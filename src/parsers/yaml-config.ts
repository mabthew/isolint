import YAML from 'yaml';

/** Parse YAML content, returning null on failure. */
export function parseYamlConfig(content: string): unknown | null {
  try {
    return YAML.parse(content, { logLevel: 'silent' });
  } catch {
    return null;
  }
}
