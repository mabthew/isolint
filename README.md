# isolint

[![npm version](https://img.shields.io/npm/v/isolint)](https://www.npmjs.com/package/isolint)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)]()

Static analysis for parallel development. Find hardcoded ports, paths, and config that break when you run multiple worktrees, CI jobs, or AI agents side by side.

## The problem

Git worktrees, CI matrix builds, and autonomous AI agents all run your code in parallel — but most repos aren't built for it. Hardcoded port `3000`, a fixed `container_name`, an absolute path to `/Users/you/...` — any of these will collide the moment two copies run at once.

`isolint` scans your repo, finds these issues, scores your readiness, and suggests fixes:

```
isolint — /path/to/repo
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

## Install

```bash
npm install -g isolint
```

## Quick start

```bash
# Scan current directory
isolint .

# Show suggested fixes inline
isolint . --suggest

# Preview auto-fixes without writing
isolint . --fix --dry-run

# Apply auto-fixable changes
isolint . --fix

# JSON output for CI
isolint . --format json
```

## What it detects

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

## Supported ecosystems

Node/TypeScript | Python | Go | Rust | Java/Kotlin | C#/.NET | Ruby/Rails | PHP | Elixir | Swift | C/C++

Each ecosystem gets tailored detection patterns and idiomatic fix suggestions (e.g., `process.env.PORT` for Node, `os.environ.get("PORT")` for Python, `ENV.fetch("PORT")` for Ruby).

## CI integration

```yaml
# GitHub Actions
- name: Isolation Lint
  run: npx isolint . --format json --fail-on high
```

Exit codes: `0` no findings above threshold, `1` findings found, `2` configuration error.

## Configuration

```bash
isolint --init  # creates .isolint.yml
```

```yaml
severity: medium
ignore:
  - "*.generated.*"
  - "coverage/"
```

Also reads legacy `.parallel-dev-audit.yml` and `.worktree-audit.yml` config files.

## Inline ignore

```ts
// isolint-ignore-next-line
app.listen(3000);

app.listen(8080); // iso-ignore
```

Legacy aliases (`pda-ignore`, `wta-ignore`, `parallel-dev-audit-ignore`) are still supported.

## Benchmark

Compare multiple repos:

```bash
isolint benchmark ./repo-a ./repo-b ./repo-c
```

## CLI options

```
Usage: isolint [options] [path]

Options:
  -s, --suggest              Show suggested fixes inline
  --fix                      Apply auto-fixable changes
  --dry-run                  With --fix, preview without writing
  --format <type>            Output: terminal, json, markdown (default: terminal)
  --severity <level>         Minimum severity: critical, high, medium, low, info
  --fail-on <level>          Exit 1 if findings at this level+ (default: high)
  --category <cats>          Only check categories (comma-separated)
  --ignore <patterns>        Additional ignore globs (comma-separated)
  --max-file-size <bytes>    Skip files larger than this (default: 1MB)
  --init                     Create starter .isolint.yml config
  -q, --quiet                Findings only, no header/footer
  -v, --verbose              Show scan progress and detected ecosystems
  -V, --version              Show version
  -h, --help                 Show help
```

## Programmatic API

```ts
import { runAudit } from 'isolint';

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

## Pairs well with

[**Worktrunk**](https://github.com/max-sixty/worktrunk) — CLI for git worktree management. Worktrunk creates and manages worktrees; isolint makes sure your repo is ready for them.

## Security & privacy

Runs 100% locally — no network calls, no telemetry, no data collection. Respects `.gitignore`, skips binaries and secrets, read-only by default (only `--fix` modifies files, with backups).

## License

MIT
