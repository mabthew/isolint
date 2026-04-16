import type { SgNode, SgRoot } from '@ast-grep/napi';
import { FileContext, Finding, LangPatternSet } from './types.js';
import { isLikelyPort, hasPortContext, WELL_KNOWN_SERVICE_PORTS, SAFE_PATH_PREFIXES, DB_URL_PATTERN } from './lang/patterns.js';
import { ecosystemForExtension } from './lang/index.js';

// ---------------------------------------------------------------------------
// Module-level cache for the dynamic import
// ---------------------------------------------------------------------------

// null = not yet attempted, false = unavailable (native binary failed), object = loaded
let _astMod: any | false = null;
/** Warm the ast-grep cache. Call once at engine startup. */
export async function initAstGrep(): Promise<boolean> {
  if (_astMod !== null) return _astMod !== false;
  try {
    _astMod = await import('@ast-grep/napi');
    return true;
  } catch {
    _astMod = false;
    return false;
  }
}

/** Sync check — only valid after initAstGrep() has resolved. */
export function isAstAvailable(): boolean {
  return _astMod !== null && _astMod !== false;
}

// ---------------------------------------------------------------------------
// Extension → language mapping (Phase A: JS/TS only)
// ---------------------------------------------------------------------------

/** Extensions handled by base @ast-grep/napi (no lang packs). */
export const EXT_TO_LANG: Record<string, string> = {
  '.ts':  'TypeScript',
  '.tsx': 'Tsx',
  '.js':  'JavaScript',
  '.jsx': 'Tsx',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _parseCache: { content: string; lang: string; root: SgNode } | null = null;

function parseFile(file: FileContext): SgNode | null {
  const lang = EXT_TO_LANG[file.extension];
  if (!lang) return null;

  // Single-entry cache: both rules run on the same file sequentially.
  // Keyed on content (reference-equal in engine, fast mismatch otherwise) + lang.
  if (_parseCache && _parseCache.content === file.content && _parseCache.lang === lang) {
    return _parseCache.root;
  }

  try {
    const tree: SgRoot = _astMod.parse(lang, file.content);
    const root = tree.root();
    _parseCache = { content: file.content, lang, root };
    return root;
  } catch {
    _parseCache = null;
    return null;
  }
}

/** Collect all string-like AST nodes (string literals, template strings, JSX text). */
function collectStringNodes(root: SgNode): SgNode[] {
  return [
    ...root.findAll({ rule: { kind: 'string' } }),
    ...root.findAll({ rule: { kind: 'template_string' } }),
    ...root.findAll({ rule: { kind: 'jsx_text' } }),
  ];
}

/** Env-var reference check shared across AST detection functions. */
function lineHasEnvRef(line: string): boolean {
  return line.includes('process.env') || line.includes('os.environ') ||
    line.includes('os.Getenv') || line.includes('env::var') ||
    line.includes('ENV[') || line.includes('${');
}

// ---------------------------------------------------------------------------
// astDetectPorts
// ---------------------------------------------------------------------------

/**
 * AST-based port detection for JS/TS source files.
 *
 * Returns:
 *   Finding[]  — parsed successfully (may be empty → regex is SKIPPED)
 *   null       — unsupported extension or parse failure → caller falls back to regex
 */
export function astDetectPorts(
  file: FileContext,
  langPatterns: LangPatternSet[],
): Finding[] | null {
  if (!isAstAvailable()) return null;

  // Pre-filter: skip parsing if file has no port-range numbers
  if (!/\d{4,5}/.test(file.content)) return [];

  const root = parseFile(file);
  if (!root) return null;

  const findings: Finding[] = [];
  const eco = ecosystemForExtension(file.extension);
  const relevantPatterns = langPatterns.filter(
    p => p.sourceExtensions.includes(file.extension) || eco === p.ecosystem,
  );
  const foundLines = new Set<number>();

  // --- Pattern 1: .listen($PORT) structural match ---
  // Need two patterns: single-arg and multi-arg
  const listenSingle = root.findAll({ rule: { pattern: '$OBJ.listen($PORT)' } });
  const listenMulti = root.findAll({ rule: { pattern: '$OBJ.listen($PORT, $$$REST)' } });

  for (const node of [...listenSingle, ...listenMulti]) {
    const portNode = node.getMatch('PORT');
    if (!portNode || portNode.kind() !== 'number') continue;

    const port = parseInt(portNode.text(), 10);
    if (!isLikelyPort(port)) continue;

    // Skip if the call already references an env var
    const callText = node.text();
    if (callText.includes('process.env') || callText.includes('os.environ') ||
        callText.includes('os.Getenv') || callText.includes('env::var') ||
        callText.includes('ENV[') || callText.includes('${')) continue;

    const range = portNode.range();
    const lineNum = range.start.line + 1; // 0-indexed → 1-indexed
    const col = range.start.column + 1;
    foundLines.add(lineNum);

    const ps = relevantPatterns[0];
    const fix = buildSourcePortFix(ps, port, false);

    findings.push({
      ruleId: `hardcoded-ports/${eco !== 'unknown' ? eco : 'node'}`,
      category: 'hardcoded-port',
      severity: 'high',
      filePath: file.filePath,
      line: lineNum,
      column: col,
      matchedText: String(port),
      message: `Server .listen() with hardcoded port: port ${port}`,
      context: file.lines[lineNum - 1]?.trim() ?? '',
      ecosystem: eco !== 'unknown' ? eco : undefined,
      suggestedFix: fix,
    });
  }

  // --- Pattern 2: number literals in port-relevant contexts ---
  // Instead of trying to pattern-match every port assignment form,
  // find all number nodes and apply the same heuristics as the regex path.
  // AST guarantees these are real code, not comments.
  const allNumbers = root.findAll({ rule: { kind: 'number' } });
  for (const numNode of allNumbers) {
    const port = parseInt(numNode.text(), 10);
    if (!isLikelyPort(port)) continue;

    // Check parent early — needed for negative-number check and context checks
    const parent = numNode.parent();
    const parentKind = parent?.kind();

    // Negative numbers (parent is unary_expression with `-`) are never ports
    if (parentKind === 'unary_expression') continue;

    const range = numNode.range();
    const lineNum = range.start.line + 1;

    // Skip if already found by .listen() pattern
    if (foundLines.has(lineNum)) continue;

    const lineContent = file.lines[lineNum - 1] ?? '';

    // Skip if line already uses an env var
    if (lineContent.includes('process.env') || lineContent.includes('os.environ') ||
        lineContent.includes('os.Getenv') || lineContent.includes('env::var') ||
        lineContent.includes('ENV[') || lineContent.includes('${')) continue;

    // Check if this number is in a port-relevant context
    // Use the parent node to detect structural patterns
    let isPortContext = false;
    let description = '';

    if (parentKind === 'pair') {
      // Object property: { port: 3000 }
      const keyNode = parent!.children().find(c => c.kind() === 'property_identifier');
      if (keyNode && /port/i.test(keyNode.text())) {
        isPortContext = true;
        description = 'Port assignment with hardcoded value';
      }
    }

    if (!isPortContext && parentKind === 'variable_declarator') {
      // const port = 3000
      const nameNode = parent!.children().find(c => c.kind() === 'identifier');
      if (nameNode && /port/i.test(nameNode.text())) {
        isPortContext = true;
        description = 'Port assignment with hardcoded value';
      }
    }

    if (!isPortContext && parentKind === 'arguments') {
      // Already handled by .listen() pattern above — skip other call args
      // unless there's port context on the line
      if (hasPortContext(lineContent)) {
        isPortContext = true;
        description = 'Port binding with hardcoded value';
      }
    }

    // Fallback: check the line content for port context (same heuristic as regex path)
    if (!isPortContext && hasPortContext(lineContent)) {
      isPortContext = true;
      description = 'Port assignment with hardcoded value';
    }

    if (!isPortContext) continue;

    foundLines.add(lineNum);
    const col = range.start.column + 1;
    const ps = relevantPatterns[0];
    const fix = buildSourcePortFix(ps, port, false);

    findings.push({
      ruleId: `hardcoded-ports/${eco !== 'unknown' ? eco : 'node'}`,
      category: 'hardcoded-port',
      severity: 'high',
      filePath: file.filePath,
      line: lineNum,
      column: col,
      matchedText: String(port),
      message: `${description}: port ${port}`,
      context: lineContent.trim(),
      ecosystem: eco !== 'unknown' ? eco : undefined,
      suggestedFix: fix,
    });
  }

  // --- Pattern 3: string literals containing localhost:NNNN ---
  const LOCALHOST_RE = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})/;
  const stringNodes = [
    ...root.findAll({ rule: { kind: 'string' } }),
    ...root.findAll({ rule: { kind: 'template_string' } }),
    ...root.findAll({ rule: { kind: 'jsx_text' } }),
  ];

  for (const node of stringNodes) {
    const text = node.text();
    const localhostMatch = LOCALHOST_RE.exec(text);
    if (!localhostMatch) continue;

    const port = parseInt(localhostMatch[1], 10);
    if (!isLikelyPort(port)) continue;

    const range = node.range();
    const lineNum = range.start.line + 1;

    // Skip if already found by earlier patterns
    if (foundLines.has(lineNum)) continue;

    const lineContent = file.lines[lineNum - 1] ?? '';

    // Skip if already using env var
    if (lineContent.includes('process.env') || lineContent.includes('os.environ') ||
        lineContent.includes('os.Getenv') || lineContent.includes('${')) continue;

    foundLines.add(lineNum);

    findings.push({
      ruleId: 'hardcoded-ports/localhost',
      category: 'hardcoded-port',
      severity: WELL_KNOWN_SERVICE_PORTS.has(port) ? 'high' : 'medium',
      filePath: file.filePath,
      line: lineNum,
      column: range.start.column + 1,
      matchedText: localhostMatch[0],
      message: `Hardcoded localhost URL with port ${port}`,
      context: lineContent.trim(),
      ecosystem: eco !== 'unknown' ? eco : undefined,
      suggestedFix: {
        description: 'Use an environment variable for the port in this URL',
        replacement: localhostMatch[0],
        confidence: 'manual',
        howToApply: `Extract the port to an environment variable and build the URL dynamically (e.g., \`http://localhost:\${PORT}\` where PORT defaults to ${port})`,
        docUrl: 'https://isolint.dev/docs/rules/hardcoded-ports',
      },
    });
  }

  return findings;
}

