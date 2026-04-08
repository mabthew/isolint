import * as fs from 'fs';
import * as path from 'path';
import { FileContext, AuditConfig } from './types.js';
import { parseDotenv } from './parsers/dotenv.js';
import { parseJsonConfig } from './parsers/json-config.js';
import { parseYamlConfig } from './parsers/yaml-config.js';

/** Binary/media/data extensions to always skip. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.avif', '.svg',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.dylib', '.o', '.a',
  '.pyc', '.pyo', '.class', '.jar', '.war',
  '.lock',
  '.csv', '.tsv', // data files — not config
]);

/** Directories to always skip. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'vendor', '__pycache__',
  '.venv', 'venv', '.tox', '.nox',
  'target', '.gradle', '.cache', '.npm', '.pnpm-store',
  '.claude', 'dist', '.next', '.nuxt',
]);

/**
 * Parse a .gitignore file into a list of matchers.
 * Supports: comments, blank lines, negation (!), directory markers (/),
 * simple globs (*, **), and extension patterns (*.ext).
 */
function parseGitignore(content: string): Array<{ pattern: RegExp; negated: boolean }> {
  const matchers: Array<{ pattern: RegExp; negated: boolean }> = [];

  for (let line of content.split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    let negated = false;
    if (line.startsWith('!')) {
      negated = true;
      line = line.slice(1);
    }

    // Remove trailing spaces (unless escaped)
    line = line.replace(/(?<!\\)\s+$/, '');
    // Remove trailing slash (we match both files and dirs)
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);

    // Convert gitignore glob to regex
    let regex = line
      .replace(/\./g, '\\.')           // escape dots
      .replace(/\*\*/g, '\0')          // placeholder for **
      .replace(/\*/g, '[^/]*')         // * = anything except /
      .replace(/\?/g, '[^/]')          // ? = single char except /
      .replace(/\0/g, '.*');           // ** = anything including /

    // If pattern has no slash, it matches anywhere in the path
    if (!line.includes('/')) {
      regex = `(?:^|/)${regex}(?:$|/)`;
    } else {
      // Anchored to root
      if (regex.startsWith('/')) regex = regex.slice(1);
      regex = `^${regex}(?:$|/)`;
    }

    try {
      matchers.push({ pattern: new RegExp(regex), negated });
    } catch {
      // Skip invalid patterns
    }
  }

  return matchers;
}

/** Check if a relative path is ignored by the gitignore matchers. */
function isGitignored(
  relativePath: string,
  matchers: Array<{ pattern: RegExp; negated: boolean }>
): boolean {
  let ignored = false;
  for (const { pattern, negated } of matchers) {
    if (pattern.test(relativePath)) {
      ignored = !negated;
    }
  }
  return ignored;
}

/** Load and parse .gitignore from a directory, returning matchers. */
function loadGitignore(rootDir: string): Array<{ pattern: RegExp; negated: boolean }> {
  const gitignorePath = path.join(rootDir, '.gitignore');
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    return parseGitignore(content);
  } catch {
    return [];
  }
}

/** Discover all scannable files in the repo using recursive readdir. */
export async function discoverFiles(config: AuditConfig): Promise<string[]> {
  const files: string[] = [];
  const customIgnores = new Set(config.ignorePatterns);
  const gitignoreMatchers = config.respectGitignore !== false
    ? loadGitignore(config.rootDir)
    : [];

  function walk(dir: string, relativeBase: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      const relativePath = relativeBase ? `${relativeBase}/${name}` : name;

      // Skip symlinks to prevent infinite loops and reading outside repo
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        if (customIgnores.has(name) || customIgnores.has(`${name}/`)) continue;
        if (gitignoreMatchers.length > 0 && isGitignored(relativePath, gitignoreMatchers)) continue;
        walk(path.join(dir, name), relativePath);
      } else if (entry.isFile()) {
        const ext = path.extname(name).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) continue;
        if (gitignoreMatchers.length > 0 && isGitignored(relativePath, gitignoreMatchers)) continue;
        files.push(relativePath);
      }
    }
  }

  walk(config.rootDir, '');
  return files;
}

/** Read and parse a file into a FileContext. */
export function readFileContext(filePath: string, rootDir: string): FileContext | null {
  const absolutePath = path.resolve(path.join(rootDir, filePath));

  // Guard against path traversal (e.g. filePath = "../../etc/passwd")
  if (!absolutePath.startsWith(path.resolve(rootDir))) return null;

  let content: string;
  try {
    const stat = fs.statSync(absolutePath);
    if (stat.size > 1_048_576) return null; // Skip files > 1MB
    content = fs.readFileSync(absolutePath, 'utf-8');
  } catch {
    return null;
  }

  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);
  const lines = content.split('\n');

  // Pre-compute newline offsets for O(log n) line lookups
  const lineOffsets: number[] = [0]; // line 1 starts at offset 0
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      lineOffsets.push(i + 1);
    }
  }

  const ctx: FileContext = {
    filePath,
    absolutePath,
    content,
    lines,
    lineOffsets,
    extension: ext,
    basename,
  };

  // Parse structured files
  if (basename.startsWith('.env')) {
    ctx.parsed = { env: parseDotenv(content) };
  } else if (ext === '.json' || ext === '.jsonc') {
    ctx.parsed = { json: parseJsonConfig(content) };
  } else if (ext === '.yml' || ext === '.yaml') {
    ctx.parsed = { yaml: parseYamlConfig(content) };
  }

  return ctx;
}
