import * as fs from 'fs';
import * as path from 'path';
import { Ecosystem, LangPatternSet, RepoProfile } from '../types.js';
import { nodePatterns } from './node.js';
import { pythonPatterns } from './python.js';
import { goPatterns } from './go.js';
import { rustPatterns } from './rust.js';
import { dotnetPatterns } from './dotnet.js';
import { javaPatterns } from './java.js';
import { rubyPatterns } from './ruby.js';

const ECOSYSTEM_MARKERS: Record<Ecosystem, string[]> = {
  node: ['package.json', 'tsconfig.json', 'deno.json'],
  python: ['pyproject.toml', 'setup.py', 'Pipfile', 'requirements.txt', 'manage.py'],
  go: ['go.mod', 'go.sum'],
  rust: ['Cargo.toml', 'Cargo.lock'],
  dotnet: ['*.csproj', '*.sln', 'global.json'],
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  ruby: ['Gemfile', 'Rakefile', 'config.ru'],
  unknown: [],
};

const PATTERN_SETS: Record<Ecosystem, LangPatternSet | null> = {
  node: nodePatterns,
  python: pythonPatterns,
  go: goPatterns,
  rust: rustPatterns,
  dotnet: dotnetPatterns,
  java: javaPatterns,
  ruby: rubyPatterns,
  unknown: null,
};

/** Detect which ecosystems are present in the repo. */
export function detectEcosystems(rootDir: string): RepoProfile {
  const ecosystems: Ecosystem[] = [];
  const markers: Partial<Record<Ecosystem, string[]>> = {};

  for (const [eco, markerFiles] of Object.entries(ECOSYSTEM_MARKERS)) {
    if (eco === 'unknown') continue;
    const found: string[] = [];
    for (const marker of markerFiles) {
      if (marker.includes('*')) {
        // Glob-style marker — check if any matching file exists
        const ext = marker.replace('*', '');
        try {
          const entries = fs.readdirSync(rootDir);
          for (const entry of entries) {
            if (entry.endsWith(ext)) {
              found.push(entry);
              break;
            }
          }
        } catch { /* directory doesn't exist */ }
      } else {
        const fullPath = path.join(rootDir, marker);
        if (fs.existsSync(fullPath)) {
          found.push(marker);
        }
      }
    }
    if (found.length > 0) {
      ecosystems.push(eco as Ecosystem);
      markers[eco as Ecosystem] = found;
    }
  }

  // If nothing detected, mark as unknown
  if (ecosystems.length === 0) {
    ecosystems.push('unknown');
  }

  return {
    ecosystems,
    primaryEcosystem: ecosystems[0],
    markers,
  };
}

/** Get pattern sets for all detected ecosystems. */
export function getPatternSets(profile: RepoProfile): LangPatternSet[] {
  const sets: LangPatternSet[] = [];
  for (const eco of profile.ecosystems) {
    const ps = PATTERN_SETS[eco];
    if (ps) sets.push(ps);
  }
  return sets;
}

/** Get the best matching ecosystem for a given file extension. */
export function ecosystemForExtension(ext: string): Ecosystem {
  for (const [eco, ps] of Object.entries(PATTERN_SETS)) {
    if (ps && ps.sourceExtensions.includes(ext)) {
      return eco as Ecosystem;
    }
  }
  return 'unknown';
}
