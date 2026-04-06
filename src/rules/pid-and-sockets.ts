import { Rule, Finding, FileContext, LangPatternSet, lineNumberAt } from '../types.js';
import { ecosystemForExtension } from '../lang/index.js';

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
    const findings: Finding[] = [];

    // Skip node_modules, vendor, etc.
    if (file.filePath.includes('node_modules/') || file.filePath.includes('vendor/')) return findings;

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
              description: 'Namespace PID/socket path per worktree',
              replacement: match[0].replace(/\.(pid|sock(et)?)/, '.${WORKTREE_ID}.$1'),
              confidence: 'manual',
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
          description: 'Namespace PID file per worktree',
          replacement: match[0].replace(pidPath, pidPath.replace('.pid', '.${WORKTREE_ID}.pid')),
          confidence: 'manual',
        },
      });
    }

    return findings;
  },
};
