import * as fs from 'fs';
import * as path from 'path';
import { Rule, Finding, FileContext, LangPatternSet } from '../types.js';

export const envPropagationRule: Rule = {
  id: 'env-propagation',
  name: 'Environment File Propagation',
  category: 'hardcoded-port', // reuse category — env files are a port/config concern
  description: 'Detects .env files that are gitignored and won\'t propagate to new worktrees',
  defaultSeverity: 'high',
  filePatterns: ['.gitignore'],
  detect(file: FileContext, _langPatterns: LangPatternSet[]): Finding[] {
    const findings: Finding[] = [];
    const rootDir = path.dirname(file.absolutePath);

    // Check if .env is gitignored
    const envIgnored = file.lines.some(line => {
      const trimmed = line.trim();
      return trimmed === '.env' || trimmed === '.env.local' || trimmed === '.env*' ||
             trimmed === '.env.*.local';
    });

    if (!envIgnored) return findings;

    // Check if .env exists (meaning it's being used but won't propagate)
    const envExists = fs.existsSync(path.join(rootDir, '.env'));
    const envExampleExists = fs.existsSync(path.join(rootDir, '.env.example')) ||
                             fs.existsSync(path.join(rootDir, '.env.template')) ||
                             fs.existsSync(path.join(rootDir, '.env.sample'));

    if (envExists || envExampleExists) {
      const lineNum = file.lines.findIndex(l => {
        const t = l.trim();
        return t === '.env' || t === '.env.local' || t === '.env*' || t === '.env.*.local';
      }) + 1;

      findings.push({
        ruleId: 'env-propagation/gitignored',
        category: 'hardcoded-port',
        severity: 'info', // info since tools like worktrunk handle this
        filePath: file.filePath,
        line: lineNum || 1,
        column: 1,
        matchedText: '.env',
        message: `.env is gitignored — new worktrees won't have environment variables. ${envExampleExists ? 'Use .env.example as template.' : 'Consider adding .env.example.'}`,
        context: file.lines[(lineNum || 1) - 1]?.trim() || '.env',
        suggestedFix: {
          description: 'Add a worktree hook to copy .env.example to .env on worktree creation',
          replacement: 'cp .env.example .env  # in your worktree create hook',
          confidence: 'manual',
        },
      });
    }

    return findings;
  },
};
