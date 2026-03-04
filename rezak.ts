// Rezak.ts
// Split text into short fragments using prioritized separators from YAML/JSON config.
// Notes:
// - All regex operations are ALWAYS case-insensitive.
// - Multi-line inline flag like (?m) in patterns is supported ONLY as a prefix and is converted to RegExp flag "m".
// - Regex separators are supported via "re:<pattern>" or "regex:<pattern>" entries in split_levels.separators.
// - Separators longer than 1 character are treated as whole word/phrase matches (not inside other words).
// - keep="drop" also drops the delimiter if it appears at the very beginning of a fragment (e.g., "but ...").
// - No character-based splitting. Whitespace fallback is optional via config.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";

type KeepMode = "left" | "right" | "drop";

type RegexStep = {
  pattern: string;
  repl: string;
};

type SplitLevel = {
  name: string;
  separators: string[];
  keep: KeepMode;
  greedy?: boolean;
};

type Config = {
  max_words: number;
  min_words_per_side: number;
  split_on_whitespace_fallback: boolean;

  mark_oversized: boolean;
  oversized_prefix: string;
  mark_split_level_name: boolean;

  word_regex: string;

  preprocess_steps: RegexStep[];
  postprocess_steps: RegexStep[];

  protect_patterns: string[];

  split_levels: SplitLevel[];
};

type OutputFragment = {
  text: string;
  splitLevelName: string | null;
};

const KEEP_MODES: Set<string> = new Set(["left", "right", "drop"]);
const WORD_CHAR_RE = /[A-Za-z0-9']/;
const REGEX_SEPARATOR_PREFIXES = ["re:", "regex:"];

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function readTextFileUtf8(p: string): string {
  return fs.readFileSync(p, "utf8");
}

function loadRawConfig(configPath: string): any {
  const ext = path.extname(configPath).toLowerCase();
  const rawText = readTextFileUtf8(configPath);

  if (ext === ".yml" || ext === ".yaml") {
    const data = YAML.parse(rawText);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      die("YAML config root must be a mapping/object.");
    }
    return data;
  }

  if (ext === ".json") {
    const data = JSON.parse(rawText);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      die("JSON config root must be an object.");
    }
    return data;
  }

  die("Unsupported config extension. Use .yaml/.yml or .json");
}

function toBool(v: any, def: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === undefined || v === null) return def;
  return Boolean(v);
}

function toInt(v: any, def: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))
    return Math.trunc(Number(v));
  return def;
}

function ensureString(v: any, def: string): string {
  if (typeof v === "string") return v;
  if (v === undefined || v === null) return def;
  return String(v);
}

function getRegexSeparatorPattern(token: string): string | null {
  const lower = token.toLowerCase();
  for (const prefix of REGEX_SEPARATOR_PREFIXES) {
    if (lower.startsWith(prefix)) return token.slice(prefix.length);
  }
  return null;
}

function parseSteps(raw: any, key: string): RegexStep[] {
  const steps = raw?.[key];
  if (steps === undefined || steps === null) return [];
  if (!Array.isArray(steps)) die(`${key} must be a list of {pattern, repl}.`);

  return steps.map((st: any, i: number) => {
    if (!st || typeof st !== "object" || Array.isArray(st))
      die(`${key}[${i}] must be an object.`);
    const pattern = ensureString(st.pattern, "");
    const repl = ensureString(st.repl, "");
    if (!pattern) die(`${key}[${i}].pattern is required.`);
    return { pattern, repl };
  });
}

function parseLevels(raw: any): SplitLevel[] {
  const levels = raw?.split_levels;
  if (!Array.isArray(levels) || levels.length === 0)
    die("split_levels is required and must be a non-empty list.");

  return levels.map((lvl: any, i: number) => {
    if (!lvl || typeof lvl !== "object" || Array.isArray(lvl))
      die(`split_levels[${i}] must be an object.`);

    const name = ensureString(lvl.name, `level_${i}`);
    const seps = lvl.separators;
    if (!Array.isArray(seps) || seps.length === 0)
      die(`split_levels[${i}].separators must be a non-empty list.`);
    const separators = seps.map((s: any, j: number) => {
      const separator = ensureString(s, "");
      if (!separator) die(`split_levels[${i}].separators[${j}] must not be empty.`);

      const regexPattern = getRegexSeparatorPattern(separator);
      if (regexPattern !== null && regexPattern.length === 0) {
        die(
          `split_levels[${i}].separators[${j}] regex pattern must not be empty.`,
        );
      }

      return separator;
    });

    const keep = ensureString(lvl.keep, "left").toLowerCase();
    if (!KEEP_MODES.has(keep))
      die(`split_levels[${i}].keep must be one of: left|right|drop.`);

    const greedy = toBool(lvl.greedy, false);

    return { name, separators, keep: keep as KeepMode, greedy };
  });
}

