import { Rule, Finding, FileContext, LangPatternSet, lineNumberAt } from '../types.js';
import { ecosystemForExtension } from '../lang/index.js';
import { isAstAvailable, EXT_TO_LANG, astDetectLogFilePaths, isParityMode, logParityDivergences } from '../ast-detect.js';

/** Universal log file path patterns. */
const LOG_FILE_PATTERNS = [
  { regex: /(?:logFile|log_file|logPath|log_path)\s*[:=]\s*["']([^"']+\.log)["']/gi, desc: 'Hardcoded log file path' },
  { regex: /(?:>|>>)\s*["']?(\/[^\s"']+\.log)["']?/g, desc: 'Shell redirect to log file' }, // require absolute path to avoid console.log
  { regex: /logging\.FileHandler\(\s*["']([^"']+\.log)["']/g, desc: 'Python FileHandler with hardcoded log path' },
];

export const logFilePathsRule: Rule = {
  id: 'log-file-paths',
  name: 'Log File Paths',
  category: 'log-file-path',
  description: 'Detects hardcoded log file paths that would be overwritten by parallel worktrees',
  defaultSeverity: 'low',
  filePatterns: ['**/*'],
  detect(file: FileContext, langPatterns: LangPatternSet[]): Finding[] {
    // AST path for JS/TS source files
    if (isAstAvailable() && EXT_TO_LANG[file.extension]) {
      const astResult = astDetectLogFilePaths(file, langPatterns);
      if (astResult !== null) {
        if (isParityMode()) {
          const regexResult = detectLogPathsRegexPath(file, langPatterns);
          logParityDivergences('log-file-paths', file.filePath, astResult, regexResult);
        }
        return astResult;
      }
    }
    return detectLogPathsRegexPath(file, langPatterns);
  },
};

/** Regex-based log file path detection. Extracted for AST parity validation. */
export function detectLogPathsRegexPath(file: FileContext, langPatterns: LangPatternSet[]): Finding[] {
    const findings: Finding[] = [];

    // 1. Universal log file patterns
    for (const { regex, desc } of LOG_FILE_PATTERNS) {
      const re = new RegExp(regex.source, regex.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(file.content)) !== null) {
        const logPath = match[1];
        const lineNum = lineNumberAt(file.lineOffsets, match.index);
        const lineContent = file.lines[lineNum - 1] || '';
        const trimmedLine = lineContent.trim();

        // Skip comments
        if (trimmedLine.startsWith('//') || trimmedLine.startsWith('#') || trimmedLine.startsWith('*')) continue;

        // Skip if already using env var
        if (logPath.includes('${') || lineContent.includes('process.env') || lineContent.includes('os.environ')) continue;

        const isShell = file.extension === '.sh' || file.extension === '.bash' || file.basename === 'Makefile';
        findings.push({
          ruleId: 'log-file-paths/hardcoded',
          category: 'log-file-path',
          severity: 'low',
          filePath: file.filePath,
          line: lineNum,
          column: match.index - file.content.lastIndexOf('\n', match.index - 1),
          matchedText: match[0],
          message: `${desc}: ${logPath}`,
          context: trimmedLine,
          suggestedFix: isShell
            ? {
                description: 'Parallel worktrees writing to the same log file will interleave output',
                replacement: match[0].replace(logPath, logPath.replace('.log', '.$(basename $PWD).log')),
                confidence: 'review',
                docUrl: 'https://isolint.dev/docs/rules/log-file-paths',
              }
            : {
                description: 'Parallel worktrees writing to the same log file will interleave output',
                replacement: match[0],
                confidence: 'manual',
                howToApply: 'Include the worktree name in the log file path so each worktree writes to a separate file (e.g., app.<worktree>.log)',
                docUrl: 'https://isolint.dev/docs/rules/log-file-paths',
              },
        });
      }
    }

    // 2. Ecosystem-specific log patterns
    const eco = ecosystemForExtension(file.extension);
    for (const ps of langPatterns) {
      for (const patDef of ps.logPathPatterns) {
        const regex = new RegExp(patDef.pattern.source, patDef.pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(file.content)) !== null) {
          const lineNum = lineNumberAt(file.lineOffsets, match.index);
          const lineContent = file.lines[lineNum - 1] || '';

          if (findings.some(f => f.line === lineNum && f.filePath === file.filePath)) continue;

          findings.push({
            ruleId: `log-file-paths/${ps.ecosystem}`,
            category: 'log-file-path',
            severity: 'low',
            filePath: file.filePath,
            line: lineNum,
            column: match.index - file.content.lastIndexOf('\n', match.index - 1),
            matchedText: match[0],
            message: `${patDef.description}`,
            context: lineContent.trim(),
            ecosystem: ps.ecosystem,
            suggestedFix: {
              description: 'Parallel worktrees writing to the same log file will interleave output',
              replacement: match[0],
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
