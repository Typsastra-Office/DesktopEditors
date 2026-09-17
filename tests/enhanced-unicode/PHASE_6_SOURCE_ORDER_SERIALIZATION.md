# Phase 6 source-order logical text serialization

## Status

Phase 6 completed locally on 2026-08-31.

The implementation is committed as `bf6b5da695` on the `enhanced-unicode` branch of the `core` fork, based on Phase 5 commit `95d6bef926`. The top-level `DesktopEditors` repository records the Phase 6 revision through its `core` submodule pointer.

This phase adds a dedicated logical text-content serializer beside the ordinary writer path. It does not add a renderer or metafile caller and does not modify `CCommandManager`, `CTextLine`, or ordinary PDF text commands.

## Objective

Serialize semantic CIDs in authoritative input order while independently reproducing each logical unit's supplied visual position.

The serializer consumes:

```text
logical unit plan
+ physical shard and local CID mapping
+ serialized Type 0 font widths
+ deterministic shard resource names
+ tagging or marked-content boundary identity
```

It emits logical text operations using retained `Tf`, group-level `Tm`, contiguous `Tj`, and safely adjusted `TJ`.

## Work completed

### Dedicated logical text command

`CLogicalTextCommand` combines one planned logical unit with its Phase 5 sharded mapping and an explicit boundary identifier.

Input order is authoritative. The serializer performs one forward traversal and never:

- sorts by `VisualX`
- reverses RTL units
- groups nonadjacent units by shard
- collects a repeated semantic unit back beside its original allocation
- inserts a duplicate invisible text layer

Every semantic CID is written as exactly two uppercase big-endian hexadecimal bytes under `/Identity-H`.

### Physical font resources

Each shard receives a deterministic resource entry containing:

- a unique PDF resource name
- the shard's `CLogicalType0FontResult`

Resource names are syntax-validated, length-bounded, nonempty, and unique. A shard transition closes the current text group and emits the corresponding `Tf` before the next command.

The active shard is retained across baseline and boundary groups. `Tf` is therefore not repeated unless the physical shard changes.

A repeated semantic key that maps back to an earlier shard produces a source-order font transition back to that shard; it is never reordered beside earlier commands.

### Normalized coordinate contract

Phase 1 logical `VisualX` and `VisualY` values are normalized to a font size of `1.0`.

The serializer applies:

```text
user_x = run_origin_x + visual_x * serialized_font_size
user_y = run_origin_y + visual_y * serialized_font_size
```

`FontSize` is rounded once to the six-decimal value emitted by `Tf`. A positive input that rounds to zero is rejected. The same effective value is used for all subsequent matrix and cursor calculations.

`Tm` coordinates are rounded to six decimals. The rounded emitted coordinates are converted back to normalized space and become the authoritative starting cursor and baseline. If the first unit cannot be represented within the configured tolerance, serialization fails explicitly without changing the caller's output.

### Actual PDF width accounting

Horizontal cursor reconstruction uses the width actually serialized in the shard's `/W` array:

```text
pdf_advance = serialized_width / 1000
```

It does not use the unrounded source-font advance after Type 0 serialization. This prevents a small source-to-PDF width rounding difference from accumulating across logical units.

### `Tj` and `TJ`

Adjacent units can share a group only when they have:

- the same physical shard
- the same boundary identifier
- a baseline within tolerance of the group's emitted baseline
- a finite and safely bounded horizontal adjustment
- a two-decimal adjustment that reconstructs the requested position within tolerance

For each next unit:

```text
expected_x = reconstructed_current_x + current_pdf_advance
displacement = next_visual_x - expected_x
TJ adjustment = -displacement * 1000
```

The adjustment is rounded to two decimal places. A forward LTR gap produces a negative number; backward RTL movement produces a positive number.

The reconstructed next position after the rounded adjustment becomes the cursor used for the following pair. This prevents individually valid rounding errors from accumulating across a long group.

`Tj` is emitted only when every relation in the group is mathematically contiguous. A nonzero displacement that merely rounds to adjustment `0` still uses `TJ`.

### Group boundaries and fallback

A group ends before:

- a physical shard transition
- a tagging or marked-content boundary transition
- a baseline outside tolerance from the emitted group baseline
- an adjustment beyond the configured safe magnitude
- an adjustment that cannot meet the configured precision

The next valid unit starts a new `Tm` group at its own visual origin. CIDs remain in input order.

A non-finite or otherwise invalid unit cannot be represented by a new matrix and fails explicitly.

### Failure and size safety

The complete result is assembled in a local string and assigned only after successful serialization. Validation and precision failures leave the caller's output unchanged.

Content and intermediate `Tj`/`TJ` group construction use checked incremental appends against the 32-bit PDF stream-size limit. This avoids both unchecked growth and false rejection based only on a conservative command count.

## Files changed

Production logical path:

- `core/PdfFile/SrcWriter/LogicalTextSerializer.h`
- `core/PdfFile/SrcWriter/LogicalTextSerializer.cpp`
- `core/PdfFile/CMakeLists.txt`

Tests:

- `core/PdfFile/tests/LogicalText/LogicalTextSerializerTest.cpp`
- `core/PdfFile/tests/LogicalText/LogicalTextPdfTest.cpp`
- `core/PdfFile/tests/LogicalText/CMakeLists.txt`

Documentation:

- `ENHANCED_UNICODE_IMPLEMENTATION_PLAN.md`
- `tests/enhanced-unicode/PHASE_6_SOURCE_ORDER_SERIALIZATION.md`

## Test coverage

Phase 6 adds coverage for:

