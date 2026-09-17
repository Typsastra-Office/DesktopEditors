# Phase 4 synthetic TrueType visual construction

## Status

Phase 4 completed on 2026-08-31.

The implementation is committed as `20d7bb7525` on the `enhanced-unicode` branch of the `core` fork, based on Phase 3 commit `6714ccd998`. The top-level `DesktopEditors` repository records the Phase 4 revision through its `core` submodule pointer.

This phase extends the parallel logical-font path created in Phase 3. It still has no renderer, metafile, or ordinary PDF caller.

## Objective

Represent every supported logical visual exactly in one compact embedded TrueType GID.

Exact source-backed visuals continue to reuse a compact source glyph:

```text
one component
+ zero component offset
+ nominal source advance
    -> compact source GID
```

Every other supported visual receives one appended synthetic composite glyph:

```text
positioned component
or changed advance
or multiple components
    -> compact synthetic GID
```

The decision is geometric and independent of Unicode, script, or language.

## Work completed

### Hybrid compact-font builder

`core/PdfFile/SrcWriter/LogicalTrueTypeSubset.h` now exposes two entry points:

- `TryBuildSourceBackedLogicalTrueType()` retains the strict Phase 3 behavior
- `TryBuildLogicalTrueType()` enables Phase 4 synthetic construction

The test-only Type 0 builder now calls the hybrid entry point.

The compact embedded namespace is deterministic:

```text
GID 0
    .notdef

GID 1..N
    used source glyphs and transitive dependencies

GID N+1..
    synthetic visual glyphs in visual-record encounter order
```

The complete source GID range is never retained merely to preserve source numbering.

### Visual classification

For every visual record, the builder:

1. validates that at least one source component exists
2. validates every source GID
3. adds every directly referenced source glyph to the compact source namespace
4. computes transitive source-composite closure
5. classifies the visual as exact source-backed or synthetic
6. assigns one compact GID to the visual record
7. maps every semantic CID independently to that visual GID

Different semantic CIDs may therefore share one synthetic GID while preserving distinct `/ToUnicode` mappings.

### Synthetic TrueType composites

Each synthetic glyph contains:

- `numberOfContours = -1`
- recalculated signed 16-bit bounding box
- one component record per shaped source component
- compactly remapped component GID
- signed word X/Y arguments
- `ARGS_ARE_XY_VALUES`
- `MORE_COMPONENTS` on every component except the final one

`ROUND_XY_TO_GRID` is deliberately not emitted. The supplied integer font-unit geometry must not be changed by device-pixel rounding during rasterization.

Component order remains the shaped visual order stored in `CVisualUnitKey`.

### Synthetic advances

Synthetic `hmtx` records use the logical visual advance rather than a source glyph's nominal advance.

This supports:

- a single source glyph with a changed advance
- positioned source glyphs
- multi-component logical units

The advance must fit unsigned 16-bit TrueType `hmtx` storage.

### Component and bounds validation

Each component X and Y value must fit a signed 16-bit TrueType composite argument.

For every component with contours, the builder translates its source glyph bounds by the component offset. Every translated bound must remain signed 16-bit.

Contourless source glyphs are still allowed as components but do not affect:

- synthetic glyph bounds
- synthetic left side bearing
- global `head` bounds
- `hhea` bearing extrema

An all-contourless synthetic visual receives zero bounds and a zero left side bearing while retaining its requested advance.

### Iterative source glyph statistics

The builder computes source glyph statistics with iterative post-order traversal rather than recursion.

For every selected source glyph it records:

- point count
- contour count
- direct component count
- composite depth
- contour presence
- declared source bounds

The traversal:

- follows compact source-composite dependencies
- detects cycles
- avoids call-stack exhaustion on deep source graphs
- rejects point, contour, component, or depth requirements that cannot fit TrueType `maxp`

### Exact synthetic resource accounting

For each synthetic visual, the builder sums the expanded point and contour requirements of its selected components and computes the required composite depth.

It rejects:

