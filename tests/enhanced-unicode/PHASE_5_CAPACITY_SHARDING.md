# Phase 5 exact capacity tracking and logical-font sharding

## Status

Phase 5 completed locally on 2026-08-31.

The implementation is committed as `95d6bef926` on the `enhanced-unicode` branch of the `core` fork, based on Phase 4 commit `20d7bb7525`. The top-level `DesktopEditors` repository records the Phase 5 revision through its `core` submodule pointer.

This phase extends the parallel logical-font test path. It does not add a renderer caller, metafile command, PDF text-content serializer, or ordinary PDF-font behavior.

## Objective

Keep every physical logical Type 0 font within the independent 16-bit PDF CID and embedded TrueType GID namespaces while preserving exact semantic and visual reuse.

For each shard, embedded capacity is now counted as:

```text
.notdef
+ unique used source glyphs
+ transitive source-composite dependencies
+ unique synthetic visual glyphs
```

Semantic capacity is counted independently as the number of nonzero logical CIDs.

## Work completed

### Exact compact-glyph tracker

`CLogicalCompactGlyphTracker` uses the same TrueType parser, source-composite closure traversal, glyph-stat validation, and synthetic-glyph validation as the Phase 4 compact-font builder.

For a proposed new visual it plans, without mutation:

- directly referenced source glyphs
- every transitive source-composite dependency
- only source glyphs not already committed to the shard
- whether the visual needs one synthetic glyph

GID 0 is committed when the tracker is constructed, so `.notdef` is always included in physical capacity.

A plan is committed only after both semantic and embedded capacity checks pass. Shared source glyphs and dependencies are represented by a set and are charged once per shard.

### Source-backed and synthetic agreement

The tracker uses the same visual classification as serialization:

```text
one component
+ zero X/Y offset
+ source hmtx advance
    -> source-backed visual

otherwise
    -> one synthetic visual GID
```

Synthetic planning calls the existing Phase 4 composite builder before allocation. Invalid component coordinates, translated bounds, source glyphs, and TrueType resource requirements therefore fail before shard state changes.

### Physical logical-font shards

`CShardedLogicalFontMapper` was added beside the existing Phase 2 `CLogicalFontMapper`.

The original mapper remains unchanged as a simple one-shard allocator for Phase 2 through Phase 4 tests. The new source-aware mapper owns:

```text
global semantic key -> shard index and local mapping

physical shard
    logical semantic/visual records
    compact glyph tracker
```

Every physical shard starts local CID and visual-record allocation at 1. CID 0, visual record 0, and embedded GID 0 remain reserved.

### Allocation behavior

For a new semantic key, the mapper:

1. checks semantic capacity on the active final shard
2. detects whether its visual already exists in that shard
3. plans new source closure and synthetic cost only for a new visual
4. checks embedded capacity independently
5. commits and maps when both limits fit
6. otherwise plans the complete unit against a new empty shard
7. explicitly fails if that visual and all dependencies cannot fit an empty shard

A repeated semantic key bypasses active-shard planning and returns its original shard and local CID. It consumes neither another semantic CID nor another embedded GID.

Different semantics may share one visual in the same shard. They consume separate CIDs but no additional embedded glyphs.

A visual is never divided between physical fonts. Its direct source glyphs, transitive dependencies, and optional synthetic glyph are committed together to one shard.

### Capacity and overflow safety

The production physical limit is 65,535 nonzero CIDs and 65,535 total embedded glyphs per shard.

Constructor-provided capacities support smaller values for deterministic tests. Values above 65,535 are clamped to the physical limit. Zero semantic or embedded capacity is rejected before allocation.

Capacity arithmetic checks the current count before subtraction and addition. The sharded mapper never asks the existing local allocator to create a CID above 65,535, so no 16-bit allocation boundary can wrap.

### Failure atomicity

Planning does not mutate persistent state. A new shard is built as a local candidate and appended only after successful capacity planning and mapping.

The tested failure paths preserve:

- the caller's output mapping
- the current semantic cache
- existing shards
- compact-glyph tracker state
- shard count

An oversized first visual does not leave an empty shard behind.

### Current optimization boundary

The compact tracker reparses the immutable source font for each new visual. This keeps Phase 5 exact and reuses the proven Phase 4 validation logic without introducing a second parser or speculative font serialization.

A later optimization may cache parsed source metadata and dependency closure, provided tracker and serializer behavior remain identical.

## Files changed

Production logical path:

- `core/PdfFile/SrcWriter/LogicalFontMapper.h`
- `core/PdfFile/SrcWriter/LogicalFontMapper.cpp`
- `core/PdfFile/SrcWriter/LogicalFontSharding.h`
- `core/PdfFile/SrcWriter/LogicalFontSharding.cpp`
- `core/PdfFile/SrcWriter/LogicalTrueTypeSubset.h`
- `core/PdfFile/SrcWriter/LogicalTrueTypeSubset.cpp`
- `core/PdfFile/CMakeLists.txt`

Tests:

