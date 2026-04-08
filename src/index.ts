// Programmatic API
export { runAudit } from './engine.js';
export { applyFixes, interactiveFix } from './fixer.js';
export { detectEcosystems, getPatternSets } from './lang/index.js';
export { getAllRules } from './rules/index.js';
export { lineNumberAt } from './types.js';
export type {
  AuditConfig,
  AuditReport,
  Finding,
  SuggestedFix,
  Rule,
  Severity,
  Category,
  Ecosystem,
  RepoProfile,
} from './types.js';
