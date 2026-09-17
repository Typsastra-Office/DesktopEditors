# Phase 10: End-to-end PDF integration and fallback policy

## Status

Phase 10 is implemented in `core` commit `f0d766a85f` on the `enhanced-unicode` branch, covering the production PDF writer and its focused integration tests.

Enhanced Unicode remains disabled by default in `sdkjs`. The existing development switch is still the rollback boundary:

```javascript
AscCommon.SetEnhancedUnicodeEnabled(true);
```

The switch must be enabled before shaping/recalculation and before constructing the export renderer. Disabling it preserves the ordinary command-83 export path.

## Objective

Connect version-1 logical metafile command 84 to production PDF output for supported TrueType units while preserving a documented compatibility path for unsupported fonts, states, and units.

## Production PDF path

`CPdfWriter::CommandDrawTextLogicalUnit()` now performs the complete native integration:

```text
command 84
    -> validate active page and text state
    -> resolve and load source font
    -> enforce embedding rights
    -> convert renderer millimetres to em-relative geometry
    -> plan one logical unit
    -> allocate semantic CID and visual identity
    -> select/create logical-font shard snapshot
    -> build compact synthetic TrueType subset
    -> create production Type 0 PDF font objects
    -> submit one two-byte CID through CCommandManager
```

The emitted font graph contains:

- Type 0 parent font
- `/Identity-H`
- CIDFontType2 descendant
- explicit `/CIDToGIDMap`
- exact sequence-valued `/ToUnicode`
- `/W` widths
- font-derived `FontDescriptor` metrics
- embedded `FontFile2`

The production bridge is implemented in:

- `core/PdfFile/SrcWriter/LogicalPdfFont.h`
- `core/PdfFile/SrcWriter/LogicalPdfFont.cpp`
- `core/PdfFile/SrcWriter/Document.h`
- `core/PdfFile/SrcWriter/Document.cpp`

Both CMake and qmake production builds register the complete logical-font source set.

## Coordinate contract

Command 84 carries two coordinate domains:

- `VisualX` and `VisualY` are absolute renderer coordinates in millimetres
- component offsets and `LogicalAdvance` are relative renderer distances in millimetres

The logical planner expects em-relative advance and component positions. The PDF writer therefore converts only relative geometry:

```text
renderer millimetres
    -> PDF points
    -> divide by active point size
    -> em-relative logical geometry
```

Absolute `VisualX` and `VisualY` continue through the existing command-manager placement and transform path. This preserves page transforms, page-height inversion, color, alpha, resource registration, and graphics ordering.

## Immutable shard snapshots

Logical mappers grow as new semantic or visual identities are encountered, but PDF font objects are immutable after commands reference them.

The initial production strategy creates a new complete logical PDF font whenever a shard's semantic count grows:

```text
snapshot N     remains valid for earlier commands
snapshot N + 1 serves later commands after new CID allocation
```

The writer tracks the published semantic count separately from mapper creation flags. If font rebuilding fails after mapper mutation, the shard remains dirty and a later retry cannot emit the new CID through an older snapshot.

This strategy is correct but can embed multiple progressively larger snapshots. Dirty-shard finalization and batching are performance optimizations for Phase 11.

## Subset names

Generated logical fonts now use a deterministic six-uppercase-letter prefix followed by `+Logical`, for example:

```text
AAAAAB+Logical
```

The six-letter prefix follows the PDF subset naming convention. Rewriting the embedded SFNT `name` table to match the PDF dictionary name remains a conformance follow-up for Phase 11.

## Fallback policy

### Current granularity

The native boundary uses **per-logical-unit compatibility fallback**, with permanent unsupported-source caching at the whole-font level.

Exactly one branch runs for a command-84 unit:

1. logical CID output, or
2. the existing per-GID compatibility output

The first fallback component carries the complete Unicode sequence through `CommandDrawTextCHAR2`; later visual components use the established legacy semantic-space convention.

### Logical eligibility

The production logical path currently requires:

- a valid page
- nonempty Unicode and component arrays
- an ordinary standalone TrueType font
- source face index zero
- permitted preview/print embedding
- no synthetic bold or italic
- positive font size
- zero character spacing
- valid Unicode and geometry
- a representable shard allocation
- successful compact TrueType and Type 0 construction

The following remain on compatibility fallback:

- CFF and CFF2
- variable fonts
- TTC/nonzero face indexes
- restricted embedding
- Base14 or already embedded alternate fonts
- synthetic style state
- nonzero character spacing
- invalid or overflowing logical geometry
- PDF/A output until logical `/CIDSet` support is implemented and qualified

### Atomicity limitation

Phase 9 queues command 84 in source order while ordinary command 83 and graphics operations are immediate. Therefore the current pipeline does **not** provide atomic whole-document fallback.

A document may contain supported logical units and unsupported legacy units. This is intentional for the development path but is not yet suitable for claiming uniform whole-document semantics.

A fully atomic document policy would require preflight or replay before any PDF content is committed. That larger mechanism is deferred rather than being simulated incorrectly.

