import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { runAudit, SEVERITY_ORDER } from '../src/engine.js';
import { AuditConfig, Severity } from '../src/types.js';

// Fixtures live in source tree, not dist
const FIXTURES_DIR = path.resolve(__dirname, '..', '..', 'test', 'fixtures');

function makeConfig(fixtureName: string, overrides: Partial<AuditConfig> = {}): AuditConfig {
  return {
    rootDir: path.resolve(FIXTURES_DIR, fixtureName),
    suggest: false,
    fix: false,
    dryRun: false,
    format: 'terminal',
    ignorePatterns: [],
    respectGitignore: false,
    maxFileSize: 1_048_576,
    ...overrides,
  };
}

describe('integration — full audit pipeline', () => {
  it('sample-app: exits with findings at high+ severity', async () => {
    const report = await runAudit(makeConfig('sample-app'));

    // Has critical findings (env file ports, absolute paths, docker ports)
    const criticals = report.findings.filter(f => f.severity === 'critical');
    assert.ok(criticals.length > 0, 'sample-app should have critical findings');

    // fail-on=high should trigger
    const failLevel: Severity = 'high';
    const threshold = SEVERITY_ORDER[failLevel];
    const hasFailure = report.findings.some(f => SEVERITY_ORDER[f.severity] <= threshold);
    assert.ok(hasFailure, 'should have findings at high+ severity');
  });

  it('clean-app: exits clean', async () => {
    const report = await runAudit(makeConfig('clean-app'));
    assert.equal(report.findingsCount, 0);
    assert.equal(report.score, 100);

    // fail-on=high should NOT trigger
    const failLevel: Severity = 'high';
    const threshold = SEVERITY_ORDER[failLevel];
    const hasFailure = report.findings.some(f => SEVERITY_ORDER[f.severity] <= threshold);
    assert.ok(!hasFailure, 'clean-app should not trigger failure');
  });

  it('ignore-test: respects all ignore forms', async () => {
    const report = await runAudit(makeConfig('ignore-test'));
    // Only line 6 should have findings (localhost:9000)
    // Lines 4 and 5 should be suppressed
    for (const f of report.findings) {
      assert.ok(f.line !== 4, 'line 4 should be ignored (ignore-next-line)');
      assert.ok(f.line !== 5, 'line 5 should be ignored (wta-ignore)');
    }
  });

  it('sample-app: docker findings include container_name', async () => {
    const report = await runAudit(makeConfig('sample-app', { categories: ['docker-conflict'] }));
    assert.ok(report.findings.length >= 2, 'should find container_name conflicts');
    assert.ok(
      report.findings.some(f => f.matchedText.includes('myapp-web')),
      'should find myapp-web container'
    );
  });

  it('sample-app: .env files excluded from non-env rules', async () => {
    // .env files are excluded from all rules except env-propagation (by design)
    // DB URLs in .env should NOT produce database-string findings
    const report = await runAudit(makeConfig('sample-app', { categories: ['database-string'] }));
    const envDbFindings = report.findings.filter(f =>
      f.filePath === '.env' && f.category === 'database-string'
    );
    assert.equal(envDbFindings.length, 0, '.env should be excluded from database-string rule');
  });

  it('report metadata is correct', async () => {
    const report = await runAudit(makeConfig('sample-app'));
    assert.ok(report.timestamp);
    assert.ok(report.duration >= 0);
    assert.ok(report.repoProfile.ecosystems.includes('node'));
    assert.ok(report.summary.length > 0, 'should have category summaries');
  });
});
