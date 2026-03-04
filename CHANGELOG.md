# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [1.2.0] - 2026-03-04

### Added

- Added optional split-level prefixes via `mark_split_level_name`, allowing output lines to include the matching `split_levels.name`.

### Changed

- Removed the `split_level_prefix` setting. When split-level prefixes are enabled, the script now uses the raw `split_levels.name` value followed by a space.
- Updated `README.md` to document the simplified split-level prefix behavior and its interaction with oversized markers.

## [1.1.0] - 2026-03-04

### Added

- Added `README.md` with English documentation for the CLI tool, configuration format, processing flow, and usage examples.
- Added support for regex-based separators in `split_levels.separators` via `re:` and `regex:` prefixes.

### Changed

- Updated the splitting flow so `greedy: true` levels are attempted before the `max_words` check.
- Greedy separators now split fragments even when the fragment is already within the configured `max_words` limit.
- Current documentation and examples now reference `rezak.ts` and `rezak.yaml`.

### Fixed

- Renamed the internal `protected` identifier to `protectedIntervals` to avoid ECMAScript module parsing errors caused by the reserved word `protected`.
