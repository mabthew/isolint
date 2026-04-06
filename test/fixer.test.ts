import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { applyFixes } from '../src/fixer.js';
import { AuditReport, Finding } from '../src/types.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'test',
    category: 'hardcoded-port',
    severity: 'high',
    filePath: 'test.ts',
    line: 1,
    column: 1,
    matchedText: '3000',
    message: 'test finding',
    context: 'app.listen(3000)',
    suggestedFix: {
      description: 'Use env var',
      replacement: 'PORT',
      confidence: 'auto',
    },
    ...overrides,
  };
}

describe('fixer — applyFixes', () => {
  it('applies auto-confidence fixes in dry-run mode', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wta-fixer-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'app.listen(3000);\n');
      const report: AuditReport = {
        repoPath: tmpDir,
        timestamp: new Date().toISOString(),
        duration: 0,
        filesScanned: 1,
        findingsCount: 1,
        repoProfile: { ecosystems: ['node'], markers: {} },
        findings: [makeFinding()],
        summary: [],
        score: 80,
      };

      const result = applyFixes(report, { dryRun: true });
      assert.equal(result.applied, 1);
      assert.equal(result.errors.length, 0);
      // File should be unchanged in dry-run
      const content = fs.readFileSync(path.join(tmpDir, 'test.ts'), 'utf-8');
      assert.ok(content.includes('3000'), 'dry-run should not modify file');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips non-auto fixes unless force is true', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wta-fixer-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'app.listen(3000);\n');
      const report: AuditReport = {
        repoPath: tmpDir,
        timestamp: new Date().toISOString(),
        duration: 0,
        filesScanned: 1,
        findingsCount: 1,
        repoProfile: { ecosystems: ['node'], markers: {} },
        findings: [makeFinding({ suggestedFix: { description: 'fix', replacement: 'PORT', confidence: 'review' } })],
        summary: [],
        score: 80,
      };

      const result = applyFixes(report);
      assert.equal(result.skipped, 1);
      assert.equal(result.applied, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('replaces all occurrences on a line (replaceAll)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wta-fixer-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'listen(3000) and port(3000)\n');
      const report: AuditReport = {
        repoPath: tmpDir,
        timestamp: new Date().toISOString(),
        duration: 0,
        filesScanned: 1,
        findingsCount: 1,
        repoProfile: { ecosystems: ['node'], markers: {} },
        findings: [makeFinding()],
        summary: [],
        score: 80,
      };

      const result = applyFixes(report, { dryRun: false });
      assert.equal(result.applied, 1);
      const content = fs.readFileSync(path.join(tmpDir, 'test.ts'), 'utf-8');
      assert.ok(!content.includes('3000'), 'replaceAll should replace all occurrences');
      assert.ok(content.includes('PORT'), 'should contain replacement');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
