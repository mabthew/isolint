import { AuditConfig, AuditReport, CategorySummary, Finding, LangPatternSet, RepoProfile, Rule, Category, Severity } from './types.js';
import { discoverFiles, readFileContext } from './scanner.js';
import { detectEcosystems, getPatternSets } from './lang/index.js';
import { getAllRules } from './rules/index.js';

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export { SEVERITY_ORDER };

/** Run the full audit pipeline. */
export async function runAudit(config: AuditConfig): Promise<AuditReport> {
  const start = Date.now();

  // 1. Detect ecosystems
  const profile: RepoProfile = detectEcosystems(config.rootDir);
  const patternSets: LangPatternSet[] = getPatternSets(profile);

  if (config.verbose) {
    const ecoList = profile.ecosystems.filter(e => e !== 'unknown');
    console.error(`Ecosystems detected: ${ecoList.length > 0 ? ecoList.join(', ') : 'none'}`);
  }

  // 2. Discover files
  const filePaths = await discoverFiles(config);

  if (config.verbose) {
    console.error(`Files to scan: ${filePaths.length}`);
  }

  // 3. Load rules
  const allRules = getAllRules();
  const rules = filterRules(allRules, config);

  if (config.verbose) {
    console.error(`Rules active: ${rules.map(r => r.id).join(', ')}`);
  }

  // 4. Run rules against each file
  const findings: Finding[] = [];
  let filesScanned = 0;

  for (const filePath of filePaths) {
    const fileCtx = readFileContext(filePath, config.rootDir);
    if (!fileCtx) continue;
    filesScanned++;

    // Skip .env files — they contain secrets and are env vars by definition.
    // Only the env-propagation rule (which reads .gitignore) should run.
    const isEnvFile = fileCtx.basename.startsWith('.env') &&
      !fileCtx.basename.endsWith('.example') &&
      !fileCtx.basename.endsWith('.template') &&
      !fileCtx.basename.endsWith('.sample');

    // Build set of ignored lines for this file
    const ignoredLines = getIgnoredLines(fileCtx.lines);

    for (const rule of rules) {
      if (isEnvFile && rule.id !== 'env-propagation') continue;
      // Check if this rule cares about this file type
      if (!matchesFilePatterns(filePath, fileCtx.basename, rule.filePatterns)) {
        continue;
      }

      const ruleFindings = rule.detect(fileCtx, patternSets);

      // Filter out ignored lines
      const filtered = ruleFindings.filter(f => !ignoredLines.has(f.line));

      // Downgrade findings in documentation and test files
      if (isDocFile(filePath)) {
        for (const f of filtered) {
          f.severity = 'info';
        }
      } else if (isTestFile(filePath)) {
        for (const f of filtered) {
          if (f.severity === 'critical') f.severity = 'high';
          else if (f.severity === 'high') f.severity = 'medium';
          else if (f.severity === 'medium') f.severity = 'low';
        }
      }

      findings.push(...filtered);
    }
  }

  // 5. Cross-category dedup: if a DB URL was found on a line, drop the port-only finding for same line
  const crossDeduped = crossCategoryDedup(findings);

  // 6. Same-category dedup: keep highest severity per file:line:category
  const deduped = deduplicateFindings(crossDeduped);

  // 7. Filter by severity
  const finalFindings = config.severityFilter
    ? deduped.filter(f => SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER[config.severityFilter!])
    : deduped;

  // 8. Sort: by severity, then file, then line
  finalFindings.sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;
    const fileDiff = a.filePath.localeCompare(b.filePath);
    if (fileDiff !== 0) return fileDiff;
    return a.line - b.line;
  });

  // 9. Build summary + score
  const summary = buildSummary(finalFindings);
  const score = computeReadinessScore(finalFindings, filesScanned);

  return {
    repoPath: config.rootDir,
    timestamp: new Date().toISOString(),
    duration: Date.now() - start,
    filesScanned,
    findingsCount: finalFindings.length,
    repoProfile: profile,
    findings: finalFindings,
    summary,
    score,
  };
}

// --- Inline ignore support ---

const IGNORE_PATTERNS = [
  'parallel-dev-audit-ignore-next-line',
  'parallel-dev-audit-ignore',
  'pda-ignore',
  // Legacy aliases
  'worktree-audit-ignore-next-line',
  'worktree-audit-ignore',
  'wta-ignore',
];

/**
 * Scan lines for ignore comments. Returns a Set of 1-based line numbers to skip.
 * Supports:
 *   // parallel-dev-audit-ignore-next-line  (skips next line)
 *   // parallel-dev-audit-ignore            (skips current line if inline, next if on own line)
 *   // pda-ignore                           (short form)
 *   // wta-ignore                           (legacy alias)
 */
