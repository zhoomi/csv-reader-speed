# Read broken CSV files faster, 21 November 2026

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/zhoomi/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/zhoomi/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A fast drop-in for **csv-reader 1.0.0** (make.fun's own CSV reader), written for the
[make.fun bounty "Read broken CSV files faster, 21 November 2026"](https://make.fun/bounty/csv-reader-speed-01-run-20261121).
`run(input)` returns exactly what csv-reader 1.0.0 returns for `{text, header}` —
`{columns, rows, errors}` — for every input, including all the broken-row cases:
BOM, CRLF mixed with LF, stray CRs, doubled quotes, quote junk, unterminated
quotes, short and long rows. One wrong case and an entry is not timed, so
correctness comes first and speed second.

## How it is fast

The reference builds every field a character at a time. This reader instead:

- **Finds each field's end first and slices it once.** An unquoted field is
  scanned for its terminator (comma, line break, or stray CR) and produced
  with a single `slice`, instead of appending one character at a time.
- **Takes a whole clean record at a time.** When a record holds no quote and
  no stray CR — the common case — its fields come from one native `split(',')`
  over a single slice, instead of a field-by-field loop.
- **Allocates nothing per field but the field itself.** The field readers
  return the string directly and report how the field ended through two shared
  variables, instead of allocating a result object per field (the biggest
  allocation in the hot path, and the garbage collection it causes).
- **No regex anywhere in the hot path.** Delimiters are found with `indexOf`
  and `charCodeAt` only.

`main.ts` turns off V8's incremental marking before importing `solve.js`,
the same flag the house baseline runs with.

## Correctness

Verified against csv-reader 1.0.0 (the reference in
`baselines/csv-reader/vendor/csv-reader/index.js`):

- All 6 practice cases identical to `practice/reference/expected.json`.
- 695 further cases — 600 generated with the kit's own generator across 100
  seeds plus 95 hand-crafted edge cases (unterminated quotes, stray CRs,
  quote junk, short/long rows, header true/false, BOM, mixed CRLF/LF, empty
  fields) — **0 differences** from the reference.

## Speed

CPU time on the same machine, `--no-incremental-marking`, trimmed mean:

| set | this reader | csv-reader 1.0.0 | speedup |
| --- | --- | --- | --- |
| practice (6 cases, 10.19 MB) | 137 ms | 628 ms | **4.56x** |
| generated (12 cases, 20.75 MB) | 342 ms | 1103 ms | **3.23x** |

## How to run

```sh
# the harness runs the driver; it reads /input/cases.json and writes /output/answers.json
node main.ts

# outside a container, point it at your own directories
MAKEFUN_INPUT_DIR=./input MAKEFUN_OUTPUT_DIR=./output node main.ts
```

`main.ts` reads every case from `cases.json` (a JSON array of `{id, input}`),
answers each one alone with `run()` from `solve.js`, and writes `answers.json`
(a JSON array of the answers, one per case and in the cases' order).

## Files

- `solve.js` — the parser. Dependency-free ES module, exports `run(input)`.
- `main.ts` — the driver the harness runs.
- `README.md` — this file.
- `LICENSE` — MIT.