- `core/PdfFile/tests/LogicalText/LogicalFontShardingTest.cpp`
- `core/PdfFile/tests/LogicalText/CMakeLists.txt`

Documentation:

- `ENHANCED_UNICODE_IMPLEMENTATION_PLAN.md`
- `tests/enhanced-unicode/PHASE_5_CAPACITY_SHARDING.md`

## Test coverage

Phase 5 adds coverage for:

- semantic-capacity exhaustion creating a new physical shard
- embedded compact-GID exhaustion creating a new physical shard
- independent semantic and embedded limits
- repeated semantic keys returning their original shard and CID
- repeated semantics consuming no additional capacity
- different Unicode sharing one visual GID in a shard
- shared source dependencies being counted once
- exact transitive source-composite closure cost
- large source fonts using a small number of high source GIDs
- one additional GID per unique synthetic visual
- repeated synthetic visuals consuming no additional embedded GID
- explicit rejection when one visual cannot fit an empty shard
- no empty shard after failed first allocation
- CID 0, visual record 0, and embedded GID 0 reservation in every shard
- zero-capacity rejection without state or result mutation
- clamping capacities above 65,535
- 65,536 semantic allocations without CID wrap
- local CID restart at 1 in a new shard
- serialization of every generated shard through `TryBuildLogicalType0Font()`
- equality between tracker count and serialized `maxp.numGlyphs`

All Phase 1 through Phase 4 tests remain in the focused executable.

## Review findings

A focused independent review checked:

- direct and transitive source-glyph accounting
- synthetic visual accounting
- semantic attachment to the original shard
- independent CID and GID capacities
- subtraction and allocation overflow safety
- failure mutation behavior
- tracker and serializer count agreement

The review reported no actionable correctness findings.

## Validation environment

- Operating system: Windows
- Compiler: MSVC through Visual Studio 2022 17.14
- Build system: CMake with Ninja
- Test framework: GoogleTest 1.17.0
- strict font parser: fontTools 4.61.1
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
65 tests from 8 test suites
65 passed
```

Phase 5 contributes 12 tests in the new logical-font-sharding suite.

### Production build

The existing PDF library compiled and linked successfully with the Phase 5 files included:

```text
cmake --build build/phase1-msvc --target PdfFile --config Release
```

Result:

```text
Success! [PdfFile.dll] is ready!
```

### Strict font parsing

The serialization test generated two independent physical logical-font shards. fontTools opened both with strict checksum checking:

```text
phase5-shard-0.ttf ok
phase5-shard-1.ttf ok
```

For each shard, the tracker's embedded-glyph count exactly equals the serialized `maxp.numGlyphs` value.

### PDF content validation

Phase 5 does not yet switch font resources in a PDF content stream. Multi-shard `Tj`/`TJ` serialization is Phase 6, so no synthetic multi-shard PDF fixture, qpdf check, Poppler extraction, or raster comparison was added in this phase.

Each generated shard was nevertheless serialized independently through the existing Phase 4 Type 0 font builder, including `/ToUnicode`, `/CIDToGIDMap`, widths, and `FontFile2` data.

### Static checks

- project diagnostics report no errors or warnings in the new and modified implementation/test files
- focused independent review reports no actionable findings
- `git diff --check` reports no whitespace errors after documentation updates

## Behavior impact

Phase 5 still does not modify or call:

- ordinary `CFontCidTrueType` allocation
- ordinary `EncodeUnicode()` or `EncodeGID()`
- ordinary PDF `/ToUnicode` or `/CIDToGIDMap` generation
- `CPdfWriter` text commands
- `CCommandManager` or `CTextLine`
- metafile commands or parsing
- `IRenderer`
- `sdkjs`

The new source-aware sharded mapper remains reachable only through the dedicated logical-font test path.

## Exit-criteria assessment

| Criterion | Result |
| --- | --- |
| count `.notdef` in every shard | passed |
| count unique used source glyphs | passed |
| count transitive source-composite dependencies | passed |
| count one GID per unique synthetic visual | passed |
| track semantic CID and embedded GID limits independently | passed |
| create a shard before either physical limit is exceeded | passed |
| keep repeated semantic keys on their original shard | passed |
| keep one visual and all dependencies in one shard | passed |
| explicitly fail when one visual cannot fit an empty shard | passed |
| support reduced deterministic test limits | passed |
| clamp limits to 65,535 and avoid allocation wrap | passed |
| preserve existing ordinary PDF behavior | passed |
| leave Phase 6 content serialization untouched | passed |

## Rollback boundary

Phase 5 is isolated to the parallel logical-font implementation and focused tests.

Rollback consists of removing `CShardedLogicalFontMapper`, `CLogicalCompactGlyphTracker`, their CMake entries and tests, and the visual-record lookup helper. The existing Phase 2 one-shard mapper and Phase 3/4 compact-font serializers remain independently usable.

## Next phase

Phase 6 will serialize logical CIDs in authoritative source order, select the correct physical font shard, and recover visual placement through retained text state and `Tj`/`TJ` displacement. That work has not started.