/** Build a source-code suggestedFix for an AST-detected port. */
function buildSourcePortFix(
  ps: LangPatternSet | undefined,
  port: number,
  isUrlEmbedded: boolean,
): Finding['suggestedFix'] {
  if (!ps) return undefined;
  const template = ps.fixTemplates['hardcoded-port'];
  if (!template) return undefined;

  if (isUrlEmbedded) {
    return {
      description: 'Use an environment variable for the port in this URL',
      replacement: String(port),
      confidence: 'manual',
      howToApply: `Extract the port to an environment variable and build the URL dynamically (e.g., \`http://localhost:\${PORT}\` where PORT defaults to ${port})`,
      docUrl: 'https://isolint.dev/docs/rules/hardcoded-ports',
    };
  }

  // For Phase A (JS/TS), this is always 'node' ecosystem → auto confidence
  const replacement = template.envVarPattern.replace('$ORIGINAL', String(port));
  return {
    description: template.description,
    replacement,
    confidence: 'auto',
    docUrl: 'https://isolint.dev/docs/rules/hardcoded-ports',
  };
}

// ---------------------------------------------------------------------------
// astDetectAbsolutePaths
// ---------------------------------------------------------------------------

const ABS_PATH_PATTERNS = [
  { regex: /(?:\/Users\/\w+|\/home\/\w+|C:\\Users\\\w+)(?:[/\\][^\s"'`,:;)}\]]+)+/, desc: 'Hardcoded user home directory path' },
  { regex: /[A-Z]:\\(?:\w+\\){2,}[^\s"'`,:;)}\]]+/, desc: 'Hardcoded Windows drive path' },
  { regex: /(?:\/opt\/\w+|\/srv\/\w+|\/var\/www\/\w+)(?:\/[^\s"'`,:;)}\]]+)+/, desc: 'Hardcoded server deployment path' },
];

/**
 * AST-based absolute path detection for JS/TS source files.
 *
 * Returns:
 *   Finding[]  — parsed successfully (may be empty → regex is SKIPPED)
 *   null       — unsupported extension or parse failure → caller falls back to regex
 */
export function astDetectAbsolutePaths(
  file: FileContext,
  langPatterns: LangPatternSet[],
): Finding[] | null {
  if (!isAstAvailable()) return null;
  if (file.content.includes('\0')) return null; // binary content guard

  // Pre-filter: skip parsing if file has no path-like patterns
  if (!/(?:\/Users\/|\/home\/|C:\\Users|\/opt\/|\/srv\/|\/var\/www\/)/.test(file.content)) return [];

  const root = parseFile(file);
  if (!root) return null;

  const findings: Finding[] = [];
  const eco = ecosystemForExtension(file.extension);

  // Find all string and template_string nodes — AST guarantees these are code, not comments
  const stringNodes = [
    ...root.findAll({ rule: { kind: 'string' } }),
    ...root.findAll({ rule: { kind: 'template_string' } }),
    ...root.findAll({ rule: { kind: 'jsx_text' } }),
  ];

  for (const node of stringNodes) {
    const text = node.text();
    for (const { regex, desc } of ABS_PATH_PATTERNS) {
      const match = regex.exec(text);
      if (!match) continue;

      const matchedPath = match[0];
      if (SAFE_PATH_PREFIXES.some(prefix => matchedPath.startsWith(prefix))) continue;

      const range = node.range();
      const lineNum = range.start.line + 1;
      const lineContent = file.lines[lineNum - 1] ?? '';

      const relativePath = suggestRelativePath(matchedPath);
      const fixTemplate = langPatterns
        .find(p => p.ecosystem === eco)
        ?.fixTemplates['absolute-path'];

      const replacement = fixTemplate
        ? fixTemplate.envVarPattern.replace('$RELATIVE', relativePath)
        : `path.resolve(__dirname, '${relativePath}')`;
      const fixDescription = fixTemplate
        ? fixTemplate.description
        : 'Use a relative path or environment variable';

      findings.push({
        ruleId: 'absolute-paths/enlistment',
        category: 'absolute-path',
        severity: 'critical',
        filePath: file.filePath,
        line: lineNum,
        column: range.start.column + 1,
        matchedText: matchedPath,
        message: `${desc}: ${matchedPath}`,
        context: lineContent.trim(),
        ecosystem: eco !== 'unknown' ? eco : undefined,
        suggestedFix: {
          description: fixDescription,
          replacement,
          confidence: 'manual',
          howToApply: 'Replace with a relative path or environment variable so it works in any worktree location',
          docUrl: 'https://isolint.dev/docs/rules/absolute-paths',
        },
      });
      break; // only first pattern match per string node
    }
  }

  return findings;
}

/** Extract a useful relative path from an absolute path. Mirrors absolute-paths.ts logic. */
function suggestRelativePath(absPath: string): string {
  const parts = absPath.replace(/\\/g, '/').split('/');
  for (let i = 0; i < parts.length; i++) {
    if (['src', 'lib', 'app', 'config', 'public', 'static', 'assets', 'data'].includes(parts[i])) {
      return './' + parts.slice(i).join('/');
    }
  }
  return './' + parts.slice(-3).join('/');
}

// ---------------------------------------------------------------------------
// astDetectDatabaseStrings
// ---------------------------------------------------------------------------

const DB_PROTOCOL_PREFILTER = /(postgresql|postgres|mysql|mongodb|redis|amqp|mssql|sqlite)(?:\+\w+)?:\/\//;
const DB_KEYWORD_PREFILTER = /database|DATABASE|DB_URL|SQLALCHEMY|connection.?string/i;

/**
 * AST-based database connection string detection for JS/TS source files.
 *
 * Returns:
 *   Finding[]  — parsed successfully (may be empty → regex is SKIPPED)
 *   null       — unsupported extension or parse failure → caller falls back to regex
 */
export function astDetectDatabaseStrings(
  file: FileContext,
  langPatterns: LangPatternSet[],
): Finding[] | null {
  if (!isAstAvailable()) return null;

  // Pre-filter: skip parsing if file has no DB-related content
  if (!DB_PROTOCOL_PREFILTER.test(file.content) && !DB_KEYWORD_PREFILTER.test(file.content)) return [];

  const root = parseFile(file);
  if (!root) return null;

  const findings: Finding[] = [];
  const eco = ecosystemForExtension(file.extension);
  const stringNodes = collectStringNodes(root);
  const foundLines = new Set<number>();

  // 1. Universal DB URL pattern
  for (const node of stringNodes) {
    const text = node.text();
    const dbUrlRegex = new RegExp(DB_URL_PATTERN.source, DB_URL_PATTERN.flags);
    let match: RegExpExecArray | null;
    while ((match = dbUrlRegex.exec(text)) !== null) {
      const url = match[0];
      const protocol = match[1];
      const range = node.range();
      const lineNum = range.start.line + 1;
      const lineContent = file.lines[lineNum - 1] ?? '';

      if (lineHasEnvRef(lineContent)) continue;
      if (foundLines.has(lineNum)) continue;
      foundLines.add(lineNum);

      const fixTemplate = langPatterns
        .find(p => p.ecosystem === eco)
        ?.fixTemplates['database-string'];

      const replacement = fixTemplate
        ? fixTemplate.envVarPattern.replace('$ORIGINAL', url)
        : 'process.env.DATABASE_URL';
      const fixDescription = fixTemplate
        ? fixTemplate.description
        : 'Use an environment variable for the database URL';

      findings.push({
        ruleId: 'database-strings/url',
        category: 'database-string',
        severity: 'critical',
        filePath: file.filePath,
        line: lineNum,
        column: range.start.column + 1,
        matchedText: url,
        message: `Hardcoded ${protocol} connection string — database name should be per-worktree`,
        context: lineContent.trim(),
        ecosystem: eco !== 'unknown' ? eco : undefined,
        suggestedFix: {
          description: fixDescription,
          replacement,
          confidence: 'review',
          docUrl: 'https://isolint.dev/docs/rules/database-strings',
        },
      });
    }
  }

  // 2. Ecosystem-specific DB patterns
  for (const ps of langPatterns) {
    if (!ps.sourceExtensions.includes(file.extension) && ps.ecosystem !== eco) continue;

    for (const patDef of ps.dbStringPatterns) {
      for (const node of stringNodes) {
        const text = node.text();
        const regex = new RegExp(patDef.pattern.source, patDef.pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
          const range = node.range();
          const lineNum = range.start.line + 1;
          const lineContent = file.lines[lineNum - 1] ?? '';

          if (foundLines.has(lineNum)) continue;
          if (lineHasEnvRef(lineContent)) continue;
          foundLines.add(lineNum);

          const displayText = match[1] ?? match[0];
          const ecoFixTemplate = ps.fixTemplates['database-string'];

          findings.push({
            ruleId: `database-strings/${ps.ecosystem}`,
            category: 'database-string',
            severity: 'high',
            filePath: file.filePath,
            line: lineNum,
            column: range.start.column + 1,
            matchedText: displayText,
            message: patDef.description,
            context: lineContent.trim(),
            ecosystem: ps.ecosystem,
            suggestedFix: {
              description: ecoFixTemplate?.description || 'Use an environment variable for the database connection string',
              replacement: ecoFixTemplate
                ? ecoFixTemplate.envVarPattern.replace('$ORIGINAL', displayText)
                : 'process.env.DATABASE_URL',
              confidence: 'review',
              docUrl: 'https://isolint.dev/docs/rules/database-strings',
            },
          });
        }
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// astDetectPidAndSockets
// ---------------------------------------------------------------------------

const PID_SOCK_PREFILTER = /\.pid|\.sock|pidfile|pid_file/i;
const PID_SOCK_RE = /[^\s"']*\.(?:pid|sock(?:et)?)\b/;

/**
 * AST-based PID file and socket path detection for JS/TS source files.
 *
 * Returns:
 *   Finding[]  — parsed successfully (may be empty → regex is SKIPPED)
 *   null       — unsupported extension or parse failure → caller falls back to regex
 */
export function astDetectPidAndSockets(
  file: FileContext,
  langPatterns: LangPatternSet[],
): Finding[] | null {
  if (!isAstAvailable()) return null;

  if (!PID_SOCK_PREFILTER.test(file.content)) return [];

  const root = parseFile(file);
  if (!root) return null;

  const findings: Finding[] = [];
  const eco = ecosystemForExtension(file.extension);
  const stringNodes = collectStringNodes(root);
  const foundLines = new Set<number>();

  // 1. Ecosystem-specific PID/socket patterns
  for (const ps of langPatterns) {
    for (const patDef of ps.pidSocketPatterns) {
      for (const node of stringNodes) {
        const text = node.text();
        const regex = new RegExp(patDef.pattern.source, patDef.pattern.flags);
        if (!regex.test(text)) continue;

        const range = node.range();
        const lineNum = range.start.line + 1;
        if (foundLines.has(lineNum)) continue;
        foundLines.add(lineNum);

        const lineContent = file.lines[lineNum - 1] ?? '';
        findings.push({
          ruleId: `pid-and-sockets/${ps.ecosystem}`,
          category: 'pid-socket',
          severity: 'high',
          filePath: file.filePath,
          line: lineNum,
          column: range.start.column + 1,
          matchedText: text,
          message: `${patDef.description}: ${text}`,
          context: lineContent.trim(),
          ecosystem: ps.ecosystem,
          suggestedFix: {
            description: 'Each worktree needs its own PID/socket file, otherwise only one instance can run at a time',
            replacement: text,
            confidence: 'manual',
            howToApply: 'Include the worktree name in the PID/socket file path to make it unique (e.g., server.<worktree>.pid or puma.<worktree>.sock)',
            docUrl: 'https://isolint.dev/docs/rules/pid-and-sockets',
          },
        });
      }
    }
  }

  // 2. Universal: string nodes containing .pid or .sock paths
  for (const node of stringNodes) {
    const text = node.text();
    const match = PID_SOCK_RE.exec(text);
    if (!match) continue;

    const range = node.range();
    const lineNum = range.start.line + 1;
    if (foundLines.has(lineNum)) continue;
    foundLines.add(lineNum);

    const lineContent = file.lines[lineNum - 1] ?? '';
    const matchedPath = match[0];

    findings.push({
      ruleId: 'pid-and-sockets/config',
      category: 'pid-socket',
      severity: 'high',
      filePath: file.filePath,
      line: lineNum,
      column: range.start.column + 1,
      matchedText: matchedPath,
      message: `Hardcoded PID/socket file path: ${matchedPath}`,
      context: lineContent.trim(),
      ecosystem: eco !== 'unknown' ? eco : undefined,
      suggestedFix: {
        description: 'Each worktree needs its own PID/socket file — two servers can\'t write to the same one',
        replacement: matchedPath,
        confidence: 'manual',
        howToApply: 'Include the worktree name in the PID/socket file path to make it unique (e.g., server.<worktree>.pid)',
        docUrl: 'https://isolint.dev/docs/rules/pid-and-sockets',
      },
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// astDetectLogFilePaths
// ---------------------------------------------------------------------------

const LOG_PREFILTER = /\.log\b/i;
const LOG_CONFIG_CONTEXT = /(?:logFile|log_file|logPath|log_path)\s*[:=]/i;

/**
 * AST-based log file path detection for JS/TS source files.
 *
 * Returns:
 *   Finding[]  — parsed successfully (may be empty → regex is SKIPPED)
 *   null       — unsupported extension or parse failure → caller falls back to regex
 */
export function astDetectLogFilePaths(
  file: FileContext,
  langPatterns: LangPatternSet[],
): Finding[] | null {
  if (!isAstAvailable()) return null;

  if (!LOG_PREFILTER.test(file.content)) return [];

  const root = parseFile(file);
  if (!root) return null;

  const findings: Finding[] = [];
  const eco = ecosystemForExtension(file.extension);
  const stringNodes = collectStringNodes(root);
  const foundLines = new Set<number>();

  // 1. Universal: string nodes containing .log file paths
  for (const node of stringNodes) {
    const text = node.text();
    if (!/\.log\b/.test(text)) continue;

    // Require either a path separator (real file path) or log assignment context
    const hasPathSep = text.includes('/') || text.includes('\\');
    const range = node.range();
    const lineNum = range.start.line + 1;
    const lineContent = file.lines[lineNum - 1] ?? '';
    const hasLogContext = LOG_CONFIG_CONTEXT.test(lineContent);

    if (!hasPathSep && !hasLogContext) continue;

    if (lineHasEnvRef(lineContent)) continue;
    if (foundLines.has(lineNum)) continue;
    foundLines.add(lineNum);

    // Extract the log path from the string
    const logPathMatch = text.match(/[\w./-]+\.log\b/);
    const logPath = logPathMatch ? logPathMatch[0] : text;

    findings.push({
      ruleId: 'log-file-paths/hardcoded',
      category: 'log-file-path',
      severity: 'low',
      filePath: file.filePath,
      line: lineNum,
      column: range.start.column + 1,
      matchedText: logPath,
      message: `Hardcoded log file path: ${logPath}`,
      context: lineContent.trim(),
      ecosystem: eco !== 'unknown' ? eco : undefined,
      suggestedFix: {
        description: 'Parallel worktrees writing to the same log file will interleave output',
        replacement: logPath,
        confidence: 'manual',
        howToApply: 'Include the worktree name in the log file path so each worktree writes to a separate file (e.g., app.<worktree>.log)',
        docUrl: 'https://isolint.dev/docs/rules/log-file-paths',
      },
    });
  }

  // 2. Ecosystem-specific log patterns
  for (const ps of langPatterns) {
    for (const patDef of ps.logPathPatterns) {
      for (const node of stringNodes) {
        const text = node.text();
        const regex = new RegExp(patDef.pattern.source, patDef.pattern.flags);
        if (!regex.test(text)) continue;

        const range = node.range();
        const lineNum = range.start.line + 1;
        if (foundLines.has(lineNum)) continue;

        const lineContent = file.lines[lineNum - 1] ?? '';
        foundLines.add(lineNum);

        findings.push({
          ruleId: `log-file-paths/${ps.ecosystem}`,
          category: 'log-file-path',
          severity: 'low',
          filePath: file.filePath,
          line: lineNum,
          column: range.start.column + 1,
          matchedText: text,
          message: patDef.description,
          context: lineContent.trim(),
          ecosystem: ps.ecosystem,
          suggestedFix: {
            description: 'Parallel worktrees writing to the same log file will interleave output',
            replacement: text,
            confidence: 'manual',
            howToApply: 'Include the worktree name in the log file path so each worktree writes to a separate file',
            docUrl: 'https://isolint.dev/docs/rules/log-file-paths',
          },
        });
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// astDetectTempDirectories
// ---------------------------------------------------------------------------

const TEMP_PREFILTER = /\/tmp\/|tmpDir|temp_dir|tmpdir|mkdtemp/i;
const TMP_DIR_RE = /\/tmp\/([a-zA-Z][\w-]+)/;
const TEMP_CONFIG_CONTEXT = /(?:tmpDir|temp_dir|tempDir|tmp_dir)\s*[:=]/i;

/**
 * AST-based temp directory detection for JS/TS source files.
 *
 * Returns:
 *   Finding[]  — parsed successfully (may be empty → regex is SKIPPED)
 *   null       — unsupported extension or parse failure → caller falls back to regex
 */
export function astDetectTempDirectories(
  file: FileContext,
  langPatterns: LangPatternSet[],
): Finding[] | null {
  if (!isAstAvailable()) return null;

  if (!TEMP_PREFILTER.test(file.content)) return [];

  const root = parseFile(file);
  if (!root) return null;

  const findings: Finding[] = [];
  const stringNodes = collectStringNodes(root);
  const foundLines = new Set<number>();

  // 1. String nodes containing /tmp/name
  for (const node of stringNodes) {
    const text = node.text();
    const match = TMP_DIR_RE.exec(text);
    if (!match) continue;

    const range = node.range();
    const lineNum = range.start.line + 1;
    if (foundLines.has(lineNum)) continue;
    foundLines.add(lineNum);

    const lineContent = file.lines[lineNum - 1] ?? '';
    findings.push({
      ruleId: 'temp-directories/hardcoded',
      category: 'temp-directory',
      severity: 'low',
      filePath: file.filePath,
      line: lineNum,
      column: range.start.column + 1,
      matchedText: text,
      message: `Hardcoded /tmp subdirectory: ${match[1]}`,
      context: lineContent.trim(),
      suggestedFix: {
        description: 'Two worktrees using the same temp dir will overwrite each other\'s files',
        replacement: text,
        confidence: 'manual',
        howToApply: 'Include the worktree name in the temp directory path so each worktree uses a separate location',
        docUrl: 'https://isolint.dev/docs/rules/temp-directories',
      },
    });
  }

  // 2. Config assignments: tmpDir = "..." (check string nodes with assignment context)
  for (const node of stringNodes) {
    const range = node.range();
    const lineNum = range.start.line + 1;
    if (foundLines.has(lineNum)) continue;

    const lineContent = file.lines[lineNum - 1] ?? '';
    if (!TEMP_CONFIG_CONTEXT.test(lineContent)) continue;

    const text = node.text();
    foundLines.add(lineNum);

    findings.push({
      ruleId: 'temp-directories/hardcoded',
      category: 'temp-directory',
      severity: 'low',
      filePath: file.filePath,
      line: lineNum,
      column: range.start.column + 1,
      matchedText: text,
      message: `Hardcoded temp directory config: ${text}`,
      context: lineContent.trim(),
      suggestedFix: {
        description: 'Two worktrees using the same temp dir will overwrite each other\'s files',
        replacement: text,
        confidence: 'manual',
        howToApply: 'Include the worktree name in the temp directory path so each worktree uses a separate location',
        docUrl: 'https://isolint.dev/docs/rules/temp-directories',
      },
    });
  }

  // 3. Structural match: os.tmpdir() + "/suffix"
  try {
    const tmpdirConcat = root.findAll({ rule: { pattern: 'os.tmpdir() + $SUFFIX' } });
    for (const node of tmpdirConcat) {
      const range = node.range();
      const lineNum = range.start.line + 1;
      if (foundLines.has(lineNum)) continue;
      foundLines.add(lineNum);

      const suffix = node.getMatch('SUFFIX');
      const lineContent = file.lines[lineNum - 1] ?? '';

      findings.push({
        ruleId: 'temp-directories/hardcoded',
        category: 'temp-directory',
        severity: 'low',
        filePath: file.filePath,
        line: lineNum,
        column: range.start.column + 1,
        matchedText: node.text(),
        message: `os.tmpdir() with hardcoded subdirectory name: ${suffix?.text() ?? ''}`,
        context: lineContent.trim(),
        suggestedFix: {
          description: 'Two worktrees using the same temp dir will overwrite each other\'s files',
          replacement: node.text(),
          confidence: 'manual',
          howToApply: 'Include the worktree name in the temp directory path so each worktree uses a separate location',
          docUrl: 'https://isolint.dev/docs/rules/temp-directories',
        },
      });
    }
  } catch {
    // structural pattern match can fail on unusual AST shapes — not fatal
  }

  return findings;
}

