import type { SgNode, SgRoot } from '@ast-grep/napi';
import { FileContext, Finding, LangPatternSet } from './types.js';
import { isLikelyPort, hasPortContext, WELL_KNOWN_SERVICE_PORTS, SAFE_PATH_PREFIXES } from './lang/patterns.js';
import { ecosystemForExtension } from './lang/index.js';

// ---------------------------------------------------------------------------
// Module-level cache for the dynamic import
// ---------------------------------------------------------------------------

// null = not yet attempted, false = unavailable (native binary failed), object = loaded
let _astMod: any | false = null;
let _parityMode = false;

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

export function setParityMode(v: boolean): void { _parityMode = v; }
export function isParityMode(): boolean { return _parityMode; }

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
// Parity validation
// ---------------------------------------------------------------------------

/**
 * Compare AST and regex findings and log any misses to stderr.
 * Only runs when verbose/parity mode is enabled.
 */
export function logParityDivergences(
  ruleName: string,
  filePath: string,
  astFindings: Finding[],
  regexFindings: Finding[],
): void {
  const astLines = new Set(astFindings.map(f => f.line));
  for (const rf of regexFindings) {
    if (!astLines.has(rf.line)) {
      console.error(
        `[ast-parity] ${ruleName} MISS in ${filePath}:${rf.line} — ` +
        `regex found "${rf.matchedText}" but AST did not`,
      );
    }
  }
  const regexLines = new Set(regexFindings.map(f => f.line));
  for (const af of astFindings) {
    if (!regexLines.has(af.line)) {
      console.error(
        `[ast-parity] ${ruleName} EXTRA in ${filePath}:${af.line} — ` +
        `AST found "${af.matchedText}" but regex did not`,
      );
    }
  }
}
