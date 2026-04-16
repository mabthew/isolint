/**
 * Interactive fix mode — polished gutter-style UI for reviewing fixes one at a time.
 *
 * Flow:
 *   1. Auto-confidence fixes are applied (or previewed with --dry-run) silently
 *   2. Review-confidence fixes are shown one per screen with inline diff preview
 *   3. Manual-confidence findings are listed as advisory in the completion summary
 */
import pc from 'picocolors';
import { AuditReport, Finding } from './types.js';
import { applyFixes, FixResult } from './fixer.js';
import {
  LOGO, SEVERITY_COLORS, SEVERITY_BADGES,
  highlightMatch, confidenceLabel,
} from './ui.js';

// ─── Finding classification ───────────────────────────────────────────────────

interface ClassifiedFindings {
  auto: Finding[];
  review: Finding[];
  manual: Finding[];
}

export function classifyFindings(findings: Finding[]): ClassifiedFindings {
  const auto: Finding[] = [];
  const review: Finding[] = [];
  const manual: Finding[] = [];

  for (const f of findings) {
    if (!f.suggestedFix) continue;
    switch (f.suggestedFix.confidence) {
      case 'auto': auto.push(f); break;
      case 'review': review.push(f); break;
      case 'manual': manual.push(f); break;
    }
  }

  return { auto, review, manual };
}

// ─── Diff computation ─────────────────────────────────────────────────────────

interface DiffLines {
  before: string;
  after: string;
}

export function computeDiff(finding: Finding): DiffLines | null {
  const fix = finding.suggestedFix;
  if (!fix || fix.confidence === 'manual') return null;

  const ctx = finding.contextLines;
  if (!ctx) return null;

  const ctxLine = ctx.find(c => c.line === finding.line);
  if (!ctxLine) return null;

  const before = ctxLine.text;
  const after = before.replaceAll(finding.matchedText, fix.replacement);
  if (before === after) return null;

  return { before: before.trimStart(), after: after.trimStart() };
}

// ─── Screen renderers ─────────────────────────────────────────────────────────

const thinBar = pc.dim(pc.cyan('│'));
const cont = `${thinBar}  `;

export function renderEntryBanner(
  auto: Finding[],
  review: Finding[],
  manual: Finding[],
  autoApplied: number,
  dryRun: boolean,
): string {
  const lines: string[] = [];
  const total = auto.length + review.length + manual.length;

  lines.push('');
  lines.push(`  ${LOGO}   ${pc.dim('interactive mode')}`);
  lines.push('');
  lines.push(`  ${pc.bold(`${total} findings`)} with suggested fixes`);

  if (auto.length > 0)
    lines.push(`   ${pc.green(String(auto.length).padStart(2))} auto     ${dryRun ? pc.dim('previewed (dry-run)') : pc.dim('applied automatically')}`);
  if (review.length > 0)
    lines.push(`   ${pc.yellow(String(review.length).padStart(2))} review   ${pc.dim('need your approval')}`);
  if (manual.length > 0)
    lines.push(`   ${pc.red(String(manual.length).padStart(2))} manual   ${pc.dim('instructions shown after review')}`);

  lines.push('');

  if (autoApplied > 0) {
    lines.push(`  ${pc.green('✓')} ${pc.bold(`${autoApplied} auto-fix${autoApplied === 1 ? '' : 'es'}`)} ${dryRun ? 'previewed' : 'applied'}`);
    lines.push('');
  }

  if (review.length > 0) {
    lines.push(`  Reviewing ${pc.bold(String(review.length))} finding${review.length === 1 ? '' : 's'}...`);
    lines.push('');
  }

  return lines.join('\n');
}