function loadConfig(configPath: string): Config {
  const raw = loadRawConfig(configPath);

  const max_words = toInt(raw.max_words, 12);
  if (max_words <= 0) die("max_words must be > 0");

  const min_words_per_side = toInt(raw.min_words_per_side, 1);
  if (min_words_per_side < 0) die("min_words_per_side must be >= 0");

  const split_on_whitespace_fallback = toBool(
    raw.split_on_whitespace_fallback,
    false,
  );

  const mark_oversized = toBool(raw.mark_oversized, false);
  const oversized_prefix = ensureString(raw.oversized_prefix, "[OVERSIZED] ");
  const mark_split_level_name = toBool(raw.mark_split_level_name, false);

  const word_regex = ensureString(
    raw.word_regex,
    "[A-Za-z0-9]+(?:'[A-Za-z0-9]+)*",
  );

  const preprocess_steps = parseSteps(raw, "preprocess_steps");
  const postprocess_steps = parseSteps(raw, "postprocess_steps");

  const protect_patterns_raw = raw.protect_patterns;
  const protect_patterns = Array.isArray(protect_patterns_raw)
    ? protect_patterns_raw
        .map((p: any) => ensureString(p, ""))
        .filter((p: string) => p.length > 0)
    : [];

  const split_levels = parseLevels(raw);

  return {
    max_words,
    min_words_per_side,
    split_on_whitespace_fallback,
    mark_oversized,
    oversized_prefix,
    mark_split_level_name,
    word_regex,
    preprocess_steps,
    postprocess_steps,
    protect_patterns,
    split_levels,
  };
}

function extractInlinePrefixFlags(pattern: string): {
  source: string;
  flags: string;
} {
  // Supports ONLY a prefix like: (?m) or (?im) or (?mi)
  // Always adds "i" (ignore case) and "g" (global) elsewhere.
  // Returns flags to be merged into the final RegExp flags.
  const m = pattern.match(/^\(\?([a-zA-Z]+)\)/);
  if (!m) return { source: pattern, flags: "" };
  const inline = m[1].toLowerCase();
  const rest = pattern.slice(m[0].length);
  // Only keep JS-supported flags: m, s, u, y (we will add i+g anyway)
  const allowed = new Set(["m", "s", "u", "y"]);
  const flags = inline
    .split("")
    .filter((ch) => allowed.has(ch))
    .join("");
  return { source: rest, flags };
}

function compileRegex(pattern: string, extraFlags: string): RegExp {
  const { source, flags } = extractInlinePrefixFlags(pattern);
  const uniq = new Set<string>();
  for (const ch of (flags + extraFlags).split("")) uniq.add(ch);
  return new RegExp(source, Array.from(uniq).join(""));
}

function applyRegexSteps(text: string, steps: RegexStep[]): string {
  // Always ignore-case and global. Respect optional prefix (?m) converted to flag "m".
  let out = text;
  for (const st of steps) {
    const rx = compileRegex(st.pattern, "gi");
    out = out.replace(rx, st.repl);
  }
  return out;
}

function countWords(text: string, wordRxGlobal: RegExp): number {
  const m = text.match(wordRxGlobal);
  return m ? m.length : 0;
}

function isWordChar(ch: string): boolean {
  return WORD_CHAR_RE.test(ch);
}

function overlapsAny(
  intervals: Array<[number, number]>,
  s: number,
  e: number,
): boolean {
  for (const [a, b] of intervals) {
    if (s < b && e > a) return true;
  }
  return false;
}

