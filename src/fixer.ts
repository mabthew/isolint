import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import pc from 'picocolors';
import { AuditReport, Finding, FixConfidence } from './types.js';

interface FixResult {
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

type InteractiveDecision = 'apply' | 'skip' | 'apply-all' | 'skip-all';

/**
 * Interactive fix mode: prompt per finding with context.
 * Falls back to batch mode in non-TTY environments.
 */
export async function interactiveFix(report: AuditReport): Promise<FixResult> {
  const fixableFindings = report.findings.filter(f => f.suggestedFix);
  if (fixableFindings.length === 0) {
    console.log('No fixable findings.');
    return { applied: 0, skipped: 0, errors: [] };
  }

  // Non-TTY fallback: apply auto-confidence fixes only
  if (!process.stdin.isTTY) {
    console.log('Non-TTY detected — falling back to batch mode (auto-confidence only).');
    return applyFixes(report);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise(resolve => rl.question(question, resolve));

  const result: FixResult = { applied: 0, skipped: 0, errors: [] };
  const approved: Finding[] = [];
  let applyAll = false;

  console.log(`\n${pc.bold(`${fixableFindings.length} fixable finding(s) found.`)} Reviewing each:\n`);

  for (const finding of fixableFindings) {
    if (applyAll) {
      approved.push(finding);
      result.applied++;
      continue;
    }

    const fix = finding.suggestedFix!;

    // Read the actual file to show context lines
    const absPath = path.join(report.repoPath, finding.filePath);
    let contextLines: string[] = [];
    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      const lines = content.split('\n');
      const start = Math.max(0, finding.line - 3);
      const end = Math.min(lines.length, finding.line + 2);
      for (let i = start; i < end; i++) {
        const marker = i === finding.line - 1 ? pc.yellow('→') : ' ';
        const lineNum = pc.dim(String(i + 1).padStart(4));
        contextLines.push(`  ${marker} ${lineNum}  ${lines[i]}`);
      }
    } catch {
      contextLines = [`    ${finding.context}`];
    }

    // Show finding details
    console.log(pc.dim('─'.repeat(60)));
    console.log(`${pc.bold(finding.filePath)}:${finding.line}  ${severityBadge(finding.severity)}  ${finding.category}`);
    console.log(`  ${finding.message}\n`);
    console.log(contextLines.join('\n'));
    console.log('');
    console.log(`  ${pc.cyan('fix')} (${fix.confidence}): ${fix.description}`);
    console.log(`  ${pc.green('→')} ${fix.replacement}`);
    console.log('');

    const answer = await ask(`  ${pc.bold('[a]pply')}  ${pc.dim('[s]kip')}  ${pc.dim('[A]pply all')}  ${pc.dim('[S]kip rest')}  ? `);
    const choice = answer.trim().toLowerCase();

    if (choice === 'a' || choice === 'apply') {
      approved.push(finding);
      result.applied++;
    } else if (choice === 'apply all' || choice.startsWith('a') && choice === choice.toUpperCase()) {
      // 'A' (uppercase) = apply all
      approved.push(finding);
      result.applied++;
      applyAll = true;
    } else if (choice === 'skip rest' || choice.startsWith('s') && choice === choice.toUpperCase()) {
      // 'S' (uppercase) = skip rest
      result.skipped += fixableFindings.length - (result.applied + result.skipped);
      break;
    } else {
      result.skipped++;
    }
  }

  rl.close();

  // Apply approved fixes
  if (approved.length > 0) {
    console.log(`\nApplying ${approved.length} fix(es)...`);
    const approvedReport: AuditReport = { ...report, findings: approved };
    const applyResult = applyFixes(approvedReport, { force: true });
    result.errors = applyResult.errors;
    console.log(`${pc.green('Done.')} Applied: ${applyResult.applied}, Errors: ${applyResult.errors.length}`);
  } else {
    console.log('\nNo fixes applied.');
  }

  return result;
}

function severityBadge(severity: string): string {
  switch (severity) {
    case 'critical': return pc.bgRed(pc.white(` ${severity} `));
    case 'high': return pc.red(severity);
    case 'medium': return pc.yellow(severity);
    case 'low': return pc.dim(severity);
    default: return pc.dim(severity);
  }
}