export function renderFindingScreen(finding: Finding, index: number, total: number): string {
  const lines: string[] = [];
  const sevColor = SEVERITY_COLORS[finding.severity];
  const badge = SEVERITY_BADGES[finding.severity];
  const loc = pc.dim(`${finding.line}:${finding.column}`);
  const progress = pc.dim(`${index + 1} of ${total}`);

  // File header with progress counter
  lines.push(`  ${pc.cyan('┃')} ${pc.white(pc.bold(pc.underline(finding.filePath)))}${' '.repeat(Math.max(1, 54 - finding.filePath.length))}${progress}`);

  // Blank line
  lines.push(`  ${thinBar}`);

  // Finding header
  lines.push(`  ${thinBar}    ${badge}  ${loc}  ${pc.bold(finding.message)}`);

  // Source context with gutter
  if (finding.contextLines && finding.contextLines.length > 0) {
    const ctx = finding.contextLines;
    const maxLine = ctx.reduce((m, c) => Math.max(m, c.line), 0);
    const gutterWidth = String(maxLine).length;
    const sep = pc.dim('┆');
    const findingBranch = pc.dim(pc.cyan('├────')) + sevColor(pc.bold('▸'));

    for (const c of ctx) {
      const isFinding = c.line === finding.line;
      const lnStr = String(c.line).padStart(gutterWidth, ' ');
      const lnCol = isFinding ? pc.bold(sevColor(lnStr)) : pc.dim(lnStr);

      if (isFinding) {
        const highlighted = highlightMatch(c.text, finding.column, finding.matchedText, sevColor);
        lines.push(`  ${findingBranch} ${lnCol} ${sep} ${highlighted}`);
      } else {
        lines.push(`  ${cont}    ${lnCol} ${sep} ${pc.dim(c.text)}`);
      }
    }
  } else {
    lines.push(`  ${cont}       ${pc.dim(finding.context)}`);
  }

  // Suggestion block with diff preview
  const fix = finding.suggestedFix!;
  const indent = '     ';
  const header = `${pc.yellow('fix')} · ${confidenceLabel(fix.confidence)} · ${pc.dim(fix.description)}`;

  lines.push(`  ${thinBar}`);
  lines.push(`  ${cont}${indent}${pc.dim('╭─')} ${header}`);

  const diff = computeDiff(finding);
  if (diff) {
    lines.push(`  ${cont}${indent}${pc.dim('│')} ${pc.red('- ' + diff.before)}`);
    for (const ln of diff.after.split('\n')) {
      lines.push(`  ${cont}${indent}${pc.dim('│')} ${pc.green('+ ' + ln)}`);
    }
  } else if (fix.confidence === 'manual' && fix.howToApply) {
    for (const ln of fix.howToApply.split('\n')) {
      lines.push(`  ${cont}${indent}${pc.dim('│')}   ${pc.dim(ln)}`);
    }
  } else if (fix.replacement && fix.replacement !== finding.matchedText) {
    for (const ln of fix.replacement.split('\n')) {
      lines.push(`  ${cont}${indent}${pc.dim('│')}   ${pc.green(ln)}`);
    }
  }

  lines.push(`  ${cont}${indent}${pc.dim('╰─')}`);

  // Prompt bar
  lines.push(`  ${thinBar}`);
  lines.push(`  ${thinBar}  ${pc.bold('y')} ${pc.dim('apply')}  ${pc.bold('n')} ${pc.dim('skip')}  ${pc.bold('a')} ${pc.dim('all')}  ${pc.bold('q')} ${pc.dim('quit')}  ${pc.bold('?')} ${pc.dim('help')}`);

  return lines.join('\n');
}

export function renderHelpOverlay(): string {
  const lines: string[] = [];
  const indent = '     ';

  lines.push('');
  lines.push(`  ${indent}${pc.dim('╭─')} ${pc.bold('Keyboard shortcuts')}`);
  lines.push(`  ${indent}${pc.dim('│')}   ${pc.bold('y')}   Apply this fix`);
  lines.push(`  ${indent}${pc.dim('│')}   ${pc.bold('n')}   Skip this fix`);
  lines.push(`  ${indent}${pc.dim('│')}   ${pc.bold('a')}   Apply all remaining fixes`);
  lines.push(`  ${indent}${pc.dim('│')}   ${pc.bold('q')}   Skip remaining and finish`);
  lines.push(`  ${indent}${pc.dim('│')}   ${pc.bold('?')}   Show this help`);
  lines.push(`  ${indent}${pc.dim('╰─')}`);
  lines.push('');
  lines.push(`  ${pc.dim('Press any key to continue...')}`);

  return lines.join('\n');
}

