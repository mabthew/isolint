import pc from 'picocolors';
import { AuditReport, Finding, Severity } from '../types.js';

const SEVERITY_COLORS: Record<Severity, (s: string) => string> = {
  critical: pc.red,
  high: pc.yellow,
  medium: pc.cyan,
  low: pc.dim,
  info: pc.gray,
};

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'CRIT',
  high: 'HIGH',
  medium: ' MED',
  low: ' LOW',
  info: 'INFO',
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

export function formatTerminalReport(report: AuditReport, showFixes: boolean): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(pc.bold('parallel-dev-audit') + ` — ${report.repoPath}`);
  lines.push(pc.dim(`Scanned ${report.filesScanned} files in ${report.duration}ms`));

  // Detected ecosystems
  if (report.repoProfile.ecosystems.length > 0 && report.repoProfile.ecosystems[0] !== 'unknown') {
    lines.push(pc.dim(`Ecosystems: ${report.repoProfile.ecosystems.join(', ')}`));
  }
  lines.push('');

  if (report.findings.length === 0) {
    lines.push(scoreColor(100)(pc.bold('  Parallel Dev Readiness: 100/100 (A+)')));
    lines.push(pc.green('  No parallel-incompatible patterns found.'));
    lines.push('');
    return lines.join('\n');
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
      lines.push(pc.underline(filePath));
      for (const f of fileFindings) {
        const color = SEVERITY_COLORS[f.severity];
        const label = SEVERITY_LABELS[f.severity];
        const loc = pc.dim(`${f.line}:${f.column}`);
        lines.push(`  ${color(label)} ${loc}  ${f.message}`);
        lines.push(`       ${pc.dim(f.context)}`);

        if (showFixes && f.suggestedFix) {
          const confidence = f.suggestedFix.confidence === 'auto'
            ? pc.green('auto-fixable')
            : f.suggestedFix.confidence === 'review'
              ? pc.yellow('needs review')
              : pc.red('manual fix');
          lines.push(`       ${pc.bold('fix')} (${confidence}): ${f.suggestedFix.description}`);
          lines.push(`       ${pc.green('→')} ${pc.dim(f.suggestedFix.replacement)}`);
        }
      }
      lines.push('');
    }
  }

  // Render code issues first, then doc findings separately
  if (codeFindings.length > 0 && docFindings.length > 0) {
    lines.push(pc.bold(`Code Issues (${codeFindings.length})`));
    lines.push('');
    renderFindingGroup(codeFindings);

    lines.push(pc.bold(`Documentation (${docFindings.length} — informational)`));
    lines.push('');
    renderFindingGroup(docFindings);
  } else {
    // All findings are one type — no need for section headers
    renderFindingGroup(report.findings);
  }

  // Score with visual bar
  const grade = scoreGrade(report.score);
  const colorFn = scoreColor(report.score);
  const barFilled = Math.round(report.score / 5);
  const barEmpty = 20 - barFilled;
  const bar = colorFn('█'.repeat(barFilled)) + pc.dim('░'.repeat(barEmpty));
  lines.push(`${bar} ${colorFn(pc.bold(`${report.score}/100 (${grade})`))}`);
  lines.push('');

  // Summary
  lines.push(pc.bold('Summary'));
  for (const s of report.summary) {
    const parts: string[] = [];
    for (const [sev, count] of Object.entries(s.bySeverity)) {
      const color = SEVERITY_COLORS[sev as Severity];
      parts.push(color(`${count} ${sev}`));
    }
    lines.push(`  ${s.category}: ${s.count} findings (${parts.join(', ')})`);
  }

  lines.push('');
  const critCount = report.findings.filter(f => f.severity === 'critical').length;
  const highCount = report.findings.filter(f => f.severity === 'high').length;
  if (critCount > 0) {
    lines.push(pc.red(`  ${critCount} critical issue${critCount > 1 ? 's' : ''} — these WILL break parallel development`));
  }
  if (highCount > 0) {
    lines.push(pc.yellow(`  ${highCount} high severity issue${highCount > 1 ? 's' : ''} — likely to cause conflicts`));
  }
  lines.push(pc.dim(`  Total: ${report.findingsCount} findings`));
  lines.push('');

  return lines.join('\n');
}
