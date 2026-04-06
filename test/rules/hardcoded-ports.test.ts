import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { hardcodedPortsRule } from '../../src/rules/hardcoded-ports.js';
import { FileContext } from '../../src/types.js';
import { getPatternSets } from '../../src/lang/index.js';

function makeFile(content: string, filePath = 'server.ts', basename?: string): FileContext {
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
    basename: basename ?? filePath.split('/').pop()!,
  };
}

const patterns = getPatternSets({ ecosystems: ['node'], markers: { node: ['package.json'] } });

describe('hardcoded-ports rule', () => {
  it('detects hardcoded port in .listen()', () => {
    const file = makeFile(`app.listen(3000, () => {});`);
    const findings = hardcodedPortsRule.detect(file, patterns);
    assert.ok(findings.length > 0, 'should find hardcoded port');
    assert.equal(findings[0].category, 'hardcoded-port');
  });

  it('detects port in .env files', () => {
    const file = makeFile('PORT=3000\nAPI_PORT=8080', '.env', '.env');
    const findings = hardcodedPortsRule.detect(file, patterns);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].severity, 'critical');
  });

  it('skips lines using process.env', () => {
    const file = makeFile(`const port = process.env.PORT || 3000;`);
    const findings = hardcodedPortsRule.detect(file, patterns);
    assert.equal(findings.length, 0, 'should skip env var usage');
  });

  it('detects Docker Compose port mappings', () => {
    const content = `services:\n  web:\n    ports:\n      - "3000:3000"`;
    const file = makeFile(content, 'docker-compose.yml', 'docker-compose.yml');
    const findings = hardcodedPortsRule.detect(file, patterns);
    assert.ok(findings.length > 0, 'should find docker port mapping');
    assert.equal(findings[0].severity, 'critical');
  });

  it('detects Dockerfile EXPOSE', () => {
    const content = `FROM node:20\nEXPOSE 3000`;
    const file = makeFile(content, 'Dockerfile', 'Dockerfile');
    const findings = hardcodedPortsRule.detect(file, patterns);
    assert.ok(findings.length > 0, 'should find EXPOSE');
    assert.equal(findings[0].severity, 'medium');
  });

  it('skips comment lines', () => {
    const file = makeFile(`// app.listen(3000)`);
    const findings = hardcodedPortsRule.detect(file, patterns);
    assert.equal(findings.length, 0, 'should skip comments');
  });

  it('detects localhost URLs', () => {
    const file = makeFile(`const url = "http://localhost:4000/api";`);
    const findings = hardcodedPortsRule.detect(file, patterns);
    assert.ok(findings.length > 0, 'should find localhost URL');
  });
});