- contiguous LTR units using one `Tj`
- forward LTR gaps producing negative `TJ` adjustments
- backward RTL movement producing positive `TJ` adjustments
- mixed-direction positions remaining in authoritative CID order
- baseline changes starting a new `Tm`
- baseline tolerance being anchored to the emitted group matrix
- shard transitions selecting deterministic resources in source order
- repeated mappings returning to an earlier shard resource
- boundary changes preventing cross-boundary text operations
- two-decimal adjustment rounding within `0.000005 em`
- use of actual serialized `/W` widths
- exact-only `Tj` eligibility
- cumulative rounded-cursor reconstruction
- fallback when required precision cannot be met
- fallback when adjustment magnitude is unsafe
- normalized placement scaling by effective font size and run origin
- rejection of font sizes that serialize as zero
- rejection of an insufficiently precise `Tm` origin
- rejection of duplicate shard resource names
- validation failure without output mutation
- two-shard Type 0 PDF generation
- exact multi-scalar Arabic and Hebrew `/ToUnicode` mappings
- source-order mixed-script mappings across a shard transition

All Phase 1 through Phase 5 tests remain in the focused executable.

## Review findings

Independent review identified and verified fixes for:

1. cumulative `TJ` rounding error across more than two units
2. baseline drift caused by pairwise rather than group-origin comparison
3. duplicate resource names aliasing different physical shards
4. unchecked intermediate group-string growth
5. false output rejection from a conservative per-command size reservation
6. `Tm` rounding not participating in cursor reconstruction
7. `Tf` rounding differing from the font size used for geometry

The final review reported no remaining implementation correctness findings.

## Validation environment

- Operating system: Windows
- Compiler: MSVC through Visual Studio 2022 17.14
- Build system: CMake with Ninja
- Test framework: GoogleTest 1.17.0
- PDF syntax validation: qpdf
- PDF font inspection: `pdffonts`
- rasterization: `pdftoppm`
- extraction readers: Xpdf-compatible `pdftotext` 4.00, PyMuPDF, pypdf, and pdfminer
- build configuration: Release

Generated artifacts remain under ignored `core/build/phase1-msvc` output.

## Results

### Focused tests

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

Expanded executable result:

```text
85 tests from 10 test suites
85 passed
```

### Production build

The existing PDF library compiled and linked successfully with the logical serializer included:

```text
cmake --build build/phase1-msvc --target PdfFile --config Release
```

Result:

```text
Success! [PdfFile.dll] is ready!
```

### PDF fixture

`phase6-logical-source-order.pdf` contains:

- two independently serialized physical logical Type 0 fonts
- `/Identity-H` on both resources
- embedded compact `CIDFontType2` fonts
- explicit `/CIDToGIDMap` streams
- exact `/ToUnicode` entries
- Arabic and Hebrew word-level logical units
- a mixed Latin, Arabic, and Hebrew run crossing the shard boundary
- retained and switched `Tf`
- independent `Tm` origins
- adjusted `TJ` content

`qpdf --check` reports no syntax or stream errors.

`pdffonts` reports both fonts as embedded, subsetted CID TrueType fonts with Unicode mappings.

Rasterization at 144 DPI succeeds.

### Extraction interoperability

Producer-level tests prove that content CIDs remain in authoritative input order and every CID has its exact `/ToUnicode` value.

Available readers do not expose a single uniform bidi extraction policy:

- PyMuPDF preserves the complete Arabic and Hebrew word mappings but visually reorders the mixed-direction line
- pypdf preserves the standalone Arabic and Hebrew mappings but suppresses some overlapping mixed-direction segments under its layout heuristics
- the installed Xpdf-compatible `pdftotext -raw -enc UTF-8` exposes all mappings but reverses RTL strings internally
- pdfminer applies its own visual-order and whitespace reconstruction

These differences occur after the producer has emitted source-order CIDs and exact CMaps. They match the architecture document's warning that reader search, layout, and bidi behavior is not standardized by PDF syntax alone.

The authoritative input is written beside the fixture as `phase6-expected-source-order.txt` for future validation with the project's target Poppler and application-reader versions.

## Behavior impact

Phase 6 does not modify or call:

- ordinary `CFontCidTrueType` allocation
- ordinary `EncodeUnicode()` or `EncodeGID()`
- ordinary `/ToUnicode` or `/CIDToGIDMap` generation
- `CPdfWriter::CommandDrawTextEx()`
- `CCommandManager`
- `CTextLine`
- metafile commands or parsing
- `IRenderer`
- `sdkjs`

The serializer remains reachable only through the dedicated logical-font test path.

## Exit-criteria assessment

| Criterion | Result |
| --- | --- |
| contiguous LTR emits `Tj` | passed |
| LTR gaps emit negative `TJ` | passed |
| backward RTL movement emits positive `TJ` | passed |
| CID bytes remain in authoritative input order | passed |
| baseline changes create a new matrix group | passed |
| shard transitions select correct font resources | passed |
| tagging boundaries split text operations | passed |
| rounded placement remains within tolerance | passed |
| cumulative rounding remains within tolerance | passed |
| Arabic and Hebrew `/ToUnicode` extraction mappings are exact | passed |
| generated PDF renders and passes syntax checks | passed |
| all tested readers return identical mixed-bidi text | reader-dependent; not a producer invariant |
| ordinary text serializer remains unchanged | passed |

## Rollback boundary

Phase 6 is isolated to `LogicalTextSerializer`, focused tests, and CMake source registration.

Rollback consists of removing the serializer files and tests. Phase 1 through Phase 5 planning, mapping, sharding, and Type 0 font serialization remain independently usable. The ordinary `CCommandManager` and `CTextLine` paths are unaffected.

## Next phase

Phase 7 will add a versioned logical-unit metafile command and native reader validation. That work has not started.
