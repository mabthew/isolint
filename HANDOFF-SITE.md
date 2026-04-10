# isolint.dev Site Handoff

## What this is

Handoff doc for building the isolint.dev documentation site. The CLI links to these URLs via `--suggest` mode (always shown, not just verbose) — they just need pages behind them.

## Doc URLs to create

Every suggested fix in the CLI has a `docUrl` field pointing to `https://isolint.dev/docs/rules/<rule-id>`. These are the 10 pages needed:

| Rule ID             | URL path                        | What it detects                                                    |
| ------------------- | ------------------------------- | ------------------------------------------------------------------ |
| `hardcoded-ports`   | `/docs/rules/hardcoded-ports`   | Fixed port numbers in .listen(), .env, Docker, localhost URLs      |
| `absolute-paths`    | `/docs/rules/absolute-paths`    | `/Users/you/...`, `/home/deploy/...`, Windows drive paths          |
| `docker-conflicts`  | `/docs/rules/docker-conflicts`  | Fixed `container_name`, network names in Docker Compose            |
| `database-strings`  | `/docs/rules/database-strings`  | Hardcoded `postgresql://`, `mongodb://` connection strings         |
| `env-propagation`   | `/docs/rules/env-propagation`   | `.env` is gitignored and won't propagate to new worktrees          |
| `pid-and-sockets`   | `/docs/rules/pid-and-sockets`   | Hardcoded `.pid` and `.sock` file paths                            |
| `log-file-paths`    | `/docs/rules/log-file-paths`    | Hardcoded log file paths that parallel processes overwrite         |
| `shared-caches`     | `/docs/rules/shared-caches`     | Shared cache directories that corrupt across worktrees             |
| `build-directories` | `/docs/rules/build-directories` | Hardcoded build output dirs, Rust target/ without CARGO_TARGET_DIR |
| `temp-directories`  | `/docs/rules/temp-directories`  | Fixed temp dir names that collide across worktrees                 |

## What each rule page should cover

1. **What it detects** — patterns, file types, example code that triggers it
2. **Why it matters** — what breaks when two worktrees hit this (port conflicts, data corruption, stale builds, etc.)
3. **How to fix it** — ecosystem-specific examples (Node, Python, Go, Rust, Docker, etc.)
4. **Severity levels** — when it's critical vs high vs medium
5. **Configuration** — how to ignore or adjust via `.isolint.yml`

## Ecosystem-specific fix examples to include

The CLI generates these fix patterns per ecosystem. Each rule page should show the relevant ones:

### Hardcoded ports

- **Node:** `parseInt(process.env.PORT || '3000', 10)`
- **Python:** `int(os.environ.get('PORT', 8000))`
- **Go:** `os.Getenv("PORT")`
- **Ruby:** `ENV.fetch("PORT", 3000)`
- **Rust:** `std::env::var("PORT").unwrap_or("8080".into())`
- **Docker Compose:** `"${HOST_PORT:-3000}:3000"` with `.env` per worktree
- **Dockerfile:** `ARG PORT=3000` + `EXPOSE $PORT` + `docker build --build-arg PORT=3001`

### Database strings

- **Node:** `process.env.DATABASE_URL || 'postgresql://...'`
- **Python:** `os.environ.get('DATABASE_URL', '...')`
- **Go:** `os.Getenv("DATABASE_URL")`

### Absolute paths

- **Node:** `path.resolve(__dirname, './relative/path')`
- **Python:** `Path('./relative/path')`
- **Go:** `filepath.Join(".", "relative/path")`

## Site structure suggestion

```
isolint.dev/
  /                     — landing page (what isolint does, install, quick demo)
  /docs                 — docs index
  /docs/getting-started — install, first scan, config
  /docs/rules           — rules index (table of all rules)
  /docs/rules/<id>      — individual rule pages (10 pages above)
  /docs/ci              — CI integration guide
  /docs/worktrees       — git worktree workflow guide
```

## Source of truth

All rule definitions live in `src/rules/*.ts`. Each rule has:

- `id`, `name`, `category`, `description`, `defaultSeverity`
- Detection patterns with `PatternDef[]`
- `SuggestedFix` objects with `description`, `replacement`, `confidence`, `howToApply?`, `docUrl?`

Ecosystem-specific patterns and fix templates live in `src/lang/*.ts` (node, python, go, rust, java, ruby, php, elixir, swift, zig, cpp, dotnet).

