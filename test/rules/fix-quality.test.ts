import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { hardcodedPortsRule } from '../../src/rules/hardcoded-ports.js';
import { dockerConflictsRule } from '../../src/rules/docker-conflicts.js';
import { databaseStringsRule } from '../../src/rules/database-strings.js';
import { logFilePathsRule } from '../../src/rules/log-file-paths.js';
import { tempDirectoriesRule } from '../../src/rules/temp-directories.js';
import { pidAndSocketsRule } from '../../src/rules/pid-and-sockets.js';
import { buildDirectoriesRule } from '../../src/rules/build-directories.js';
import { sharedCachesRule } from '../../src/rules/shared-caches.js';
import { FileContext, Finding } from '../../src/types.js';
import { getPatternSets } from '../../src/lang/index.js';

function makeFile(content: string, filePath: string, basename?: string): FileContext {
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

/** Simulate fixer's replaceAll and verify result is different from original */
function applyReplacement(line: string, finding: Finding): string {
  if (!finding.suggestedFix) return line;
  return line.replaceAll(finding.matchedText, finding.suggestedFix.replacement);
}

const nodePatterns = getPatternSets({ ecosystems: ['node'], markers: { node: ['package.json'] } });
const dotnetPatterns = getPatternSets({ ecosystems: ['dotnet'], markers: { dotnet: ['*.csproj'] } });
const pythonPatterns = getPatternSets({ ecosystems: ['python'], markers: { python: ['pyproject.toml'] } });
const javaPatterns = getPatternSets({ ecosystems: ['java'], markers: { java: ['pom.xml'] } });
const rubyPatterns = getPatternSets({ ecosystems: ['ruby'], markers: { ruby: ['Gemfile'] } });

describe('fix quality — hardcoded-ports', () => {
  describe('auto confidence', () => {
    it('Node .listen(PORT) produces valid replacement', () => {
      const file = makeFile('app.listen(3000, () => {});', 'server.ts');
      const findings = hardcodedPortsRule.detect(file, nodePatterns);
      const finding = findings.find(f => f.ruleId.includes('node'));
      assert.ok(finding, 'should detect port');
      assert.equal(finding.suggestedFix?.confidence, 'auto');
      assert.equal(finding.matchedText, '3000');
      const result = applyReplacement('app.listen(3000, () => {});', finding);
      assert.ok(result.includes('process.env.PORT'), 'should contain env var');
      assert.ok(result.includes('app.listen('), 'should preserve .listen(');
      assert.ok(result.includes(', () => {});'), 'should preserve callback');
    });

    it('Python .run(port=PORT) produces valid replacement', () => {
      const file = makeFile('app.run(port=8000)', 'server.py');
      const findings = hardcodedPortsRule.detect(file, pythonPatterns);
      const finding = findings.find(f => f.ruleId.includes('python'));
      assert.ok(finding, 'should detect port');
      assert.equal(finding.suggestedFix?.confidence, 'auto');
      assert.equal(finding.matchedText, '8000');
      const result = applyReplacement('app.run(port=8000)', finding);
      assert.ok(result.includes('os.environ.get'), 'should contain env var');
      assert.ok(result.includes('app.run(port='), 'should preserve port= keyword');
    });

    it('Docker Compose port mapping produces valid replacement', () => {
      const content = `services:\n  web:\n    ports:\n      - "3000:3000"`;
      const file = makeFile(content, 'docker-compose.yml', 'docker-compose.yml');
      const findings = hardcodedPortsRule.detect(file, nodePatterns);
      assert.ok(findings.length > 0);
      const finding = findings[0];
      assert.equal(finding.suggestedFix?.confidence, 'auto');
      // matchedText should not have leading whitespace or YAML list prefix
      assert.ok(!finding.matchedText.includes('-'), 'matchedText should not include YAML list prefix');
      assert.ok(!finding.suggestedFix!.replacement.startsWith(' '), 'replacement should not have leading whitespace');
      const line = '      - "3000:3000"';
      const result = applyReplacement(line, finding);
      assert.ok(result.includes('${HOST_PORT:-3000}'), 'should have variable interpolation');
      assert.ok(result.startsWith('      - "'), 'should preserve original indentation');
    });

    it('Spring server.port in .properties produces valid replacement', () => {
      const file = makeFile('server.port=8080', 'application.properties', 'application.properties');
      const findings = hardcodedPortsRule.detect(file, javaPatterns);
      const finding = findings.find(f => f.ruleId.includes('java'));
      assert.ok(finding, 'should detect port');
      assert.equal(finding.suggestedFix?.confidence, 'auto');
      assert.equal(finding.matchedText, '8080');
      const result = applyReplacement('server.port=8080', finding);
      assert.equal(result, 'server.port=${PORT:8080}');
    });
  });

  describe('manual confidence for non-interpolable formats', () => {
    it('dotnet JSON config gets manual confidence', () => {
      const content = `{"Kestrel":{"EndPoints":{"Http":{"Url":"http://*:5271"}}}}`;
      const file = makeFile(content, 'appsettings.json', 'appsettings.json');
      const findings = hardcodedPortsRule.detect(file, dotnetPatterns);
      assert.ok(findings.length > 0);
      for (const f of findings) {
        assert.equal(f.suggestedFix?.confidence, 'manual', `${f.ruleId} should be manual in JSON`);
        assert.ok(f.suggestedFix?.howToApply, `${f.ruleId} should have howToApply`);
      }
    });

    it('Dockerfile EXPOSE gets manual confidence', () => {
      const file = makeFile('FROM node:20\nEXPOSE 3000', 'Dockerfile', 'Dockerfile');
      const findings = hardcodedPortsRule.detect(file, nodePatterns);
      assert.ok(findings.length > 0);
      assert.equal(findings[0].suggestedFix?.confidence, 'manual');
      assert.ok(findings[0].suggestedFix?.howToApply?.includes('ARG'), 'howToApply should mention ARG');
    });

    it('.env file ports get manual confidence', () => {
      const file = makeFile('PORT=3000', '.env', '.env');
      const findings = hardcodedPortsRule.detect(file, nodePatterns);
      assert.ok(findings.length > 0);
      assert.equal(findings[0].suggestedFix?.confidence, 'manual');
    });

    it('localhost URL patterns get manual confidence', () => {
      // Use a file type that won't match any ecosystem's portBindingPatterns
      // so the universal localhost pattern fires (not the ecosystem-specific one)
      const file = makeFile('url = "http://localhost:4000/api"', 'config.txt', 'config.txt');
      const findings = hardcodedPortsRule.detect(file, nodePatterns);
      const localhostFinding = findings.find(f => f.ruleId.includes('localhost'));
      assert.ok(localhostFinding, 'should detect localhost URL');
      assert.equal(localhostFinding.suggestedFix?.confidence, 'manual');
      assert.ok(localhostFinding.suggestedFix?.howToApply, 'should have howToApply');
    });
  });

  describe('matchedText is minimal', () => {
    it('ecosystem source pattern uses port number as matchedText', () => {
      const file = makeFile('app.listen(3000, () => {});', 'server.ts');
      const findings = hardcodedPortsRule.detect(file, nodePatterns);
      const finding = findings.find(f => f.ruleId.includes('node'));
      assert.ok(finding);
      assert.equal(finding.matchedText, '3000', 'matchedText should be just the port number');
    });

    it('Ruby config.port uses port number as matchedText', () => {
      const file = makeFile('config.port = 3000', 'config.rb');
      const findings = hardcodedPortsRule.detect(file, rubyPatterns);
      const finding = findings.find(f => f.ruleId.includes('ruby'));
      assert.ok(finding);
      assert.equal(finding.matchedText, '3000');
      assert.equal(finding.suggestedFix?.confidence, 'auto');
    });
  });
});

describe('fix quality — docker-conflicts', () => {
  it('container_name: auto confidence with minimal matchedText', () => {
    const content = `services:\n  web:\n    container_name: myapp`;
    const file = makeFile(content, 'docker-compose.yml', 'docker-compose.yml');
    const findings = dockerConflictsRule.detect(file, []);
    assert.ok(findings.length > 0);
    const f = findings[0];
    assert.equal(f.matchedText, 'myapp', 'matchedText should be just the name');
    assert.equal(f.suggestedFix?.confidence, 'auto');
    assert.ok(f.suggestedFix?.replacement.includes('${COMPOSE_PROJECT_NAME:-myapp}'));
    // Verify replacement produces valid YAML when applied
    const line = '    container_name: myapp';
    const result = applyReplacement(line, f);
    assert.ok(result.startsWith('    container_name:'), 'should preserve structure');
    assert.ok(result.includes('${COMPOSE_PROJECT_NAME:-myapp}'), 'should have interpolation');
  });

  it('network name: auto confidence with minimal matchedText', () => {
    const content = `services:\n  web:\n    image: nginx\nnetworks:\n  mynet:\n    name: mynetwork`;
    const file = makeFile(content, 'docker-compose.yml', 'docker-compose.yml');
    const findings = dockerConflictsRule.detect(file, []);
    const netFinding = findings.find(f => f.ruleId.includes('network'));
    assert.ok(netFinding, 'should detect network name');
    assert.equal(netFinding.matchedText, 'mynetwork');
    assert.equal(netFinding.suggestedFix?.confidence, 'auto');
  });
});

describe('fix quality — no shell syntax in source code', () => {
  it('log-file-paths: no $(basename) in .py files', () => {
    const content = `logging.FileHandler("app.log")`;
    const file = makeFile(content, 'logger.py');
    const findings = logFilePathsRule.detect(file, []);
    assert.ok(findings.length > 0);
    assert.ok(!findings[0].suggestedFix?.replacement.includes('$('), 'should not have shell syntax');
    assert.equal(findings[0].suggestedFix?.confidence, 'manual');
  });

  it('log-file-paths: keeps $(basename) in .sh files', () => {
    const content = `echo "logging" >> "/var/log/app.log"`;
    const file = makeFile(content, 'run.sh');
    const findings = logFilePathsRule.detect(file, []);
    assert.ok(findings.length > 0);
    assert.ok(findings[0].suggestedFix?.replacement.includes('$(basename'), 'should have shell syntax in shell file');
    assert.equal(findings[0].suggestedFix?.confidence, 'review');
  });

  it('temp-directories: no $(basename) in .ts files', () => {
    const content = `const dir = "/tmp/myapp"`;
    const file = makeFile(content, 'worker.ts');
    const findings = tempDirectoriesRule.detect(file, []);
    assert.ok(findings.length > 0);
    assert.ok(!findings[0].suggestedFix?.replacement.includes('$('), 'should not have shell syntax');
    assert.equal(findings[0].suggestedFix?.confidence, 'manual');
  });

  it('pid-and-sockets: no $(basename) in replacements', () => {
    const content = `pidfile = "/var/run/app.pid"`;
    const file = makeFile(content, 'config.rb');
    const findings = pidAndSocketsRule.detect(file, []);
    assert.ok(findings.length > 0);
    assert.ok(!findings[0].suggestedFix?.replacement.includes('$('), 'should not have shell syntax');
    assert.equal(findings[0].suggestedFix?.confidence, 'manual');
  });
});

describe('fix quality — database-strings format awareness', () => {
  it('JSON config gets manual confidence', () => {
    const content = `{"ConnectionStrings":{"Default":"Server=localhost;Database=mydb"}}`;
    const file = makeFile(content, 'appsettings.json', 'appsettings.json');
    const findings = databaseStringsRule.detect(file, dotnetPatterns);
    for (const f of findings) {
      if (f.suggestedFix) {
        assert.equal(f.suggestedFix.confidence, 'manual', 'JSON should be manual');
        assert.ok(f.suggestedFix.howToApply, 'should have howToApply');
      }
    }
  });
});

describe('fix quality — auto findings produce valid replacements', () => {
  it('all auto-confidence findings have replacements that change the line', () => {
    // Test across several file types that produce auto findings
    const testCases: { content: string; filePath: string; basename: string; patterns: ReturnType<typeof getPatternSets>; rule: typeof hardcodedPortsRule }[] = [
      { content: 'app.listen(3000);', filePath: 'server.ts', basename: 'server.ts', patterns: nodePatterns, rule: hardcodedPortsRule },
      { content: 'app.run(port=8000)', filePath: 'app.py', basename: 'app.py', patterns: pythonPatterns, rule: hardcodedPortsRule },
      { content: 'services:\n  web:\n    ports:\n      - "3000:3000"', filePath: 'docker-compose.yml', basename: 'docker-compose.yml', patterns: nodePatterns, rule: hardcodedPortsRule },
    ];

    for (const tc of testCases) {
      const file = makeFile(tc.content, tc.filePath, tc.basename);
      const findings = tc.rule.detect(file, tc.patterns);
      const autoFindings = findings.filter(f => f.suggestedFix?.confidence === 'auto');
      assert.ok(autoFindings.length > 0, `${tc.filePath} should have auto findings`);

      for (const f of autoFindings) {
        const lineContent = file.lines[f.line - 1];
        assert.ok(lineContent.includes(f.matchedText),
          `matchedText "${f.matchedText}" should appear in line "${lineContent}" (${tc.filePath})`);
        const result = applyReplacement(lineContent, f);
        assert.notEqual(result, lineContent,
          `replacement should change the line in ${tc.filePath}`);
      }
    }
  });

  it('manual findings always have howToApply', () => {
    const testCases = [
      { content: 'EXPOSE 3000', filePath: 'Dockerfile', basename: 'Dockerfile', patterns: nodePatterns, rule: hardcodedPortsRule },
      { content: 'PORT=3000', filePath: '.env', basename: '.env', patterns: nodePatterns, rule: hardcodedPortsRule },
    ];

    for (const tc of testCases) {
      const file = makeFile(tc.content, tc.filePath, tc.basename);
      const findings = tc.rule.detect(file, tc.patterns);
      const manualFindings = findings.filter(f => f.suggestedFix?.confidence === 'manual');
      for (const f of manualFindings) {
        assert.ok(f.suggestedFix?.howToApply,
          `manual finding ${f.ruleId} in ${tc.filePath} should have howToApply`);
      }
    }
  });
});
