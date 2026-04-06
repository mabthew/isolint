import { Rule } from '../types.js';
import { hardcodedPortsRule } from './hardcoded-ports.js';
import { absolutePathsRule } from './absolute-paths.js';
import { dockerConflictsRule } from './docker-conflicts.js';
import { databaseStringsRule } from './database-strings.js';
import { sharedCachesRule } from './shared-caches.js';
import { pidAndSocketsRule } from './pid-and-sockets.js';
import { buildDirectoriesRule } from './build-directories.js';
import { tempDirectoriesRule } from './temp-directories.js';
import { logFilePathsRule } from './log-file-paths.js';
import { envPropagationRule } from './env-propagation.js';

const ALL_RULES: Rule[] = [
  hardcodedPortsRule,
  absolutePathsRule,
  dockerConflictsRule,
  databaseStringsRule,
  sharedCachesRule,
  pidAndSocketsRule,
  buildDirectoriesRule,
  tempDirectoriesRule,
  logFilePathsRule,
  envPropagationRule,
];

export function getAllRules(): Rule[] {
  return ALL_RULES;
}

export function getRuleById(id: string): Rule | undefined {
  return ALL_RULES.find(r => r.id === id);
}
