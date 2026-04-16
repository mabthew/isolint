import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Finding, ContextLine } from '../src/types.js';
import { classifyFindings, computeDiff, renderFindingScreen, renderCompletionSummary, renderEntryBanner } from '../src/interactive.js';
import { stripAnsi } from '../src/ui.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'test',
    category: 'hardcoded-port',
    severity: 'high',
    filePath: 'src/config.ts',
    line: 3,
    column: 10,
    matchedText: '3000',
    message: 'Hardcoded port 3000',
    context: 'app.listen(3000)',
    contextLines: [
      { line: 1, text: 'const express = require("express");' },
      { line: 2, text: 'const app = express();' },
      { line: 3, text: 'app.listen(3000, () => {' },
      { line: 4, text: '  console.log("running");' },
      { line: 5, text: '});' },
    ],
    suggestedFix: {
      description: 'Use environment variable',
      replacement: 'process.env.PORT ?? 3000',
      confidence: 'auto',
    },
    ...overrides,
  };
}

// ─── classifyFindings ─────────────────────────────────────────────────────────

describe('classifyFindings', () => {
  it('splits findings by confidence level', () => {
    const findings = [
      makeFinding({ suggestedFix: { description: 'a', replacement: 'x', confidence: 'auto' } }),
      makeFinding({ suggestedFix: { description: 'b', replacement: 'y', confidence: 'review' } }),
      makeFinding({ suggestedFix: { description: 'c', replacement: 'z', confidence: 'manual' } }),
      makeFinding({ suggestedFix: { description: 'd', replacement: 'w', confidence: 'review' } }),
    ];
    const result = classifyFindings(findings);
    assert.equal(result.auto.length, 1);
    assert.equal(result.review.length, 2);
    assert.equal(result.manual.length, 1);
  });

  it('discards findings without suggestedFix', () => {
    const findings = [
      makeFinding({ suggestedFix: undefined }),
      makeFinding(),
    ];
    const result = classifyFindings(findings);
    assert.equal(result.auto.length, 1);
    assert.equal(result.review.length, 0);
    assert.equal(result.manual.length, 0);
  });

  it('returns empty arrays when no findings', () => {
    const result = classifyFindings([]);
    assert.equal(result.auto.length, 0);
    assert.equal(result.review.length, 0);
    assert.equal(result.manual.length, 0);
  });
});

// ─── computeDiff ──────────────────────────────────────────────────────────────

describe('computeDiff', () => {
  it('computes before/after for a review finding', () => {
    const finding = makeFinding({
      suggestedFix: { description: 'fix', replacement: 'process.env.PORT ?? 3000', confidence: 'review' },
    });
    const diff = computeDiff(finding);
    assert.ok(diff);
    assert.ok(diff.before.includes('3000'));
    assert.ok(diff.after.includes('process.env.PORT'));
  });

  it('returns null for manual findings', () => {
    const finding = makeFinding({
      matchedText: '3000',
      suggestedFix: { description: 'fix', replacement: '3000', confidence: 'manual' },
    });
    const diff = computeDiff(finding);
    assert.equal(diff, null);
  });

  it('returns null when replacement equals matchedText', () => {
    const finding = makeFinding({
      suggestedFix: { description: 'fix', replacement: '3000', confidence: 'review' },
    });
    const diff = computeDiff(finding);
    assert.equal(diff, null);
  });

  it('returns null when no contextLines', () => {
    const finding = makeFinding({ contextLines: undefined });
    const diff = computeDiff(finding);
    assert.equal(diff, null);
  });

  it('handles multi-line replacements', () => {
    const finding = makeFinding({
      suggestedFix: { description: 'fix', replacement: 'process.env.PORT ??\n  3000', confidence: 'review' },
    });
    const diff = computeDiff(finding);
    assert.ok(diff);
    assert.ok(diff.after.includes('\n'));
  });
});

// ─── renderFindingScreen ──────────────────────────────────────────────────────

