# Phase 9: Logical-unit metafile emission

## Status

Phase 9 is implemented in `sdkjs` commit `e6fbf921fd` on the `enhanced-unicode` branch.

The implementation connects Phase 8 logical units to the version-1 command-84 protocol introduced by Phase 7. Enhanced mode remains disabled by default. The ordinary command-83 path is unchanged when the gate is disabled.

## Objective

Transport one complete logical text unit from paragraph shaping through the JavaScript metafile as:

```text
exact editor Unicode
+ logical advance
+ actual page-space visual origin
+ ordered positioned source-GID components
```

without drawing a duplicate per-GID grapheme for the same supported unit.

## Development gate

The export-level development switch is:

```javascript
AscCommon.SetEnhancedUnicodeEnabled(true);
```

It must be set before paragraph shaping and before constructing `CDocumentRenderer`. This enables both sides of the Phase 9 connection:

1. paragraph shaping automatically builds and attaches logical units
2. `CDocumentRenderer` accepts, orders, and emits command 84

The renderer can also be controlled explicitly:

```javascript
renderer.SetTextLogicalUnitsEnabled(true);
```

Disable the feature to restore legacy behavior:

```javascript
AscCommon.SetEnhancedUnicodeEnabled(false);
renderer.SetTextLogicalUnitsEnabled(false);
```

The default is `false`.

## JavaScript protocol writer

`common/Drawings/LogicalUnitMetafile.js` implements the Phase 7 wire contract:

```text
u8     command = 84
u32le  record size including this size field
u8     version = 1
u8     flags = 0
u16le  reserved = 0
u32le  Unicode count
u32le  Unicode scalars[]
i32le  logical advance * 100000
i32le  visual x * 100000
i32le  visual y * 100000
u32le  component count
components[] {
    u32le source GID
    i32le relative x * 100000
    i32le relative y * 100000
}
```

The writer validates the complete unit before modifying metafile memory:

- 1 to 4,096 Unicode scalars
- valid Unicode scalar values without surrogates
- 1 to 4,096 components
- source GIDs in `1..65535`
- finite fixed-point geometry within signed 32-bit range
- nonnegative logical advance
- framed record size no greater than 1 MiB

Invalid units return `false` without writing a partial command.

## Geometry conversion

Phase 8 retains HarfBuzz geometry in raw 26.6 coordinates at `MEASURE_FONTSIZE`. `AscFonts.DrawTextLogicalUnit()` converts it using the same coefficient as ordinary `DrawGrapheme()`:

```text
25.4 / 72 / 64 / MEASURE_FONTSIZE * actual font size
```

The emitted geometry uses:

- the item draw point as the actual independent `VisualX` and `VisualY`
- total shaped X advance as `LogicalAdvance`
- component positions relative to the logical-unit origin
- inverted HarfBuzz Y offsets to match the existing metafile page-coordinate convention

Vertical/nonzero-Y-advance units remain on the legacy path because protocol version 1 contains one horizontal logical advance.

## Source-order emission

Paragraph content enters the bidi flow in source order but is drawn in visual order. Enhanced commands therefore cannot be written immediately.

`CDocumentRenderer` queues accepted logical units with:

- source and visual indexes
- a deep copy of Unicode and component geometry
- source-font name, size, and style
- text brush color

At the end of each paragraph range, the queue is drained in ascending `SourceIndex` order. `VisualIndex` is a deterministic tie-breaker. Before each command, the captured font and text color are restored.

This yields:

```text
PDF/metafile command order: authoritative source order
VisualX/VisualY:             independently positioned visual order
component order:             HarfBuzz visual order within each unit
```

The queue is also flushed before page end and before enhanced mode is disabled.

## Duplicate suppression and legacy behavior

A paragraph item suppresses its ordinary `DrawGrapheme()` call only after the enhanced renderer validates and accepts the logical unit into its queue.

