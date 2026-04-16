/**
 * Shared visual primitives for terminal output.
 * Used by both the terminal reporter and the interactive fix mode.
 */
import pc from 'picocolors';
import { Severity, FixConfidence } from './types.js';

// #f59e0b amber — raw ANSI true color since picocolors has no orange
export const AMBER = (s: string) => `\x1b[38;2;245;158;11m${s}\x1b[39m`;
export const LOGO = AMBER('░▒▓█') + pc.bold(AMBER('  i s o l i n t  ')) + AMBER('█▓▒░');

export const SEVERITY_COLORS: Record<Severity, (s: string) => string> = {
  critical: pc.red,
  high: pc.yellow,
  medium: pc.cyan,
  low: pc.gray,
  info: pc.gray,
};

export const SEVERITY_BADGES: Record<Severity, string> = {
  critical: pc.bgRed(pc.bold(pc.black(' ✖ CRIT '))),
  high: pc.bgYellow(pc.bold(pc.black(' ▲ HIGH '))),
  medium: pc.bgCyan(pc.bold(pc.black(' ◆ MED  '))),
  low: pc.bgWhite(pc.black(' ◉ LOW  ')),
  info: pc.bgWhite(pc.black(' ○ INFO ')),
};

export const SEVERITY_ICONS: Record<Severity, string> = {
  critical: '✖',
  high: '▲',
  medium: '◆',
  low: '◉',
  info: '○',
};

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Highlight the offending span on a source line by bolding + coloring
 * the substring that starts at `column` and has length `matchedText.length`.
 * Falls back to rendering the full line bright if the span can't be located.
 */
export function highlightMatch(
  lineText: string,
  column: number,
  matchedText: string,
  color: (s: string) => string,
): string {
  if (!matchedText || column < 1) return color(lineText);
  const startIdx = column - 1;
  const endIdx = startIdx + matchedText.length;
  if (endIdx <= lineText.length && lineText.slice(startIdx, endIdx) === matchedText) {
    return lineText.slice(0, startIdx) + color(pc.bold(matchedText)) + lineText.slice(endIdx);
  }
  const foundIdx = lineText.indexOf(matchedText);
  if (foundIdx !== -1) {
    return lineText.slice(0, foundIdx) + color(pc.bold(matchedText)) + lineText.slice(foundIdx + matchedText.length);
  }
  return color(lineText);
}

export function confidenceLabel(confidence: FixConfidence): string {
  switch (confidence) {
    case 'auto': return pc.green(pc.bold('auto-fix'));
    case 'review': return pc.yellow('review');
    case 'manual': return pc.red('manual');
  }
}
