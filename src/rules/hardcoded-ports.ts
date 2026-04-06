import { Rule, Finding, FileContext, LangPatternSet, lineNumberAt } from '../types.js';
import { hasPortContext, isLikelyPort, WELL_KNOWN_SERVICE_PORTS } from '../lang/patterns.js';
import { ecosystemForExtension } from '../lang/index.js';

/** Check if a line is a comment (handles //, #, *, <!--, --, %) */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') ||
         trimmed.startsWith('<!--') || trimmed.startsWith('--') || trimmed.startsWith('%') ||
         trimmed.startsWith('"""') || trimmed.startsWith("'''") || trimmed.startsWith('/*');
}

/** Universal port pattern for .env files. */
const ENV_PORT_PATTERN = /^([A-Z_]*PORT[A-Z_]*)\s*=\s*(\d+)/gm;

/** Universal localhost:port pattern. */
const LOCALHOST_PORT_PATTERN = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})/g;

/** Docker-compose ports pattern. */
const DOCKER_PORTS_PATTERN = /^\s*-\s*["']?(\d{4,5}):(\d{4,5})["']?\s*$/gm;

/** Docker-compose expose pattern. */
const DOCKER_EXPOSE_PATTERN = /^\s*-\s*["']?(\d{4,5})["']?\s*$/gm;

/** Dockerfile EXPOSE pattern. */
const DOCKERFILE_EXPOSE_PATTERN = /^EXPOSE\s+(\d{4,5})/gm;

export const hardcodedPortsRule: Rule = {
  id: 'hardcoded-ports',
  name: 'Hardcoded Ports',
  category: 'hardcoded-port',
  description: 'Detects hardcoded port numbers that will cause conflicts in parallel worktrees',
  defaultSeverity: 'high',
  filePatterns: [
    '**/*',
  ],
  detect(file: FileContext, langPatterns: LangPatternSet[]): Finding[] {
    const findings: Finding[] = [];

    // 1. .env files — high confidence
    if (file.basename.startsWith('.env')) {
      findings.push(...detectEnvPorts(file));
      return findings;
    }

    // 2. Docker files
    if (file.basename.startsWith('docker-compose') || file.basename === 'compose.yml' || file.basename === 'compose.yaml') {
      findings.push(...detectDockerComposePorts(file));
      return findings;
    }
    if (file.basename === 'Dockerfile' || file.basename.startsWith('Dockerfile.')) {
      findings.push(...detectDockerfilePorts(file));
      return findings;
    }

    // 3. Source code — use ecosystem-specific patterns + universal patterns
    const eco = ecosystemForExtension(file.extension);
    const relevantPatterns = langPatterns.filter(p =>
      p.sourceExtensions.includes(file.extension) || eco === p.ecosystem
    );

    // Run ecosystem-specific port patterns
    for (const ps of relevantPatterns) {
      for (const patDef of ps.portBindingPatterns) {
        const regex = new RegExp(patDef.pattern.source, patDef.pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(file.content)) !== null) {
          const port = parseInt(match[1], 10);
          if (!isLikelyPort(port)) continue;

          const lineNum = lineNumberAt(file.lineOffsets, match.index);
          const lineContent = file.lines[lineNum - 1] || '';
          const col = match.index - file.content.lastIndexOf('\n', match.index - 1);

          // Skip comments
          if (isCommentLine(lineContent)) continue;

          // Skip if line looks like it already uses an env var
          if (lineContent.includes('process.env') || lineContent.includes('os.environ') ||
              lineContent.includes('os.Getenv') || lineContent.includes('env::var') ||
              lineContent.includes('ENV[') || lineContent.includes('${')) continue;

          // For the broad "port: NNNN" pattern, apply stricter context filtering
          if (patDef.description.includes('Port assignment') && !hasPortContext(lineContent)) continue;

          findings.push({
            ruleId: `hardcoded-ports/${ps.ecosystem}`,
            category: 'hardcoded-port',
            severity: 'high',
            filePath: file.filePath,
            line: lineNum,
            column: col,
            matchedText: match[0],
            message: `${patDef.description}: port ${port}`,
            context: lineContent.trim(),
            ecosystem: ps.ecosystem,
            suggestedFix: ps.fixTemplates['hardcoded-port']
              ? {
                  description: ps.fixTemplates['hardcoded-port']!.description,
                  replacement: ps.fixTemplates['hardcoded-port']!.envVarPattern.replace('$ORIGINAL', String(port)),
                  confidence: 'review',
                }
              : undefined,
          });
        }
      }
    }

    // Universal localhost:port pattern (works in any file type)
    const localhostRegex = new RegExp(LOCALHOST_PORT_PATTERN.source, LOCALHOST_PORT_PATTERN.flags);
    let match: RegExpExecArray | null;
    while ((match = localhostRegex.exec(file.content)) !== null) {
      const port = parseInt(match[1], 10);
      if (!isLikelyPort(port)) continue;

      const lineNum = lineNumberAt(file.lineOffsets, match.index);
      const lineContent = file.lines[lineNum - 1] || '';

      // Skip if already found by ecosystem-specific pattern
      if (findings.some(f => f.line === lineNum && f.filePath === file.filePath)) continue;

      // Skip comments
      if (isCommentLine(lineContent)) continue;

      // Skip if already using env var
      if (lineContent.includes('process.env') || lineContent.includes('os.environ') ||
          lineContent.includes('os.Getenv') || lineContent.includes('${')) continue;

      findings.push({
        ruleId: 'hardcoded-ports/localhost',
        category: 'hardcoded-port',
        severity: WELL_KNOWN_SERVICE_PORTS.has(port) ? 'high' : 'medium',
        filePath: file.filePath,
        line: lineNum,
        column: match.index - file.content.lastIndexOf('\n', match.index - 1),
        matchedText: match[0],
        message: `Hardcoded localhost URL with port ${port}`,
        context: lineContent.trim(),
        ecosystem: eco !== 'unknown' ? eco : undefined,
      });
    }

    return findings;
  },
};

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
      ruleId: 'hardcoded-ports/env-file',
      category: 'hardcoded-port',
      severity: 'critical',
      filePath: file.filePath,
      line: lineNum,
      column: 1,
      matchedText: match[0],
      message: `Hardcoded port ${port} in ${varName} — will conflict across worktrees`,
      context: file.lines[lineNum - 1]?.trim() || match[0],
      suggestedFix: {
        description: `Make ${varName} dynamic (e.g., use worktrunk port hashing or assign per-worktree)`,
        replacement: `${varName}=\${${varName}:-${port}}`,
        confidence: 'review',
      },
    });
  }

  return findings;
}

