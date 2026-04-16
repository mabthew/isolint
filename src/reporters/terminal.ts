import pc from 'picocolors';
import { AuditReport, Finding, Severity } from '../types.js';
import {
  AMBER, LOGO,
  SEVERITY_COLORS, SEVERITY_BADGES, SEVERITY_ICONS,
  stripAnsi, highlightMatch, confidenceLabel,
} from '../ui.js';

function scoreColor(score: number): (s: string) => string {
  if (score >= 90) return pc.green;
  if (score >= 70) return pc.yellow;
  if (score >= 50) return pc.cyan;
  return pc.red;
}

function scoreGrade(score: number): string {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function renderScoreBar(score: number): string {
  const grade = scoreGrade(score);
  const colorFn = scoreColor(score);
  const barFilled = Math.round(score / 5);
  const barEmpty = 20 - barFilled;
  const bar = colorFn('█'.repeat(barFilled)) + pc.dim('░'.repeat(barEmpty));
  return `  ${bar}  ${colorFn(pc.bold(`${score}/100`))} ${pc.bold(`(${grade})`)}`;
}

export function formatTerminalReport(
  report: AuditReport,
  showFixes: boolean,
  quiet?: boolean,
  verbose?: boolean,
  gutter: boolean = true,
): string {
  const useGutter = gutter;
  const lines: string[] = [];
  const bar = pc.dim(pc.cyan('▎'));

  // Header (suppressed in quiet mode)
  if (!quiet) {
    lines.push('');
    lines.push(`  ${LOGO}`);
    lines.push('');
    lines.push(`  ${pc.bold(report.repoPath)}`);

    // Compact stats line
    const parts: string[] = [
      `${report.filesScanned} files`,
      `${report.duration}ms`,
    ];
    if (report.repoProfile.ecosystems.length > 0 && report.repoProfile.ecosystems[0] !== 'unknown') {
      parts.push(report.repoProfile.ecosystems.join(', '));
    }
    lines.push(`  ${pc.dim(parts.join(' · '))}`);
    lines.push('');
  }

  // Audit results summary — shown right after header
  if (!quiet) {
    lines.push(`  ${pc.bold('AUDIT RESULTS')}`);
    lines.push('');
    lines.push(renderScoreBar(report.score));
    lines.push('');

    if (report.findings.length === 0) {
      lines.push(pc.green(`  ${pc.bold('✓')} No parallel-incompatible patterns found.`));
      lines.push('');
      return lines.join('\n');
    }

    lines.push(`  ${pc.white(pc.bold(pc.underline(`${report.findingsCount} findings`)))}`);
    lines.push('');

    const critCount = report.findings.filter(f => f.severity === 'critical').length;
    const highCount = report.findings.filter(f => f.severity === 'high').length;
    if (critCount > 0) {
      lines.push(`  ${pc.bgRed(pc.bold(pc.black(` ${SEVERITY_ICONS.critical} ${critCount} critical `)))} ${pc.red('these WILL break parallel development')}`);
    }
    if (highCount > 0) {
      lines.push(`  ${pc.bgYellow(pc.bold(pc.black(` ${SEVERITY_ICONS.high} ${highCount} high `)))} ${pc.yellow('likely to cause conflicts')}`);
    }
    if (critCount > 0 || highCount > 0) {
      lines.push('');
    }

    // Collect unique doc URLs by category so we can show each next to its summary row
    const docUrls = new Map<string, string>();
    for (const f of report.findings) {
      if (f.suggestedFix?.docUrl && !docUrls.has(f.category)) {
        docUrls.set(f.category, f.suggestedFix.docUrl.replace('https://', ''));
      }
    }

    // Build each summary row, then right-pad to the widest visible width
    // so the doc URLs line up in a column on the right.
    const rows: Array<{ body: string; docUrl: string | undefined }> = [];
    for (const s of report.summary) {
      const summaryParts: string[] = [];
      for (const [sev, count] of Object.entries(s.bySeverity)) {
        const color = SEVERITY_COLORS[sev as Severity];
        summaryParts.push(color(`${count} ${sev}`));
      }
      const catName = pc.bold(s.category.padEnd(18));
      const body = `  ${catName}  ${s.count} findings (${summaryParts.join(', ')})`;
      rows.push({ body, docUrl: docUrls.get(s.category) });
    }
    const widest = rows.reduce((m, r) => Math.max(m, stripAnsi(r.body).length), 0);
    for (const r of rows) {
      const padded = r.body + ' '.repeat(widest - stripAnsi(r.body).length);
      const suffix = r.docUrl ? '  ' + pc.dim(r.docUrl) : '';
      lines.push(padded + suffix);
    }
    lines.push('');
  } else if (report.findings.length === 0) {
    return '';
  }

  // Split findings into code issues vs documentation (informational)
  const DOC_EXTS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc']);
  const codeFindings: Finding[] = [];
  const docFindings: Finding[] = [];
  for (const f of report.findings) {
    const ext = f.filePath.slice(f.filePath.lastIndexOf('.'));
    if (DOC_EXTS.has(ext)) {
      docFindings.push(f);
    } else {
      codeFindings.push(f);
    }
  }

  function renderFindingGroup(findings: Finding[]) {
    const byFile = new Map<string, Finding[]>();
    for (const f of findings) {
      const arr = byFile.get(f.filePath) || [];
      arr.push(f);
      byFile.set(f.filePath, arr);
    }

    const thinBar = pc.dim(pc.cyan('│'));

    for (const [filePath, fileFindings] of byFile) {
      // File path header — heavy bar
      lines.push(`  ${pc.cyan('┃')} ${pc.white(pc.bold(pc.underline(filePath)))}`);

      const shownFixDescriptions = new Set<string>();

      for (let i = 0; i < fileFindings.length; i++) {
        const f = fileFindings[i];
        // Context/sub-line prefix: keep the vertical │ flowing straight through
        // the header and body — the only horizontal branch is the one that
        // connects `│` → `▸` on the finding line itself.
        const cont = `${thinBar}  `;

        // Blank connector line above each finding
        lines.push(`  ${thinBar}`);

        // Header line — no branch, just the vertical │ continuing through
        const badge = SEVERITY_BADGES[f.severity];
        const loc = pc.dim(`${f.line}:${f.column}`);
        lines.push(`  ${thinBar}    ${badge}  ${loc}  ${pc.bold(f.message)}`);

        // Source context: gutter view when we have contextLines + TTY, compact otherwise
        if (useGutter && f.contextLines && f.contextLines.length > 0) {
          renderFindingGutterBody(f, cont);
        } else {
          lines.push(`  ${cont}       ${pc.dim(f.context)}`);
        }

        if (showFixes && f.suggestedFix) {
          // Include the finding line so identical (description, replacement)
          // pairs on different lines each render their own suggestion block.
          const fixKey = `${f.suggestedFix.description}|${f.suggestedFix.replacement}|${f.line}`;
          if (shownFixDescriptions.has(fixKey)) continue;
          shownFixDescriptions.add(fixKey);

          // In gutter mode render the suggestion block; otherwise keep the
          // existing single-line `→ replacement` form used by CI / piped output.
          if (useGutter) {
            renderSuggestionBlock(f, cont);
          } else {
            const confidence = f.suggestedFix.confidence === 'auto'
              ? pc.green(pc.bold('auto-fixable'))
              : f.suggestedFix.confidence === 'review'
                ? pc.yellow('suggested fix')
                : pc.red('manual steps');
            lines.push(`  ${cont}`);
            lines.push(`  ${cont}       ${confidence}  ${pc.dim(f.suggestedFix.description)}`);
            if (f.suggestedFix.confidence === 'manual' && f.suggestedFix.howToApply) {
              lines.push(`  ${cont}       ${pc.dim(f.suggestedFix.howToApply)}`);
            } else if (f.suggestedFix.replacement) {
              const replacementLine = f.suggestedFix.replacement.split('\n')[0];
              lines.push(`  ${cont}       ${pc.green('→')} ${pc.green(replacementLine)}`);
            }
          }
        }
      }
      lines.push('');
    }
  }

  /**
   * Semgrep-style gutter body rendered inside the file tree.
   * Lines are prefixed with `cont` so they tie into the ├──/└── branches above.
   *
   *   │      13 ┆   "ConnectionStrings": {
   *   │      14 ┆     "WebHooksDB": "..."
   *   │    ▸ 15 ┆     "EventBus": "amqp://localhost"
   *   │      16 ┆   },
   */
  function renderFindingGutterBody(f: Finding, cont: string) {
    const ctx = f.contextLines!;
    const maxLine = ctx.reduce((m, c) => Math.max(m, c.line), 0);
    const gutterWidth = String(maxLine).length;
    const sep = pc.dim('┆');
    const sevColor = SEVERITY_COLORS[f.severity];

    // Horizontal connector from the vertical │ to the ▸ marker for the finding line
    // Replaces the leading `│    ` (cont + 4 spaces) with `├────▸` — same visual width.
    const findingBranch = pc.dim(pc.cyan('├────')) + sevColor(pc.bold('▸'));

    for (const c of ctx) {
      const isFinding = c.line === f.line;
      const lnStr = String(c.line).padStart(gutterWidth, ' ');
      const lnCol = isFinding ? pc.bold(sevColor(lnStr)) : pc.dim(lnStr);

      if (isFinding) {
        const highlighted = highlightMatch(c.text, f.column, f.matchedText, sevColor);
        lines.push(`  ${findingBranch} ${lnCol} ${sep} ${highlighted}`);
      } else {
        lines.push(`  ${cont}    ${lnCol} ${sep} ${pc.dim(c.text)}`);
      }
    }
  }

  /**
   * Suggestion block — the `--suggest` body. Shown below the gutter view as a
   * boxed code block containing the recommended replacement. Does NOT attempt
   * a textual splice into the source line because current isolint fixes are
   * illustrative rather than drop-in safe (see roadmap item #12). When
   * precise per-context replacements land, this can graduate to a real diff
   * hunk renderer.
   *
   *   │
   *   │     ╭─ suggested fix · review · Use Environment.GetEnvironmentVariable with fallback
   *   │     │   Environment.GetEnvironmentVariable("PORT") ?? "5045"
   *   │     ╰─
   */
  function renderSuggestionBlock(f: Finding, cont: string) {
    const fix = f.suggestedFix!;

    const header = `${pc.yellow('suggested fix')} · ${confidenceLabel(fix.confidence)} · ${pc.dim(fix.description)}`;
    const indent = '     '; // 5 spaces — sits under the gutter body

    lines.push(`  ${cont}`);
    lines.push(`  ${cont}${indent}${pc.dim('╭─')} ${header}`);

    if (fix.confidence === 'manual' && fix.howToApply) {
      // Manual fixes: show the how-to text as the body
      for (const ln of fix.howToApply.split('\n')) {
        lines.push(`  ${cont}${indent}${pc.dim('│')}   ${pc.dim(ln)}`);
      }
    } else if (fix.replacement) {
      for (const ln of fix.replacement.split('\n')) {
        lines.push(`  ${cont}${indent}${pc.dim('│')}   ${pc.green(ln)}`);
      }
    }

    lines.push(`  ${cont}${indent}${pc.dim('╰─')}`);
  }

  // Section headers: uppercase bold + heavy divider
  if (codeFindings.length > 0 && docFindings.length > 0) {
    const codeTitle = `CODE ISSUES (${codeFindings.length})`;
    lines.push(`  ${pc.bold(codeTitle)} ${pc.dim('━'.repeat(Math.max(1, 52 - codeTitle.length)))}`);
    lines.push('');
    renderFindingGroup(codeFindings);

    const docTitle = `DOCUMENTATION (${docFindings.length})`;
    lines.push(`  ${pc.bold(docTitle)} ${pc.dim('━'.repeat(Math.max(1, 52 - docTitle.length)))}`);
    lines.push('');
    renderFindingGroup(docFindings);
  } else {
    renderFindingGroup(report.findings);
  }

  return lines.join('\n');
}
