import { Rule, Finding, FileContext, LangPatternSet, lineNumberAt } from '../types.js';
import { ecosystemForExtension } from '../lang/index.js';
import { isAstAvailable, EXT_TO_LANG, astDetectPidAndSockets } from '../ast-detect.js';

/** Universal PID file patterns. */
const PID_FILE_PATTERN = /["']?([^\s"']*\.pid)["']?/g;

/** Universal socket file patterns. */
const SOCKET_FILE_PATTERN = /["']?([^\s"']*\.sock(?:et)?)["']?/g;

/** PID file write patterns (more specific). */
const PID_WRITE_PATTERN = /(?:pidfile|pid_file|pid_path|PID_FILE)\s*[:=]\s*["']?([^\s"']+)/gi;

export const pidAndSocketsRule: Rule = {
  id: 'pid-and-sockets',
  name: 'PID Files and Sockets',
  category: 'pid-socket',
  description: 'Detects hardcoded PID and socket file paths that prevent parallel server instances',
  defaultSeverity: 'high',
  filePatterns: ['**/*'],
  detect(file: FileContext, langPatterns: LangPatternSet[]): Finding[] {
    // Skip node_modules, vendor, etc.
    if (file.filePath.includes('node_modules/') || file.filePath.includes('vendor/')) return [];

    // AST path for JS/TS source files
    if (isAstAvailable() && EXT_TO_LANG[file.extension]) {
      const astResult = astDetectPidAndSockets(file, langPatterns);
      if (astResult !== null) return astResult;
    }
    return detectPidSocketsRegexPath(file, langPatterns);
  },
};

/** Regex-based PID/socket detection. Extracted for AST parity validation. */
export function detectPidSocketsRegexPath(file: FileContext, langPatterns: LangPatternSet[]): Finding[] {
    const findings: Finding[] = [];

    // 1. Ecosystem-specific PID/socket patterns
    const eco = ecosystemForExtension(file.extension);
    for (const ps of langPatterns) {
      for (const patDef of ps.pidSocketPatterns) {
        const regex = new RegExp(patDef.pattern.source, patDef.pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(file.content)) !== null) {
          const lineNum = lineNumberAt(file.lineOffsets, match.index);
          const lineContent = file.lines[lineNum - 1] || '';

          findings.push({
            ruleId: `pid-and-sockets/${ps.ecosystem}`,
            category: 'pid-socket',
            severity: 'high',
            filePath: file.filePath,
            line: lineNum,
            column: match.index - file.content.lastIndexOf('\n', match.index - 1),
            matchedText: match[0],
            message: `${patDef.description}: ${match[0]}`,
            context: lineContent.trim(),
            ecosystem: ps.ecosystem,
            suggestedFix: {
              description: 'Each worktree needs its own PID/socket file, otherwise only one instance can run at a time',
              replacement: match[0],
              confidence: 'manual',
              howToApply: 'Include the worktree name in the PID/socket file path to make it unique (e.g., server.<worktree>.pid or puma.<worktree>.sock)',
              docUrl: 'https://isolint.dev/docs/rules/pid-and-sockets',
            },
          });
        }
      }
    }

    // 2. Universal PID file config patterns
    const pidWriteRegex = new RegExp(PID_WRITE_PATTERN.source, PID_WRITE_PATTERN.flags);
    let match: RegExpExecArray | null;
    while ((match = pidWriteRegex.exec(file.content)) !== null) {
      const pidPath = match[1];
      const lineNum = lineNumberAt(file.lineOffsets, match.index);
      const lineContent = file.lines[lineNum - 1] || '';

      if (findings.some(f => f.line === lineNum && f.filePath === file.filePath)) continue;

      findings.push({
        ruleId: 'pid-and-sockets/config',
        category: 'pid-socket',
        severity: 'high',
        filePath: file.filePath,
        line: lineNum,
        column: match.index - file.content.lastIndexOf('\n', match.index - 1),
        matchedText: match[0],
        message: `Hardcoded PID file path: ${pidPath}`,
        context: lineContent.trim(),
        suggestedFix: {
          description: 'Each worktree needs its own PID file — two servers can\'t write to the same one',
          replacement: match[0],
          confidence: 'manual',
          howToApply: 'Include the worktree name in the PID file path to make it unique (e.g., server.<worktree>.pid)',
          docUrl: 'https://isolint.dev/docs/rules/pid-and-sockets',
        },
      });
    }

    return findings;
}
