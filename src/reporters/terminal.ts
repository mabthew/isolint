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

export function formatTerminalReport(report: AuditReport, showFixes: boolean, quiet?: boolean, verbose?: boolean): string {
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

    for (const [filePath, fileFindings] of byFile) {
      const thinBar = pc.dim(pc.cyan('│'));

      // File path — heavy bar only here, aligns with │ below
      lines.push(`  ${pc.cyan('┃')} ${pc.white(pc.bold(pc.underline(filePath)))}`);

      // Track which fix descriptions we've already shown for this file
      const shownFixDescriptions = new Set<string>();

      for (let i = 0; i < fileFindings.length; i++) {
        const f = fileFindings[i];
        const isLast = i === fileFindings.length - 1;
        const badge = SEVERITY_BADGES[f.severity];
        const loc = pc.dim(`${f.line}:${f.column}`);
        const branch = isLast ? pc.dim(pc.cyan('└──')) : pc.dim(pc.cyan('├──'));
        const cont = isLast ? '  ' : thinBar;
        lines.push(`  ${thinBar}`);
        lines.push(`  ${branch} ${badge} ${loc}  ${pc.bold(f.message)}`);
        lines.push(`  ${cont}                   ${pc.dim(f.context)}`);

        if (showFixes && f.suggestedFix) {
          // Skip duplicate fixes — show once per unique description in a file
          const fixKey = f.suggestedFix.description + f.suggestedFix.replacement;
          if (shownFixDescriptions.has(fixKey)) continue;
          shownFixDescriptions.add(fixKey);

          const confidence = f.suggestedFix.confidence === 'auto'
            ? pc.green(pc.bold('auto-fixable'))
            : f.suggestedFix.confidence === 'review'
              ? pc.yellow('suggested fix')
              : pc.red('manual steps');
          const pad = '         ';
          lines.push(`  ${cont}${pad}${confidence}  ${pc.dim(f.suggestedFix.description)}`);
          if (f.suggestedFix.confidence === 'manual' && f.suggestedFix.howToApply) {
            lines.push(`  ${cont}${pad}${pc.dim(f.suggestedFix.howToApply)}`);
          } else {
            const replacementLine = f.suggestedFix.replacement.split('\n')[0];
            lines.push(`  ${cont}${pad}${pc.green('→')} ${pc.green(replacementLine)}`);
          }
          lines.push(`  ${cont}`);
        }
      }
      lines.push('');
    }
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
