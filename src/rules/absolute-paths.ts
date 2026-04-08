import { Rule, Finding, FileContext, LangPatternSet, lineNumberAt } from '../types.js';
import { HARDCODED_PATH_PREFIXES, SAFE_PATH_PREFIXES } from '../lang/patterns.js';
import { ecosystemForExtension } from '../lang/index.js';

/** Match absolute paths that look like user home directories or project roots. */
const USER_HOME_PATTERN = /(?:\/Users\/\w+|\/home\/\w+|C:\\Users\\\w+)(?:[/\\][^\s"'`,:;)}\]]+)+/g;

/** Match hardcoded Windows drive paths. */
const WINDOWS_DRIVE_PATTERN = /[A-Z]:\\(?:\w+\\){2,}[^\s"'`,:;)}\]]+/g;

/** Match hardcoded /opt or /srv paths. */
const SERVER_PATH_PATTERN = /(?:\/opt\/\w+|\/srv\/\w+|\/var\/www\/\w+)(?:\/[^\s"'`,:;)}\]]+)+/g;

export const absolutePathsRule: Rule = {
  id: 'absolute-paths',
  name: 'Absolute Paths',
  category: 'absolute-path',
  description: 'Detects hardcoded absolute paths (enlistment roots, user home dirs) that break on other machines or worktrees',
  defaultSeverity: 'critical',
  filePatterns: ['**/*'],
  detect(file: FileContext, langPatterns: LangPatternSet[]): Finding[] {
    const findings: Finding[] = [];

    // Skip binary-looking content
    if (file.content.includes('\0')) return findings;

    const patterns = [
      { regex: USER_HOME_PATTERN, desc: 'Hardcoded user home directory path' },
      { regex: WINDOWS_DRIVE_PATTERN, desc: 'Hardcoded Windows drive path' },
      { regex: SERVER_PATH_PATTERN, desc: 'Hardcoded server deployment path' },
    ];

    for (const { regex, desc } of patterns) {
      const re = new RegExp(regex.source, regex.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(file.content)) !== null) {
        const matchedPath = match[0];

        // Skip safe system paths
        if (SAFE_PATH_PREFIXES.some(prefix => matchedPath.startsWith(prefix))) continue;

        // Skip if in a comment about paths (e.g., "# Default path is /home/user/...")
        const lineNum = lineNumberAt(file.lineOffsets, match.index);
        const lineContent = file.lines[lineNum - 1] || '';

        // Skip lines that are pure comments
        const trimmedLine = lineContent.trim();
        if (trimmedLine.startsWith('//') || trimmedLine.startsWith('#') || trimmedLine.startsWith('*') || trimmedLine.startsWith('<!--')) {
          continue;
        }

        const eco = ecosystemForExtension(file.extension);
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
          column: match.index - file.content.lastIndexOf('\n', match.index - 1),
          matchedText: matchedPath,
          message: `${desc}: ${matchedPath}`,
          context: lineContent.trim(),
          ecosystem: eco !== 'unknown' ? eco : undefined,
          suggestedFix: {
            description: fixDescription,
            replacement,
            confidence: 'manual',
          },
        });
      }
    }

    return findings;
  },
};

/** Try to extract a useful relative path suggestion from an absolute path. */
function suggestRelativePath(absPath: string): string {
  // Strip the user-specific prefix, keep the project-relative part
  const parts = absPath.replace(/\\/g, '/').split('/');
  // Find a likely project root indicator
  for (let i = 0; i < parts.length; i++) {
    if (['src', 'lib', 'app', 'config', 'public', 'static', 'assets', 'data'].includes(parts[i])) {
      return './' + parts.slice(i).join('/');
    }
  }
  // Fall back to last 2-3 segments
  return './' + parts.slice(-3).join('/');
}
