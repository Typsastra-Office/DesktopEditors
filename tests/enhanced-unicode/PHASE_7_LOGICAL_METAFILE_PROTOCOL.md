# Phase 7 versioned logical-unit metafile protocol

## Status

Phase 7 completed on 2026-08-31.

The implementation is committed as `62c618c6c3` on the `enhanced-unicode` branch of the `core` fork, based on Phase 6 commit `bf6b5da695`. The top-level `DesktopEditors` repository records the Phase 7 revision through its `core` submodule pointer.

This phase adds the native transport contract and forwarding boundary only. It does not construct units in `sdkjs`, emit command 84 from JavaScript, or activate logical-font resource management in the production PDF writer. Those responsibilities remain in Phases 8, 9, and 10.

## Objective

Transport one complete logical text unit through a bounded, versioned native metafile record without changing command 83 or requiring every existing renderer to implement a new pure virtual method.

The transported unit contains:

```text
exact Unicode scalars
+ normalized logical advance
+ independent visual origin
+ ordered positioned source-GID components
```

## Protocol

### Command identity and framing

The new command is:

```text
ctDrawTextLogicalUnit = 84
```

The existing command remains:

```text
ctDrawTextCodeGid = 83
```

Command 84 uses the existing advanced-record framing convention:

```text
u8     command = 84
u32le  record_size
bytes  payload
```

`record_size` includes its own four-byte field but does not include the command byte.

### Version 1 payload

```text
u8      version = 1
u8      flags = 0
u16le   reserved = 0

u32le   unicode_count
u32le[] unicode_scalars

i32le   logical_advance * 100000
i32le   visual_x * 100000
i32le   visual_y * 100000

u32le   component_count

components:
    u32le source_gid
    i32le relative_x * 100000
    i32le relative_y * 100000
```

The total framed record size is:

```text
4 + 24 + 4 * unicode_count + 12 * component_count
```

All integer fields are explicitly serialized and parsed as little-endian values. Geometry uses the existing metafile scale of `100000`, truncates toward zero, and therefore has a precision of `0.00001`.

### Limits

```text
maximum record size:      1 MiB
maximum Unicode scalars:  4096
maximum components:       4096
valid source GIDs:        1..65535
```

The logical advance must be nonnegative. Unicode values must be Unicode scalar values, excluding surrogate code points.

### Version policy

A correctly bounded record with an unknown nonzero version is skipped without a renderer call. The reader remains synchronized at the next command.

Version 1 is parsed strictly. Unknown flags, nonzero reserved data, trailing bytes, invalid counts, invalid values, truncated fields, and invalid geometry reject the metafile conversion.

An empty payload is malformed because it does not contain a version byte. Unknown versions do not need to use the version-1 minimum payload size.

## Work completed

### Generic logical renderer contract

`IRenderer.h` now defines transport-only structures:

- `CRendererLogicalComponent`
- `CRendererLogicalUnit`

`IRenderer::CommandDrawTextLogicalUnit()` is a non-pure virtual method so existing renderer implementations remain source compatible.

The default compatibility path is visual-only:

- the first positioned GID receives the complete Unicode array through `CommandDrawTextCHAR2()`
- later positioned GIDs are drawn through `CommandDrawTextExCHAR()` with semantic space
- component order and absolute positions are preserved

This fallback keeps non-PDF renderers operational but is not the Enhanced Unicode PDF representation. Renderers may override the method when they can preserve logical-unit semantics directly.

### Bounded parser and serializer

`LogicalUnitMetafile` provides:

- version and limit constants
- `ParseLogicalUnitRecord()`
- `SerializeLogicalUnitRecord()`
- structured parse results and error information

The parser:

- checks the outer record before reading or allocating
- checks each count against both a fixed limit and remaining bytes
- parses into a local object
- mutates caller output only after complete success
- skips bounded unknown versions without interpreting their payload

The serializer:

- validates all counts, scalars, GIDs, and geometry
- checks fixed-point range before conversion
- computes and checks the complete record size
- builds into a local byte vector
- leaves caller output unchanged on failure

