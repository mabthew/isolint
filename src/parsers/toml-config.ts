/** Parse TOML content, returning null on failure. */
export async function parseTomlConfig(content: string): Promise<unknown | null> {
  try {
    const { parse } = await import('smol-toml');
    return parse(content);
  } catch {
    return null;
  }
}
