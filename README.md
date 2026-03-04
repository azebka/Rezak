# Rezak

`rezak.ts` is a small Node.js CLI tool that cleans and splits English text into short fragments using a configurable set of rules defined in `rezak.yaml`.

It is designed for text that looks like subtitle lines, dialogue, or speech transcripts, where you want compact, readable output lines instead of long sentences.

## What The Script Does

The script processes input in four stages:

1. Preprocess the raw text
2. Split it into fragments
3. Postprocess each fragment
4. Mark fragments that are still too long

## Processing Flow

### 1. Preprocessing

Before splitting, the script applies regex-based cleanup rules from `preprocess_steps` in `rezak.yaml`.

With the current config, this includes:

- Removing subtitle index lines such as `49`
- Removing SubRip timecodes such as `00:02:24,530 --> 00:02:28,910`
- Replacing newlines with spaces
- Normalizing ellipses
- Removing bracketed tags like `[Music]`
- Collapsing repeated whitespace
- Trimming leading and trailing whitespace
- Replacing long dashes (`–`, `—`) with a normal hyphen (`-`)

## 2. Splitting Logic

The script counts words using the regex from `word_regex`.

The current config uses:

- `max_words: 8`
- `min_words_per_side: 1`

That means the preferred target is fragments with no more than 8 words, and when a split is made, both sides should contain at least 1 word whenever possible.

### Greedy Levels

Split levels marked with `greedy: true` are applied first and are attempted even when the fragment is already shorter than `max_words`.

This means a greedy separator can force a split regardless of fragment length.

Example:

- `Hello. World.` can still be split into two lines because sentence-ending punctuation is configured as a greedy split level.

### Non-Greedy Levels

If no greedy split applies, the script checks whether the fragment is already short enough.

- If the fragment is within `max_words`, it is kept as-is.
- If it is too long, the script tries non-greedy split levels in priority order.

For non-greedy levels, the script picks the best split point, usually the one closest to the middle of the fragment.

### Split Priority

The current config tries separators in this general order:

- Sentence endings: `.`, `;`, `?`, `!`
- Colon: `:`
- Comma: `,`
- Spaced dash: ` - `
- Specific words or phrases such as `and`, `then`, `but`, `to`, `you`, `with`, `that`

Each level also defines how the separator is handled:

- `keep: left` keeps the separator on the left fragment
- `keep: right` keeps the separator on the right fragment
- `keep: drop` removes the separator from both fragments

### Protected Patterns

The script avoids splitting inside protected matches from `protect_patterns`.

With the current config, this includes:

- Titles like `Mr.` or `Dr.`
- Abbreviations like `e.g.` or `i.e.`
- Acronyms like `U.S.`
- Decimal numbers like `3.14`
- Numbers with thousands separators like `1,000.25`
- URLs
- Email addresses

This prevents incorrect splits on punctuation that is part of a protected token.

### Whitespace Fallback

If no configured separator works, the script can optionally split on whitespace near the middle.

In the current config:

- `split_on_whitespace_fallback: false`

So whitespace fallback is disabled.

## 3. Postprocessing

After splitting, the script applies `postprocess_steps` to each fragment.

With the current config, this includes:

- Removing trailing periods
- Removing trailing semicolons
- Removing leading dialogue hyphens like `- Hello`
- Normalizing repeated hyphens
- Collapsing repeated whitespace
- Trimming whitespace
- Inserting a space after commas when needed

## 4. Oversized Fragments

If a fragment is still longer than `max_words` after all split attempts, it can be marked as oversized.

In the current config:

- `mark_oversized: true`
- `oversized_prefix: "[OVERSIZED] "`

So long fragments that could not be split are kept and prefixed with `[OVERSIZED] `.

## Input And Output

The script accepts either:

- Direct text via `--text`
- A file via `--infile`

It outputs:

- To stdout by default
- Or to a file when `--outfile` is provided

Each final fragment is written on its own line.

## CLI Usage

The script requires:

- `--config <path>`
- One input source:
- `--text <string>` or `--infile <path>`

Optional:

- `--outfile <path>`

## Example Commands

Install the runtime dependencies:

```bash
npm install tsx yaml
```

Run with a text file:

```bash
node --import tsx rezak.ts --config rezak.yaml --infile input.txt
```

Run with inline text:

```bash
node --import tsx rezak.ts --config rezak.yaml --text "Hello, how are you? I'm fine."
```

Write output to a file:

```bash
node --import tsx rezak.ts --config rezak.yaml --infile input.txt --outfile output.txt
```

You can also use:

```bash
npx tsx rezak.ts --config rezak.yaml --infile input.txt
```

## Current Configuration Summary

With the provided `rezak.yaml`, the script is optimized for:

- Cleaning subtitle-style input
- Splitting English text into short lines
- Preserving common abbreviations and structured tokens
- Preferring punctuation-based splits before word-based splits
- Applying greedy sentence-level splits even for short text

## Files

- `rezak.ts`: the CLI script
- `rezak.yaml`: splitting and cleanup rules
- `input.txt`: example input file
