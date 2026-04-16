import {
  Rule,
  Finding,
  FileContext,
  LangPatternSet,
  FixConfidence,
  Ecosystem,
  lineNumberAt,
} from "../types.js";
import {
  hasPortContext,
  isLikelyPort,
  WELL_KNOWN_SERVICE_PORTS,
} from "../lang/patterns.js";
import { ecosystemForExtension } from "../lang/index.js";
import { isAstAvailable, EXT_TO_LANG, astDetectPorts } from '../ast-detect.js';

/** Check if a line is a comment (handles //, #, *, <!--, --, %) */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("<!--") ||
    trimmed.startsWith("--") ||
    trimmed.startsWith("%") ||
    trimmed.startsWith('"""') ||
    trimmed.startsWith("'''") ||
    trimmed.startsWith("/*")
  );
}

type FileFormat = 'json' | 'yaml' | 'properties' | 'xml' | 'shell' | 'source';

export function getFileFormat(file: FileContext): FileFormat {
  if (file.extension === '.json') return 'json';
  if (file.extension === '.yml' || file.extension === '.yaml') return 'yaml';
  if (file.extension === '.properties' || file.extension === '.ini') return 'properties';
  if (file.extension === '.xml' || file.basename.endsWith('.csproj') ||
      file.basename.endsWith('.fsproj') || file.basename.endsWith('.vbproj')) return 'xml';
  if (file.extension === '.sh' || file.extension === '.bash' || file.basename === 'Makefile') return 'shell';
  return 'source';
}

/** Ecosystems where port patterns match inside string literals (e.g. ":3000") */
const STRING_EMBEDDED_PORT_ECOSYSTEMS: Ecosystem[] = ['go', 'rust'];

/** Ecosystems whose envVarPattern produces a valid bare-numeric replacement */
const AUTO_FIX_ECOSYSTEMS: Ecosystem[] = ['node', 'python', 'ruby', 'php', 'elixir', 'swift'];

/** Pattern descriptions where the port is inside a URL/string (not a bare number) */
const URL_EMBEDDED_PATTERN_KEYWORDS = ['localhost', 'loopback', 'bind-all'];

/** Universal port pattern for .env files. */
const ENV_PORT_PATTERN = /^([A-Z_]*PORT[A-Z_]*)\s*=\s*(\d+)/gm;

/** Universal localhost:port pattern. */
const LOCALHOST_PORT_PATTERN =
  /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})/g;

