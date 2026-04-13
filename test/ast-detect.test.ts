import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';
import { initAstGrep, isAstAvailable, EXT_TO_LANG, astDetectPorts, astDetectAbsolutePaths, logParityDivergences } from '../src/ast-detect.js';
import { FileContext, Finding } from '../src/types.js';
import { getPatternSets } from '../src/lang/index.js';

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

const nodePatterns = getPatternSets({ ecosystems: ['node'], markers: { node: ['package.json'] } });

// Initialize ast-grep once before all tests
before(async () => {
  const ok = await initAstGrep();
  assert.ok(ok, '@ast-grep/napi should be available as a regular dependency');
});

// ---------------------------------------------------------------------------
// EXT_TO_LANG
// ---------------------------------------------------------------------------

describe('EXT_TO_LANG mapping', () => {
  it('maps all expected JS/TS extensions', () => {
    assert.equal(EXT_TO_LANG['.ts'], 'TypeScript');
    assert.equal(EXT_TO_LANG['.tsx'], 'Tsx');
    assert.equal(EXT_TO_LANG['.js'], 'JavaScript');
    assert.equal(EXT_TO_LANG['.jsx'], 'Tsx');
    assert.equal(EXT_TO_LANG['.mjs'], 'JavaScript');
    assert.equal(EXT_TO_LANG['.cjs'], 'JavaScript');
    assert.equal(EXT_TO_LANG['.mts'], 'TypeScript');
    assert.equal(EXT_TO_LANG['.cts'], 'TypeScript');
  });

  it('returns undefined for non-JS/TS extensions', () => {
    assert.equal(EXT_TO_LANG['.py'], undefined);
    assert.equal(EXT_TO_LANG['.yaml'], undefined);
    assert.equal(EXT_TO_LANG['.go'], undefined);
    assert.equal(EXT_TO_LANG[''], undefined);
  });
});

// ---------------------------------------------------------------------------
// astDetectPorts
// ---------------------------------------------------------------------------