function detectDockerComposePorts(file: FileContext): Finding[] {
  const findings: Finding[] = [];
  const portsRegex = new RegExp(DOCKER_PORTS_PATTERN.source, DOCKER_PORTS_PATTERN.flags);
  let match: RegExpExecArray | null;

  while ((match = portsRegex.exec(file.content)) !== null) {
    const hostPort = parseInt(match[1], 10);
    const containerPort = parseInt(match[2], 10);
    const lineNum = lineNumberAt(file.lineOffsets, match.index);

    // Skip if already using variable interpolation
    if (match[0].includes('${')) continue;

    findings.push({
      ruleId: 'hardcoded-ports/docker-compose',
      category: 'hardcoded-port',
      severity: 'critical',
      filePath: file.filePath,
      line: lineNum,
      column: 1,
      matchedText: match[0].trim(),
      message: `Fixed Docker port mapping ${hostPort}:${containerPort} — host port will conflict across worktrees`,
      context: file.lines[lineNum - 1]?.trim() || match[0].trim(),
      suggestedFix: {
        description: 'Use variable interpolation for host port',
        replacement: `      - "\${HOST_PORT:-${hostPort}}:${containerPort}"`,
        confidence: 'review',
      },
    });
  }

  return findings;
}

function detectDockerfilePorts(file: FileContext): Finding[] {
  const findings: Finding[] = [];
  const regex = new RegExp(DOCKERFILE_EXPOSE_PATTERN.source, DOCKERFILE_EXPOSE_PATTERN.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(file.content)) !== null) {
    const port = parseInt(match[1], 10);
    const lineNum = lineNumberAt(file.lineOffsets, match.index);

    // Check if ARG is used
    if (file.content.includes(`ARG PORT`) || file.content.includes(`ARG EXPOSE_PORT`)) continue;

    findings.push({
      ruleId: 'hardcoded-ports/dockerfile',
      category: 'hardcoded-port',
      severity: 'medium',
      filePath: file.filePath,
      line: lineNum,
      column: 1,
      matchedText: match[0],
      message: `Hardcoded EXPOSE ${port} in Dockerfile`,
      context: file.lines[lineNum - 1]?.trim() || match[0],
      suggestedFix: {
        description: 'Use ARG for port',
        replacement: `ARG PORT=${port}\nEXPOSE $PORT`,
        confidence: 'review',
      },
    });
  }

  return findings;
}
