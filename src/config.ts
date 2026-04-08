import * as fs from 'fs';
import * as path from 'path';
import { AuditConfig, Category, Severity } from './types.js';
import { parseYamlConfig } from './parsers/yaml-config.js';

interface ConfigFile {
  severity?: Severity;
  failOn?: Severity;
  categories?: Category[];
  ignore?: string[];
  maxFileSize?: number;
}

const CONFIG_FILENAMES = ['.parallel-dev-audit.yml', '.parallel-dev-audit.yaml', '.worktree-audit.yml', '.worktree-audit.yaml'];

/** Load config from .parallel-dev-audit.yml (or legacy .worktree-audit.yml). CLI flags take precedence. */
export function loadConfig(rootDir: string, cliConfig: Partial<AuditConfig>): AuditConfig {
  let fileConfig: ConfigFile = {};

  for (const name of CONFIG_FILENAMES) {
    const configPath = path.join(rootDir, name);
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = parseYamlConfig(content);
      if (parsed && typeof parsed === 'object') {
        fileConfig = parsed as ConfigFile;
      } else {
        console.error(`Warning: ${name} exists but could not be parsed — using defaults`);
      }
      break;
    }
  }

  return {
    rootDir,
    suggest: cliConfig.suggest ?? false,
    fix: cliConfig.fix ?? false,
    dryRun: cliConfig.dryRun ?? false,
    format: cliConfig.format ?? 'terminal',
    severityFilter: cliConfig.severityFilter ?? fileConfig.severity,
    failOn: cliConfig.failOn ?? fileConfig.failOn,
    categories: cliConfig.categories ?? fileConfig.categories,
    ignorePatterns: [
      ...(fileConfig.ignore ?? []),
      ...(cliConfig.ignorePatterns ?? []),
    ],
    respectGitignore: cliConfig.respectGitignore ?? true,
    maxFileSize: cliConfig.maxFileSize ?? fileConfig.maxFileSize ?? 1_048_576,
    verbose: cliConfig.verbose ?? false,
  };
}

const INIT_CONFIG = `# parallel-dev-audit configuration
# See: https://github.com/mabthew/parallel-dev-audit

# Minimum severity to report: critical, high, medium, low, info
# severity: medium

# Only check specific categories (uncomment to filter):
# categories:
#   - hardcoded-port
#   - absolute-path
#   - docker-conflict
#   - database-string
#   - build-directory
#   - shared-cache
#   - pid-socket
#   - temp-directory
#   - log-file-path

# Additional file/directory patterns to ignore:
ignore:
  - "*.generated.*"
  - "*.min.js"
  - "*.bundle.js"
  - "coverage/"
  - ".storybook/"

# Max file size to scan (bytes, default 1MB):
# maxFileSize: 1048576
`;

/** Create a starter config file. */
export function initConfig(rootDir: string): string {
  const configPath = path.join(rootDir, '.parallel-dev-audit.yml');
  if (fs.existsSync(configPath)) {
    return `Config already exists: ${configPath}`;
  }
  fs.writeFileSync(configPath, INIT_CONFIG, 'utf-8');
  return `Created ${configPath}`;
}
