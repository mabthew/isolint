import { Rule, Finding, FileContext, LangPatternSet, lineNumberAt } from '../types.js';

const CONTAINER_NAME_PATTERN = /^\s*container_name:\s*["']?([^"'\s#]+)/gm;
const NETWORK_NAME_PATTERN = /^\s*name:\s*["']?([^"'\s#]+)/gm;
const VOLUME_NAME_PATTERN = /^\s*driver_opts:/; // flag if custom volume names are hardcoded

export const dockerConflictsRule: Rule = {
  id: 'docker-conflicts',
  name: 'Docker Conflicts',
  category: 'docker-conflict',
  description: 'Detects Docker Compose values that will conflict across parallel worktrees',
  defaultSeverity: 'high',
  filePatterns: ['docker-compose*.yml', 'docker-compose*.yaml', 'compose.yml', 'compose.yaml'],
  detect(file: FileContext, _langPatterns: LangPatternSet[]): Finding[] {
    const findings: Finding[] = [];

    // 1. Fixed container_name
    const nameRegex = new RegExp(CONTAINER_NAME_PATTERN.source, CONTAINER_NAME_PATTERN.flags);
    let match: RegExpExecArray | null;
    while ((match = nameRegex.exec(file.content)) !== null) {
      const name = match[1];
      // Skip if already using variable interpolation
      if (name.includes('${')) continue;

      const lineNum = lineNumberAt(file.lineOffsets, match.index);
      findings.push({
        ruleId: 'docker-conflicts/container-name',
        category: 'docker-conflict',
        severity: 'high',
        filePath: file.filePath,
        line: lineNum,
        column: 1,
        matchedText: name,
        message: `Fixed container_name "${name}" — will conflict across worktrees`,
        context: file.lines[lineNum - 1]?.trim() || match[0].trim(),
        suggestedFix: {
          description: 'Two worktrees running the same container_name will conflict — use COMPOSE_PROJECT_NAME to namespace',
          replacement: `\${COMPOSE_PROJECT_NAME:-${name}}`,
          confidence: 'auto',
          docUrl: 'https://isolint.dev/docs/rules/docker-conflicts',
        },
      });
    }

    // 2. Fixed network names (under networks: top-level key)
    // Only flag if we're in the top-level networks section
    const networkRegex = new RegExp(NETWORK_NAME_PATTERN.source, NETWORK_NAME_PATTERN.flags);
    const inNetworksSection = /^networks:\s*$/m.test(file.content);
    if (inNetworksSection) {
      while ((match = networkRegex.exec(file.content)) !== null) {
        const name = match[1];
        if (name.includes('${')) continue;

        const lineNum = lineNumberAt(file.lineOffsets, match.index);
        // Check if we're after the networks: key
        const beforeMatch = file.content.slice(0, match.index);
        if (!beforeMatch.includes('networks:')) continue;

        findings.push({
          ruleId: 'docker-conflicts/network-name',
          category: 'docker-conflict',
          severity: 'medium',
          filePath: file.filePath,
          line: lineNum,
          column: 1,
          matchedText: name,
          message: `Fixed network name "${name}" — may conflict across worktrees`,
          context: file.lines[lineNum - 1]?.trim() || match[0].trim(),
          suggestedFix: {
            description: 'Fixed network names will collide when multiple worktrees run Docker Compose',
            replacement: `\${COMPOSE_PROJECT_NAME:-default}-${name}`,
            confidence: 'auto',
            docUrl: 'https://isolint.dev/docs/rules/docker-conflicts',
          },
        });
      }
    }

    return findings;
  },
};
