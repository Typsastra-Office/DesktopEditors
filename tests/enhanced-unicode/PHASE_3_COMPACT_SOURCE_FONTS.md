# Phase 3 compact source-backed TrueType fonts

## Status

Phase 3 completed on 2026-08-31.

The implementation is committed as `6714ccd998` on the `enhanced-unicode` branch of the `core` fork, based on Phase 2 commit `bfd601292d`. The top-level `DesktopEditors` repository records the Phase 3 revision through its `core` submodule pointer.

This phase remains a parallel, test-only logical-font path. It has no production callers and does not modify ordinary PDF font allocation or rendering.

## Objective

Prove that manually constructed source-backed logical units can produce a compact, valid TrueType `glyf` font and the material required by a PDF Type 0 font without synthetic glyph construction.

A source-backed visual is accepted only when it is exactly one existing, unshifted source glyph with its nominal source advance:

```text
logical semantic CID
    -> logical visual record
    -> compact embedded GID
    -> existing source glyph outline
```

Different semantic CIDs may share one compact embedded GID while retaining distinct exact Unicode mappings.

## Work completed

### Compact TrueType subset builder

Added:

- `core/PdfFile/SrcWriter/LogicalTrueTypeSubset.h`
- `core/PdfFile/SrcWriter/LogicalTrueTypeSubset.cpp`

`TryBuildSourceBackedLogicalTrueType()` accepts a standalone static TrueType SFNT with `glyf` outlines and produces a compact derived font.

The parser validates the SFNT flavor and required tables, including:

- `head`
- `hhea`
- `maxp`
- `hmtx`
- `loca`
- `glyf`

The initial implementation deliberately rejects:

- TrueType collections
- OpenType CFF fonts
- variable TrueType fonts carrying variation tables
- missing, malformed, or unsupported required table data
- source GID 0 as a normal visual
- invalid or unsupported logical visual constructions

The source font's `unitsPerEm` is retained in the subset result for PDF metric conversion.

### Source-backed classification

A visual is source-backed in Phase 3 only when all of these conditions hold:

- it contains exactly one component
- its X and Y component offsets are zero
- its source GID is between 1 and `maxp.numGlyphs - 1`
- its logical advance equals the source glyph's nominal `hmtx` advance

Positioned components, changed advances, and multi-component visuals remain unsupported. They are inputs to Phase 4 synthetic glyph construction rather than approximations in Phase 3.

### Compact GID allocation

Embedded GID 0 remains reserved for `.notdef`.

Used source GIDs are assigned deterministic compact GIDs in encounter order. A high source GID therefore consumes one compact entry rather than forcing the derived font to retain the source font's complete GID range.

The result exposes:

- source GID to compact GID
- visual-record ID to compact GID
- semantic CID to compact GID

Semantic and visual allocation remain independent. Multiple semantic CIDs can point to the same visual record and compact GID.

### Source composite closure

Existing source composite glyphs remain source-backed. The builder computes their complete transitive source-glyph dependency closure.

Dependency traversal is iterative rather than recursive, so a deeply nested source font cannot exhaust the C++ call stack. Active and completed states detect dependency cycles and return a structured `CompositeCycle` error.

Composite component GIDs inside copied `glyf` records are rewritten to their compact embedded GIDs.

### Rebuilt TrueType tables

The compact font rebuilds or updates:

- `glyf`
- long-format `loca`
- `hmtx`
- `hhea`
- `maxp`
- `head`
- minimal `cmap`
- format-3 `post`

The writer:

- sorts table records deterministically
- aligns table data to four-byte SFNT boundaries
- calculates table checksums
- calculates `head.checkSumAdjustment`
- emits a whole-font checksum of `0xB1B0AFBA`

Long and short source `loca` formats are accepted. The output always uses long `loca` so compact rebuilding does not depend on the short-offset size limit. Source `loca` offsets must be ordered, within `glyf`, and two-byte aligned.

### Optional-table policy

The derived font safely copies selected global or non-GID-indexed tables when present:

- `name`
- `OS/2`
- `cvt `
- `fpgm`
- `prep`
- `gasp`

The builder deliberately drops layout tables whose glyph-indexed contents would become stale after compact remapping:

