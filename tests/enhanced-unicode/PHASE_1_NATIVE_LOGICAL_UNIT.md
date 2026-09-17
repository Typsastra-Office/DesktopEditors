# Phase 1 native logical-unit contract

## Status

Phase 1 completed on 2026-08-31.

The implementation is committed as `939e3e5bf5` on the `enhanced-unicode` branch of the `core` fork. The top-level `DesktopEditors` repository records that revision through its `core` submodule pointer.

This phase is intentionally isolated. It adds no production callers and does not change metafile parsing, renderer commands, font allocation, or PDF output.

## Objective

Introduce and test a native representation of a PDF logical text unit in `core`, while keeping exact Unicode semantic identity separate from shaped visual identity and page placement.

## Repository state

| Repository | Branch or revision | Phase 1 role |
| --- | --- | --- |
| `DesktopEditors` | `main` | documentation and pinned submodule integration |
| `core` | `939e3e5bf5` on `enhanced-unicode` | Phase 1 implementation |
| `sdkjs` | `bf4a2db383f2dc9712c328e8704d3c58abb6a93e` | unchanged in this phase |

## Work completed

### Native logical-text contract

Added:

- `core/PdfFile/SrcWriter/LogicalText.h`
- `core/PdfFile/SrcWriter/LogicalText.cpp`

The contract defines:

- `CLogicalGlyph`
  - source GID
  - horizontal and vertical advances
  - horizontal and vertical offsets
- `CLogicalTextUnit`
  - exact UTF-32 Unicode scalar sequence
  - shaped glyph sequence
  - independent visual origin
  - optional source location
- `CLogicalComponent`
  - source GID
  - component position quantized to source-font units
- `CVisualUnitKey`
  - logical advance width in source-font units
  - ordered visual components
  - no Unicode and no page placement
- `CSemanticUnitKey`
  - exact Unicode scalar sequence
  - visual key
- `CLogicalUnitPlan`
  - exact Unicode
  - planned visual key
  - normalized visual origin
  - optional source location

### Deterministic key behavior

Added `operator==` and `operator<` for logical locations, components, visual keys, and semantic keys.

These operators allow deterministic use in ordered maps and preserve the required identity separation:

```text
visual identity
    = font-unit advance + ordered positioned GIDs

semantic identity
    = exact Unicode + visual identity

page placement
    = not part of either key
```

Different Unicode sequences can therefore share one visual key while remaining distinct semantic keys.

### Krilla-compatible planning

Added the non-throwing planner:

```cpp
bool TryPlanLogicalTextUnit(
    const CLogicalTextUnit& unit,
    unsigned int unitsPerEm,
    CLogicalUnitPlan& plan,
    CLogicalTextError& error);
```

The planner follows the Krilla Version 4 geometry model:

1. Traverse shaped glyphs in visual order.
2. Track horizontal and vertical pen positions.
3. Record each component at the current pen plus its glyph offset.
4. Track the minimum and maximum horizontal pen positions.
5. Normalize component X positions by subtracting the minimum horizontal pen position.
6. Round component positions and logical advance into source-font units.
7. Shift the planned visual X origin by the same horizontal minimum.
8. Preserve visual Y and optional source location.

This supports negative horizontal movement without putting page placement into the reusable visual key.

### Validation and diagnostics

Added structured error codes and diagnostic messages for:

- empty Unicode sequences
- invalid Unicode scalars, including surrogate values and values above `U+10FFFF`
- empty glyph sequences
- GID 0
- GIDs above 65,535
- non-finite visual origins
- non-finite glyph advances or offsets
- zero `unitsPerEm`
- non-finite accumulated pen positions
- integer overflow while converting positions or advances to font units

Errors identify the affected Unicode or glyph index where applicable. The planner clears its output and error state at the start of every call and does not throw exceptions for invalid input.

### Build and test integration

Updated:

- `core/PdfFile/CMakeLists.txt`
- `core/CMakeLists.txt`

Added the focused GoogleTest target:

- `core/PdfFile/tests/LogicalText/CMakeLists.txt`
- `core/PdfFile/tests/LogicalText/LogicalTextTest.cpp`

The target is registered with CTest as `pdf_logical_text_test` when `EO_BUILD_TESTS=ON`.

## Test coverage

The Phase 1 suite contains 16 tests across three suites.

### Logical planning

- plans a valid one-glyph unit
- preserves ordered multi-glyph component positions
- normalizes negative horizontal pen movement
- rounds equivalent floating-point geometry deterministically
- preserves the optional source location

### Key identity

- excludes page placement from visual identity
- treats identical Unicode and visual data as one semantic key
- keeps Unicode out of visual identity
- distinguishes different Unicode sharing one visual
- distinguishes identical Unicode with different visual construction
- verifies ordered-map key reuse

### Input validation

- rejects empty text and empty glyph arrays
- rejects surrogate values and values above `U+10FFFF`
- rejects GID 0 and GIDs above 65,535
- rejects NaN and infinity in visual positions
- rejects NaN and infinity in glyph metrics
- rejects zero `unitsPerEm`
- rejects font-unit overflow in advances and component positions

## Validation environment

- Operating system: Windows
- Compiler: MSVC 19.44.35228.0
- Build system: CMake 3.30.3 with Ninja 1.12.1
- Test framework: GoogleTest 1.17.0 from the `tests` vcpkg manifest feature
- Build configuration: Release

The isolated test build is stored under the ignored local directory `core/build/phase1-msvc`.

## Results

### Focused test target

Command:

```text
cmake --build build/phase1-msvc --target pdf_logical_text_test --config Release
ctest --test-dir build/phase1-msvc -R pdf_logical_text_test --output-on-failure
```

Result:

```text
1/1 Test #7: pdf_logical_text_test ............ Passed
100% tests passed, 0 tests failed out of 1
```

The test executable reported:

```text
16 tests from 3 test suites
16 passed
```

### Production build

The existing top-level Windows build successfully compiled `LogicalText.cpp` and linked `PdfFile.dll`:

```text
cmake --build . --target PdfFile --config Release
```

The command was run from the Visual Studio developer environment so the MSVC standard-library and Windows SDK include paths were available.

### Static checks

- `git diff --check` passed.
- Zed diagnostics reported no errors or warnings in the new production and test sources.
- Generated CMake, vcpkg, and test artifacts remained ignored.

## Behavior impact

There are no production callers of `TryPlanLogicalTextUnit` in Phase 1.

The following remain unchanged:

- `IRenderer`
- metafile commands and parsing
- `CFontCidTrueType` allocation
- `/ToUnicode` generation
- `/CIDToGIDMap`
- `CCommandManager` and `CTextLine`
- ordinary PDF text serialization
- `sdkjs` shaping and grapheme behavior

The new files can be removed without affecting existing export behavior, preserving the planned rollback boundary.

## Exit-criteria assessment

| Criterion | Result |
| --- | --- |
| native logical units can be created and planned entirely in tests | passed |
| key equality and validation are deterministic | passed by focused tests |
| production `PdfFile` target still builds | passed |
| existing full `core` test suite still passes | not rerun; only the focused Phase 1 CTest target was built and executed |
| no renderer or PDF behavior changes | satisfied by isolation; no production caller exists |

## Deferred work

Phase 1 deliberately does not implement:

- semantic CID allocation
- visual-record allocation
- compact embedded GID allocation
- TrueType subsetting or synthetic composites
- logical-font sharding
- `Tj` or `TJ` serialization
- a logical-unit metafile command
- authoritative logical-unit construction in `sdkjs`

Those responsibilities begin in Phase 2 and later phases.