If any of these conditions applies, `AscFonts.DrawTextLogicalUnit()` returns `false` and the existing grapheme path runs:

- enhanced mode is disabled
- the context has no logical-unit capability
- the unit has a nonzero Y advance
- validation fails
- the renderer has no active page or font state
- drawing is temporary, forced, adds a temporary hyphen, uses item gap clipping, or is converting text to paths

Logical metadata is attached only to the one source item that owns the visible cluster grapheme. Re-shaping clears stale metadata. Disabled ordinary shaping does not retain source arrays, component arrays, or per-item logical metadata.

## Files changed in `sdkjs`

Protocol and renderer:

- `common/Drawings/LogicalUnitMetafile.js`
- `common/Drawings/Metafile.js`
- `common/libfont/grapheme.js`

Shaping and paragraph drawing:

- `common/libfont/textshaper.js`
- `word/Editor/Paragraph/TextShaper.js`
- `word/Editor/Paragraph/RunContent/Text.js`
- `word/Editor/Paragraph/draw/content-draw-state.js`

Bundle registration:

- `configs/word.json`
- `configs/cell.json`
- `configs/slide.json`
- `configs/visio.json`
- `common/libfont/test/shaper.html`

Tests:

- `common/Drawings/test/logicalunitmetafile.js`
- `common/Drawings/test/logicalunitgeometry.js`
- `common/Drawings/test/logicalunitdraw.js`

## Focused JavaScript tests

Run from `sdkjs`:

```text
node common/Drawings/test/logicalunitmetafile.js
node common/Drawings/test/logicalunitgeometry.js
node common/Drawings/test/logicalunitdraw.js
node common/libfont/test/logicalunits.js
```

Coverage includes:

- exact command identifier, version header, and framed size
- explicit little-endian field positions
- Unicode sequence transport including a non-BMP scalar
- positive and negative fixed-point geometry with truncation
- multi-component GID order and positioning
- invalid-input memory immutability
- Unicode, component, GID, and geometry limits
- default-disabled and explicit capability gates
- mixed-bidi source-index ordering
- immutable queued unit snapshots
- raw HarfBuzz-to-page coordinate conversion
- vertical-unit legacy fallback
- duplicate suppression after queue acceptance
- unchanged grapheme drawing when enhanced mode rejects a unit
- forced-drawing bypass
- all Phase 8 logical-unit tests

All focused tests passed.

## Build validation

The source dependencies were installed from the pinned lockfile:

```text
cd sdkjs/build
npm ci
```

The real desktop Word Closure bundle compiled successfully:

```text
npx grunt compile-word --desktop
```

The four modified SDK config files also passed JSON parsing, and all changed JavaScript files passed `node --check`.

`npm ci` reported eight existing dependency audit findings: one moderate and seven high. No dependency versions were changed in this phase.

## Native protocol validation

The existing Phase 7 native parser and adapter tests were rerun:

```text
pdf_logical_text_test.exe \
  --gtest_filter=LogicalUnitMetafile.*:LogicalMetafileAdapter.*
```

Results:

```text
18 tests from 2 suites
18 passed
```

The native suite verifies command-84 parsing, bounded framing, fixed-point decoding, all limits, component order, command-83 compatibility, and the complete native record-to-logical-PDF test pipeline.

## Phase boundary

Phase 9 transports logical units but does not activate production logical PDF fonts.

`CPdfWriter::CommandDrawTextLogicalUnit()` still deliberately returns `S_FALSE`. Therefore turning on the development gate for a real PDF export currently proves that validated command-84 units reach the PDF writer, but the export is expected to stop rather than silently split the unit.

Phase 10 must add:

- supported-font and embedding checks
- production `LogicalFontMapper` ownership and resource finalization
- whole-run/font/page/document fallback policy
- handling for ordinary spaces and other non-HarfBuzz text items
- complete corpus export and extraction validation

Until then, leave the gate disabled for normal exports.