- `GSUB`
- `GPOS`
- `GDEF`

The PDF paints already-shaped compact GIDs, so the derived font is not expected to shape text again.

### Test-only Type 0 font materialization

Added:

- `core/PdfFile/SrcWriter/LogicalType0Font.h`
- `core/PdfFile/SrcWriter/LogicalType0Font.cpp`

`TryBuildLogicalType0Font()` creates the independently testable material required by a Type 0 PDF font:

- compact `FontFile2` bytes
- explicit big-endian `/CIDToGIDMap` bytes
- PDF `/W` values
- exact `/ToUnicode` CMap text
- metadata identifying `/Identity-H` and `CIDFontType2`

The implementation is intentionally not connected to `CFontCidTrueType`, `CPdfWriter`, or the PDF object graph yet.

### PDF width normalization

Logical visual identity and source-backed validation remain in source-font units.

PDF CID widths are converted to 1000-unit text space with deterministic nearest-integer rounding:

```text
pdf_width = round(source_width * 1000 / units_per_em)
```

This distinction was found while validating the generated PDF fixture. Reusing raw source `hmtx` units in `/W` is incorrect when `unitsPerEm` is not 1000.

### Exact `/ToUnicode`

Each nonzero semantic CID maps to its own exact Unicode scalar sequence.

The CMap writer supports:

- multiple Unicode scalars per CID
- supplementary scalars encoded as UTF-16 surrogate pairs
- distinct Unicode sequences sharing one compact GID
- `beginbfchar` blocks limited to 100 mappings

CID 0 is not emitted as a normal semantic mapping.

### Build integration

Updated:

- `core/PdfFile/CMakeLists.txt`
- `core/PdfFile/tests/LogicalText/CMakeLists.txt`

The new implementation is compiled into `PdfFile.dll`, but no existing PDF code calls it. The focused GoogleTest target is the only caller in Phase 3.

## Test coverage

Added:

- `core/PdfFile/tests/LogicalText/LogicalTrueTypeSubsetTest.cpp`
- `core/PdfFile/tests/LogicalText/LogicalType0FontTest.cpp`

### Compact source fonts

Tests cover:

- deterministic low-GID compaction
- source GID 65,000 compacting to embedded GID 1
- exclusion of unused source GIDs from the compact namespace
- nested source-composite dependency closure
- component-GID rewriting inside copied composite glyphs
- a 4,096-glyph dependency chain without recursive traversal
- source-composite cycle rejection
- long source `loca` through the committed Font Awesome fixture
- short source `loca` through the committed Material Icons fixture
- valid whole-font checksums
- deterministic derived-font bytes and mappings
- deliberate removal of `GSUB`, `GPOS`, and `GDEF`

### Source-backed restrictions

Tests reject:

- positioned source components
- changed logical advances
- source GID 0
- CFF-flavored OpenType input
- variable TrueType input
- invalid source glyph references
- malformed tables and composite relationships covered by the parser tests

### Type 0 mappings

Tests cover:

- `/Identity-H` and `CIDFontType2` metadata
- explicit CID-to-GID mapping
- multiple semantic CIDs sharing one compact GID
- normalized PDF widths
- exact BMP Unicode mappings
- exact supplementary Unicode mappings
- bounded 100-entry `beginbfchar` blocks
- CID 0 exclusion
- invalid Unicode scalar rejection
- empty semantic text rejection
- generated PDF fixture serialization

## Review findings

A focused independent review found two material issues before completion:

1. Variable TrueType fonts were accepted and then had their variation tables dropped. The parser now rejects fonts carrying supported variation-table signatures, and a regression test covers `fvar` input.
2. Composite closure used recursive depth-first traversal. It now uses an explicit stack, retains cycle detection, and is tested with a 4,096-glyph chain and a self-cycle.

The review also identified that the generated PDF fixture lacked the required six-uppercase-letter subset prefix. Its Type 0 font, descendant font, and descriptor now consistently use `ABCDEF+Phase3Subset`.

The following parser-hardening items remain outside the Phase 3 exit criteria:

- source table checksum verification
- broad fuzzing of malformed SFNT input

