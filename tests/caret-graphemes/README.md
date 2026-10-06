# Complex script caret movement fixture

Checks that caret movement, selection endpoints and mouse placement stop on
grapheme cluster boundaries for every script we support, not just Latin.

The fixture is deliberately split from the implementation. It does not ask
`Intl.Segmenter` what the answer should be at test time, because that only
proves the editor agrees with whichever ICU is installed in the runtime. That
is exactly how a real defect survived an earlier test: the development machine
had a newer ICU that already merged the Khmer sequence, so a broken merge
looked correct. The expected stops are frozen in `cases.json` and reviewed by a
human instead.

## Files

| File | Purpose |
| --- | --- |
| `cases.json` | The fixture: text, the ICU clusters it is expected to start from, and the caret stops we require. |
| `generate-cases.mjs` | Regenerates `cases.json`. Run it only when deliberately changing the fixture. |
| `docx.mjs` | Dependency-free DOCX writer (ZIP + CRC32). One paragraph per case. |
| `cdp.mjs` | Minimal Chrome DevTools Protocol client, plus the probe evaluated in the editor. |
| `run.mjs` | The runner. Two modes, see below. |

## Running

Unit mode is fast, needs no editor, and exercises the caret helpers in
`Paragraph.js` directly:

```powershell
node tests/caret-graphemes/run.mjs --unit
```

Runtime mode drives the real desktop editor, which is the only place the ICU
that actually ships is involved:

```powershell
node tests/caret-graphemes/run.mjs
```

It writes a fixture document, launches the development build with
`--remote-debugging-port=9222`, reads the caret stops back over CDP and compares
them with the fixture. Options:

- `--app <path>` — which `DesktopEditors.exe` to use. Defaults to the
  `onlyoffice` development build under `build_tools/out/win_64`.
- `--port <n>` — debugging port, default `9222`.
- `--filter <text>` — only run cases whose id contains the text.
- `--keep` — do not kill the editor afterwards. Also used to attach to an
  editor that is already running.
- `--emit-docx <path>` — write the fixture document and exit.

To launch the editor yourself and then attach (useful when the runner's own
launch misbehaves in a shell):

```powershell
node tests/caret-graphemes/run.mjs --emit-docx "$env:TEMP\caret-fixture.docx"
& "...\DesktopEditors.exe" --remote-debugging-port=9222 "$env:TEMP\caret-fixture.docx"
node tests/caret-graphemes/run.mjs --keep
```

## What a case looks like

```json
{
  "id": "km-coeng",
  "tier": "cluster",
  "script": "Khmer",
  "note": "Coeng (U+17D2) subscript must not be split from its base.",
  "cps": [6017, 6098, 6040, 6082, 6042],
  "icuClusters": [[0, 2], [2, 4], [4, 5]],
  "expected": [0, 4, 5],
  "clusters": [["1781", "17D2", "1798", "17C2"], ["179A"]]
}
```

- `cps` is the paragraph text as code points. Positions everywhere in this
  fixture are **code point indices**, which is the unit the editor addresses run
  elements in. `Intl.Segmenter` reports UTF-16 offsets, so anything coming from
  it has to be converted.
- `icuClusters` is what the ICU shipped in the desktop runtime reports, in code
  point ranges. It splits straight after each Khmer Coeng, because UAX #29 has
  no Khmer rule.
- `expected` is the caret stops we require, that is `icuClusters` after the
  Coeng merge. Its length is the number of clusters plus one, since a stop sits
  on each boundary.
- `clusters` is the same segmentation written out for review.

`tier` is `cluster` for a short case that isolates one rule, or `sentence` for a
real sentence borrowed from `tests/enhanced-unicode/corpus.json`. Sentence cases
matter because they put word boundaries, spaces, punctuation and long runs of
adjacent clusters in play, and they exercise the bounded scan the caret uses.

## Why unit mode is not enough on its own

Unit mode replays `icuClusters` through a stub segmenter rather than calling the
host `Intl`. That is what makes the Coeng rule testable: on a machine whose ICU
already merges the sequence, calling the real `Intl.Segmenter` would hide a
broken merge. The stub means unit mode fails on such a machine too.

Unit mode still cannot see differences between one ICU version and another,
because it is fed the fixture's own clusters. Runtime mode is the authoritative
check, and it is the mode that caught the Coeng merge silently regressing in the
first place.

## Adding a case

1. Add the text to `generate-cases.mjs` (as code points for cluster cases, or
   reuse a corpus sentence for a sentence case).
2. Decide what the caret stops **should** be. Do not simply record what the
   editor currently does.
3. Run `node tests/caret-graphemes/generate-cases.mjs` and review the diff.
4. Run both modes.

A new case is a claim about what a reader expects. If the editor disagrees,
that is the finding.

## Known behaviour worth knowing

- Khmer Coeng sequences are merged by an explicit rule because UAX #29 has none.
  The runtime ICU splits them; modern ICU merges them. The rule is what makes
  the two agree.
- Arabic lam-alef (`لا`) is two caret stops, matching UAX #29, Chrome and Word.
  It is listed in the fixture as `ar-lam-alef` so the choice is visible.
- Gurmukhi nukta (`pa-nukta`) keeps the spacing letter separate, again per
  UAX #29.
- The desktop editor executes the V8 snapshot `sdk-all.bin`, not `sdk-all.js`,
  and it uses the snapshot without a staleness check. After changing
  `Paragraph.js`, rebuild the bundles, copy them into the runtime and rerun
  `x2t.exe -create-js-snapshots` from the app's `converter` directory, or the
  editor keeps running the old code and this fixture will fail.
