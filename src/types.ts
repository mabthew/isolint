export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type Category =
  | 'hardcoded-port'
  | 'absolute-path'
  | 'build-directory'
  | 'shared-cache'
  | 'pid-socket'
  | 'docker-conflict'
  | 'database-string'
  | 'temp-directory'
  | 'log-file-path';

export type Ecosystem =
  | 'node'
  | 'dotnet'
  | 'go'
  | 'rust'
  | 'java'
  | 'ruby'
  | 'python'
  | 'unknown';

export type FixConfidence = 'auto' | 'review' | 'manual';

export interface Finding {
  ruleId: string;
  category: Category;
  severity: Severity;
  filePath: string;
  line: number;
  column: number;
  matchedText: string;
  message: string;
  context: string;
  ecosystem?: Ecosystem;
  suggestedFix?: SuggestedFix;
}

export interface SuggestedFix {
  description: string;
  replacement: string;
  confidence: FixConfidence;
}

export interface PatternDef {
  pattern: RegExp;
  description: string;
  contextKeywords?: string[];
  negativeContext?: string[];
}

export interface FixTemplate {
  sourcePattern: string;
  envVarPattern: string;
  description: string;
}

export interface LangPatternSet {
  ecosystem: Ecosystem;
  portBindingPatterns: PatternDef[];
  buildOutputDirs: string[];
  cacheDirs: string[];
  pidSocketPatterns: PatternDef[];
  dbStringPatterns: PatternDef[];
  logPathPatterns: PatternDef[];
  sourceExtensions: string[];
  configFileGlobs: string[];
  fixTemplates: Partial<Record<Category, FixTemplate>>;
}

export interface FileContext {
  filePath: string;
  absolutePath: string;
  content: string;
  lines: string[];
  /** Pre-computed newline byte offsets for O(log n) line number lookups. */
  lineOffsets: number[];
  extension: string;
  basename: string;
  parsed?: {
    yaml?: unknown;
    json?: unknown;
    env?: Record<string, string>;
    toml?: unknown;
  };
}

/** Binary search lineOffsets to find the 1-based line number for a byte offset. */
export function lineNumberAt(offsets: number[], byteOffset: number): number {
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid] <= byteOffset) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo; // 1-based: line 1 if offset is before first newline
}

export interface RepoProfile {
  ecosystems: Ecosystem[];
  primaryEcosystem?: Ecosystem;
  markers: Partial<Record<Ecosystem, string[]>>;
}

export interface Rule {
  id: string;
  name: string;
  category: Category;
  description: string;
  filePatterns: string[];
  defaultSeverity: Severity;
  detect(file: FileContext, langPatterns: LangPatternSet[]): Finding[];
}

export interface AuditReport {
  repoPath: string;
  timestamp: string;
  duration: number;
  filesScanned: number;
  findingsCount: number;
  repoProfile: RepoProfile;
  findings: Finding[];
  summary: CategorySummary[];
  /** Parallel Dev Readiness Score: 0 (many issues) to 100 (clean). */
  score: number;
}

export interface CategorySummary {
  category: Category;
  count: number;
  bySeverity: Partial<Record<Severity, number>>;
}

export interface AuditConfig {
  rootDir: string;
  suggest: boolean;
  fix: boolean;
  dryRun: boolean;
  format: 'terminal' | 'json' | 'markdown' | 'report';
  severityFilter?: Severity;
  failOn?: Severity;
  categories?: Category[];
  ignorePatterns: string[];
  respectGitignore: boolean;
  maxFileSize: number;
  verbose?: boolean;
}