All reads used for subset construction are bounds-checked, and generated outputs are independently parsed. These residual items should be addressed before treating arbitrary untrusted font bytes as a security boundary.

## Validation environment

- Operating system: Windows
- Compiler: MSVC 19.44 through Visual Studio 2022 17.14
- Build system: CMake with Ninja
- Test framework: GoogleTest 1.17.0
- strict font parser: fontTools 4.61.1
- PDF validation: qpdf and Poppler tools
- build configuration: Release

The isolated build remains under ignored `core/build/phase1-msvc` output.

## Results

### Focused CTest target

Commands:

```text
cmake --build build/phase1-msvc --target pdf_logical_text_test --config Release
ctest --test-dir build/phase1-msvc -R pdf_logical_text_test --output-on-failure
```

Result:

```text
1/1 Test #7: pdf_logical_text_test ............ Passed
100% tests passed, 0 tests failed out of 1
```

The expanded executable result is:

```text
40 tests from 6 test suites
40 passed
```

This includes all Phase 1 and Phase 2 tests plus eleven compact-subset tests and four Type 0 materialization tests.

### Strict font parsing

fontTools 4.61.1 opened all generated fonts with strict checksum checking:

```text
phase3-fontawesome.ttf ok
phase3-material-icons.ttf ok
phase3-nested-composite.ttf ok
```

The files are generated into the ignored focused-test output directory.

### PDF syntax and extraction

`qpdf --check phase3-source-backed.pdf` reported:

```text
No syntax or stream encoding errors found
```

The fixture emits two semantic CIDs with exact mappings to `A` and `B` while both CIDs share one visible embedded GID.

Normal Poppler extraction:

```text
AB
```

Raw Poppler extraction:

```text
AB
```

Poppler rasterization succeeded and visibly painted two copies of the shared source glyph at the expected horizontal positions.

### Production build

The existing production PDF target compiled and linked successfully with the new files:

```text
cmake --build . --target PdfFile --config Release
```

The build emitted existing third-party compiler warnings but no Phase 3 build error.

### Static checks

- `git diff --check` passed before documentation finalization and is rerun as the final check.
- Zed diagnostics reported no errors or warnings in the Phase 3 implementation and tests.
- generated fonts, PDFs, raster images, CMake outputs, and the local MSVC bootstrap script remain under ignored build output.

## Behavior impact

Phase 3 does not modify or call:

- `CFontCidTrueType`
- ordinary `EncodeUnicode()` or `EncodeGID()` allocation
- existing `/ToUnicode` generation
- existing `/CIDToGIDMap` generation
- `CPdfWriter` text commands
- `CCommandManager` or `CTextLine`
- metafile commands or parsing
- `IRenderer`
- `sdkjs`

Ordinary PDF export behavior is unchanged because the new logical subset and Type 0 builders have no production caller.

## Exit-criteria assessment

| Criterion | Result |
| --- | --- |
| low and high source GIDs compact independently of source GID range | passed |
| source composite dependencies are included transitively | passed |
| embedded GID 0 remains reserved | passed |
| different semantic CIDs can share one compact GID | passed |
| exact multi-scalar and supplementary `/ToUnicode` mappings are emitted | passed |
| PDF widths are normalized to 1000-em text space | passed |
| generated fonts pass strict font parsing | passed |
| generated PDF passes qpdf syntax checking | passed |
| manually constructed one-glyph units render visibly | passed |
| normal and raw extraction preserve semantic order | passed |
| ordinary PDF behavior remains unchanged | satisfied by isolation and successful production build |
| focused Phase 1-3 tests pass | 40/40 passed |
| existing full `core` test suite passes | not rerun; only the focused logical-text CTest target and production PDF target were built |

## Deferred work

Phase 3 deliberately does not implement:

- synthetic composite glyph construction
- positioned or multi-component logical visuals
- altered logical advances
- synthetic bounding-box and `maxp` recalculation
- physical logical-font sharding
- source-order `Tj` or `TJ` serialization in the production writer
- native metafile logical-unit transport
- `sdkjs` shaping integration
- CFF, CFF2, TTC, variable, color, SVG, or bitmap font support

Synthetic TrueType visual construction begins in Phase 4.
