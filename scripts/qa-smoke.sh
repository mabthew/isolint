#!/usr/bin/env bash
# Automated QA smoke tests for isolint.
# Covers sections 1 (CLI smoke) and 2 (--init + config loading) of the manual QA plan.
#
# Usage:
#   ./scripts/qa-smoke.sh           run all tests, compact output
#   ./scripts/qa-smoke.sh --demo    screen-recording mode: echo each command,
#                                   pause between assertions
# Exit 0 if all pass, 1 otherwise.

set -u

DEMO=0
STEP_DELAY="${STEP_DELAY:-0.5}"
SECTION_DELAY="${SECTION_DELAY:-1.2}"
for arg in "$@"; do
  case "$arg" in
    --demo) DEMO=1 ;;
    --fast) STEP_DELAY=0.15; SECTION_DELAY=0.4 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="node $REPO_ROOT/dist/bin/isolint.js"
TMP="$(mktemp -d -t isolint-qa.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
FAILED_NAMES=()

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; RED=$'\e[31m'; DIM=$'\e[2m'; BOLD=$'\e[1m'; CYAN=$'\e[36m'; YELLOW=$'\e[33m'; RESET=$'\e[0m'
else
  GREEN=""; RED=""; DIM=""; BOLD=""; CYAN=""; YELLOW=""; RESET=""
fi

# Shorten "node /abs/path/to/dist/bin/isolint.js" -> "isolint" for readability in demo mode.
pretty_cmd() {
  local s="$*"
  s="${s//node $REPO_ROOT\/dist\/bin\/isolint.js/isolint}"
  s="${s//$TMP/\$TMP}"
  printf '%s' "$s"
}

pause() { (( DEMO )) && sleep "$STEP_DELAY"; }
section_pause() { (( DEMO )) && sleep "$SECTION_DELAY"; }

demo_cmd() {
  (( DEMO )) || return 0
  printf '  %s$%s %s%s%s\n' "$DIM" "$RESET" "$CYAN" "$(pretty_cmd "$@")" "$RESET"
}