### Checked metafile framing

`CBufferReader::TryReadBoundedRecord()` reads the four-byte size explicitly as little-endian and validates:

- at least four bytes remain
- record size is at least four
- record size does not exceed the command limit
- the complete record remains in the source buffer

It does not advance on failure. On success it returns a payload view and advances exactly to the record boundary.

### Rendering and metadata readers

`ConvertBufferToRenderer()` handles command 84 by:

1. reading a bounded frame
2. parsing version 1 or skipping an unknown version
3. invoking `CommandDrawTextLogicalUnit()` only for a parsed version-1 unit
4. failing explicitly on malformed input or renderer rejection

`CMetafilePagesInfo::CheckBuffer()` uses the same bounded framing and parser. It skips valid unknown versions and returns early on malformed input, preserving metadata-scanner synchronization.

Command 83 parsing and layout are unchanged.

### PDF forwarding boundary

The method is forwarded through:

```text
IRenderer
    -> CPdfFile
    -> CPdfWriter
```

`CPdfWriter::CommandDrawTextLogicalUnit()` currently returns `S_FALSE` deliberately. A command-83 fallback would split the unit and silently lose Enhanced Unicode semantics. Production logical-font ownership, font selection, resource finalization, and fallback policy are Phase 10 work, so explicit rejection is safer than producing a falsely enhanced PDF.

`LogicalMetafileAdapter` converts a validated renderer unit into the existing `CLogicalUnitPlan` contract by converting normalized geometry to source-font units and preserving the visual origin.

### Build integration

The protocol source is registered in the graphics CMake, qmake, native-graphics, and drawing-file source lists. The adapter is registered in the PDF CMake target. A compatibility stub is present in the WASM PDF writer.

No `sdkjs` source was modified in this phase.

## Files changed

Native protocol and renderer:

- `core/DesktopEditor/graphics/LogicalUnitMetafile.h`
- `core/DesktopEditor/graphics/LogicalUnitMetafile.cpp`
- `core/DesktopEditor/graphics/IRenderer.h`
- `core/DesktopEditor/graphics/MetafileToRenderer.h`
- `core/DesktopEditor/graphics/MetafileToRenderer.cpp`
- `core/DesktopEditor/graphics/MetafileToRendererReader.h`

Graphics build registration:

- `core/DesktopEditor/graphics/cmake/CMakeLists.txt`
- `core/DesktopEditor/graphics/pro/graphics.pro`
- `core/DesktopEditor/graphics/pro/js/drawingfile.json`
- `core/DesktopEditor/graphics/pro/js/qt/nativegraphics.pro`

PDF forwarding and adapter:

- `core/PdfFile/PdfFile.h`
- `core/PdfFile/PdfFile.cpp`
- `core/PdfFile/PdfWriter.h`
- `core/PdfFile/PdfWriter.cpp`
- `core/PdfFile/SrcWriter/LogicalMetafileAdapter.h`
- `core/PdfFile/SrcWriter/LogicalMetafileAdapter.cpp`
- `core/PdfFile/CMakeLists.txt`
- `core/DesktopEditor/graphics/pro/js/wasm/src/pdfwriter.cpp`

Tests:

- `core/PdfFile/tests/LogicalText/LogicalUnitMetafileTest.cpp`
- `core/PdfFile/tests/LogicalText/LogicalMetafileAdapterTest.cpp`
- `core/PdfFile/tests/LogicalText/CMakeLists.txt`

Documentation:

- `ENHANCED_UNICODE_IMPLEMENTATION_PLAN.md`
- `tests/enhanced-unicode/PHASE_7_LOGICAL_METAFILE_PROTOCOL.md`

## Test coverage

The focused native tests cover:

- exact version-1 field roundtrip
- explicit little-endian framing
- fixed-point truncation for positive and negative geometry
- multiple-unit source order
- component order
- minimal and full unknown-version records
- synchronization after an unknown version
- invalid outer lengths without reader advancement
- truncated outer records
- empty, excessive, and maximum Unicode counts
- surrogate and out-of-range Unicode values
- empty, excessive, and maximum component counts
- minimum and maximum accepted GIDs
- invalid GIDs
- truncated version headers, geometry, and components
- negative logical advances
- unknown flags and reserved bits
- trailing version-1 bytes
- parser output immutability on malformed and unsupported input
- serializer output immutability on failure
- unchanged command-83 identifier and binary fixture layout
- record-to-plan geometry conversion
- complete native record-to-sharded-logical-PDF pipeline

The complete pipeline fixture executes:

```text
versioned native record
    -> bounded record reader
    -> version-1 parser
    -> logical metafile adapter
    -> sharded logical font mapper
    -> compact Type 0 font builder
    -> source-order Tj/TJ serializer
```

It uses Latin `U+0041` and Arabic `U+0628`, forces a physical shard transition, checks exact `/ToUnicode` mappings, and checks source-order `/LF0` then `/LF1` selection.

## Validation environment

- Operating system: Windows
- Compiler: MSVC through Visual Studio 2022 17.14
- Build system: CMake with Ninja
- Test framework: GoogleTest 1.17.0
- Build configuration: Release

Generated artifacts remain under ignored `core/build/phase1-msvc` output.

## Results

### Focused tests

Commands:

```text
cmake --build build/phase1-msvc --target pdf_logical_text_test --config Release
build/phase1-msvc/pdf_logical_text_test/pdf_logical_text_test.exe --gtest_color=no
```

Result:

```text
103 tests from 12 test suites
103 passed
```

### Production build

Command:

```text
cmake --build build/phase1-msvc --target PdfFile graphics --config Release
```

Result:

```text
PdfFile and graphics compiled and linked successfully
```

The build emitted existing warning classes from AGG and DLL-interface declarations but no Phase 7 compilation or link errors.

### Source hygiene

Command:

```text
git diff --check
```

Result:

```text
passed
```

## Review findings

Implementation review found and corrected one forward-compatibility defect: the initial parser applied the version-1 minimum payload length before reading the version. That incorrectly rejected a short but correctly framed future-version record. The parser now requires only a version byte before deciding whether the payload is supported, while retaining strict minimum-size validation for version 1.

A requested independent sub-agent review could not run because the agent service returned a subscription rate-limit error. The implementation was instead reviewed directly against the Phase 7 requirements and validated by the boundary tests above.

## Behavior impact

Phase 7 changes native behavior only when command 84 is present.

- Existing command-83 files retain their old layout and parser.
- Existing renderers compile because the new method is not pure virtual.
- Non-PDF renderers use the documented visual compatibility path by default.
- The production PDF writer rejects logical units explicitly until Phase 10 activation.
- Current exports cannot emit command 84 because Phases 8 and 9 have not started.
- Ordinary PDF text allocation and serialization remain unchanged.

## Exit-criteria assessment

| Criterion | Result |
| --- | --- |
| new command leaves command 83 unchanged | passed |
| complete logical-unit fields round-trip | passed |
| parser bounds counts before allocation | passed |
| malformed and excessive input is rejected | passed |
| unknown versions skip while preserving synchronization | passed |
| existing renderer implementations remain build-compatible | passed |
| metadata scanner follows the same framing policy | passed |
| forwarding reaches `CPdfWriter` | passed |
| native fixture reaches the complete logical PDF primitives | passed |
| production `CPdfWriter` emits logical fonts | intentionally deferred to Phase 10 |
| `sdkjs` constructs or emits authoritative units | not part of Phase 7 |

## Rollback boundary

Command 84 is additive. Rollback consists of removing its parser, transport types, forwarding methods, adapter, source registrations, and tests. Command 83 and all ordinary document behavior remain intact.

## Next phase

Phase 8 will construct authoritative logical units in `sdkjs` from source Unicode and shaped visual graphemes. It must not yet emit command 84; JavaScript metafile emission is Phase 9.
