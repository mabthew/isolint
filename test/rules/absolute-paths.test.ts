import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { absolutePathsRule } from '../../src/rules/absolute-paths.js';
import { FileContext } from '../../src/types.js';

function makeFile(content: string, filePath = 'config.ts'): FileContext {
  const lines = content.split('\n');
  const lineOffsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineOffsets.push(i + 1);
  }
  return {
    filePath,
    absolutePath: `/repo/${filePath}`,
    content,
    lines,
    lineOffsets,
    extension: filePath.slice(filePath.lastIndexOf('.')),
    basename: filePath.split('/').pop()!,
  };
}

describe('absolute-paths rule', () => {
  it('detects /Users/xxx paths', () => {
    const file = makeFile(`const p = "/Users/matt/projects/app/data";`);
    const findings = absolutePathsRule.detect(file, []);
    assert.ok(findings.length > 0);
    assert.equal(findings[0].severity, 'critical');
    assert.equal(findings[0].category, 'absolute-path');
  });

  it('detects /home/xxx paths', () => {
    const file = makeFile(`DATA_DIR=/home/deploy/app/data`);
    const findings = absolutePathsRule.detect(file, []);
    assert.ok(findings.length > 0);
  });

  it('skips safe system paths like /usr/', () => {
    const file = makeFile(`const bin = "/usr/local/bin/node";`);
    const findings = absolutePathsRule.detect(file, []);
    assert.equal(findings.length, 0);
  });

  it('skips comment lines', () => {
    const file = makeFile(`// path is /Users/matt/projects/app`);
    const findings = absolutePathsRule.detect(file, []);
    assert.equal(findings.length, 0);
  });

  it('detects Windows drive paths', () => {
    const file = makeFile(`const p = "C:\\Users\\matt\\projects\\app\\data";`);
    const findings = absolutePathsRule.detect(file, []);
    assert.ok(findings.length > 0);
  });
});
