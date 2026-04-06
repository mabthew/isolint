import { Rule, Finding, FileContext, LangPatternSet, lineNumberAt } from '../types.js';

/** Patterns for build output directory configuration. */
const BUILD_DIR_CONFIG_PATTERNS = [
  // Only match quoted string values or simple unquoted paths (not function calls like path.join)
  { regex: /(?:outDir|distDir|outputDir|buildDir|out_dir|build_dir)\s*[:=]\s*["']([^"']+)["']/gi, desc: 'Build output directory' },
  { regex: /(?:outputDirectory|publishDir|publish_dir)\s*[:=]\s*["']([^"']+)["']/gi, desc: 'Publish directory' },
];

export const buildDirectoriesRule: Rule = {
  id: 'build-directories',
  name: 'Build Directories',
  category: 'build-directory',
  description: 'Detects hardcoded build output directories that may conflict across worktrees',
  defaultSeverity: 'medium',
  filePatterns: ['**/*'],
  detect(file: FileContext, langPatterns: LangPatternSet[]): Finding[] {
    const findings: Finding[] = [];

    // 1. Config-based build directory detection
    for (const { regex, desc } of BUILD_DIR_CONFIG_PATTERNS) {
      const re = new RegExp(regex.source, regex.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(file.content)) !== null) {
        const dir = match[1];
        const lineNum = lineNumberAt(file.lineOffsets, match.index);
        const lineContent = file.lines[lineNum - 1] || '';
        const trimmedLine = lineContent.trim();

        // Skip comments
        if (trimmedLine.startsWith('//') || trimmedLine.startsWith('#')) continue;

        // Skip if already using env var
        if (dir.includes('${') || dir.includes('process.env')) continue;

        findings.push({
          ruleId: 'build-directories/config',
          category: 'build-directory',
          severity: 'medium',
          filePath: file.filePath,
          line: lineNum,
          column: match.index - file.content.lastIndexOf('\n', match.index - 1),
          matchedText: match[0],
          message: `${desc} "${dir}" is hardcoded — parallel builds may conflict`,
          context: trimmedLine,
          suggestedFix: {
            description: 'Use environment variable for build directory',
            replacement: match[0].replace(dir, `\${BUILD_DIR:-${dir}}`),
            confidence: 'review',
          },
        });
      }
    }

    // 2. Rust-specific: target/ without CARGO_TARGET_DIR awareness
    if (file.basename === 'Cargo.toml') {
      // Check if .cargo/config.toml sets target-dir — if not, flag it
      const hasTargetDir = file.content.includes('target-dir');
      if (!hasTargetDir) {
        findings.push({
          ruleId: 'build-directories/rust-target',
          category: 'build-directory',
          severity: 'high',
          filePath: file.filePath,
          line: 1,
          column: 1,
          matchedText: 'Cargo.toml',
          message: 'Rust project without CARGO_TARGET_DIR — all worktrees share target/, causing full rebuilds',
          context: '(set CARGO_TARGET_DIR or target-dir in .cargo/config.toml)',
          suggestedFix: {
            description: 'Set CARGO_TARGET_DIR per worktree or add target-dir to .cargo/config.toml',
            replacement: 'CARGO_TARGET_DIR="${WORKTREE_ROOT}/target"',
            confidence: 'manual',
          },
        });
      }
    }

    return findings;
  },
};