export function renderCompletionSummary(
  autoApplied: number,
  approved: number,
  skipped: number,
  manualFindings: Finding[],
  dryRun: boolean,
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`  ${pc.dim('╭─')} ${pc.bold('summary')}`);

  if (autoApplied > 0) {
    lines.push(`  ${pc.dim('│')}  ${pc.green('✓')} ${autoApplied} auto-fixed${dryRun ? ' (dry-run)' : ''}`);
  }
  if (approved > 0) {
    lines.push(`  ${pc.dim('│')}  ${pc.green('✓')} ${approved} approved & ${dryRun ? 'previewed' : 'applied'}`);
  }
  if (skipped > 0) {
    lines.push(`  ${pc.dim('│')}  ${pc.dim('○')} ${skipped} skipped`);
  }
  if (manualFindings.length > 0) {
    lines.push(`  ${pc.dim('│')}  ${pc.yellow('⚠')} ${manualFindings.length} require manual steps`);
  }

  lines.push(`  ${pc.dim('╰─')}`);

  if ((autoApplied > 0 || approved > 0) && !dryRun) {
    lines.push('');
    lines.push(`  ${pc.dim('Backup saved to .isolint-backup/')}`);
  }

  // Manual findings advisory
  if (manualFindings.length > 0) {
    lines.push('');
    const title = `MANUAL STEPS (${manualFindings.length})`;
    lines.push(`  ${pc.bold(title)} ${pc.dim('━'.repeat(Math.max(1, 48 - title.length)))}`);
    lines.push('');

    for (const f of manualFindings) {
      const sevColor = SEVERITY_COLORS[f.severity];
      lines.push(`  ${pc.cyan('┃')} ${pc.bold(f.filePath)}:${f.line}  ${sevColor(f.severity)}  ${f.message}`);

      if (f.suggestedFix?.howToApply) {
        for (const ln of f.suggestedFix.howToApply.split('\n')) {
          lines.push(`  ${thinBar}  ${pc.dim('→')} ${pc.dim(ln)}`);
        }
      }
      if (f.suggestedFix?.docUrl) {
        lines.push(`  ${thinBar}  ${pc.dim(f.suggestedFix.docUrl.replace('https://', ''))}`);
      }
      lines.push('');
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ─── Keypress reader ──────────────────────────────────────────────────────────

function readKey(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', (data) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      const key = data.toString();
      if (key === '\x03') {
        process.stdout.write('\n');
        process.exit(130);
      }
      resolve(key);
    });
  });
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runInteractiveFix(
  report: AuditReport,
  options: { dryRun?: boolean } = {},
): Promise<FixResult> {
  const dryRun = options.dryRun ?? false;
  const { auto, review, manual } = classifyFindings(report.findings);
  const result: FixResult = { applied: 0, skipped: 0, errors: [] };

  if (auto.length === 0 && review.length === 0 && manual.length === 0) {
    console.log('No fixable findings.');
    return result;
  }

  // Non-TTY fallback
  if (!process.stdin.isTTY) {
    console.log('Non-TTY detected — applying auto-confidence fixes only.');
    return applyFixes(report, { dryRun });
  }

  // Register cleanup for terminal state
  const cleanup = () => {
    try { process.stdin.setRawMode?.(false); } catch {}
    process.stdin.pause();
  };
  const sigintHandler = () => { cleanup(); process.exit(130); };
  process.on('SIGINT', sigintHandler);

  try {
    // Phase 0: Apply auto-fixes silently
    let autoApplied = 0;
    if (auto.length > 0) {
      const autoReport: AuditReport = { ...report, findings: auto };
      const autoResult = applyFixes(autoReport, { dryRun });
      autoApplied = autoResult.applied;
      result.applied += autoResult.applied;
      result.errors.push(...autoResult.errors);
    }

    // Entry banner
    process.stdout.write(renderEntryBanner(auto, review, manual, autoApplied, dryRun));

    // Phase 1: Review loop
    const approved: Finding[] = [];
    let applyAll = false;

    for (let i = 0; i < review.length; i++) {
      const finding = review[i];

      if (applyAll) {
        approved.push(finding);
        continue;
      }

      // Clear screen and render finding
      process.stdout.write('\x1b[2J\x1b[H');
      process.stdout.write(renderFindingScreen(finding, i, review.length));
      process.stdout.write('\n');

      let decided = false;
      while (!decided) {
        const key = await readKey();

        switch (key.toLowerCase()) {
          case 'y':
            approved.push(finding);
            decided = true;
            break;
          case 'n':
            result.skipped++;
            decided = true;
            break;
          case 'a':
            approved.push(finding);
            applyAll = true;
            decided = true;
            break;
          case 'q':
            result.skipped += review.length - i;
            i = review.length; // break outer loop
            decided = true;
            break;
          case '?':
            process.stdout.write('\x1b[2J\x1b[H');
            process.stdout.write(renderHelpOverlay());
            await readKey(); // wait for any key
            // Re-render the finding screen
            process.stdout.write('\x1b[2J\x1b[H');
            process.stdout.write(renderFindingScreen(finding, i, review.length));
            process.stdout.write('\n');
            break;
          // Ignore unknown keys
        }
      }
    }

    // Apply approved review fixes
    if (approved.length > 0) {
      const approvedReport: AuditReport = { ...report, findings: approved };
      const approveResult = applyFixes(approvedReport, { force: true, dryRun });
      result.applied += approveResult.applied;
      result.errors.push(...approveResult.errors);
    }
    result.skipped += manual.length;

    // Phase 2: Completion summary
    process.stdout.write('\x1b[2J\x1b[H');
    process.stdout.write(renderCompletionSummary(
      autoApplied,
      approved.length,
      result.skipped,
      manual,
      dryRun,
    ));

  } finally {
    cleanup();
    process.removeListener('SIGINT', sigintHandler);
  }

  return result;
}