function getIgnoredLines(lines: string[]): Set<number> {
  const ignored = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    for (const pattern of IGNORE_PATTERNS) {
      if (line.includes(pattern)) {
        if (pattern.includes('next-line')) {
          // Always ignore the next line
          ignored.add(i + 2); // 1-based
        } else {
          // If the comment is the entire line (no code before it), ignore next line
          // If it's inline after code, ignore this line
          const commentStart = line.indexOf(pattern);
          const beforeComment = line.slice(0, commentStart).replace(/\/\/\s*$/, '').replace(/#\s*$/, '').trim();
          if (beforeComment.length === 0) {
            ignored.add(i + 2); // standalone comment → skip next line
          } else {
            ignored.add(i + 1); // inline → skip this line
          }
        }
        break;
      }
    }
  }
  return ignored;
}

// --- File classification ---

const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc']);
const TEST_PATTERNS = ['test', 'tests', 'e2e', 'spec', 'playwright', '__tests__', '__mocks__', 'fixtures'];

function isDocFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return DOC_EXTENSIONS.has(ext);
}

function isTestFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return TEST_PATTERNS.some(p => lower.includes(p));
}

// --- Rule filtering ---

function filterRules(rules: Rule[], config: AuditConfig): Rule[] {
  if (!config.categories || config.categories.length === 0) return rules;
  return rules.filter(r => config.categories!.includes(r.category));
}

function matchesFilePatterns(filePath: string, basename: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern === '**/*') return true;
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1);
      if (filePath.endsWith(ext)) return true;
    }
    if (pattern.startsWith('.env')) {
      if (basename.startsWith('.env')) return true;
    }
    if (basename === pattern) return true;
    if (filePath.endsWith(pattern)) return true;
    if (pattern.includes('*')) {
      const re = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      if (re.test(basename) || re.test(filePath)) return true;
    }
  }
  return false;
}

// --- Deduplication ---

/**
 * Cross-category dedup: when a database-string finding exists on a line,
 * drop any hardcoded-port finding on the same line (the port is part of the DB URL).
 */
function crossCategoryDedup(findings: Finding[]): Finding[] {
  // Build a set of file:line keys that have database-string findings
  const dbLines = new Set<string>();
  for (const f of findings) {
    if (f.category === 'database-string') {
      dbLines.add(`${f.filePath}:${f.line}`);
    }
  }

  return findings.filter(f => {
    // Drop port findings on lines that already have a DB string finding
    if (f.category === 'hardcoded-port' && dbLines.has(`${f.filePath}:${f.line}`)) {
      return false;
    }
    return true;
  });
}

/**
 * Same-category dedup: keep only the highest-severity finding per file:line:category.
 */
function deduplicateFindings(findings: Finding[]): Finding[] {
  const byKey = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.filePath}:${f.line}:${f.category}`;
    const existing = byKey.get(key);
    if (!existing || SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[existing.severity]) {
      byKey.set(key, f);
    }
  }
  return Array.from(byKey.values());
}

// --- Summary + scoring ---

function buildSummary(findings: Finding[]): CategorySummary[] {
  const map = new Map<Category, CategorySummary>();

  for (const f of findings) {
    let entry = map.get(f.category);
    if (!entry) {
      entry = { category: f.category, count: 0, bySeverity: {} };
      map.set(f.category, entry);
    }
    entry.count++;
    entry.bySeverity[f.severity] = (entry.bySeverity[f.severity] || 0) + 1;
  }

  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/** Severity weights for scoring. */
const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 10,
  high: 5,
  medium: 2,
  low: 0.5,
  info: 0,
};

/**
 * Compute a Parallel Dev Readiness Score (0-100).
 * 100 = no findings. Each finding deducts points based on severity.
 * Score is capped at 0 minimum.
 */
function computeReadinessScore(findings: Finding[], filesScanned: number): number {
  if (findings.length === 0) return 100;

  // Total penalty points
  let penalty = 0;
  for (const f of findings) {
    penalty += SEVERITY_WEIGHTS[f.severity];
  }

  // Normalize: scale penalty relative to repo size so large repos aren't unfairly penalized
  // A repo with 100 files and 10 critical findings should score similarly to
  // a repo with 10000 files and 10 critical findings
  const scaleFactor = Math.max(1, Math.log10(filesScanned + 1));
  const normalizedPenalty = penalty / scaleFactor;

  // Map to 0-100 scale. 200 penalty points (normalized) = score of 0
  const score = Math.max(0, Math.round(100 - (normalizedPenalty / 200) * 100));
  return Math.min(100, score);
}