## Recent CLI changes to reflect on the site

### Fix confidence labels
The CLI uses three confidence levels for suggested fixes:
- **auto-fixable** (green) — `--fix` applies these automatically
- **suggested fix** (yellow) — `--fix` can apply, but user should verify. Shown as: `suggested fix — --fix can apply this`
- **manual steps** (red) — no code replacement, user follows guidance. Shown as: `manual steps — no auto-fix, follow guidance below`

### Doc links always shown
Every fix box includes a `Learn more: https://isolint.dev/docs/rules/<rule-id>` link. These are always visible (not gated behind `--verbose`).

### Doc/template files skipped by default
The CLI now skips `.env.example`, `.env.template`, `.env.sample`, and documentation files (`.md`, `.mdx`, `.txt`, `.rst`, `.adoc`) by default. Users can opt in with:
- `--include-docs` — include all doc/template files (findings downgraded to info)
- `--include-docs .md,.txt` — include only specific extensions

This should be documented on the getting-started and CLI reference pages.

### Monorepo ecosystem detection
Ecosystem detection now checks one level of subdirectories (e.g., `server/package.json`), not just the repo root. This correctly detects monorepo setups.

### Fix descriptions explain WHY
All suggested fixes now explain the problem, not just the solution. e.g., "Use a build ARG to make the port overridable per worktree: docker build --build-arg PORT=3002" instead of just "Use ARG for port".

## README content to reuse

The main `README.md` already has:

- Detection categories table
- Supported ecosystems list
- CLI options reference
- Programmatic API example
- CI integration YAML snippet

These can be expanded into dedicated pages on the site. Note: the README CLI options section needs updating to include `--include-docs`.

## Brand / style

- Package name: `isolint`
- Tagline: "Static analysis for parallel development"
- Logo: `░▒▓█  i s o l i n t  █▓▒░` (terminal gradient style, rendered in amber #f59e0b)
- Pairs with: [Worktrunk](https://github.com/max-sixty/worktrunk) for worktree management
- Similar styling to https://worktrunk.dev, look at the site for details but minimalist, functional examples, gif terminal demos

## Terminal color mapping

Exact colors used in the CLI output. Use these for any terminal screenshots or demos on the site.

| Element | Terminal color | Hex equivalent |
|---------|---------------|----------------|
| Logo (`░▒▓█ isolint █▓▒░`) | ANSI true color | `#f59e0b` (amber) |
| Score bar (90+) | `pc.green` | `#22c55e` |
| Score bar (70-89) | `pc.yellow` | `#eab308` |
| Score bar (50-69) | `pc.cyan` | `#06b6d4` |
| Score bar (<50) | `pc.red` | `#ef4444` |
| CRITICAL badge | `pc.bgRed` + white text | bg `#ef4444`, text `#ffffff` |
| HIGH badge | `pc.bgYellow` + black text | bg `#eab308`, text `#000000` |
| MEDIUM badge | `pc.bgCyan` + black text | bg `#8fb8b0` (muted teal), text `#000000` |
| LOW badge | `pc.dim` + inverse | dim white inverse |
| INFO badge | `pc.bgWhite` + black text | bg `#e8e6e3`, text `#000000` |
| File paths | `pc.white` + bold + underline | `#e8e6e3` |
| File sidebar `▎` | `pc.cyan` | `#06b6d4` |
| Section dividers `━━━` | `pc.dim` | `#a8a29e` |
| Fix `[FIX]` label | `pc.dim` brackets + `pc.bold` text | `#a8a29e` / `#e8e6e3` |
| Fix — suggested fix | `pc.yellow` bold | `#eab308` |
| Fix — manual steps | `pc.red` bold | `#ef4444` |
| Fix — auto-fixable | `pc.green` bold | `#22c55e` |
| Fix replacement `→` | `pc.green` | `#22c55e` |
| Doc links | `pc.dim` | `#a8a29e` |
| Context lines | `pc.dim` | `#a8a29e` |

Site palette:
- `#0a0a0a` — background
- `#141414` — card/surface
- `#1a1a1a` — elevated surface
- `#262626` — border
- `#f59e0b` — primary/brand (amber)
- `#fbbf24` — primary hover
- `#e8e6e3` — text primary
- `#a8a29e` — text secondary/muted
- `#22c55e` — success/good
- `#ef4444` — error/critical
- `#eab308` — warning/high
- `#8fb8b0` — info/medium (muted teal)
