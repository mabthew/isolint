/** Parse JSON/JSONC (strips single-line comments, trailing commas). */
export function parseJsonConfig(content: string): unknown | null {
  try {
    // Strip // comments and trailing commas for JSONC support
    const cleaned = content
      .replace(/\/\/.*$/gm, '')
      .replace(/,\s*([\]}])/g, '$1');
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