function mergeIntervals(
  intervals: Array<[number, number]>,
): Array<[number, number]> {
  if (intervals.length === 0) return [];
  intervals.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const merged: Array<[number, number]> = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const [s, e] = intervals[i];
    const last = merged[merged.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

function getProtectedIntervals(
  text: string,
  protectPatterns: string[],
): Array<[number, number]> {
  const intervals: Array<[number, number]> = [];
  for (const p of protectPatterns) {
    // Always ignore-case; global; support optional prefix (?m)
    const rx = compileRegex(p, "gi");
    let match: RegExpExecArray | null;
    // Need exec loop for spans
    const r = new RegExp(rx.source, rx.flags); // clone to avoid lastIndex issues across calls
    while ((match = r.exec(text)) !== null) {
      if (match[0].length === 0) {
        // avoid infinite loops
        r.lastIndex += 1;
        continue;
      }
      intervals.push([match.index, match.index + match[0].length]);
    }
  }
  return mergeIntervals(intervals);
}

function applySplit(
  text: string,
  start: number,
  end: number,
  keep: KeepMode,
): [string, string] {
  if (keep === "left") {
    const left = text.slice(0, end).trim();
    const right = text.slice(end).trim();
    return [left, right];
  }
  if (keep === "right") {
    const left = text.slice(0, start).trim();
    const right = text.slice(start).trim();
    return [left, right];
  }
  // drop
  const left = text.slice(0, start).trim();
  const right = text.slice(end).trim();
  return [left, right];
}

function collectOccurrences(
  text: string,
  level: SplitLevel,
  protectedIntervals: Array<[number, number]>,
): Array<[number, number]> {
  // Rule:
  // - separators with "re:" / "regex:" prefix => treat as regex matches
  // - separators with len(token) > 1 => treat as word/phrase (boundary-checked; token is trimmed for matching)
  // - separators with len(token) == 1 => treat as literal char
  const occs: Array<[number, number]> = [];
  const tl = text.toLowerCase();

  for (const rawToken of level.separators) {
    if (!rawToken) continue;

    const regexPattern = getRegexSeparatorPattern(rawToken);
    if (regexPattern !== null) {
      const rx = compileRegex(regexPattern, "gi");
      let match: RegExpExecArray | null;
      const r = new RegExp(rx.source, rx.flags);
      while ((match = r.exec(text)) !== null) {
        if (match[0].length === 0) {
          r.lastIndex += 1;
          continue;
        }

        const start = match.index;
        const end = match.index + match[0].length;
        if (!overlapsAny(protectedIntervals, start, end))
          occs.push([start, end]);
      }
      continue;
    }

    if (rawToken.length > 1) {
      const token = rawToken.trim();
      if (!token) continue;

      const tok = token.toLowerCase();
      let from = 0;
      while (true) {
        const idx = tl.indexOf(tok, from);
        if (idx === -1) break;
        const start = idx;
        const end = idx + tok.length;

        // Word/phrase boundary check at ends only
        const before = start > 0 ? text[start - 1] : "";
        const after = end < text.length ? text[end] : "";
        if ((before && isWordChar(before)) || (after && isWordChar(after))) {
          from = idx + 1;
          continue;
        }

        if (!overlapsAny(protectedIntervals, start, end))
          occs.push([start, end]);
        from = idx + tok.length;
      }
    } else {
      const tok = rawToken.toLowerCase();
      let from = 0;
      while (true) {
        const idx = tl.indexOf(tok, from);
        if (idx === -1) break;
        const start = idx;
        const end = idx + 1;
        if (!overlapsAny(protectedIntervals, start, end))
          occs.push([start, end]);
        from = idx + 1;
      }
    }
  }

  occs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // Remove overlaps (keep earliest)
  const out: Array<[number, number]> = [];
  let lastEnd = -1;
  for (const [s, e] of occs) {
    if (s < lastEnd) continue;
    out.push([s, e]);
    lastEnd = e;
  }
  return out;
}

function startMatchSpan(
  text: string,
  tokenRaw: string,
): [number, number] | null {
  if (!tokenRaw) return null;

  const regexPattern = getRegexSeparatorPattern(tokenRaw);
  if (regexPattern !== null) {
    const baseRx = compileRegex(regexPattern, "i");
    const anchored = new RegExp(`^(?:${baseRx.source})`, baseRx.flags);
    const match = text.match(anchored);
    if (!match || match[0].length === 0) return null;
    return [0, match[0].length];
  }

  if (tokenRaw.length > 1) {
    const token = tokenRaw.trim();
    if (!token) return null;
    if (text.length < token.length) return null;

    const head = text.slice(0, token.length);
    if (head.toLowerCase() !== token.toLowerCase()) return null;

    const before = ""; // start boundary
    const after = token.length < text.length ? text[token.length] : "";
    if (before && isWordChar(before)) return null;
    if (after && isWordChar(after)) return null;

    return [0, token.length];
  }

  // Single char delimiter
  if (text.length > 0 && text[0].toLowerCase() === tokenRaw.toLowerCase())
    return [0, 1];
  return null;
}

function dropLeadingDelimiterIfNeeded(
  text: string,
  level: SplitLevel,
): [string, boolean] {
  if (level.keep !== "drop") return [text, false];

  let best: [number, number] | null = null;
  for (const tok of level.separators) {
    const span = startMatchSpan(text, tok);
    if (!span) continue;
    if (!best || span[1] > best[1]) best = span; // pick the longest match
  }
  if (!best) return [text, false];

  const end = best[1];
  return [text.slice(end).trimStart(), true];
}

function pickBestSplitNonGreedy(
  text: string,
  level: SplitLevel,
  protectedIntervals: Array<[number, number]>,
  wordRx: RegExp,
  minWordsPerSide: number,
): [number, number] | null {
  const occs = collectOccurrences(text, level, protectedIntervals);
  if (occs.length === 0) return null;

  const mid = text.length / 2;
  let validBest: { score: number; s: number; e: number } | null = null;
  let anyBest: { score: number; s: number; e: number } | null = null;

  for (const [s, e] of occs) {
    const delimMid = (s + e) / 2;
    const score = Math.abs(delimMid - mid);

    if (!anyBest || score < anyBest.score) anyBest = { score, s, e };

    const [left, right] = applySplit(text, s, e, level.keep);
    if (!left || !right) continue;

    if (minWordsPerSide > 0) {
      if (countWords(left, wordRx) < minWordsPerSide) continue;
      if (countWords(right, wordRx) < minWordsPerSide) continue;
    }

    if (!validBest || score < validBest.score) validBest = { score, s, e };
  }

  const best = validBest ?? anyBest;
  return best ? [best.s, best.e] : null;
}

function greedySplitAll(
  text: string,
  level: SplitLevel,
  protectedIntervals: Array<[number, number]>,
  wordRx: RegExp,
  minWordsPerSide: number,
): string[] | null {
  const occs = collectOccurrences(text, level, protectedIntervals);
  if (occs.length === 0) return null;

  const pieces: string[] = [];
  let cursor = 0;
  let didSplit = false;

  for (const [s, e] of occs) {
    if (s < cursor) continue;

    let leftPiece = "";
    let newCursor = cursor;

    if (level.keep === "left") {
      leftPiece = text.slice(cursor, e).trim();
      newCursor = e;
    } else if (level.keep === "right") {
      leftPiece = text.slice(cursor, s).trim();
      newCursor = s;
    } else {
      leftPiece = text.slice(cursor, s).trim();
      newCursor = e;
    }

    if (!leftPiece) continue;

    const remaining = text.slice(newCursor).trim();
    if (!remaining) continue;

    if (minWordsPerSide > 0) {
      if (countWords(leftPiece, wordRx) < minWordsPerSide) continue;
      if (countWords(remaining, wordRx) < minWordsPerSide) continue;
    }

    pieces.push(leftPiece);
    cursor = newCursor;
    didSplit = true;
  }

  const tail = text.slice(cursor).trim();
  if (tail) pieces.push(tail);

  if (!didSplit || pieces.length < 2) return null;
  return pieces;
}

function whitespaceFallbackSplit(
  text: string,
  wordRx: RegExp,
  minWordsPerSide: number,
): [string, string] | null {
  const s = text.trim();
  if (!s) return null;

  const mid = s.length / 2;
  const wsMatches = [...s.matchAll(/\s+/g)];
  if (wsMatches.length === 0) return null;

  const positions = wsMatches.map((m) => m.index ?? -1).filter((i) => i >= 0);

  const candidates: number[] = [];
  for (const p of positions) {
    const left = s.slice(0, p).trim();
    const right = s.slice(p).trim();
    if (!left || !right) continue;

    if (minWordsPerSide > 0) {
      if (countWords(left, wordRx) < minWordsPerSide) continue;
      if (countWords(right, wordRx) < minWordsPerSide) continue;
    }
    candidates.push(p);
  }

  const pick = (arr: number[]) =>
    arr.reduce(
      (best, p) => (Math.abs(p - mid) < Math.abs(best - mid) ? p : best),
      arr[0],
    );

  if (candidates.length > 0) {
    const p = pick(candidates);
    return [s.slice(0, p).trim(), s.slice(p).trim()];
  }

  // Relax minWordsPerSide
  const p = pick(positions);
  const left = s.slice(0, p).trim();
  const right = s.slice(p).trim();
  if (left && right) return [left, right];

  return null;
}

function splitFragment(
  text: string,
  cfg: Config,
  wordRx: RegExp,
  protectPatterns: string[],
  splitLevelName: string | null = null,
): OutputFragment[] {
  let s = text.trim();
  if (!s) return [];

  const protectedIntervals = getProtectedIntervals(s, protectPatterns);

  for (const level of cfg.split_levels) {
    if (!level.greedy) continue;

    // Drop leading delimiter if keep="drop" (even if the left side would be empty).
    const [s2, changed] = dropLeadingDelimiterIfNeeded(s, level);
    if (changed) {
      return splitFragment(s2, cfg, wordRx, protectPatterns, splitLevelName);
    }

    const pieces = greedySplitAll(
      s,
      level,
      protectedIntervals,
      wordRx,
      cfg.min_words_per_side,
    );
    if (!pieces) continue;

    const out: OutputFragment[] = [];
    for (const p of pieces)
      out.push(...splitFragment(p, cfg, wordRx, protectPatterns, level.name));
    return out;
  }

  if (countWords(s, wordRx) <= cfg.max_words) {
    return [{ text: s, splitLevelName }];
  }

  for (const level of cfg.split_levels) {
    if (level.greedy) continue;

    // Drop leading delimiter if keep="drop" (even if the left side would be empty).
    const [s2, changed] = dropLeadingDelimiterIfNeeded(s, level);
    if (changed) {
      return splitFragment(s2, cfg, wordRx, protectPatterns, splitLevelName);
    }

    const best = pickBestSplitNonGreedy(
      s,
      level,
      protectedIntervals,
      wordRx,
      cfg.min_words_per_side,
    );
    if (!best) continue;

    const [start, end] = best;
    const [left, right] = applySplit(s, start, end, level.keep);
    if (!left || !right) continue;

    return [
      ...splitFragment(left, cfg, wordRx, protectPatterns, level.name),
      ...splitFragment(right, cfg, wordRx, protectPatterns, level.name),
    ];
  }

  // No separators worked.
  if (!cfg.split_on_whitespace_fallback) {
    return [{ text: s, splitLevelName }];
  }

  const ws = whitespaceFallbackSplit(s, wordRx, cfg.min_words_per_side);
  if (!ws) {
    return [{ text: s, splitLevelName }];
  }

  const [left, right] = ws;
  return [
    ...splitFragment(left, cfg, wordRx, protectPatterns, splitLevelName),
    ...splitFragment(right, cfg, wordRx, protectPatterns, splitLevelName),
  ];
}

function splitText(input: string, cfg: Config): string[] {
  const pre = applyRegexSteps(input, cfg.preprocess_steps);

  const wordRx = compileRegex(cfg.word_regex, "gi"); // word counting

  const parts = splitFragment(pre, cfg, wordRx, cfg.protect_patterns);

  const out: string[] = [];
  for (const part of parts) {
    const post = applyRegexSteps(part.text, cfg.postprocess_steps).trim();
    if (!post) continue;

    const prefixes: string[] = [];
    if (cfg.mark_split_level_name && part.splitLevelName) {
      prefixes.push(part.splitLevelName + " ");
    }
    if (cfg.mark_oversized && countWords(post, wordRx) > cfg.max_words) {
      prefixes.push(cfg.oversized_prefix);
    }

    out.push(prefixes.join("") + post);
  }
  return out;
}

function parseArgs(argv: string[]) {
  const args = { config: "", text: "", infile: "", outfile: "" };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = i + 1 < argv.length ? argv[i + 1] : "";

    if (a === "--config") {
      args.config = next;
      i++;
    } else if (a === "--text") {
      args.text = next;
      i++;
    } else if (a === "--infile") {
      args.infile = next;
      i++;
    } else if (a === "--outfile") {
      args.outfile = next;
      i++;
    } else {
      die(`Unknown arg: ${a}`);
    }
  }

  if (!args.config) die("Missing --config <path>");
  const hasText = args.text.length > 0;
  const hasFile = args.infile.length > 0;
  if ((hasText && hasFile) || (!hasText && !hasFile))
    die("Provide exactly one of: --text or --infile");

  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const cfg = loadConfig(args.config);

  const inputText = args.text ? args.text : readTextFileUtf8(args.infile);

  const fragments = splitText(inputText, cfg);
  const output = fragments.join("\n") + (fragments.length ? "\n" : "");

  if (args.outfile) {
    fs.writeFileSync(args.outfile, output, "utf8");
  } else {
    process.stdout.write(output);
  }
}

main();
