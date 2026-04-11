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

describe('hardcoded-ports rule — C# / .NET', () => {
  const dotnetPatterns = getPatternSets({ ecosystems: ['dotnet'], markers: { dotnet: ['*.csproj'] } });

  it('detects Kestrel ListenAnyIP', () => {
    const file = makeFile(`options.ListenAnyIP(5001);`, 'Program.cs');
    const findings = hardcodedPortsRule.detect(file, dotnetPatterns);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].message.includes('ListenAnyIP'), true);
  });

  it('detects Kestrel ListenLocalhost', () => {
    const file = makeFile(`options.ListenLocalhost(5002);`, 'Program.cs');
    const findings = hardcodedPortsRule.detect(file, dotnetPatterns);
    assert.equal(findings.length, 1);
  });

  it('detects Listen(IPAddress.Any, port)', () => {
    const file = makeFile(`options.Listen(IPAddress.Loopback, 5004, opts => opts.UseHttps());`, 'Program.cs');
    const findings = hardcodedPortsRule.detect(file, dotnetPatterns);
    assert.equal(findings.length, 1);
  });

  it('emits one finding per port in multi-URL applicationUrl', () => {
    const content = `{\n  "profiles": {\n    "http": {\n      "applicationUrl": "https://localhost:5243;http://localhost:5223"\n    }\n  }\n}`;
    const file = makeFile(content, 'Properties/launchSettings.json', 'launchSettings.json');
    const findings = hardcodedPortsRule.detect(file, dotnetPatterns);
    const ports = findings.map(f => f.message.match(/port (\d+)/)?.[1]).sort();
    assert.deepEqual(ports, ['5223', '5243']);
  });

  it('detects sslPort in launchSettings (IIS Express port range)', () => {
    const content = `{\n  "profiles": {\n    "iisExpress": {\n      "sslPort": 44365\n    }\n  }\n}`;
    const file = makeFile(content, 'Properties/launchSettings.json', 'launchSettings.json');
    const findings = hardcodedPortsRule.detect(file, dotnetPatterns);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].message.includes('44365'), true);
  });

  it('detects HTTP_PORTS/HTTPS_PORTS env var format', () => {
    const content = `{\n  "HTTP_PORTS": "8080",\n  "HTTPS_PORTS": "8443"\n}`;
    const file = makeFile(content, 'appsettings.json', 'appsettings.json');
    const findings = hardcodedPortsRule.detect(file, dotnetPatterns);
    assert.equal(findings.length, 2);
  });

  it('detects Kestrel EndPoints Url with wildcard host', () => {
    const content = `{\n  "Kestrel": {\n    "EndPoints": {\n      "Http": {\n        "Url": "http://*:5271"\n      }\n    }\n  }\n}`;
    const file = makeFile(content, 'appsettings.json', 'appsettings.json');
    const findings = hardcodedPortsRule.detect(file, dotnetPatterns);
    assert.ok(findings.length >= 1);
    assert.equal(findings[0].message.includes('5271'), true);
  });
});

describe('multi-line comment detection — string-literal awareness', () => {
  const nodePatterns = getPatternSets({ ecosystems: ['node'], markers: { node: ['package.json'] } });

  it('does not treat /* inside a URL string as a block comment', () => {
    // Regression: `"http://*:5271"` used to confuse the block-comment
    // detector into marking every subsequent line as "inside a comment".
    const content = `const url = "http://*:5271";\napp.listen(3000);`;
    const file = makeFile(content, 'server.ts');
    const findings = hardcodedPortsRule.detect(file, nodePatterns);
    // Should detect 3000 on line 2 (not filtered out as "commented")
    assert.ok(findings.some(f => f.line === 2), 'should detect port on line after string containing /*');
  });
});
