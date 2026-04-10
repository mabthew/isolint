import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { loadConfig } from '../src/config.js';

describe('config — loadConfig', () => {
  it('warns on unknown config keys', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-config-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, '.isolint.yml'),
        'severity: high\ncategorys: [hardcoded-port]\ntypo_key: true\n'
      );

      const warnings: string[] = [];
      const origError = console.error;
      console.error = (msg: string) => warnings.push(msg);

      loadConfig(tmpDir, { ignorePatterns: [] });

      console.error = origError;

      assert.ok(
        warnings.some(w => w.includes('categorys')),
        'should warn about "categorys" typo'
      );
      assert.ok(
        warnings.some(w => w.includes('typo_key')),
        'should warn about "typo_key"'
      );
      // Valid keys should not trigger warnings
      assert.ok(
        !warnings.some(w => w.includes('"severity"')),
        'should not warn about valid key "severity"'
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('loads valid config without warnings', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-config2-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, '.isolint.yml'),
        'severity: medium\nignore:\n  - "*.test.ts"\nmaxFileSize: 500000\n'
      );

      const warnings: string[] = [];
      const origError = console.error;
      console.error = (msg: string) => warnings.push(msg);

      const config = loadConfig(tmpDir, { ignorePatterns: [] });

      console.error = origError;

      assert.equal(warnings.length, 0, 'valid config should produce no warnings');
      assert.equal(config.severityFilter, 'medium');
      assert.ok(config.ignorePatterns.includes('*.test.ts'));
      assert.equal(config.maxFileSize, 500000);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
