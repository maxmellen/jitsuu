# Client Search & Sorting

This document describes how the web client matches, groups, and sorts results
from the in-browser SQLite database.

## Overview

Search results are grouped into three categories and rendered in priority order:

- `字` (keyword matches)
- `音` (jion matches)
- `訓` (jikun matches)

Within each group, results are sorted based on reading match position and then
by fallback rules.

## Query Normalization

The query is normalized into a set of variants:

- Original input
- Hiragana → Katakana
- Katakana → Hiragana

These variants are used for matching across `keyword`, `jion`, and `jikun`.

## Multi-kanji Expansion

If a query contains **two or more CJK ideographs**, the search expands into:

1. The full query (e.g., `由莉`)
2. Each distinct kanji in order (`由`, `莉`)

Results are merged in token order and deduplicated by entry `id`.

## Matching Rules

### Segment-prefix matching

Matching is **prefix-based** and applied to reading segments split by `・`.

For each variant, a segment is considered a match if it **starts with** that
variant. This ensures a query like `か` matches `カン` and `かんむり`, but not
`あか`.

### Parenthetical normalization

Segments are normalized before matching by removing parenthetical variants:

- Full-width parentheses: `（…）`
- ASCII parentheses: `(...)`

Example: `エン（ヱン）` is normalized to `エン`.

## Grouping

Results are grouped into `字`, `音`, and `訓`.

### Gaiji reclassification

Some gaiji entries store a **reading** in `keyword` and render the character as
an image (`gaiji_img_src`). To avoid inflating the `字` group:

- If an entry has `gaiji_img_src` **and** its `keyword` contains no CJK
  ideographs, it is reclassified:
  - If `jion` matches, place it in `音`
  - Else if `jikun` matches, place it in `訓`
  - Else keep it in `字`

## Sorting Rules (within each group)

Sorting is applied after grouping. The primary goal is to prioritize entries
whose **first reading** matches the search term.

### Match index

For a given reading field (`jion` or `jikun`):

- Split into segments by `・`
- Normalize each segment (strip parentheses)
- Find the **first segment index** where the segment starts with any query
  variant
- If none match, the index is `Infinity` (sorted last)

### Group-specific priority

The sort order uses a primary and secondary match index:

- `音` group:
  - Primary: `jion` match index
  - Secondary: `jikun` match index
- `訓` group:
  - Primary: `jikun` match index
  - Secondary: `jion` match index
- `字` group:
  - Primary: `jion` match index
  - Secondary: `jikun` match index

### Fallbacks

If match indices are equal:

1. `jion` (Japanese collation, empty last)
2. `jikun` (Japanese collation, empty last)
3. `id` (ascending)

## Filter-only Behavior

When there is no query and only `字形` filters are applied, the same comparator
is used (match indices are treated as `Infinity`, so the fallback order applies).

## Examples

- Query: `かん`
  - `カン・ガン` ranks above `アン・カン`
- Query: `かん`
  - `エン（ヱン）・カン（クヮン）` matches at index `1` (second reading)