describe('astDetectPorts', () => {
  it('returns null for non-JS/TS files', () => {
    const file = makeFile('port: 3000', 'config.yaml');
    assert.equal(astDetectPorts(file, nodePatterns), null);
  });

  it('returns null for .env files', () => {
    const file = makeFile('PORT=3000', '.env', '.env');
    assert.equal(astDetectPorts(file, nodePatterns), null);
  });

  it('detects .listen(3000) with single arg', () => {
    const file = makeFile('app.listen(3000);');
    const findings = astDetectPorts(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.ok(findings.length > 0);
    assert.equal(findings[0].matchedText, '3000');
    assert.equal(findings[0].category, 'hardcoded-port');
    assert.equal(findings[0].line, 1);
  });

  it('detects .listen(8080, callback) with multiple args', () => {
    const file = makeFile('server.listen(8080, () => console.log("ok"));');
    const findings = astDetectPorts(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.ok(findings.length > 0);
    assert.equal(findings[0].matchedText, '8080');
  });

  it('skips .listen() with a variable (not a number literal)', () => {
    const file = makeFile('app.listen(PORT);');
    const findings = astDetectPorts(file, nodePatterns)!;
    assert.ok(findings !== null);
    // Should not flag PORT (an identifier, not a number)
    const listenFindings = findings.filter(f => f.ruleId.includes('hardcoded-ports'));
    assert.equal(listenFindings.filter(f => f.matchedText === 'PORT').length, 0);
  });

  it('ignores ports inside comments', () => {
    const file = makeFile('// app.listen(3000)');
    const findings = astDetectPorts(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.equal(findings.length, 0, 'should not detect ports in single-line comments');
  });

  it('ignores ports inside block comments', () => {
    const file = makeFile('/* app.listen(3000) */');
    const findings = astDetectPorts(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.equal(findings.length, 0, 'should not detect ports in block comments');
  });

  it('ignores ports inside multi-line block comments', () => {
    const file = makeFile('/*\n * server.listen(3000)\n * port = 8080\n */\nconst x = 1;');
    const findings = astDetectPorts(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.equal(findings.length, 0, 'should not detect ports in multi-line comments');
  });

  it('skips when process.env is used', () => {
    const file = makeFile('const port = process.env.PORT || 3000;');
    const findings = astDetectPorts(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.equal(findings.length, 0, 'should skip env var usage');
  });

  it('detects port in object property { port: 3000 }', () => {
    const file = makeFile('const cfg = { port: 3000 };');
    const findings = astDetectPorts(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.ok(findings.length > 0, 'should detect port in object property');
    assert.equal(findings[0].matchedText, '3000');
  });

  it('detects localhost URL in string literal', () => {
    const file = makeFile('const url = "http://localhost:4000/api";');
    const findings = astDetectPorts(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.ok(findings.length > 0, 'should detect localhost URL');
    assert.equal(findings[0].matchedText, 'localhost:4000');
    assert.equal(findings[0].suggestedFix?.confidence, 'manual');
  });

  it('detects localhost URL in template literal', () => {
    const file = makeFile('const url = `http://localhost:5000/api`;');
    const findings = astDetectPorts(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.ok(findings.length > 0, 'should detect localhost in template string');
    assert.equal(findings[0].matchedText, 'localhost:5000');
  });

  it('returns empty array (not null) when file has no ports', () => {
    const file = makeFile('const x = "hello world";');
    const findings = astDetectPorts(file, nodePatterns);
    assert.ok(findings !== null, 'should return [] not null for parsed files');
    assert.equal(findings!.length, 0);
  });

  it('works with .js files', () => {
    const file = makeFile('app.listen(3000);', 'server.js');
    const findings = astDetectPorts(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.ok(findings.length > 0);
  });

  it('works with .tsx files', () => {
    const file = makeFile('const API = "http://localhost:3001/api";', 'App.tsx');
    const findings = astDetectPorts(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.ok(findings.length > 0);
  });

  it('skips negative numbers (error code tables)', () => {
    const file = makeFile('const UV_EADDRINUSE = [-4091, "address already in use"];');
    const findings = astDetectPorts(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.equal(findings.length, 0, 'should not flag negative number as port');
  });

  it('detects localhost URL in JSX text content', () => {
    const file = makeFile('<p>Visit http://localhost:3000/api for docs</p>', 'App.tsx');
    const findings = astDetectPorts(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.ok(findings.length > 0, 'should detect port in JSX text');
    assert.equal(findings[0].matchedText, 'localhost:3000');
  });

  it('skips TTL/duration constants', () => {
    const file = makeFile('const CACHE_TTL = 3600;');
    const findings = astDetectPorts(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.equal(findings.length, 0, 'should not flag TTL as port');
  });

  it('returns empty array quickly for files with no port candidates', () => {
    const file = makeFile('const name = "hello";\nfunction greet() { return name; }');
    const findings = astDetectPorts(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.equal(findings.length, 0);
  });
});

// ---------------------------------------------------------------------------
// astDetectAbsolutePaths
// ---------------------------------------------------------------------------

describe('astDetectAbsolutePaths', () => {
  it('returns null for non-JS/TS files', () => {
    const file = makeFile('path: /Users/matt/data', 'config.yaml');
    assert.equal(astDetectAbsolutePaths(file, []), null);
  });

  it('detects /Users/xxx path in string literal', () => {
    const file = makeFile('const p = "/Users/matt/projects/app/data";');
    const findings = astDetectAbsolutePaths(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.ok(findings.length > 0);
    assert.equal(findings[0].category, 'absolute-path');
    assert.equal(findings[0].severity, 'critical');
  });

  it('detects /home/xxx path in string literal', () => {
    const file = makeFile('const dir = "/home/deploy/app/data";');
    const findings = astDetectAbsolutePaths(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.ok(findings.length > 0);
  });

  it('ignores paths inside comments', () => {
    const file = makeFile('// path is /Users/matt/projects/app');
    const findings = astDetectAbsolutePaths(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.equal(findings.length, 0, 'should not detect paths in comments');
  });

  it('ignores paths inside block comments', () => {
    const file = makeFile('/* /Users/matt/projects/app/data */');
    const findings = astDetectAbsolutePaths(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.equal(findings.length, 0, 'should not detect paths in block comments');
  });

  it('detects path in template literal', () => {
    const file = makeFile('const p = `/Users/matt/projects/app/data`;');
    const findings = astDetectAbsolutePaths(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.ok(findings.length > 0);
  });

  it('skips safe system paths like /usr/', () => {
    const file = makeFile('const bin = "/usr/local/bin/node";');
    const findings = astDetectAbsolutePaths(file, nodePatterns)!;
    assert.ok(findings !== null);
    assert.equal(findings.length, 0, 'should skip safe system paths');
  });

  it('returns empty array (not null) for clean file', () => {
    const file = makeFile('const x = "hello";');
    const findings = astDetectAbsolutePaths(file, nodePatterns);
    assert.ok(findings !== null, 'should return [] not null for parsed files');
    assert.equal(findings!.length, 0);
  });
});

// ---------------------------------------------------------------------------
// logParityDivergences
// ---------------------------------------------------------------------------

describe('logParityDivergences', () => {
  it('logs when regex finds something AST missed', () => {
    const logs: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => { logs.push(args.join(' ')); };

    const astFindings: Finding[] = [];
    const regexFindings: Finding[] = [{
      ruleId: 'hardcoded-ports/node',
      category: 'hardcoded-port',
      severity: 'high',
      filePath: 'test.ts',
      line: 5,
      column: 1,
      matchedText: '3000',
      message: 'test',
      context: 'test',
    }];

    logParityDivergences('hardcoded-ports', 'test.ts', astFindings, regexFindings);
    console.error = origError;

    assert.ok(logs.some(l => l.includes('[ast-parity]') && l.includes('MISS')));
  });

  it('logs when AST finds something regex missed', () => {
    const logs: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => { logs.push(args.join(' ')); };

    const astFindings: Finding[] = [{
      ruleId: 'hardcoded-ports/node',
      category: 'hardcoded-port',
      severity: 'high',
      filePath: 'test.ts',
      line: 5,
      column: 1,
      matchedText: '3000',
      message: 'test',
      context: 'test',
    }];
    const regexFindings: Finding[] = [];

    logParityDivergences('hardcoded-ports', 'test.ts', astFindings, regexFindings);
    console.error = origError;

    assert.ok(logs.some(l => l.includes('[ast-parity]') && l.includes('EXTRA')));
  });

  it('logs nothing when both agree', () => {
    const logs: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => { logs.push(args.join(' ')); };

    const findings: Finding[] = [{
      ruleId: 'hardcoded-ports/node',
      category: 'hardcoded-port',
      severity: 'high',
      filePath: 'test.ts',
      line: 5,
      column: 1,
      matchedText: '3000',
      message: 'test',
      context: 'test',
    }];

    logParityDivergences('hardcoded-ports', 'test.ts', findings, findings);
    console.error = origError;

    assert.equal(logs.length, 0, 'should not log when both agree');
  });
});
