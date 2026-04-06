# parallel-dev-audit

Scan repos for hardcoded values that break parallel development workflows — git worktrees, CI matrix builds, and autonomous AI agent development.

## Why

Parallel development (git worktrees, multiple branches running simultaneously, AI agents coding in parallel) breaks when repos have hardcoded ports, absolute paths, Docker container names, and database URLs. **parallel-dev-audit** finds these issues before they bite.

## Install

```bash
npm install -g parallel-dev-audit
```

## Quick Start

```bash
# Scan current directory
parallel-dev-audit .

# Show suggested fixes
parallel-dev-audit . --suggest

# Preview auto-fixes without writing
parallel-dev-audit . --fix --dry-run

# Apply auto-fixable changes
parallel-dev-audit . --fix

# JSON output for CI
parallel-dev-audit . --format json
```

## Sample Output

```
parallel-dev-audit — /path/to/repo
Scanned 42 files in 18ms
Ecosystems: node

Code Issues (5)

.env
  CRIT 1:1  Hardcoded port 3000 in PORT — will conflict across worktrees
  CRIT 2:1  Hardcoded postgresql connection string — database name should be per-worktree

docker-compose.yml
  HIGH 4:5  Fixed container_name "myapp-web" — will conflict across worktrees
  CRIT 7:1  Fixed Docker port mapping 3000:3000 — host port will conflict

config.ts
  CRIT 3:12 Hardcoded user home directory path: /Users/matt/projects/app

████████████████░░░░ 72/100 (C)
```

## What It Detects

| Category | Severity | Example |
|---|---|---|
| **Hardcoded ports** | critical/high | `PORT=3000`, `app.listen(3000)`, Docker port mappings |
| **Absolute paths** | critical | `/Users/matt/projects/...`, `/home/deploy/...` |
| **Docker conflicts** | high/medium | Fixed `container_name`, network names |
| **Database strings** | critical/high | `postgresql://localhost:5432/mydb` |
| **Build directories** | medium/high | Hardcoded `outDir`, Rust `target/` without `CARGO_TARGET_DIR` |
| **Shared caches** | medium | `cacheDir: "node_modules/.cache"` |
| **PID/socket files** | high | `server.pid`, `puma.sock` |
| **Temp directories** | low | `/tmp/myapp-cache` |
| **Log file paths** | low | `logFile: "/var/log/app.log"` |

## Supported Ecosystems

Node.js/TypeScript, Python, Go, Rust, Java/Kotlin, C#/.NET, Ruby/Rails

## CLI Options

```
Usage: parallel-dev-audit [options] [path]

Options:
  -s, --suggest              Show suggested fixes inline
  --fix                      Apply auto-fixable changes
  --dry-run                  With --fix, preview without writing
  --format <type>            Output: terminal, json, markdown (default: terminal)
  --severity <level>         Minimum severity to report: critical, high, medium, low, info
  --fail-on <level>          Exit 1 if findings at this level+ exist (default: high)
  --category <cats>          Only check categories (comma-separated)
  --ignore <patterns>        Additional ignore globs (comma-separated)
  --max-file-size <bytes>    Skip files larger than this (default: 1MB)
  --init                     Create starter .parallel-dev-audit.yml config
  -q, --quiet                Findings only, no header/footer
  -v, --verbose              Show scan progress and detected ecosystems
  -V, --version              Show version
  -h, --help                 Show help
```

## Configuration

Create `.parallel-dev-audit.yml` in your repo root (or run `parallel-dev-audit --init`):

```yaml
# Minimum severity to report
severity: medium

# Exit 1 threshold
failOn: high

# Only check specific categories
categories:
  - hardcoded-port
  - absolute-path
  - docker-conflict

# Files/directories to ignore
ignore:
  - "*.generated.*"
  - "*.min.js"
  - "coverage/"
```

## Inline Ignore

Suppress individual findings with comments:

```ts
// parallel-dev-audit-ignore-next-line
app.listen(3000);

app.listen(8080); // pda-ignore
```

Legacy forms `// worktree-audit-ignore-next-line` and `// wta-ignore` are also supported.

## CI Integration

```yaml
# GitHub Actions
- name: Parallel Dev Audit
  run: npx parallel-dev-audit . --format json --fail-on high
```

Exit codes: `0` = no findings above threshold, `1` = findings found, `2` = configuration error.

## Programmatic API

```ts
import { runAudit } from 'parallel-dev-audit';

const report = await runAudit({
  rootDir: '/path/to/repo',
  suggest: true,
  fix: false,
  dryRun: false,
  format: 'terminal',
  ignorePatterns: [],
  respectGitignore: true,
  maxFileSize: 1_048_576,
});

console.log(`Score: ${report.score}/100`);
console.log(`Findings: ${report.findingsCount}`);
```

## Benchmark

Compare multiple repos:

```bash
parallel-dev-audit benchmark ./repo-a ./repo-b ./repo-c
```

## License

MIT