/** Docker-compose ports pattern. */
const DOCKER_PORTS_PATTERN = /^\s*-\s*["']?(\d{4,5}):(\d{4,5})["']?\s*$/gm;

/** Docker-compose expose pattern. */
const DOCKER_EXPOSE_PATTERN = /^\s*-\s*["']?(\d{4,5})["']?\s*$/gm;

/** Dockerfile EXPOSE pattern. */
const DOCKERFILE_EXPOSE_PATTERN = /^EXPOSE\s+(\d{4,5})/gm;

export const hardcodedPortsRule: Rule = {
  id: "hardcoded-ports",
  name: "Hardcoded Ports",
  category: "hardcoded-port",
  description:
    "Detects hardcoded port numbers that will cause conflicts in parallel worktrees",
  defaultSeverity: "high",
  filePatterns: ["**/*"],
  detect(file: FileContext, langPatterns: LangPatternSet[]): Finding[] {
    const findings: Finding[] = [];

    // 1. .env files — high confidence
    if (file.basename.startsWith(".env")) {
      findings.push(...detectEnvPorts(file));
      return findings;
    }

    // 2. Docker files
    if (
      file.basename.startsWith("docker-compose") ||
      file.basename === "compose.yml" ||
      file.basename === "compose.yaml"
    ) {
      findings.push(...detectDockerComposePorts(file));
      return findings;
    }
    if (
      file.basename === "Dockerfile" ||
      file.basename.startsWith("Dockerfile.")
    ) {
      findings.push(...detectDockerfilePorts(file));
      return findings;
    }

    // 3. Source code — try AST first for JS/TS files
    if (isAstAvailable() && EXT_TO_LANG[file.extension]) {
      const astResult = astDetectPorts(file, langPatterns);
      if (astResult !== null) return astResult;
    }

    // Regex fallback (non-JS/TS files, or AST parse failure)
    return detectPortsRegexPath(file, langPatterns);
  },
};

/** Regex-based source code port detection. Extracted for AST parity validation. */
export function detectPortsRegexPath(file: FileContext, langPatterns: LangPatternSet[]): Finding[] {
  const findings: Finding[] = [];
  const eco = ecosystemForExtension(file.extension);
  const relevantPatterns = langPatterns.filter(
    (p) =>
      p.sourceExtensions.includes(file.extension) ||
      eco === p.ecosystem ||
      matchesConfigFileGlob(file, p.configFileGlobs),
  );

  // Run ecosystem-specific port patterns
  for (const ps of relevantPatterns) {
    for (const patDef of ps.portBindingPatterns) {
      const regex = new RegExp(patDef.pattern.source, patDef.pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(file.content)) !== null) {
        const lineNum = lineNumberAt(file.lineOffsets, match.index);
        const lineContent = file.lines[lineNum - 1] || "";
        const col =
          match.index - file.content.lastIndexOf("\n", match.index - 1);

        // Skip comments
        if (isCommentLine(lineContent)) continue;

        // Skip if line looks like it already uses an env var
        if (
          lineContent.includes("process.env") ||
          lineContent.includes("os.environ") ||
          lineContent.includes("os.Getenv") ||
          lineContent.includes("env::var") ||
          lineContent.includes("ENV[") ||
          lineContent.includes("${")
        )
          continue;

        // Special case: applicationUrl can contain multiple semicolon-separated URLs
        // e.g. "https://localhost:5243;http://localhost:5223" → emit one finding per port
        if (patDef.description.includes("applicationUrl")) {
          const urlValue = match[1];
          const portRegex = /:(\d{4,5})\b/g;
          let portMatch: RegExpExecArray | null;
          while ((portMatch = portRegex.exec(urlValue)) !== null) {
            const port = parseInt(portMatch[1], 10);
            findings.push(
              buildDotnetPortFinding(
                ps,
                patDef.description,
                port,
                file.filePath,
                lineNum,
                col,
                lineContent,
              ),
            );
          }
          continue;
        }

        const port = parseInt(match[1], 10);
        if (
          !isUnambiguousPortContext(patDef.description) &&
          !isLikelyPort(port)
        )
          continue;

        // For the broad "port: NNNN" pattern, apply stricter context filtering
        if (
          patDef.description.includes("Port assignment") &&
          !hasPortContext(lineContent)
        )
          continue;

        const format = getFileFormat(file);
        const isUrlEmbedded = URL_EMBEDDED_PATTERN_KEYWORDS.some(
          kw => patDef.description.toLowerCase().includes(kw),
        );
        const fix = buildPortFix(ps, port, format, file, isUrlEmbedded);

        findings.push({
          ruleId: `hardcoded-ports/${ps.ecosystem}`,
          category: "hardcoded-port",
          severity: "high",
          filePath: file.filePath,
          line: lineNum,
          column: col,
          matchedText: String(port),
          message: `${patDef.description}: port ${port}`,
          context: lineContent.trim(),
          ecosystem: ps.ecosystem,
          suggestedFix: fix,
        });
      }
    }
  }

  // Universal localhost:port pattern (works in any file type)
  const localhostRegex = new RegExp(
    LOCALHOST_PORT_PATTERN.source,
    LOCALHOST_PORT_PATTERN.flags,
  );
  let match: RegExpExecArray | null;
  while ((match = localhostRegex.exec(file.content)) !== null) {
    const port = parseInt(match[1], 10);
    if (!isLikelyPort(port)) continue;

    const lineNum = lineNumberAt(file.lineOffsets, match.index);
    const lineContent = file.lines[lineNum - 1] || "";

    // Skip if already found by ecosystem-specific pattern
    if (
      findings.some((f) => f.line === lineNum && f.filePath === file.filePath)
    )
      continue;

    // Skip comments
    if (isCommentLine(lineContent)) continue;

    // Skip if already using env var
    if (
      lineContent.includes("process.env") ||
      lineContent.includes("os.environ") ||
      lineContent.includes("os.Getenv") ||
      lineContent.includes("${")
    )
      continue;

    // Find ecosystem-specific fix template for the port
    const fixTemplate =
      relevantPatterns.length > 0
        ? relevantPatterns[0].fixTemplates["hardcoded-port"]
        : undefined;

    findings.push({
      ruleId: "hardcoded-ports/localhost",
      category: "hardcoded-port",
      severity: WELL_KNOWN_SERVICE_PORTS.has(port) ? "high" : "medium",
      filePath: file.filePath,
      line: lineNum,
      column: match.index - file.content.lastIndexOf("\n", match.index - 1),
      matchedText: match[0],
      message: `Hardcoded localhost URL with port ${port}`,
      context: lineContent.trim(),
      ecosystem: eco !== "unknown" ? eco : undefined,
      suggestedFix: {
        description: "Use an environment variable for the port in this URL",
        replacement: match[0],
        confidence: "manual",
        howToApply: `Extract the port to an environment variable and build the URL dynamically (e.g., \`http://localhost:\${PORT}\` where PORT defaults to ${port})`,
        docUrl: "https://isolint.dev/docs/rules/hardcoded-ports",
      },
    });
  }

  return findings;
}

/**
 * Check if a file matches any of the given config file globs.
 * Supports exact filenames (`appsettings.json`), wildcards (`*.csproj`),
 * wildcard suffixes (`appsettings.*.json`), and path fragments (`Properties/launchSettings.json`).
 */
function matchesConfigFileGlob(
  file: FileContext,
  configFileGlobs: string[],
): boolean {
  for (const glob of configFileGlobs) {
    if (glob === file.basename) return true;
    if (glob.endsWith("/") + file.basename === glob) return true;
    if (glob.includes("/") && file.filePath.endsWith(glob)) return true;
    if (glob.startsWith("*")) {
      const suffix = glob.slice(1);
      if (file.basename.endsWith(suffix)) return true;
    }
    if (glob.includes("*")) {
      const re = new RegExp(
        "^" + glob.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
      );
      if (re.test(file.basename)) return true;
    }
  }
  return false;
}

/**
 * Dotnet patterns whose context unambiguously indicates a port number,
 * so the generic `isLikelyPort` range check should be bypassed
 * (e.g. IIS Express sslPort 44365 is outside the dev port ranges but is clearly a port).
 */
const UNAMBIGUOUS_PORT_DESCRIPTIONS = [
  "applicationUrl",
  "sslPort",
  "HTTP_PORTS",
  "ListenAnyIP",
  "ListenLocalhost",
  "Listen(IPAddress",
];

function isUnambiguousPortContext(description: string): boolean {
  return UNAMBIGUOUS_PORT_DESCRIPTIONS.some((k) => description.includes(k));
}

function buildDotnetPortFinding(
  ps: LangPatternSet,
  description: string,
  port: number,
  filePath: string,
  lineNum: number,
  col: number,
  lineContent: string,
): Finding {
  return {
    ruleId: `hardcoded-ports/${ps.ecosystem}`,
    category: "hardcoded-port",
    severity: "high",
    filePath,
    line: lineNum,
    column: col,
    matchedText: `:${port}`,
    message: `${description}: port ${port}`,
    context: lineContent.trim(),
    ecosystem: ps.ecosystem,
    suggestedFix: {
      description: "Move this port to an environment variable — JSON config files cannot use inline expressions",
      replacement: `:${port}`,
      confidence: "manual",
      howToApply: `Set the port via ASPNETCORE_URLS or ASPNETCORE_HTTP_PORTS environment variable instead of hardcoding in JSON (e.g., ASPNETCORE_HTTP_PORTS=${port})`,
      docUrl: "https://isolint.dev/docs/rules/hardcoded-ports",
    },
  };
}

/** Build a file-format-aware suggestedFix for a hardcoded port in source/config. */
export function buildPortFix(
  ps: LangPatternSet,
  port: number,
  format: FileFormat,
  file: FileContext,
  isUrlEmbedded = false,
): Finding['suggestedFix'] {
  const template = ps.fixTemplates['hardcoded-port'];
  if (!template) return undefined;

  const portStr = String(port);

  // JSON / XML: can't use inline env expressions
  if (format === 'json' || format === 'xml') {
    return {
      description: 'This config format does not support inline expressions — move the port to an environment variable',
      replacement: portStr,
      confidence: 'manual',
      howToApply: `Set the port via an environment variable (e.g., PORT=${port}) and configure the application to read it at startup`,
      docUrl: 'https://isolint.dev/docs/rules/hardcoded-ports',
    };
  }

  // .properties / .ini: Spring-style placeholder works
  if (format === 'properties') {
    return {
      description: template.description,
      replacement: `\${PORT:${port}}`,
      confidence: 'auto',
      docUrl: 'https://isolint.dev/docs/rules/hardcoded-ports',
    };
  }

  // YAML: ${VAR:-default} is supported by docker-compose/Spring but not all YAML consumers
  if (format === 'yaml') {
    return {
      description: template.description,
      replacement: `\${PORT:-${port}}`,
      confidence: 'review',
      docUrl: 'https://isolint.dev/docs/rules/hardcoded-ports',
    };
  }

  // Source code: port inside a URL string (localhost:PORT, 127.0.0.1:PORT, etc.)
  // or Go/Rust where ports are always inside string literals — can't replace bare number
  if (isUrlEmbedded || STRING_EMBEDDED_PORT_ECOSYSTEMS.includes(ps.ecosystem)) {
    return {
      description: "Use an environment variable for the port in this URL",
      replacement: portStr,
      confidence: 'manual',
      howToApply: `Extract the port to an environment variable and build the URL dynamically (e.g., \`http://localhost:\${PORT}\` where PORT defaults to ${port})`,
      docUrl: 'https://isolint.dev/docs/rules/hardcoded-ports',
    };
  }

  // Source code: ecosystems with valid bare-numeric replacement
  const replacement = template.envVarPattern.replace('$ORIGINAL', portStr);
  const confidence: FixConfidence = AUTO_FIX_ECOSYSTEMS.includes(ps.ecosystem) ? 'auto' : 'review';

  return {
    description: template.description,
    replacement,
    confidence,
    docUrl: 'https://isolint.dev/docs/rules/hardcoded-ports',
  };
}

function detectEnvPorts(file: FileContext): Finding[] {
  const findings: Finding[] = [];
  const regex = new RegExp(ENV_PORT_PATTERN.source, ENV_PORT_PATTERN.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(file.content)) !== null) {
    const varName = match[1];
    const port = parseInt(match[2], 10);
    if (port < 1024 || port > 65535) continue;

    const lineNum = lineNumberAt(file.lineOffsets, match.index);

    findings.push({
      ruleId: "hardcoded-ports/env-file",
      category: "hardcoded-port",
      severity: "critical",
      filePath: file.filePath,
      line: lineNum,
      column: 1,
      matchedText: match[0],
      message: `Hardcoded port ${port} in ${varName} — will conflict across worktrees`,
      context: file.lines[lineNum - 1]?.trim() || match[0],
      suggestedFix: {
        description: `Each worktree needs a unique ${varName}. Set a different value in each worktree's .env file.`,
        replacement: match[0],
        confidence: "manual",
        howToApply: `Set a unique ${varName} in each worktree's .env (e.g., ${port}, ${
          port + 1
        }, ${port + 2}). Consider using a tool like worktrunk or direnv to automate this.`,
        docUrl: "https://isolint.dev/docs/rules/hardcoded-ports",
      },
    });
  }
  return findings;
}

