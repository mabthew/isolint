import pc from 'picocolors';
import { AuditReport, Finding, Severity } from '../types.js';

// Single-line gradient logo in white
// #f59e0b amber — raw ANSI true color since picocolors has no orange
const AMBER = (s: string) => `\x1b[38;2;245;158;11m${s}\x1b[39m`;
const LOGO = AMBER('░▒▓█') + pc.bold(AMBER('  i s o l i n t  ')) + AMBER('█▓▒░');

const SEVERITY_COLORS: Record<Severity, (s: string) => string> = {
  critical: pc.red,
  high: pc.yellow,
  medium: pc.cyan,
  low: pc.gray,
  info: pc.gray,
};

// Badges with icons baked in for visual weight
const SEVERITY_BADGES: Record<Severity, string> = {
  critical: pc.bgRed(pc.bold(pc.black(' ✖ CRIT '))),
  high: pc.bgYellow(pc.bold(pc.black(' ▲ HIGH '))),
  medium: pc.bgCyan(pc.bold(pc.black(' ◆ MED  '))),
  low: pc.bgWhite(pc.black(' ◉ LOW  ')),
  info: pc.bgWhite(pc.black(' ○ INFO ')),
};

const SEVERITY_ICONS: Record<Severity, string> = {
  critical: '✖',
  high: '▲',
  medium: '◆',
  low: '◉',
  info: '○',
};

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
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
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

        // Body: gutter context or single-line context
        if (useGutter && f.contextLines && f.contextLines.length > 0) {
          renderFindingGutterBody(f, cont);
        } else {
          lines.push(`  ${cont}       ${pc.dim(f.context)}`);
        }

        if (showFixes && f.suggestedFix) {
          const fixKey = f.suggestedFix.description + f.suggestedFix.replacement;
          if (shownFixDescriptions.has(fixKey)) continue;
          shownFixDescriptions.add(fixKey);

          const confidence = f.suggestedFix.confidence === 'auto'
            ? pc.green(pc.bold('auto-fixable'))
            : f.suggestedFix.confidence === 'review'
              ? pc.yellow('suggested fix')
              : pc.red('manual steps');
          lines.push(`  ${cont}`);
          lines.push(`  ${cont}       ${confidence}  ${pc.dim(f.suggestedFix.description)}`);
          if (f.suggestedFix.confidence === 'manual' && f.suggestedFix.howToApply) {
            lines.push(`  ${cont}       ${pc.dim(f.suggestedFix.howToApply)}`);
          } else {
            const replacementLine = f.suggestedFix.replacement.split('\n')[0];
            lines.push(`  ${cont}       ${pc.green('→')} ${pc.green(replacementLine)}`);
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
   * Highlight the offending span on a source line by bolding + coloring
   * the substring that starts at `column` and has length `matchedText.length`.
   * Falls back to rendering the full line bright if the span can't be located.
   */
  function highlightMatch(lineText: string, column: number, matchedText: string, color: (s: string) => string): string {
    if (!matchedText || column < 1) return color(lineText);
    // Try the column-based slice first
    const startIdx = column - 1;
    const endIdx = startIdx + matchedText.length;
    if (endIdx <= lineText.length && lineText.slice(startIdx, endIdx) === matchedText) {
      return lineText.slice(0, startIdx) + color(pc.bold(matchedText)) + lineText.slice(endIdx);
    }
    // Fall back to indexOf search — matches may have shifted if context got trimmed
    const foundIdx = lineText.indexOf(matchedText);
    if (foundIdx !== -1) {
      return lineText.slice(0, foundIdx) + color(pc.bold(matchedText)) + lineText.slice(foundIdx + matchedText.length);
    }
    return color(lineText);
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
