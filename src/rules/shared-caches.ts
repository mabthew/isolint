import { Rule, Finding, FileContext, LangPatternSet, lineNumberAt } from '../types.js';

/** Pattern matching cache directory references in config files. */
const CACHE_DIR_CONFIG_PATTERN = /(?:cacheDir|cache_dir|cacheDirectory)\s*[:=]\s*["']?([^"'\s,;]+)/gi;

export const sharedCachesRule: Rule = {
  id: 'shared-caches',
  name: 'Shared Caches',
  category: 'shared-cache',
  description: 'Detects shared cache directories that corrupt when used by parallel worktrees',
  defaultSeverity: 'medium',
  filePatterns: ['**/*'],
  detect(file: FileContext, langPatterns: LangPatternSet[]): Finding[] {
    const findings: Finding[] = [];

    // Collect all known cache dirs from all ecosystems
    const allCacheDirs = new Set<string>();
    for (const ps of langPatterns) {
      for (const dir of ps.cacheDirs) {
        allCacheDirs.add(dir);
      }
    }

    // Check if file references any cache directories in a config context
    const regex = new RegExp(CACHE_DIR_CONFIG_PATTERN.source, CACHE_DIR_CONFIG_PATTERN.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(file.content)) !== null) {
      const cacheDir = match[1];
      const lineNum = lineNumberAt(file.lineOffsets, match.index);
      const lineContent = file.lines[lineNum - 1] || '';

      findings.push({
        ruleId: 'shared-caches/config',
        category: 'shared-cache',
        severity: 'medium',
        filePath: file.filePath,
        line: lineNum,
        column: match.index - file.content.lastIndexOf('\n', match.index - 1),
        matchedText: match[0],
        message: `Hardcoded cache directory "${cacheDir}" — parallel worktrees will corrupt each other's cache`,
        context: lineContent.trim(),
        suggestedFix: {
          description: 'Namespace cache directory per worktree or use an env var',
          replacement: match[0].replace(cacheDir, `\${WORKTREE_CACHE:-${cacheDir}}`),
          confidence: 'review',
        },
      });
    }

    // Check for well-known cache dirs referenced directly in scripts or configs
    for (const cacheDir of allCacheDirs) {
      // Look for direct references in shell scripts, Makefiles, CI configs
      if (file.extension === '.sh' || file.basename === 'Makefile' ||
          file.filePath.includes('.github/') || file.filePath.includes('.gitlab-ci')) {
        const escapedDir = cacheDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const dirRegex = new RegExp(`(?:rm\\s+-rf|cache|restore|save).*${escapedDir}`, 'g');
        let dirMatch: RegExpExecArray | null;
        while ((dirMatch = dirRegex.exec(file.content)) !== null) {
          const lineNum = file.content.slice(0, dirMatch.index).split('\n').length;
          const lineContent = file.lines[lineNum - 1] || '';

          findings.push({
            ruleId: 'shared-caches/script',
            category: 'shared-cache',
            severity: 'low',
            filePath: file.filePath,
            line: lineNum,
            column: 1,
            matchedText: dirMatch[0],
            message: `Reference to shared cache directory "${cacheDir}" in script`,
            context: lineContent.trim(),
          });
        }
      }
    }

    return findings;
  },
};
