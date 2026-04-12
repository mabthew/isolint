import { Rule, Finding, FileContext, LangPatternSet, lineNumberAt } from '../types.js';

/** Patterns for hardcoded temp directory usage. */
const TEMP_DIR_PATTERNS = [
  { regex: /["']\/tmp\/([a-zA-Z][\w-]+)["']/g, desc: 'Hardcoded /tmp subdirectory' },
  { regex: /(?:tmpDir|temp_dir|tempDir|tmp_dir)\s*[:=]\s*["']([^"']+)["']/gi, desc: 'Hardcoded temp directory config' },
  { regex: /os\.tmpdir\(\)\s*\+\s*["']\/([^"']+)["']/g, desc: 'os.tmpdir() with hardcoded subdirectory name' },
  { regex: /tempfile\.mkdtemp\(\s*["']([^"']+)["']/g, desc: 'Python tempfile with hardcoded prefix' },
];

export const tempDirectoriesRule: Rule = {
  id: 'temp-directories',
  name: 'Temp Directories',
  category: 'temp-directory',
  description: 'Detects hardcoded temp directory paths that may collide across worktrees',
  defaultSeverity: 'low',
  filePatterns: ['**/*'],
  detect(file: FileContext, _langPatterns: LangPatternSet[]): Finding[] {
    const findings: Finding[] = [];

    for (const { regex, desc } of TEMP_DIR_PATTERNS) {
      const re = new RegExp(regex.source, regex.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(file.content)) !== null) {
        const lineNum = lineNumberAt(file.lineOffsets, match.index);
        const lineContent = file.lines[lineNum - 1] || '';
        const trimmedLine = lineContent.trim();

        // Skip comments
        if (trimmedLine.startsWith('//') || trimmedLine.startsWith('#')) continue;

        const isShellFile = file.extension === '.sh' || file.extension === '.bash' || file.basename === 'Makefile';
        findings.push({
          ruleId: 'temp-directories/hardcoded',
          category: 'temp-directory',
          severity: 'low',
          filePath: file.filePath,
          line: lineNum,
          column: match.index - file.content.lastIndexOf('\n', match.index - 1),
          matchedText: match[0],
          message: `${desc}: ${match[1] || match[0]}`,
          context: trimmedLine,
          suggestedFix: isShellFile
            ? {
                description: 'Two worktrees using the same temp dir will overwrite each other\'s files',
                replacement: match[0].replace(match[1], `${match[1]}-\$(basename $PWD)`),
                confidence: 'review' as const,
                docUrl: 'https://isolint.dev/docs/rules/temp-directories',
              }
            : {
                description: 'Two worktrees using the same temp dir will overwrite each other\'s files',
                replacement: match[0],
                confidence: 'manual' as const,
                howToApply: 'Include the worktree name in the temp directory path so each worktree uses a separate location',
                docUrl: 'https://isolint.dev/docs/rules/temp-directories',
              },
        });
      }
    }

    return findings;
  },
};
