import * as fs from 'fs';
import * as path from 'path';
import pc from 'picocolors';
import { AuditReport, Finding } from './types.js';
import { runInteractiveFix } from './interactive.js';

export interface FixResult {
  applied: number;
  skipped: number;
  errors: string[];
}

/**
 * Apply auto-fixable changes from the audit report.
 * Only applies fixes with confidence === 'auto' unless force is true.
 */
export function applyFixes(
  report: AuditReport,
  options: { force?: boolean; dryRun?: boolean } = {}
): FixResult {
  const result: FixResult = { applied: 0, skipped: 0, errors: [] };

  // Group fixes by file
  const fixesByFile = new Map<string, Finding[]>();
  for (const finding of report.findings) {
    if (!finding.suggestedFix) continue;
    if (!options.force && finding.suggestedFix.confidence !== 'auto') {
      result.skipped++;
      continue;
    }

    const arr = fixesByFile.get(finding.filePath) || [];
    arr.push(finding);
    fixesByFile.set(finding.filePath, arr);
  }

  for (const [filePath, findings] of fixesByFile) {
    const absPath = path.join(report.repoPath, filePath);

    try {
      let content = fs.readFileSync(absPath, 'utf-8');
      const lines = content.split('\n');

      // Sort findings by line (descending) so replacements don't shift line numbers
      const sorted = [...findings].sort((a, b) => b.line - a.line);

      for (const finding of sorted) {
        if (!finding.suggestedFix) continue;

        const lineIdx = finding.line - 1;
        if (lineIdx < 0 || lineIdx >= lines.length) {
          result.errors.push(`${filePath}:${finding.line} — line out of range`);
          continue;
        }

        const line = lines[lineIdx];
        const newLine = line.replaceAll(finding.matchedText, finding.suggestedFix.replacement);

        if (newLine === line) {
          result.errors.push(`${filePath}:${finding.line} — match text not found in line`);
          continue;
        }

        if (!options.dryRun) {
          lines[lineIdx] = newLine;
        }

        result.applied++;

        if (options.dryRun) {
          console.log(pc.dim(`${filePath}:${finding.line}`));
          console.log(pc.red(`- ${line.trim()}`));
          console.log(pc.green(`+ ${newLine.trim()}`));
          console.log('');
        }
      }

      if (!options.dryRun && result.applied > 0) {
        // Backup original
        const backupDir = path.join(report.repoPath, '.isolint-backup');
        const backupPath = path.join(backupDir, filePath);
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        fs.copyFileSync(absPath, backupPath);

        // Write fixed content
        fs.writeFileSync(absPath, lines.join('\n'), 'utf-8');
      }
    } catch (err) {
      result.errors.push(`${filePath} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

/**
 * Interactive fix mode — delegates to the polished interactive UI.
 * Falls back to batch mode in non-TTY environments.
 */
export async function interactiveFix(
  report: AuditReport,
  options: { dryRun?: boolean } = {},
): Promise<FixResult> {
  return runInteractiveFix(report, options);
}
