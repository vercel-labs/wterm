// Default regex for identifying URLs in terminal output. Conservative:
// requires an explicit http:// or https:// scheme, excludes whitespace and
// characters that routinely surround URLs in prose/brackets. Trailing
// punctuation that's almost always grammar (not part of the URL) is stripped
// post-match by trimTrailing() below.
export const DEFAULT_URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/g;

// Characters to strip from the end of a match. Matches iTerm2 / kitty
// heuristics: a URL that ends with ')' is kept only if its unmatched
// parenthesis count is zero (Wikipedia-style URLs contain '(' and ')').
const TRAILING_PUNCT = /[.,;:!?>\]}"'`]$/;

export function trimTrailing(url: string): string {
  let out = url;
  while (out.length > 0) {
    if (TRAILING_PUNCT.test(out)) {
      out = out.slice(0, -1);
      continue;
    }
    // Balance trailing ')': strip if there are more ')' than '('
    if (out.endsWith(")")) {
      const opens = (out.match(/\(/g) || []).length;
      const closes = (out.match(/\)/g) || []).length;
      if (closes > opens) {
        out = out.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return out;
}

export interface UrlRange {
  /** inclusive start column (0-based) */
  start: number;
  /** exclusive end column */
  end: number;
  /** the matched URL, with trailing punctuation stripped */
  url: string;
}

export interface LinkifyConfig {
  /** Regex used to identify URLs. Must be a /g regex. */
  pattern?: RegExp;
  /**
   * Optional click handler. If provided, fires before the browser's default
   * navigation. Call `event.preventDefault()` to suppress the default open.
   */
  onClick?: (url: string, event: MouseEvent) => void;
}

export type LinkifyOption = boolean | LinkifyConfig;

export interface NormalizedLinkify {
  enabled: boolean;
  pattern: RegExp;
  onClick: ((url: string, event: MouseEvent) => void) | null;
}

export function normalizeLinkify(option: LinkifyOption | undefined): NormalizedLinkify {
  if (!option) return { enabled: false, pattern: DEFAULT_URL_PATTERN, onClick: null };
  if (option === true) return { enabled: true, pattern: DEFAULT_URL_PATTERN, onClick: null };
  return {
    enabled: true,
    pattern: option.pattern ?? DEFAULT_URL_PATTERN,
    onClick: option.onClick ?? null,
  };
}

// Find URL ranges in a single row's text. Each match is returned with the
// columns of the URL WITHOUT trailing punctuation. The regex is executed with
// a fresh lastIndex every call (safe for global regexes).
export function findUrls(rowText: string, pattern: RegExp = DEFAULT_URL_PATTERN): UrlRange[] {
  if (!pattern.global) {
    throw new Error("linkify pattern must be a global (/g) regex");
  }
  pattern.lastIndex = 0;
  const ranges: UrlRange[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(rowText)) !== null) {
    const rawUrl = m[0];
    const url = trimTrailing(rawUrl);
    if (!url) continue;
    ranges.push({ start: m.index, end: m.index + url.length, url });
    // Guard against zero-width matches (mis-specified custom regex) to avoid
    // infinite loops. Force forward progress.
    if (m.index === pattern.lastIndex) pattern.lastIndex++;
  }
  return ranges;
}