function detectDockerComposePorts(file: FileContext): Finding[] {
  const findings: Finding[] = [];
  const portsRegex = new RegExp(
    DOCKER_PORTS_PATTERN.source,
    DOCKER_PORTS_PATTERN.flags,
  );
  let match: RegExpExecArray | null;

  while ((match = portsRegex.exec(file.content)) !== null) {
    const hostPort = parseInt(match[1], 10);
    const containerPort = parseInt(match[2], 10);
    const lineNum = lineNumberAt(file.lineOffsets, match.index);

    // Skip if already using variable interpolation
    if (match[0].includes("${")) continue;

    // matchedText = just the port mapping value (e.g. "3000:3000" or 3000:3000)
    // so replaceAll splices cleanly without disrupting surrounding YAML structure
    const rawMapping = match[0].trim().replace(/^-\s*/, '');
    const unquoted = rawMapping.replace(/^["']|["']$/g, '');

    findings.push({
      ruleId: "hardcoded-ports/docker-compose",
      category: "hardcoded-port",
      severity: "critical",
      filePath: file.filePath,
      line: lineNum,
      column: 1,
      matchedText: unquoted,
      message: `Fixed Docker port mapping ${hostPort}:${containerPort} — host port will conflict across worktrees`,
      context: file.lines[lineNum - 1]?.trim() || match[0].trim(),
      suggestedFix: {
        description: `Set HOST_PORT in each worktree's .env to avoid port collisions on the host`,
        replacement: `\${HOST_PORT:-${hostPort}}:${containerPort}`,
        confidence: "auto",
        docUrl: "https://isolint.dev/docs/rules/hardcoded-ports",
      },
    });
  }

  return findings;
}

function detectDockerfilePorts(file: FileContext): Finding[] {
  const findings: Finding[] = [];
  const regex = new RegExp(
    DOCKERFILE_EXPOSE_PATTERN.source,
    DOCKERFILE_EXPOSE_PATTERN.flags,
  );
  let match: RegExpExecArray | null;

  while ((match = regex.exec(file.content)) !== null) {
    const port = parseInt(match[1], 10);
    const lineNum = lineNumberAt(file.lineOffsets, match.index);

    // Check if ARG is used
    if (
      file.content.includes(`ARG PORT`) ||
      file.content.includes(`ARG EXPOSE_PORT`)
    )
      continue;

    findings.push({
      ruleId: "hardcoded-ports/dockerfile",
      category: "hardcoded-port",
      severity: "medium",
      filePath: file.filePath,
      line: lineNum,
      column: 1,
      matchedText: match[0],
      message: `Hardcoded EXPOSE ${port} in Dockerfile`,
      context: file.lines[lineNum - 1]?.trim() || match[0],
      suggestedFix: {
        description: `Use a build ARG to make the port overridable per worktree`,
        replacement: match[0],
        confidence: "manual",
        howToApply: `Add \`ARG PORT=${port}\` before this line and change to \`EXPOSE $PORT\`. Then build with \`docker build --build-arg PORT=<port>\` per worktree.`,
        docUrl: "https://isolint.dev/docs/rules/hardcoded-ports",
      },
    });
  }

  return findings;
}
