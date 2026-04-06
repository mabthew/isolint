---
name: parallel-ready
description: Audit the current repo for hardcoded values (ports, paths, DB strings, Docker names) that break parallel development workflows. Use when setting up worktrees, before enabling parallel dev, or when checking if a repo is ready for parallel development.
argument-hint: [path]
allowed-tools: Bash Read Edit Write Glob Grep
---

# Parallel Development Readiness Audit

Scan this repository for hardcoded values that break parallel workflows (git worktrees, CI matrix builds, autonomous AI agents).

## Step 1: Run the audit

Run parallel-dev-audit on the target path. Use the project's own built CLI if available, otherwise use npx.

```!
if [ -f "dist/bin/parallel-dev-audit.js" ]; then
  node dist/bin/parallel-dev-audit.js ${0:-.} --suggest --format json 2>/dev/null
elif command -v parallel-dev-audit &>/dev/null; then
  parallel-dev-audit ${0:-.} --suggest --format json 2>/dev/null
else
  npx -y parallel-dev-audit ${0:-.} --suggest --format json 2>/dev/null
fi
```

## Step 2: Present findings

Parse the JSON output above and present a clear summary to the user:

1. **Score and grade** — Show the Parallel Dev Readiness Score (0-100) with letter grade. Frame it positively: "Your repo scores X/100 for parallel development readiness."

2. **Critical and high findings** — List these first, grouped by file. For each finding, show:
   - File path and line number
   - What was found and why it's a problem
   - The suggested fix (if available)

3. **Medium and below** — Summarize counts by category. Don't list every finding unless the user asks.

4. **Ecosystem context** — Mention which ecosystems were detected and any ecosystem-specific advice.

## Step 3: Offer to fix

If there are findings with suggested fixes, ask the user:

> I found **N** issues, **M** of which have suggested fixes. Would you like me to:
> 1. **Apply auto-fixable changes** — I'll make the safe changes directly (confidence: auto)
> 2. **Walk through each fix** — I'll show each change and let you approve/skip/modify
> 3. **Just the critical ones** — Only fix critical and high severity issues
> 4. **Export a report** — Generate a markdown report for your team

If the user chooses option 2 (walk through), for each fixable finding:
- Show the current line and the proposed replacement
- Read the surrounding code (5 lines of context) so the user can judge
- Apply using the Edit tool if approved, skip if not
- Keep a running tally of applied/skipped fixes

## Step 4: Follow-up advice

After fixes are applied (or if the user declines), provide actionable next steps:

- If score >= 90: "This repo is ready for parallel development. Consider adding `parallel-dev-audit --fail-on high` to your CI pipeline to keep it that way."
- If score 70-89: "A few issues to clean up. The main blockers are [top category]. Focus on those first."
- If score < 70: "This repo needs work before parallel development is safe. Start with the critical findings — those will cause immediate conflicts."

If the repo uses Docker Compose, suggest `COMPOSE_PROJECT_NAME` convention.
If hardcoded ports are the main issue, mention Portless (Vercel Labs) as an alternative to manual parameterization.
If the user is using worktrees specifically, mention Worktrunk or workz for runtime isolation after fixing the audit findings.