describe('renderFindingScreen', () => {
  it('includes file path and progress counter', () => {
    const finding = makeFinding({
      suggestedFix: { description: 'Use env var', replacement: 'process.env.PORT ?? 3000', confidence: 'review' },
    });
    const output = stripAnsi(renderFindingScreen(finding, 0, 5));
    assert.ok(output.includes('src/config.ts'));
    assert.ok(output.includes('1 of 5'));
  });

  it('includes severity badge text', () => {
    const finding = makeFinding({
      severity: 'critical',
      suggestedFix: { description: 'fix', replacement: 'x', confidence: 'review' },
    });
    const output = stripAnsi(renderFindingScreen(finding, 0, 1));
    assert.ok(output.includes('CRIT'));
  });

  it('includes gutter characters', () => {
    const finding = makeFinding({
      suggestedFix: { description: 'fix', replacement: 'x', confidence: 'review' },
    });
    const output = renderFindingScreen(finding, 0, 1);
    const plain = stripAnsi(output);
    assert.ok(plain.includes('┃'));
    assert.ok(plain.includes('│'));
    assert.ok(plain.includes('├────▸'));
    assert.ok(plain.includes('╭─'));
    assert.ok(plain.includes('╰─'));
  });

  it('shows diff preview with - and + lines', () => {
    const finding = makeFinding({
      suggestedFix: { description: 'fix', replacement: 'process.env.PORT ?? 3000', confidence: 'review' },
    });
    const output = stripAnsi(renderFindingScreen(finding, 0, 1));
    assert.ok(output.includes('- app.listen(3000'));
    assert.ok(output.includes('+ app.listen(process.env.PORT ?? 3000'));
  });

  it('shows keyboard shortcuts', () => {
    const finding = makeFinding({
      suggestedFix: { description: 'fix', replacement: 'x', confidence: 'review' },
    });
    const output = stripAnsi(renderFindingScreen(finding, 0, 1));
    assert.ok(output.includes('apply'));
    assert.ok(output.includes('skip'));
    assert.ok(output.includes('quit'));
    assert.ok(output.includes('help'));
  });

  it('shows context lines with line numbers', () => {
    const finding = makeFinding({
      suggestedFix: { description: 'fix', replacement: 'x', confidence: 'review' },
    });
    const output = stripAnsi(renderFindingScreen(finding, 0, 1));
    assert.ok(output.includes('1'));
    assert.ok(output.includes('express'));
    assert.ok(output.includes('5'));
  });
});

// ─── renderCompletionSummary ──────────────────────────────────────────────────

describe('renderCompletionSummary', () => {
  it('shows auto-fixed count', () => {
    const output = stripAnsi(renderCompletionSummary(4, 0, 0, [], false));
    assert.ok(output.includes('4 auto-fixed'));
  });

  it('shows approved count', () => {
    const output = stripAnsi(renderCompletionSummary(0, 3, 0, [], false));
    assert.ok(output.includes('3 approved'));
    assert.ok(output.includes('applied'));
  });

  it('shows skipped count', () => {
    const output = stripAnsi(renderCompletionSummary(0, 0, 2, [], false));
    assert.ok(output.includes('2 skipped'));
  });

  it('shows manual findings advisory', () => {
    const manualFindings = [
      makeFinding({
        severity: 'high',
        message: 'Hardcoded port in JSON config',
        suggestedFix: {
          description: 'Move to env var',
          replacement: '3000',
          confidence: 'manual',
          howToApply: 'Set PORT in env',
          docUrl: 'https://isolint.dev/docs/rules/hardcoded-ports',
        },
      }),
    ];
    const output = stripAnsi(renderCompletionSummary(0, 0, 0, manualFindings, false));
    assert.ok(output.includes('MANUAL STEPS'));
    assert.ok(output.includes('Set PORT in env'));
    assert.ok(output.includes('isolint.dev'));
  });

  it('shows backup message when fixes applied', () => {
    const output = stripAnsi(renderCompletionSummary(2, 1, 0, [], false));
    assert.ok(output.includes('Backup saved'));
  });

  it('does not show backup message in dry-run', () => {
    const output = stripAnsi(renderCompletionSummary(2, 1, 0, [], true));
    assert.ok(!output.includes('Backup saved'));
  });

  it('shows dry-run label', () => {
    const output = stripAnsi(renderCompletionSummary(2, 0, 0, [], true));
    assert.ok(output.includes('dry-run'));
  });
});

// ─── renderEntryBanner ────────────────────────────────────────────────────────

describe('renderEntryBanner', () => {
  it('shows total count and breakdown', () => {
    const auto = [makeFinding()];
    const review = [makeFinding(), makeFinding()];
    const manual = [makeFinding()];
    const output = stripAnsi(renderEntryBanner(auto, review, manual, 1, false));
    assert.ok(output.includes('4 findings'));
    assert.ok(output.includes('1 auto'));
    assert.ok(output.includes('2 review'));
    assert.ok(output.includes('1 manual'));
  });

  it('shows auto-fixes applied count', () => {
    const output = stripAnsi(renderEntryBanner([makeFinding()], [], [], 1, false));
    assert.ok(output.includes('1 auto-fix'));
    assert.ok(output.includes('applied'));
  });

  it('shows dry-run label when applicable', () => {
    const output = stripAnsi(renderEntryBanner([makeFinding()], [], [], 1, true));
    assert.ok(output.includes('dry-run'));
    assert.ok(output.includes('previewed'));
  });

  it('shows interactive mode label', () => {
    const output = stripAnsi(renderEntryBanner([], [makeFinding()], [], 0, false));
    assert.ok(output.includes('interactive mode'));
  });
});
