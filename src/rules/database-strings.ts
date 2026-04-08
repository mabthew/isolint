import { Rule, Finding, FileContext, LangPatternSet, lineNumberAt } from '../types.js';
import { DB_URL_PATTERN } from '../lang/patterns.js';
import { ecosystemForExtension } from '../lang/index.js';

export const databaseStringsRule: Rule = {
  id: 'database-strings',
  name: 'Database Connection Strings',
  category: 'database-string',
  description: 'Detects hardcoded database connection strings that will cause cross-worktree conflicts',
  defaultSeverity: 'high',
  filePatterns: ['**/*'],
  detect(file: FileContext, langPatterns: LangPatternSet[]): Finding[] {
    const findings: Finding[] = [];

    // 1. Universal database URL pattern
    const dbUrlRegex = new RegExp(DB_URL_PATTERN.source, DB_URL_PATTERN.flags);
    let match: RegExpExecArray | null;
    while ((match = dbUrlRegex.exec(file.content)) !== null) {
      const url = match[0];
      const lineNum = lineNumberAt(file.lineOffsets, match.index);
      const lineContent = file.lines[lineNum - 1] || '';
      const trimmedLine = lineContent.trim();

      // Skip comments
      if (trimmedLine.startsWith('//') || trimmedLine.startsWith('#') || trimmedLine.startsWith('*')) continue;

      // Skip if already wrapped in env var
      if (lineContent.includes('process.env') || lineContent.includes('os.environ') ||
          lineContent.includes('os.Getenv') || lineContent.includes('env::var') ||
          lineContent.includes('ENV[') || lineContent.includes('${')) continue;

      const protocol = match[1];
      const severity = file.basename.startsWith('.env') ? 'high' : 'critical';
      let eco = ecosystemForExtension(file.extension);
      // For config/YAML files, check if any ecosystem claims this file via configFileGlobs
      if (eco === 'unknown') {
        for (const ps of langPatterns) {
          if (ps.configFileGlobs.some(g => file.filePath.endsWith(g.replace('*', '')) || file.basename === g)) {
            eco = ps.ecosystem;
            break;
          }
        }
      }

      // Find ecosystem-specific fix template
      const fixTemplate = langPatterns
        .find(p => p.ecosystem === eco)
        ?.fixTemplates['database-string'];

      const replacement = fixTemplate
        ? fixTemplate.envVarPattern.replace('$ORIGINAL', url.length > 80 ? url.slice(0, 77) + '...' : url)
        : 'process.env.DATABASE_URL';
      const fixDescription = fixTemplate
        ? fixTemplate.description
        : 'Use an environment variable for the database URL';

      findings.push({
        ruleId: 'database-strings/url',
        category: 'database-string',
        severity,
        filePath: file.filePath,
        line: lineNum,
        column: match.index - file.content.lastIndexOf('\n', match.index - 1),
        matchedText: url.length > 80 ? url.slice(0, 77) + '...' : url,
        message: `Hardcoded ${protocol} connection string — database name should be per-worktree`,
        context: trimmedLine.length > 120 ? trimmedLine.slice(0, 117) + '...' : trimmedLine,
        ecosystem: eco !== 'unknown' ? eco : undefined,
        suggestedFix: {
          description: fixDescription,
          replacement,
          confidence: 'review',
        },
      });
    }

    // 2. Ecosystem-specific DB patterns
    const eco = ecosystemForExtension(file.extension);
    for (const ps of langPatterns) {
      if (ps.ecosystem !== eco && !ps.configFileGlobs.some(g => file.filePath.endsWith(g.replace('*', '')))) continue;

      for (const patDef of ps.dbStringPatterns) {
        const regex = new RegExp(patDef.pattern.source, patDef.pattern.flags);
        while ((match = regex.exec(file.content)) !== null) {
          const lineNum = lineNumberAt(file.lineOffsets, match.index);
          const lineContent = file.lines[lineNum - 1] || '';

          // Skip if already found by universal pattern
          if (findings.some(f => f.line === lineNum && f.filePath === file.filePath)) continue;

          // Skip if already using env var
          if (lineContent.includes('${') || lineContent.includes('process.env') || lineContent.includes('os.environ')) continue;

          findings.push({
            ruleId: `database-strings/${ps.ecosystem}`,
            category: 'database-string',
            severity: 'high',
            filePath: file.filePath,
            line: lineNum,
            column: match.index - file.content.lastIndexOf('\n', match.index - 1),
            matchedText: match[0].length > 80 ? match[0].slice(0, 77) + '...' : match[0],
            message: `${patDef.description}`,
            context: lineContent.trim(),
            ecosystem: ps.ecosystem,
          });
        }
      }
    }

    return findings;
  },
};