- more than 65,535 direct components
- more than 65,535 expanded points
- more than 65,535 expanded contours
- composite depth beyond 65,535

The implementation checks child values before subtraction, preventing unsigned-underflow acceptance at the 16-bit boundary.

A simple glyph containing 65,536 points is rejected before it can be copied or referenced synthetically.

### Recalculated compact-font metadata

Phase 4 recalculates font-wide values across only the emitted compact source and synthetic glyphs.

`head`:

- `xMin`
- `yMin`
- `xMax`
- `yMax`
- long `indexToLocFormat`
- `checkSumAdjustment`

`hhea`:

- `advanceWidthMax`
- `minLeftSideBearing`
- `minRightSideBearing`
- `xMaxExtent`
- `numberOfHMetrics`

`maxp`:

- `numGlyphs`
- `maxPoints`
- `maxContours`
- `maxCompositePoints`
- `maxCompositeContours`
- `maxComponentElements`
- `maxComponentDepth`

Contourless glyphs are ignored for bearing and extent extrema. Signed `hhea` results are validated on both bounds before serialization.

Instruction-related `maxp` fields remain conservatively copied from the source font.

### Type 0 integration

`TryBuildLogicalType0Font()` now accepts synthetic visual records through `TryBuildLogicalTrueType()`.

The existing independent mappings remain unchanged:

```text
semantic CID
    -> exact Unicode through /ToUnicode
    -> source-backed or synthetic GID through /CIDToGIDMap
```

A generated Phase 4 PDF fixture uses one semantic CID whose `/ToUnicode` value is `AB` and whose synthetic GID paints two positioned source glyph components.

## Files changed

Production logical path:

- `core/PdfFile/SrcWriter/LogicalTrueTypeSubset.h`
- `core/PdfFile/SrcWriter/LogicalTrueTypeSubset.cpp`
- `core/PdfFile/SrcWriter/LogicalType0Font.cpp`

Tests:

- `core/PdfFile/tests/LogicalText/LogicalSyntheticTrueTypeTest.cpp`
- `core/PdfFile/tests/LogicalText/LogicalTrueTypeSubsetTest.cpp`
- `core/PdfFile/tests/LogicalText/LogicalType0FontTest.cpp`
- `core/PdfFile/tests/LogicalText/CMakeLists.txt`

## Test coverage

Phase 4 adds coverage for:

- changed-advance synthetic fallback
- positioned single-component construction
- positive and negative component offsets
- ordered multi-component construction
- compact component-GID remapping
- source-composite dependency retention inside a synthetic visual
- different semantics sharing one synthetic GID
- distinct visual keys receiving distinct synthetic GIDs
- exact composite flags without device-grid rounding
- translated synthetic bounds
- contourless-only visuals
- mixed contourless and visible components
- signed coordinate boundaries
- translated-bound overflow
- unsigned advance boundaries
- direct-component count 65,535 and 65,536
- simple-glyph point count 65,535 and 65,536
- direct and synthetic rejection of unrepresentable point counts
- signed `hhea` extrema overflow
- synthetic Type 0 `/CIDToGIDMap`
- exact multi-scalar `/ToUnicode`
- generated synthetic PDF serialization

All Phase 1 through Phase 3 tests remain in the same focused executable.

## Review findings

A focused independent review identified and verified fixes for:

1. `ROUND_XY_TO_GRID` changing component geometry at fractional device pixels
2. saturated rather than rejected synthetic `maxp` requirements
3. contourless glyphs incorrectly expanding synthetic bounds
4. retained full-source `head` and `hhea` extrema
5. positive `minRightSideBearing` wrapping into a negative signed value
6. 65,536-point simple glyphs bypassing checks through unsigned subtraction
7. contourless-only fonts evaluating uninitialized extrema sentinels

After the fixes and regression tests, the final review reported no actionable correctness findings.

Residual non-blocking risks:

