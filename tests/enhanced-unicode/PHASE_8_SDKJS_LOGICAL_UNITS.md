# Phase 8: Authoritative `sdkjs` logical units

## Status

Phase 8 is implemented in `sdkjs` commit `4f8209a901` on the `enhanced-unicode` branch.

The implementation is opt-in and has no production caller yet. It does not emit the logical metafile command introduced in Phase 7 and does not alter PDF output.

## Objective

Construct export-only logical text units at the HarfBuzz cluster boundary while keeping authoritative editor Unicode independent from presentation transforms, font fallback substitution, cached screen graphemes, and per-GID Unicode distribution.

## Implementation

### Authoritative source scalars

`CTextShaper.AppendToString()` now distinguishes three values:

```text
editor-source scalar
    -> optional presentation transform
    -> optional font fallback substitution
    -> HarfBuzz input scalar
```

The editor-source scalar is stored in `BufferCodePoints` before the item is sent to HarfBuzz. `engine.js`'s existing global `CODEPOINTS` array continues to describe shaping input and is not used as authoritative export text.

`CTextShaper.GetSourceCodePoint()` defaults to `GetCodePoint()` for existing shapers. `CParagraphTextShaper` overrides it so caps and small-caps presentation transforms do not replace authored lowercase Unicode.

Masked paragraph controls are an intentional security exception: their mask scalar remains authoritative so PDF metadata cannot expose protected underlying text.

### Source positions

Every item appended while logical-unit collection is enabled receives a monotonically increasing `SourceIndex`. The index survives HarfBuzz segment boundaries caused by script, direction, font, or buffer changes.

Each cluster records the source index of the first scalar in its authoritative source span. `GetLogicalUnits()` returns a sorted copy using this index, making source-order traversal explicit rather than relying on HarfBuzz's output order.

This matters for RTL shaping:

```text
HarfBuzz traversal: visual order
LogicalUnits array: collection/visual order
GetLogicalUnits(): authoritative source order
```

`SegmentIndex` identifies the shaping segment and `VisualIndex` records HarfBuzz traversal order for diagnostics.

### Visual construction

At every HarfBuzz cluster boundary, `engine.js` constructs a visual record before the existing grapheme cache distributes code points:

```text
LogicalUnit {
    Unicode
    SourceIndex
    VisualIndex
    SegmentIndex
    FontId
    FontStyle
    LogicalAdvanceX
    LogicalAdvanceY
    VisualX
    VisualY
    Components [{ Gid, X, Y }]
}
```

Coordinates and advances are retained in HarfBuzz's raw 26.6 values at the existing `MEASURE_FONTSIZE`. Phase 9 will convert these values to renderer coordinates when writing the native metafile payload.

`VisualX` and `VisualY` are the independent visual pen origin within the shaping segment. Component `X` and `Y` positions are relative to the unit origin and include the shaped component offset plus preceding component advances. Components remain in HarfBuzz visual order.

### Opt-in lifecycle

Logical-unit collection is disabled by default:

```javascript
shaper.BeginLogicalUnits(optionalDiagnostic);
shaper.Shape(...);
const units = shaper.EndLogicalUnits();
```

`optionalDiagnostic` may be either:

- a callback receiving each unit in visual collection order
- `true`, which logs source index, visual index, segment, Unicode, origin, and components

Diagnostics only observe the parallel logical-unit representation. They do not alter grapheme creation or drawing.

## Files changed in `sdkjs`

- `common/libfont/textshaper.js`
  - stores authoritative source scalars and monotonic source indexes
  - exposes the opt-in collection and diagnostic lifecycle
  - associates cluster scalar counts with source-buffer spans
  - returns logical units in explicit source order
- `common/libfont/engine.js`
  - captures cluster advances, visual origins, and positioned GID components
  - flushes logical units before the existing grapheme semantic distribution
- `word/Editor/Paragraph/TextShaper.js`
  - separates editor-source Unicode from caps/small-caps presentation shaping
  - preserves masking as a security boundary
- `common/libfont/test/logicalunits.js`
  - provides focused Node-based logical-unit tests

## Preserved behavior

The following paths remain unchanged:

- `AscFonts.InitGrapheme()` and `AscFonts.AddGlyphToGrapheme()`
- `AscFonts.GetGrapheme()` and the font/GID visual cache
- `FillCodePoints()` and existing per-GID screen-rendering semantics
- all `FlushGrapheme()` overrides
- metafile command emission
- native renderer parsing
- PDF font selection and serialization

When collection is disabled, no logical source metadata or visual component arrays are retained.

## Tests

Run from the `sdkjs` repository:

```text
node common/libfont/test/logicalunits.js
node --check common/libfont/engine.js
node --check common/libfont/textshaper.js
node --check word/Editor/Paragraph/TextShaper.js
node --check common/libfont/test/logicalunits.js
```

Covered cases:

- logical collection disabled by default
- font substitution preserving authoritative source Unicode
- caps-style presentation transformation preserving editor-source Unicode
- Latin multi-scalar ligature spans
- multi-GID visual component order and positions
- combining sequences
- emoji ZWJ and variation-selector sequences
- canonical distinction between composed and decomposed input
- RTL visual traversal returned in authoritative source order
- mixed LTR/RTL segments using stable monotonic source indexes
- diagnostics disabled by default and output-neutral when enabled

## Results

All focused tests passed:

```text
Enhanced Unicode logical-unit tests passed
```

All four changed JavaScript files passed `node --check`. Zed diagnostics reported no errors or warnings in the changed production files.

## Phase boundaries

Phase 8 deliberately does not:

- define or emit command 84 in `sdkjs`
- send logical units through `Metafile.js`
- convert raw HarfBuzz geometry to renderer coordinates
- activate `LogicalFontMapper` in production PDF export
- change ordinary grapheme drawing

Those integrations belong to Phases 9 and 10.

## Remaining end-to-end validation

The builder is ready for an export caller, but full corpus diagnostics cannot yet be captured through the native export pipeline because Phase 9 emission is intentionally absent. Phase 9 should enable collection around export shaping, convert each segment's visual origin to drawing coordinates, and compare emitted units against the Phase 0 corpus before changing production PDF font allocation.
