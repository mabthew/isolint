# parallel-dev-audit

Scan repos for hardcoded values that break parallel development workflows — git worktrees, CI matrix builds, and autonomous AI agent development.

## Why

Parallel development (git worktrees, multiple branches running simultaneously, AI agents coding in parallel) breaks when repos have hardcoded ports, absolute paths, Docker container names, and database URLs. **parallel-dev-audit** finds these issues before they bite.

## Security & Privacy

- **Runs 100% locally** — no network calls, no telemetry, no data collection
- **Respects `.gitignore`** — files your repo ignores are never read
- **Skips binaries and secrets** — `.env` files are excluded from all detection rules (they're environment variables by definition). Binary files, media, archives, and lock files are skipped entirely
- **Path traversal protection** — the scanner verifies all file paths resolve within the target directory
- **Read-only by default** — only `--fix` modifies files, and it creates backups first

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
Scanned 5 files in 26ms
Ecosystems: node

config.ts
  CRIT 3:12  Hardcoded user home directory path: /Users/mabthew/projects/myapp/data/db.sqlite
       dbPath: '/Users/mabthew/projects/myapp/data/db.sqlite',
  HIGH 2:3   Port assignment with hardcoded value: port 8080
       port: 8080,

docker-compose.yml
  CRIT 7:1   Fixed Docker port mapping 3000:3000 — host port will conflict
       - "3000:3000"
  HIGH 4:1   Fixed container_name "myapp-web" — will conflict across worktrees
       container_name: myapp-web

server.ts
  HIGH 4:4   Server .listen() with hardcoded port: port 3000
       app.listen(3000, () => {

█████████████░░░░░░░ 66/100 (D)

Summary
  hardcoded-port: 6 findings (3 critical, 3 high)
  docker-conflict: 3 findings (2 high, 1 medium)
  absolute-path: 1 findings (1 critical)
  Total: 12 findings
```

### With `--suggest`

```
config.ts
  HIGH 2:3   Port assignment with hardcoded value: port 8080
       port: 8080,
       fix (needs review): Use process.env.PORT with fallback
       → parseInt(process.env.PORT || '8080', 10)

docker-compose.yml
  CRIT 7:1   Fixed Docker port mapping 3000:3000 — host port will conflict
       - "3000:3000"
       fix (needs review): Use variable interpolation for host port
       →       - "${HOST_PORT:-3000}:3000"
  HIGH 4:1   Fixed container_name "myapp-web" — will conflict across worktrees
       container_name: myapp-web
       fix (needs review): Use COMPOSE_PROJECT_NAME or variable interpolation
       →     container_name: "${COMPOSE_PROJECT_NAME:-myapp-web}-myapp-web"

server.ts
  HIGH 4:4   Server .listen() with hardcoded port: port 3000
       app.listen(3000, () => {
       fix (needs review): Use process.env.PORT with fallback
       → parseInt(process.env.PORT || '3000', 10)
```

## What It Detects

| Category | Severity | Example |
|---|---|---|
| **Hardcoded ports** | critical/high | `app.listen(3000)`, Docker port mappings |
| **Absolute paths** | critical | `/Users/mabthew/projects/...`, `/home/deploy/...` |
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

Exit codes: `0` = no findings above threshold, `1` = findings found, `2` = configuration error.

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

## CI Integration

```yaml
# GitHub Actions
- name: Parallel Dev Audit
  run: npx parallel-dev-audit . --format json --fail-on high
```

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