- accepted source glyph bounding boxes are trusted rather than reconstructed from point data and transforms
- instruction-related `maxp` fields may overstate compact-font requirements
- physical glyph-capacity sharding remains Phase 5

## Validation environment

- Operating system: Windows
- Compiler: MSVC through Visual Studio 2022 17.14
- Build system: CMake with Ninja
- Test framework: GoogleTest 1.17.0
- strict font parser: fontTools 4.61.1
- PDF validation: qpdf and Poppler tools
- build configuration: Release

Generated artifacts remain under ignored `core/build/phase1-msvc/pdf_logical_text_test` output.

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
53 tests from 7 test suites
53 passed
```

### Production build

The existing PDF library compiled and linked successfully:

```text
cmake --build build/phase1-msvc --target PdfFile --config Release
```

Result:

```text
Success! [PdfFile.dll] is ready!
```

### Strict font parsing

fontTools opened all generated compact fonts with strict checksum checking:

```text
phase3-fontawesome.ttf ok
phase3-material-icons.ttf ok
phase3-nested-composite.ttf ok
phase4-synthetic.ttf ok
```

The Phase 4 fixture contains four embedded glyphs. Its final glyph is a valid TrueType composite.

### PDF syntax and extraction

`qpdf --check phase4-synthetic.pdf` reported no syntax or stream encoding errors.

Normal Poppler extraction:

```text
AB
```

Raw Poppler extraction:

```text
AB
```

The PDF content contains one semantic CID. Its `/ToUnicode` entry maps that CID to the exact two-scalar string `AB`.

### Rasterization

Poppler rasterization succeeded at 144 DPI.

The fixture visibly paints both source components from one synthetic embedded GID. Its second component uses a 1,000-font-unit offset in a 1,792-UPEM font, producing fractional device-pixel placement at the test size. Composite flags do not request device-grid rounding.

### Static checks

- project diagnostics report no errors or warnings
- focused independent review reports no remaining actionable findings
- final `git diff --check` is run after documentation updates

## Behavior impact

Phase 4 still does not modify or call:

- ordinary `CFontCidTrueType` allocation
- ordinary `EncodeUnicode()` or `EncodeGID()`
- existing ordinary `/ToUnicode` generation
- existing ordinary `/CIDToGIDMap` generation
- `CPdfWriter` text commands
- `CCommandManager` or `CTextLine`
- metafile commands or parsing
- `IRenderer`
- `sdkjs`

The new behavior is reachable only through the dedicated logical-font test path.

## Exit-criteria assessment

| Criterion | Result |
| --- | --- |
| positioned single component becomes synthetic | passed |
| changed source advance becomes synthetic | passed |
| multiple components become one synthetic GID | passed |
| source component GIDs use compact remapping | passed |
| source composite dependencies remain available | passed |
| positive and negative offsets render correctly | passed |
| boundary-valid coordinates and advances succeed | passed |
| out-of-range coordinates, bounds, advances, and resources fail | passed |
| identical visual keys reuse one synthetic GID | passed |
| different semantics can share one synthetic GID | passed |
| compact `head`, `hhea`, and structural `maxp` fields are recalculated | passed |
| derived synthetic font passes strict parsing | passed |
| generated synthetic PDF passes qpdf | passed |
| one semantic CID extracts exact multi-scalar Unicode | passed |
| one semantic CID paints a complete multi-GID visual | passed |
| ordinary PDF behavior remains unchanged | satisfied by isolation and production build |
| focused Phase 1-4 tests pass | 53/53 passed |
| existing full `core` test suite passes | not rerun; focused logical-text tests and production PDF target were built |

## Deferred work

Phase 4 deliberately does not implement:

- exact pre-allocation compact-capacity tracking
- multiple logical-font shards
- semantic or embedded-GID shard transitions
- source-order production `Tj` and `TJ` serialization
- native metafile logical-unit transport
- `sdkjs` shaping integration
- CFF, CFF2, TTC, variable, color, SVG, or bitmap font support

Exact compact-capacity tracking and physical logical-font sharding begin in Phase 5.