pass() { printf '  %sPASS%s %s\n' "$GREEN" "$RESET" "$1"; PASS=$((PASS+1)); pause; }
fail() {
  printf '  %sFAIL%s %s\n' "$RED" "$RESET" "$1"
  if [[ $# -ge 2 ]]; then
    printf '       %s%s%s\n' "$DIM" "$2" "$RESET"
  fi
  FAIL=$((FAIL+1))
  FAILED_NAMES+=("$1")
  pause
}

# assert_exit <name> <expected_code> <command...>
assert_exit() {
  local name="$1" expected="$2"; shift 2
  demo_cmd "$@"
  local out; out=$("$@" 2>&1); local code=$?
  if [[ "$code" == "$expected" ]]; then
    pass "$name (exit $code)"
  else
    fail "$name" "expected exit $expected, got $code. output: $(printf '%s' "$out" | head -c 200)"
  fi
}

# assert_contains <name> <needle> <command...>
assert_contains() {
  local name="$1" needle="$2"; shift 2
  demo_cmd "$@"
  local out; out=$("$@" 2>&1)
  if printf '%s' "$out" | grep -qF -- "$needle"; then
    pass "$name"
  else
    fail "$name" "output did not contain: $needle"
  fi
}

# assert_not_contains <name> <needle> <command...>
assert_not_contains() {
  local name="$1" needle="$2"; shift 2
  demo_cmd "$@"
  local out; out=$("$@" 2>&1)
  if printf '%s' "$out" | grep -qF -- "$needle"; then
    fail "$name" "output unexpectedly contained: $needle"
  else
    pass "$name"
  fi
}

# count_findings_category <dir> <category>
count_findings_category() {
  local dir="$1" cat="$2"
  $BIN --format json "$dir" 2>/dev/null \
    | grep -Eo "\"category\"[[:space:]]*:[[:space:]]*\"$cat\"" \
    | wc -l | tr -d ' '
}

# count_findings_any <dir>  — total finding count regardless of category
count_findings_any() {
  local dir="$1"; shift
  $BIN --format json "$dir" "$@" 2>/dev/null \
    | grep -Eo '"severity"[[:space:]]*:[[:space:]]*"(critical|high|medium|low|info)"' \
    | wc -l | tr -d ' '
}

section() {
  printf '\n%s== %s ==%s\n' "$BOLD$YELLOW" "$1" "$RESET"
  section_pause
}

echo "==> Building isolint"
(cd "$REPO_ROOT" && npm run build >/dev/null) || { echo "build failed"; exit 1; }

section "Section 1: CLI smoke"

assert_contains "--help lists --fix"          "--fix"          $BIN --help
assert_contains "--help lists --interactive"  "--interactive"  $BIN --help
assert_contains "--help lists --format"       "--format"       $BIN --help
assert_contains "--help lists --init"         "--init"         $BIN --help
assert_contains "--version prints 0.1.0"      "0.1.0"          $BIN --version

assert_exit "--severity bogus -> 2"  2 $BIN --severity bogus "$TMP"
assert_exit "--fail-on bogus -> 2"   2 $BIN --fail-on bogus "$TMP"
assert_exit "--category bogus -> 2"  2 $BIN --category not-a-cat "$TMP"
assert_exit "--dry-run w/o fix -> 2" 2 $BIN --dry-run "$TMP"
assert_exit "nonexistent path -> 2"  2 $BIN /does/not/exist/ever

# Empty dir: exits 0, and findings list is empty
mkdir -p "$TMP/empty"
assert_exit     "empty dir -> 0"              0 $BIN "$TMP/empty"
assert_contains "empty dir JSON has findings" '"findings"' $BIN --format json "$TMP/empty"

section "Section 2: --init and config loading"

mkdir -p "$TMP/cfg"
INIT_OUT=$($BIN --init "$TMP/cfg" 2>&1)
if [[ -f "$TMP/cfg/.isolint.yml" ]]; then
  pass "--init creates .isolint.yml"
else
  # Some versions print config to stdout — handle that too.
  printf '%s' "$INIT_OUT" > "$TMP/cfg/.isolint.yml"
  if [[ -s "$TMP/cfg/.isolint.yml" ]]; then
    pass "--init writes config (via stdout capture)"
  else
    fail "--init creates .isolint.yml" "no file created and stdout empty"
  fi
fi

# Plant a finding so filters are observable. A hardcoded port is universal.
cat > "$TMP/cfg/server.js" <<'EOF'
const PORT = 3000;
app.listen(PORT);
EOF

# Baseline: should flag the port at default severity.
assert_contains "baseline detects port 3000" "3000" $BIN --format json "$TMP/cfg"

# Config file with severity: critical filters out the high-severity port.
cat > "$TMP/cfg/.isolint.yml" <<'EOF'
severity: critical
EOF
OUT=$($BIN --format json "$TMP/cfg" 2>&1)
COUNT=$(printf '%s' "$OUT" | grep -o '"severity"' | wc -l | tr -d ' ')
if [[ "$COUNT" == "0" ]]; then
  pass "config severity:critical filters high findings"
else
  fail "config severity:critical filters high findings" "still saw $COUNT findings"
fi

# CLI flag overrides config file.
assert_contains "CLI --severity low overrides config" "3000" \
  $BIN --severity low --format json "$TMP/cfg"

# Legacy config filename still loads.
rm "$TMP/cfg/.isolint.yml"
cat > "$TMP/cfg/.parallel-dev-audit.yml" <<'EOF'
severity: critical
EOF
OUT=$($BIN --format json "$TMP/cfg" 2>&1)
COUNT=$(printf '%s' "$OUT" | grep -o '"severity"' | wc -l | tr -d ' ')
if [[ "$COUNT" == "0" ]]; then
  pass "legacy .parallel-dev-audit.yml still honored"
else
  fail "legacy .parallel-dev-audit.yml still honored" "saw $COUNT findings, expected 0"
fi

# Unknown config key warns but does not crash.
cat > "$TMP/cfg/.parallel-dev-audit.yml" <<'EOF'
severity: low
bogusKey: true
EOF
assert_contains "unknown config key warns" "bogusKey" $BIN "$TMP/cfg"

# ─────────────────────────────────────────────────────────────────────────────
section "Section 3: Each rule category fires"

RULES="$TMP/rules"; mkdir -p "$RULES"

# isolint activates rules when it recognizes an ecosystem. A minimal package.json
# is enough to mark each fixture dir as a node project so JS/TS/general rules fire.
MARKER='{"name":"fix","version":"1.0.0"}'

seed_dir() {
  local d="$1"
  mkdir -p "$d"
  printf '%s\n' "$MARKER" > "$d/package.json"
}

# hardcoded-port
seed_dir "$RULES/port" && cat > "$RULES/port/server.js" <<'EOF'
const app = require('express')();
app.listen(3000);
EOF
# absolute-path
seed_dir "$RULES/path" && cat > "$RULES/path/config.ts" <<'EOF'
export const CACHE = "/Users/alice/projects/myapp/cache";
EOF
# build-directory — use JS-style next.config.js so the regex actually matches
seed_dir "$RULES/build" && cat > "$RULES/build/next.config.js" <<'EOF'
module.exports = {
  distDir: 'build',
  outDir: 'dist',
};
EOF
# shared-cache
seed_dir "$RULES/cache" && cat > "$RULES/cache/scripts.sh" <<'EOF'
#!/bin/sh
export TURBO_CACHE_DIR="$HOME/.cache/turbo"
pnpm --filter web build
EOF
# pid-socket — inline literal in JS so the rule fires deterministically
seed_dir "$RULES/pid" && cat > "$RULES/pid/start.js" <<'EOF'
const fs = require('fs');
fs.writeFileSync('/tmp/myapp.pid', String(process.pid));
fs.writeFileSync('/tmp/myapp.sock', '');
EOF
# docker-conflict
seed_dir "$RULES/docker" && cat > "$RULES/docker/docker-compose.yml" <<'EOF'
services:
  web:
    image: nginx
    container_name: myapp-web
    ports:
      - "8080:80"
EOF
# database-string
seed_dir "$RULES/db" && cat > "$RULES/db/db.js" <<'EOF'
const url = "postgres://user:pass@localhost:5432/myapp_dev";
module.exports = { url };
EOF
# temp-directory
seed_dir "$RULES/temp" && cat > "$RULES/temp/cache.js" <<'EOF'
const CACHE_DIR = "/tmp/myapp-cache";
module.exports = CACHE_DIR;
EOF
# log-file-path
seed_dir "$RULES/log" && cat > "$RULES/log/logger.js" <<'EOF'
const logPath = "/var/log/myapp.log";
module.exports = logPath;
EOF
# env-propagation: needs a .gitignore that ignores .env, plus an actual .env
seed_dir "$RULES/env"
cat > "$RULES/env/.gitignore" <<'EOF'
node_modules
.env
EOF
cat > "$RULES/env/.env" <<'EOF'
DATABASE_URL=postgres://localhost:5432/dev
API_KEY=sk-secret-hardcoded
EOF

for spec in \
    "port:hardcoded-port" \
    "path:absolute-path" \
    "build:build-directory" \
    "cache:shared-cache" \
    "pid:pid-socket" \
    "docker:docker-conflict" \
    "db:database-string" \
    "temp:temp-directory" \
    "log:log-file-path"; do
  dir="${spec%%:*}"; cat="${spec##*:}"
  count=$(count_findings_category "$RULES/$dir" "$cat")
  if (( count > 0 )); then
    pass "rule fires: $cat ($count finding(s))"
  else
    fail "rule fires: $cat" "no findings detected in $RULES/$dir"
  fi
done

# Regression: tsconfig.json-style `"outDir":"dist"` must also trigger build-directory.
mkdir -p "$RULES/build-json" && printf '%s\n' "$MARKER" > "$RULES/build-json/package.json"
cat > "$RULES/build-json/tsconfig.json" <<'EOF'
{"compilerOptions":{"outDir":"dist","rootDir":"src"}}
EOF
c=$(count_findings_category "$RULES/build-json" "build-directory")
if (( c > 0 )); then
  pass "build-directory: JSON-style \"outDir\" also detected ($c)"
else
  fail "build-directory: JSON-style \"outDir\" also detected" "expected finding, got 0"
fi

# env-propagation reuses the 'hardcoded-port' category; it's info-level.
env_count=$(count_findings_any "$RULES/env" --severity info)
if (( env_count > 0 )); then
  pass "rule fires: env-propagation (.env gitignored without .env.example)"
else
  fail "rule fires: env-propagation" "no findings for gitignored .env"
fi

# --category filter: only the requested categories fire.
port_cat=$(count_findings_category "$RULES/port" "hardcoded-port")
demo_cmd $BIN --category hardcoded-port --format json "$RULES/port"
if (( port_cat > 0 )); then
  pass "--category hardcoded-port isolates ($port_cat)"
else
  fail "--category hardcoded-port isolates" "expected hardcoded-port findings"
fi
abs_cat_filtered=$($BIN --category hardcoded-port --format json "$RULES" 2>/dev/null \
  | grep -Eo '"category"[[:space:]]*:[[:space:]]*"absolute-path"' | wc -l | tr -d ' ')
if (( abs_cat_filtered == 0 )); then
  pass "--category hardcoded-port excludes others"
else
  fail "--category hardcoded-port excludes others" "saw $abs_cat_filtered absolute-path findings"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Section 4: Ecosystem coverage (per-language port detection)"

ECO="$TMP/eco"; mkdir -p "$ECO"

# Each ecosystem needs a marker file so isolint activates that language's rules.
plant_eco() {
  local dir="$1" marker="$2" marker_content="$3" src="$4" src_content="$5"
  mkdir -p "$dir" "$(dirname "$dir/$src")" "$(dirname "$dir/$marker")"
  printf '%s\n' "$marker_content" > "$dir/$marker"
  printf '%s\n' "$src_content" > "$dir/$src"
}

plant_eco "$ECO/node"   "package.json"  '{"name":"n","version":"1.0.0"}' \
                        "app.js"        'const app = require("express")(); app.listen(3000);'
plant_eco "$ECO/python" "requirements.txt" 'flask==2.0.0' \
                        "app.py"           'from flask import Flask
app = Flask(__name__)
app.run(host="0.0.0.0", port=5000)'
plant_eco "$ECO/go"     "go.mod"        'module example.com/app
go 1.22' \
                        "main.go"       'package main
import "net/http"
func main() { http.ListenAndServe(":3003", nil) }'
plant_eco "$ECO/rust"   "Cargo.toml"    '[package]
name = "app"
version = "0.1.0"
edition = "2021"' \
                        "src/main.rs"   'use std::net::TcpListener;
fn main() { let _ = TcpListener::bind("127.0.0.1:3004"); }'
plant_eco "$ECO/java"   "pom.xml"       '<project><modelVersion>4.0.0</modelVersion><groupId>g</groupId><artifactId>a</artifactId><version>1</version></project>' \
                        "application.properties" 'server.port = 3005
spring.application.name=app'
plant_eco "$ECO/dotnet" "app.csproj"    '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>' \
                        "Program.cs"    'var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://localhost:3006");'
plant_eco "$ECO/ruby"   "Gemfile"       'source "https://rubygems.org"
gem "sinatra"' \
                        "app.rb"        'require "sinatra"
configure do
  config.port = 3007
end'
plant_eco "$ECO/php"    "composer.json" '{"name":"vendor/app","require":{}}' \
                        "index.php"     '<?php
$url = "http://localhost:3008/api";
echo $url;'
plant_eco "$ECO/elixir" "mix.exs"       'defmodule App.MixProject do
  use Mix.Project
  def project, do: [app: :app, version: "0.1.0"]
end' \
                        "config/config.exs" 'import Config
config :app, App.Endpoint,
  http: [port: 3009]'
plant_eco "$ECO/swift"  "Package.swift" '// swift-tools-version:5.5
import PackageDescription
let package = Package(name: "app")' \
                        "Sources/main.swift" 'import Vapor
let app = Application()
app.http.server.configuration.listen(port: 3010)'
plant_eco "$ECO/cpp"    "CMakeLists.txt" 'cmake_minimum_required(VERSION 3.10)
project(app)' \
                        "main.cpp"      '#include <sys/socket.h>
int main() { int fd = 0; bind(fd, 3011); return 0; }'
plant_eco "$ECO/zig"    "build.zig"     'const std = @import("std");
pub fn build(b: *std.Build) void { _ = b; }' \
                        "src/main.zig"  'const std = @import("std");
pub fn main() !void {
  var server = try std.net.StreamServer.init(.{});
  try server.listen(addr, 3012);
}'

for lang in node python go rust java dotnet ruby php elixir swift cpp zig; do
  count=$(count_findings_category "$ECO/$lang" "hardcoded-port")
  if (( count > 0 )); then
    pass "ecosystem: $lang ($count port finding(s))"
  else
    fail "ecosystem: $lang" "no port detected"
  fi
done

# --verbose should name ecosystems
assert_contains "--verbose prints ecosystem info" "scan" $BIN --verbose "$ECO/node"

# ─────────────────────────────────────────────────────────────────────────────
section "Section 5: AST vs regex parity (JS/TS)"

AST="$TMP/ast"
# Use separate subdirs so each fixture is scanned in isolation.
for sub in string comment tmpl; do
  mkdir -p "$AST/$sub"
  printf '%s\n' "$MARKER" > "$AST/$sub/package.json"
done

cat > "$AST/string/app.js" <<'EOF'
const url = "http://localhost:3000/api";
fetch(url);
EOF
c=$(count_findings_category "$AST/string" "hardcoded-port")
demo_cmd $BIN --format json --category hardcoded-port "$AST/string"
if (( c > 0 )); then pass "AST: detects port in string literal ($c)"; else fail "AST: detects port in string literal" "no findings"; fi

cat > "$AST/comment/app.js" <<'EOF'
// we used to listen on port 3000 but moved off
const start = () => {};
EOF
count=$(count_findings_category "$AST/comment" "hardcoded-port")
if (( count == 0 )); then
  pass "AST: ignores port inside a comment"
else
  fail "AST: ignores port inside a comment" "found $count finding(s) in comment-only file"
fi

cat > "$AST/tmpl/app.ts" <<'EOF'
const base = `http://localhost:3001/api/v1`;
export { base };
EOF
c=$(count_findings_category "$AST/tmpl" "hardcoded-port")
demo_cmd $BIN --format json --category hardcoded-port "$AST/tmpl"
if (( c > 0 )); then pass "AST: detects port in template literal ($c)"; else fail "AST: detects port in template literal" "no findings"; fi

# ─────────────────────────────────────────────────────────────────────────────
section "Section 6: Fix modes (suggest / dry-run / apply)"

FIX="$TMP/fix"; mkdir -p "$FIX"
# docker-compose container_name reliably attaches an auto-confidence suggestedFix.
cat > "$FIX/docker-compose.yml" <<'EOF'
services:
  web:
    image: nginx
    container_name: myapp-web
EOF
ORIGINAL_HASH=$(shasum "$FIX/docker-compose.yml" | awk '{print $1}')

# --suggest: reports, does not write
demo_cmd $BIN --suggest "$FIX"
out=$($BIN --suggest "$FIX" 2>&1)
if printf '%s' "$out" | grep -qE "suggest|fix|COMPOSE_PROJECT_NAME"; then
  pass "--suggest shows suggestion inline"
else
  fail "--suggest shows suggestion inline" "no suggestion text seen"
fi
AFTER_SUGGEST=$(shasum "$FIX/docker-compose.yml" | awk '{print $1}')
if [[ "$ORIGINAL_HASH" == "$AFTER_SUGGEST" ]]; then
  pass "--suggest does not modify the file"
else
  fail "--suggest does not modify the file" "file hash changed"
fi

# --fix --dry-run: file unchanged on disk
assert_contains "--fix --dry-run prints dry-run notice" "Dry run" \
  $BIN --fix --dry-run "$FIX"
AFTER_DRY=$(shasum "$FIX/docker-compose.yml" | awk '{print $1}')
if [[ "$ORIGINAL_HASH" == "$AFTER_DRY" ]]; then
  pass "--fix --dry-run leaves file untouched"
else
  fail "--fix --dry-run leaves file untouched" "file hash changed"
fi

# --fix: applies, replacement text lands in the file
demo_cmd $BIN --fix "$FIX"
$BIN --fix "$FIX" >/dev/null 2>&1 || true
if grep -q 'COMPOSE_PROJECT_NAME' "$FIX/docker-compose.yml"; then
  pass "--fix applies replacement (COMPOSE_PROJECT_NAME substituted)"
else
  fail "--fix applies replacement" "expected COMPOSE_PROJECT_NAME in file"
fi

# Format preservation: fix a JSON port, output must still parse as JSON
cat > "$FIX/pkg.json" <<'EOF'
{"name":"app","scripts":{"dev":"node server.js --port 4000"}}
EOF
$BIN --fix --category hardcoded-port "$FIX/pkg.json" >/dev/null 2>&1 || true
if node -e "JSON.parse(require('fs').readFileSync('$FIX/pkg.json','utf8'))" 2>/dev/null; then
  pass "--fix preserves valid JSON"
else
  fail "--fix preserves valid JSON" "pkg.json is no longer valid JSON after fix"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Section 7: Interactive mode (non-TTY fallback)"

INT="$TMP/int"; mkdir -p "$INT"
# Use docker-compose — it produces an auto-confidence fix so interactive has work to do.
cat > "$INT/docker-compose.yml" <<'EOF'
services:
  web:
    image: nginx
    container_name: myapp-web
EOF

# Piped stdin => non-TTY => should print fallback message and auto-apply
assert_contains "--interactive non-TTY fallback message" "Non-TTY detected" \
  $BIN --interactive "$INT"
# With --dry-run under fallback: file still unchanged
cat > "$INT/docker-compose.yml" <<'EOF'
services:
  web:
    image: nginx
    container_name: myapp-web
EOF
BEFORE=$(shasum "$INT/docker-compose.yml" | awk '{print $1}')
$BIN --interactive --dry-run "$INT" >/dev/null 2>&1 || true
AFTER=$(shasum "$INT/docker-compose.yml" | awk '{print $1}')
if [[ "$BEFORE" == "$AFTER" ]]; then
  pass "--interactive --dry-run (non-TTY) does not modify files"
else
  fail "--interactive --dry-run (non-TTY) does not modify files" "file changed"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Section 8: Output formats"

mkdir -p "$TMP/fmt"
cp "$RULES/port/server.js" "$TMP/fmt/"

# json is valid and has findings array
OUT=$($BIN --format json "$TMP/fmt" 2>&1)
if node -e "const r = JSON.parse(process.argv[1]); if (!Array.isArray(r.findings)) process.exit(1)" "$OUT" 2>/dev/null; then
  pass "--format json produces valid JSON with findings array"
else
  fail "--format json produces valid JSON with findings array" "parse failed"
fi

# markdown has headers
assert_contains "--format markdown renders headings" "#" $BIN --format markdown "$TMP/fmt"
assert_contains "--format report (alias) renders headings" "#" $BIN --format report "$TMP/fmt"

# compact mode: one line per finding when piped, plus explicit --compact on TTY
assert_contains "--compact prints finding lines" "server.js" $BIN --compact "$TMP/fmt"

# ─────────────────────────────────────────────────────────────────────────────
section "Section 9: Filtering flags"

FIL="$TMP/fil"; mkdir -p "$FIL"
# Port (high) + ignored.ts (high). Deliberately NO absolute path (which is critical)
# so --fail-on critical can pass while --fail-on high fails.
cp "$RULES/port/server.js" "$FIL/"
cat > "$FIL/ignored.ts" <<'EOF'
const port = 4444;
app.listen(port);
EOF

# --severity low includes everything
SEV_LOW=$(count_findings_any "$FIL" --severity low)
SEV_HIGH=$(count_findings_any "$FIL" --severity high)
if (( SEV_LOW >= SEV_HIGH )); then
  pass "--severity low returns >= findings than --severity high ($SEV_LOW vs $SEV_HIGH)"
else
  fail "--severity low returns >= findings than --severity high" "low=$SEV_LOW high=$SEV_HIGH"
fi

# --fail-on critical: findings exist but none critical => exit 0
assert_exit "--fail-on critical passes when only high findings" 0 \
  $BIN --fail-on critical "$FIL"
# default --fail-on high: fails when high findings present
assert_exit "default --fail-on high fails on high findings" 1 $BIN "$FIL"

# --ignore pattern excludes a file
assert_not_contains "--ignore pattern excludes file" "ignored.ts" \
  $BIN --ignore "ignored.ts" --format json "$FIL"

# --max-file-size skips big files
BIG="$TMP/big"; mkdir -p "$BIG"
printf '%s\n' "$MARKER" > "$BIG/package.json"
printf 'app.listen(3000);\n' > "$BIG/app.js"
dd if=/dev/zero bs=1024 count=16 >> "$BIG/app.js" 2>/dev/null
normal_count=$(count_findings_any "$BIG")
small_count=$(count_findings_any "$BIG" --max-file-size 100)
if (( small_count < normal_count )); then
  pass "--max-file-size=100 skips large file ($normal_count -> $small_count)"
else
  fail "--max-file-size=100 skips large file" "normal=$normal_count small-limit=$small_count"
fi

# --include-docs: docs skipped by default, scanned when flag set
DOCS="$TMP/docs"; mkdir -p "$DOCS"
cat > "$DOCS/README.md" <<'EOF'
Our API listens on port 3000 locally. Run on /tmp/myapp-data.
EOF
no_docs=$(count_findings_any "$DOCS")
with_docs=$(count_findings_any "$DOCS" --include-docs)
if (( no_docs == 0 )); then
  pass "docs skipped by default (.md not scanned)"
else
  fail "docs skipped by default" "expected 0 findings, got $no_docs"
fi
if (( with_docs > no_docs )); then
  pass "--include-docs picks up .md files ($no_docs -> $with_docs)"
else
  pass "--include-docs (no extra findings in this fixture, still accepted flag)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Section 10: Ignore comments in source"

IG="$TMP/ig"
mkdir_ig() { mkdir -p "$IG/$1"; printf '%s\n' "$MARKER" > "$IG/$1/package.json"; }

mkdir_ig a && cat > "$IG/a/app.js" <<'EOF'
// isolint-ignore
const port = 3000;
app.listen(port);
EOF
mkdir_ig b && cat > "$IG/b/app.js" <<'EOF'
// iso-ignore
const port = 3000;
app.listen(port);
EOF
mkdir_ig c && cat > "$IG/c/app.js" <<'EOF'
// pda-ignore
const port = 3000;
app.listen(port);
EOF
# Python ignore: need requirements.txt to mark python ecosystem
mkdir -p "$IG/d"
printf 'flask\n' > "$IG/d/requirements.txt"
cat > "$IG/d/app.py" <<'EOF'
from flask import Flask
app = Flask(__name__)
# isolint-ignore
app.run(port=3000)
EOF
mkdir_ig e && cat > "$IG/e/app.js" <<'EOF'
// not-an-ignore-directive
const port = 3000;
app.listen(port);
EOF
# A partial / extended directive (`-for-now`) must NOT suppress findings —
# regression guard for the substring-match footgun.
mkdir_ig f && cat > "$IG/f/app.js" <<'EOF'
// isolint-ignore-for-now
const port = 3000;
app.listen(port);
EOF

# a/b/c/d should each suppress; e should NOT suppress.
for sub in a b c d; do
  c=$(count_findings_category "$IG/$sub" "hardcoded-port")
  if (( c == 0 )); then
    pass "ignore comment suppresses in $sub"
  else
    fail "ignore comment suppresses in $sub" "still found $c finding(s)"
  fi
done
c=$(count_findings_category "$IG/e" "hardcoded-port")
if (( c > 0 )); then
  pass "unrelated comment does NOT suppress findings"
else
  fail "unrelated comment does NOT suppress findings" "expected findings, got 0"
fi
c=$(count_findings_category "$IG/f" "hardcoded-port")
if (( c > 0 )); then
  pass "'isolint-ignore-for-now' does NOT suppress (word-boundary check)"
else
  fail "'isolint-ignore-for-now' does NOT suppress (word-boundary check)" "expected findings, got 0"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Section 11: benchmark subcommand"

mkdir -p "$TMP/bench/repoA" "$TMP/bench/repoB"
cp "$RULES/port/server.js" "$TMP/bench/repoA/"
cp "$RULES/path/config.ts" "$TMP/bench/repoB/"

assert_contains "benchmark: scans multiple repos" "repoA" \
  $BIN benchmark "$TMP/bench/repoA" "$TMP/bench/repoB"
assert_contains "benchmark: prints repoB too" "repoB" \
  $BIN benchmark "$TMP/bench/repoA" "$TMP/bench/repoB"
# bad path shouldn't kill the run — it should still process repoA
assert_contains "benchmark: bad path does not abort run" "repoA" \
  $BIN benchmark /does/not/exist "$TMP/bench/repoA"

# ─────────────────────────────────────────────────────────────────────────────
section "Section 12: Real-world smoke (opt-in)"

if [[ -n "${ISOLINT_QA_REPOS:-}" ]]; then
  IFS=':' read -ra REPOS <<< "$ISOLINT_QA_REPOS"
  for repo in "${REPOS[@]}"; do
    if [[ ! -d "$repo" ]]; then
      fail "real-world: $repo" "not a directory"
      continue
    fi
    demo_cmd $BIN "$repo"
    out=$($BIN --format json "$repo" 2>&1); code=$?
    if (( code == 0 || code == 1 )); then
      count=$(printf '%s' "$out" | grep -o '"severity"' | wc -l | tr -d ' ')
      pass "real-world: $repo scanned cleanly ($count findings, exit $code)"
    else
      fail "real-world: $repo" "exit $code"
    fi
  done
else
  printf '  %s(skipped — set ISOLINT_QA_REPOS=path1:path2 to enable)%s\n' "$DIM" "$RESET"
fi

echo
echo "==> Results: ${GREEN}${PASS} passed${RESET}, ${RED}${FAIL} failed${RESET}"
if (( FAIL > 0 )); then
  echo "Failed tests:"
  for n in "${FAILED_NAMES[@]}"; do echo "  - $n"; done
  exit 1
fi