The compatibility fallback itself also uses the existing sequential per-component renderer calls. Marked-content `/ActualText` and all-or-nothing preflight for multi-component fallback remain follow-up work.

## Diagnostics

Fallback reasons are retained by `CPdfWriter` and exposed through:

```cpp
CPdfWriter::GetLastLogicalTextDiagnostic()
CPdfFile::GetLastLogicalTextDiagnostic()
```

Diagnostics distinguish:

- invalid page or logical unit
- font initialization/path failures
- unsupported active text state
- unsupported face index
- font loading failure
- embedding restriction
- source-byte or units-per-em failure
- logical adapter validation failure
- sharding failure
- missing shard
- Type 0 construction failure
- PDF object bridge failure
- unqualified PDF/A output

The diagnostic is cleared after successful logical emission. Permanently unsupported source fonts cache their reason together with their unsupported status.

## Text serialization strategy

The first production integration submits one logical CID per command-84 call through `CCommandManager`.

This intentionally reuses the established machinery for:

- transforms
- font resources
- text color and alpha
- page placement
- content ordering

Phase 6 source-order `Tj`/`TJ` serialization remains proven, but command 84 currently has no run or boundary identifier. Cross-command batching would therefore risk crossing state boundaries. Integrating Phase 6 batching is deferred until the transport supplies safe run boundaries.

## Production integration test

`core/PdfFile/tests/LogicalText/LogicalPdfWriterIntegrationTest.cpp` exercises the exported production renderer rather than an isolated reconstruction:

1. initialize application fonts from the committed FontAwesome TrueType fixture
2. create a real `CPdfFile`
3. set the source path, face, size, and GID mode
4. submit a two-component logical unit with Unicode `U+0041 U+0301`
5. verify successful logical emission and an empty diagnostic
6. force unsupported character-spacing state
7. verify compatibility fallback and its diagnostic
8. save the PDF
9. verify the Type 0, Identity-H, CIDFontType2, CIDToGIDMap, and ToUnicode objects
10. verify no default Helvetica font is injected

The aggregate result is:

```text
104 tests from 13 suites
104 passed
```

## PDF artifact validation

Generated artifact:

```text
core/build/phase1-msvc/phase10-production-logical-unit.pdf
```

`qpdf --check` result:

```text
PDF Version: 1.7
No syntax or stream encoding errors found
```

A QDF inspection confirms the logical font and exact sequence mapping:

```text
/BaseFont /AAAAAB+Logical
<0001> <00410301>
/FontName /AAAAAB+Logical
```

No `/BaseFont /Helvetica` entry is present.

Poppler `pdftotext` returns `A` rather than retaining the combining scalar even though the CMap contains exact `00410301`. This is recorded as a consumer extraction/normalization result for the Phase 11 interoperability matrix; it is not a loss in the generated `/ToUnicode` data.

## Build validation

The production target compiled and linked successfully with MSVC:

```text
cmake --build . --target PdfFile --config Release
```

The logical test executable also compiled and linked against the real `PdfFile` target. Existing compiler warnings remain, but no new build error is present.

## Files changed in `core`

Production integration:

- `PdfFile/PdfFile.cpp`
- `PdfFile/PdfFile.h`
- `PdfFile/PdfWriter.cpp`
- `PdfFile/PdfWriter.h`
- `PdfFile/SrcWriter/Document.cpp`
- `PdfFile/SrcWriter/Document.h`
- `PdfFile/SrcWriter/LogicalPdfFont.cpp`
- `PdfFile/SrcWriter/LogicalPdfFont.h`

Build registration:

- `PdfFile/CMakeLists.txt`
- `PdfFile/PdfFile.pro`

Tests:

- `PdfFile/tests/LogicalText/CMakeLists.txt`
- `PdfFile/tests/LogicalText/LogicalPdfWriterIntegrationTest.cpp`

## Known limitations and Phase 11 handoff

- Enhanced Unicode remains default-off.
- Controlled export must enable the gate before shaping and renderer construction.
- Spaces, NBSP, tabs, numbering, math, breaks, temporary glyphs, forced glyphs, gaps, and text-to-path paths are not uniformly represented as logical units.
- Mixed logical and legacy units are possible; whole-document preflight is not implemented.
- Compatibility fallback does not yet use `/ActualText` for visual-only components.
- CFF/CFF2, variable fonts, TTC faces, and PDF/A logical fonts remain unsupported.
- The immutable snapshot strategy can increase font count, PDF size, and export cost.
- The embedded subset `name` table is not yet rewritten to the generated subset name.
- Command 84 has no run boundary or explicit source-font identity.
- Rendering comparison, selection behavior, broad bidi corpus export, veraPDF, embedded-font validation, and performance measurements belong to Phase 11.

## Phase boundary

Phase 10 establishes a real, testable production path and a safe default-off rollback boundary. It does not declare Enhanced Unicode ready as the default exporter. That decision requires the Phase 11 conformance, interoperability, extraction, rendering, and performance matrix.
