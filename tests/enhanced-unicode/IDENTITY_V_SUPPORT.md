# Enhanced Unicode Identity-V support

## Status

Enhanced Unicode logical fonts support explicit horizontal and vertical PDF writing modes:

```text
Horizontal -> /Encoding /Identity-H
Vertical   -> /Encoding /Identity-V + /DW2 + /W2
```

Horizontal behavior remains backward compatible. Vertical support is selected only by an explicit logical-unit writing mode; rotated horizontal text is not reclassified as vertical writing.

## Logical-unit contract

Native logical units carry:

```cpp
ERendererLogicalWritingMode::Horizontal
ERendererLogicalWritingMode::Vertical
```

JavaScript logical units use:

```javascript
AscFonts.WRITING_MODE.Horizontal
AscFonts.WRITING_MODE.Vertical
```

For vertical shaping, `CTextShaper.SetWritingMode(AscFonts.WRITING_MODE.Vertical)` selects HarfBuzz top-to-bottom direction. Paragraph inline layout uses the magnitude of HarfBuzz's negative Y advance rather than the normally zero X advance, while vertical advances and positioned components remain authoritative.

The renderer transport converts the supported top-to-bottom negative Y advance to a positive inline magnitude while preserving component X/Y positions and the independent visual origin. Bottom-to-top shaping is deliberately rejected by the logical path and uses compatibility drawing.

## Metafile compatibility

Command 84 remains length-bounded and versioned:

```text
version 1
    byte 0: version = 1
    byte 1: 0
    u16:    reserved = 0
    meaning: horizontal

version 2
    byte 0: version = 2
    byte 1: writing mode (0 horizontal, 1 vertical)
    u16:    reserved = 0
```

Horizontal units continue to serialize as version 1. Vertical units serialize as version 2. Readers that understand only version 1 can skip the bounded version-2 record without desynchronizing the remaining metafile.

## PDF font construction

Logical font state is partitioned by:

```text
source font path
+ face index
+ writing mode
```

The same source font therefore creates distinct physical Type 0 fonts when used in both writing modes.

Identity-V descendants contain:

```pdf
/Encoding /Identity-V
/DW2 [0 -1000]
/W2 [1 [w1y v1x v1y ...]]
```

The first implementation writes an explicit vertical metric triplet for every nonzero CID:

```text
w1y = negative logical advance
v1x = 0
v1y = 0
```

The zero vertical origin is intentional: HarfBuzz X/Y offsets are already baked into each synthetic composite component relative to the vertical pen. A second PDF vertical-origin displacement would move the shaped construction twice. Horizontal `/W` remains present because PDF consumers can still require horizontal glyph widths.

Synthetic composites, `/ToUnicode`, `/CIDToGIDMap`, semantic CIDs, compact embedded GIDs, sharding, and deferred font finalization are shared with Identity-H.

## Text serialization

The existing `CTextLine` batching code calculates horizontal X-axis `TJ` adjustments. Identity-V commands therefore bypass horizontal line batching and are emitted at their explicit visual X/Y origins.

This is intentionally conservative. Mode-aware vertical `TJ` batching can be added later without changing the logical-unit or font contracts.

## Reader compatibility

The bundled xpdf reader now recognizes both `Identity-H` and `Identity-V` as identity encodings. Its existing CMap and CID-font code already parses vertical writing mode, `/DW2`, and `/W2`.

## Validation

The production integration fixture creates Identity-H and Identity-V fonts from the same source font and verifies:

- separate logical source-font states and shards
- `/Encoding /Identity-H`
- `/Encoding /Identity-V`
- `/DW2`
- `/W2`
- embedded TrueType fonts
- `/CIDToGIDMap`
- `/ToUnicode`

Generated artifact:

```text
core/build/phase1-msvc/identity-v-logical-unit.pdf
```

Observed inventory:

```text
AAAAAB+Logical  CID TrueType  Identity-H  embedded subset ToUnicode
AAAAAC+Logical  CID TrueType  Identity-V  embedded subset ToUnicode
```

`qpdf --check`, Poppler font inspection, fontTools qualification, and the Phase 11 structural qualifier pass.

## Current limitations

- DrawingML East Asian vertical and Mongolian vertical text automatically select vertical shaping. Existing rotated horizontal Word/table text remains Identity-H.
- Bottom-to-top HarfBuzz shaping is not represented in the first protocol revision and uses compatibility drawing.
- PDF vertical origins are zero because synthetic components already contain authoritative HarfBuzz positioning; source `vhea`/`vmtx` metrics are not parsed.
- Vertical commands are individually positioned and are not yet combined into vertical `TJ` batches.
- Full East Asian vertical-substitution corpus testing and manual viewer selection/copy testing remain follow-up qualification.
- CFF/CFF2, variable fonts, PDF/A, and PDF/UA retain the existing Enhanced Unicode fallback policy.
