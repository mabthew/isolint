import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { AuditConfig, Category, Severity } from './types.js';
import { runAudit, SEVERITY_ORDER } from './engine.js';
import { formatTerminalReport } from './reporters/terminal.js';
import { formatJsonReport } from './reporters/json.js';
import { formatMarkdownReport, formatComparisonReport } from './reporters/report.js';
import { applyFixes, interactiveFix } from './fixer.js';
import { loadConfig, initConfig } from './config.js';

const VALID_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const VALID_CATEGORIES: Category[] = [
  'hardcoded-port', 'absolute-path', 'build-directory', 'shared-cache',
  'pid-socket', 'docker-conflict', 'database-string', 'temp-directory', 'log-file-path',
];

export function createCli(): Command {
  const program = new Command();

  program
    .name('isolint')
    .description('Scan repos for hardcoded values that break parallel development workflows\n\nExit codes:\n  0  No findings above --fail-on threshold\n  1  Findings at or above --fail-on threshold\n  2  Error (invalid args, scan failure)')
    .version('0.1.0')
    .argument('[path]', 'Path to repo root', '.')
    .option('-s, --suggest', 'Show suggested fixes inline with findings')
    .option('--fix', 'Apply auto-fixable changes (use --dry-run to preview)')
    .option('--interactive', 'Interactive fix mode: review each finding before applying')
    .option('--dry-run', 'With --fix, show what would change without writing')
    .option('--format <type>', 'Output format: terminal, json, markdown, report', 'terminal')
    .option('--severity <level>', 'Minimum severity to report: critical, high, medium, low, info')
    .option('--fail-on <level>', 'Exit 1 only if findings at this severity or above exist (default: high)')
    .option('--category <cats>', 'Only check specific categories (comma-separated)')
    .option('--ignore <patterns>', 'Additional ignore globs (comma-separated)')
    .option('--max-file-size <bytes>', 'Skip files larger than this (default: 1MB)')
    .option('--init', 'Create starter .isolint.yml config file')
    .option('--include-docs [exts]', 'Include doc/template files (default: skip). Optionally specify extensions: .md,.txt')
    .option('-q, --quiet', 'Findings only, no header/footer')
    .option('-v, --verbose', 'Show scan progress and detected ecosystems')
    .option('--compact', 'Force one-line-per-finding output (default when piped / non-TTY)')
    .action(async (targetPath: string, opts: Record<string, unknown>) => {
      const rootDir = path.resolve(targetPath as string);

      // Handle --init
      if (opts.init) {
        console.log(initConfig(rootDir));
        return;
      }

      if (!fs.existsSync(rootDir)) {
        console.error(`Error: path does not exist: ${rootDir}`);
        process.exit(2);
      }
      if (!fs.statSync(rootDir).isDirectory()) {
        console.error(`Error: path is not a directory: ${rootDir}`);
        process.exit(2);
      }

      // Validate options
      if (opts.severity && !VALID_SEVERITIES.includes(opts.severity as Severity)) {
        console.error(`Invalid severity: ${opts.severity}. Must be one of: ${VALID_SEVERITIES.join(', ')}`);
        process.exit(2);
      }

      if (opts.failOn && !VALID_SEVERITIES.includes(opts.failOn as Severity)) {
        console.error(`Invalid --fail-on: ${opts.failOn}. Must be one of: ${VALID_SEVERITIES.join(', ')}`);
        process.exit(2);
      }

      if (opts.dryRun && !opts.fix && !opts.interactive) {
        console.error('--dry-run requires --fix or --interactive');
        process.exit(2);
      }

      const categories = opts.category
        ? (opts.category as string).split(',').map(c => c.trim() as Category)
        : undefined;

      if (categories) {
        for (const cat of categories) {
          if (!VALID_CATEGORIES.includes(cat)) {
            console.error(`Invalid category: ${cat}. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
            process.exit(2);
          }
        }
      }

      // Load config from file + CLI overrides
      const config = loadConfig(rootDir, {
        suggest: opts.suggest as boolean | undefined,
        fix: opts.fix as boolean | undefined,
        dryRun: opts.dryRun as boolean | undefined,
        format: opts.format as 'terminal' | 'json' | undefined,
        severityFilter: opts.severity as Severity | undefined,
        failOn: opts.failOn as Severity | undefined,
        categories,
        ignorePatterns: opts.ignore ? (opts.ignore as string).split(',').map(p => p.trim()) : [],
        maxFileSize: opts.maxFileSize ? parseInt(opts.maxFileSize as string, 10) : undefined,
        verbose: opts.verbose as boolean | undefined,
        includeDocs: opts.includeDocs === true
          ? true  // --include-docs with no argument = include all
          : typeof opts.includeDocs === 'string'
            ? (opts.includeDocs as string).split(',').map(e => e.trim().startsWith('.') ? e.trim() : '.' + e.trim())
            : undefined,
      });

      try {
        const report = await runAudit(config);

        // Show suggestions inline if --suggest or --fix (so you see what --fix will do)
        const showSuggestions = config.suggest || config.fix;

        // Output report
        if (config.format === 'json') {
          console.log(formatJsonReport(report));
        } else if (config.format === 'markdown' || config.format === 'report') {
          console.log(formatMarkdownReport(report));
        } else {
          // Gutter view when attached to a real terminal; compact one-liner when piped,
          // CI, or when the user explicitly passes --compact.
          const useGutter = !opts.compact && Boolean(process.stdout.isTTY);
          console.log(formatTerminalReport(report, showSuggestions, opts.quiet as boolean, opts.verbose as boolean, useGutter));
        }

        // Interactive fix mode
        if (opts.interactive) {
          await interactiveFix(report, { dryRun: config.dryRun });
        } else if (config.fix && !config.dryRun) {
          console.log('Applying fixes...\n');
          const result = applyFixes(report, { dryRun: false });
          console.log(`Applied: ${result.applied}, Skipped: ${result.skipped}`);
          if (result.errors.length > 0) {
            console.error('Errors:');
            for (const err of result.errors) {
              console.error(`  ${err}`);
            }
          }
        } else if (config.fix && config.dryRun) {
          console.log('Dry run — no changes written. Remove --dry-run to apply.\n');
        } else if (config.suggest && report.findings.some(f => f.suggestedFix)) {
          console.log('Run with --fix to apply changes, or --fix --dry-run to preview.\n');
        }

        // Exit code: use --fail-on threshold (default: low — info-only findings don't fail)
        const failLevel = config.failOn ?? 'high';
        const threshold = SEVERITY_ORDER[failLevel];
        const hasFailure = report.findings.some(f => SEVERITY_ORDER[f.severity] <= threshold);
        process.exit(hasFailure ? 1 : 0);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(2);
      }
    });

  // Benchmark subcommand: compare multiple repos
  program
    .command('benchmark')
    .description('Compare parallel dev readiness across multiple repos')
    .argument('<paths...>', 'Paths to repo roots')
    .option('--severity <level>', 'Minimum severity to include', 'high')
    .action(async (paths: string[], opts: Record<string, unknown>) => {
      const results: Array<{ name: string; report: import('./types.js').AuditReport }> = [];

      for (const p of paths) {
        const rootDir = path.resolve(p);
        const rawName = path.basename(rootDir);
        const name = rawName.replace(/[-_](?:test\d*|clone\d*|tmp|audit)$/i, '');
        process.stderr.write(`Scanning ${name}...`);

        if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
          process.stderr.write(` ERROR: path does not exist or is not a directory\n`);
          continue;
        }

        const config = loadConfig(rootDir, {
          severityFilter: opts.severity as Severity | undefined,
          ignorePatterns: [],
        });

        try {
          const report = await runAudit(config);
          results.push({ name, report });
          process.stderr.write(` ${report.score}/100 (${report.filesScanned} files)\n`);
        } catch (err) {
          process.stderr.write(` ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
        }
      }

      console.log(formatComparisonReport(results));
    });

  return program;
}
