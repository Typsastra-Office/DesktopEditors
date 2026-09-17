# Phase 2 semantic and visual allocation

## Status

Phase 2 completed on 2026-08-31.

The implementation is committed as `bfd601292d` on the `enhanced-unicode` branch of the `core` fork, based on Phase 1 commit `939e3e5bf5`. The top-level `DesktopEditors` repository records the Phase 2 revision through its `core` submodule pointer.

This phase remains isolated from PDF font serialization and ordinary font allocation.

## Objective

Prove that PDF semantic CIDs and reusable visual records can be allocated as independent namespaces using manually constructed and planned logical text units.

The required relationship is:

```text
exact Unicode + visual key
    -> semantic CID

visual key
    -> reusable visual record

semantic CID
    -> exact Unicode + visual record + width
```

This allows different authored Unicode sequences to receive different semantic CIDs while sharing one visual construction.

## Work completed

### Logical font mapper

Added:

- `core/PdfFile/SrcWriter/LogicalFontMapper.h`
- `core/PdfFile/SrcWriter/LogicalFontMapper.cpp`

The new `CLogicalFontMapper` owns one `CLogicalFontShard`. Phase 5 can extend this abstraction to multiple physical shards without changing the Phase 2 identity rules.

The mapper is separate from `CFontCidTrueType` and has no production callers.

### Independent identifier namespaces

Defined separate identifier types:

- `TLogicalCid`
- `TLogicalVisualRecordId`

Both namespaces reserve identifier 0. The first normal semantic CID and visual record therefore receive identifier 1.

The identifiers use 32-bit storage during the test-only allocation phases. Physical two-byte PDF CID and compact embedded-GID capacity enforcement is deliberately deferred to Phase 5 sharding.

### Logical font shard tables

`CLogicalFontShard` maintains:

- semantic key to CID mapping
- visual key to visual-record ID mapping
- CID records containing exact Unicode, visual-record ID, and width
- visual records containing the complete visual key

The shard exposes read-only record lookup and semantic/visual counts for focused tests. Record storage uses `std::deque`, so pointers returned by lookup remain stable when later mappings append more records.

### Deterministic allocation

`CLogicalFontShard::Map()` follows this sequence:

1. Construct the semantic key from exact Unicode and the planned visual key.
2. Reuse the existing CID when the complete semantic key already exists.
3. Otherwise, reuse an existing visual record when the visual key matches.
4. Allocate a new visual record only when the visual key is new.
5. Allocate a new semantic CID in first-encounter order.
6. Store exact Unicode, the visual-record reference, and planned width under that CID.

Ordered maps provide deterministic key lookup, while IDs are assigned from record counts so allocation follows encounter order rather than key sort order.

### Mapping result

`CLogicalFontMapping` reports:

- semantic CID
- visual-record ID
- whether the semantic record was newly allocated
- whether the visual record was newly allocated

This makes semantic reuse and visual reuse independently observable in tests.

### Build integration

Updated:

- `core/PdfFile/CMakeLists.txt`
- `core/PdfFile/tests/LogicalText/CMakeLists.txt`

The new mapper is compiled into `PdfFile.dll`, but no renderer, font writer, or PDF command calls it. Its behavior is exercised only through the focused logical-text GoogleTest target.

## Test coverage

Added `core/PdfFile/tests/LogicalText/LogicalFontMapperTest.cpp` with nine mapper tests.

### Semantic reuse

- identical Unicode and visual construction reuse one CID
- repeated semantics do not allocate another visual record
- reuse reports that neither semantic nor visual state was created again

### Semantic and visual independence

- different Unicode sharing one visual receives different CIDs
- those CIDs reference the same visual record
- each CID retains its own exact Unicode payload
- identical Unicode with different visuals receives different CIDs
- different visual records are allocated for different visual constructions

### Complete visual identity

Tests verify that visual identity changes when any of these change:

- advance width
- component position
- component count
- component order
- source GID

Unicode, visual X/Y placement, and optional source location do not participate in visual identity.

### Reserved identifiers and records

- CID 0 is never allocated
- visual-record ID 0 is never allocated
- out-of-range record lookups return no record
- CID records retain exact Unicode, width, and visual-record reference
- visual records retain the complete visual key
- record pointers remain valid after later allocations

### Deterministic encounter order

Two independent mappers receiving the same unit sequence allocate identical CID and visual-record sequences.

A later semantic unit can reuse the first visual record even after a different visual was allocated between encounters.

## Review findings

A focused independent review found no semantic/visual identity defect.

The review identified that pointers returned from vector-backed record tables could be invalidated by later allocations. Before Phase 2 completion, both record tables were changed to `std::deque`, and a regression test was added that retains record pointers across many subsequent mappings.

Additional tests were also added for:

- every visual-key dimension
- both CID Unicode payloads when a visual is shared
- visual Y and optional source location exclusion

The review noted that shard identity must become part of the mapping context when Phase 5 introduces multiple shards. That API evolution is intentionally deferred until sharding exists.

## Validation environment

- Operating system: Windows
- Compiler: MSVC 19.44.35228.0
- Build system: CMake 3.30.3 with Ninja 1.12.1
- Test framework: GoogleTest 1.17.0
- Build configuration: Release

## Results

### Focused CTest target

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

The expanded executable result is:

```text
25 tests from 4 test suites
25 passed
```

This total contains the nine Phase 2 mapper tests and all 16 Phase 1 planning, key, and validation tests.

### Production build

The top-level Windows build successfully compiled the mapper and linked the existing PDF library:

```text
cmake --build . --target PdfFile --config Release
```

Result:

```text
Success! [PdfFile.dll] is ready!
```

### Static checks

- `git diff --check` passed.
- Zed diagnostics reported no errors or warnings in the mapper and tests.
- The local CMake, vcpkg, and test outputs remained ignored.

## Behavior impact

Phase 2 does not modify or call:

- `CFontCidTrueType`
- `EncodeUnicode()` or `EncodeGID()`
- `/ToUnicode`
- `/CIDToGIDMap`
- TrueType subsetting
- `CCommandManager` or `CTextLine`
- metafile commands or parsing
- `IRenderer`
- `sdkjs`

No font or PDF object is serialized from the new mapper. Existing PDF font allocation therefore remains unchanged.

## Exit-criteria assessment

| Criterion | Result |
| --- | --- |
| identical semantic units reuse one CID | passed |
| different Unicode sharing one visual receives different CIDs | passed |
| different CIDs can reference one visual record | passed |
| identical Unicode with distinct visuals receives distinct CIDs | passed |
| CID 0 is never allocated | passed |
| allocation follows deterministic encounter order | passed |
| mapping tables preserve semantic and visual independence | passed |
| ordinary PDF allocation remains unchanged | satisfied by isolation and successful production build |
| focused Phase 1 and Phase 2 tests pass | 25/25 passed |
| existing full `core` test suite passes | not rerun; only the focused logical-text CTest target was built and executed |

## Deferred work

Phase 2 deliberately does not implement:

- compact source-GID remapping
- source composite dependency closure
- TrueType table rewriting
- synthetic composite glyphs
- physical CID or embedded-GID limits
- multi-shard allocation
- font serialization
- `/ToUnicode` or `/CIDToGIDMap` output
- source-order `Tj` or `TJ` serialization

Compact source-backed TrueType font construction begins in Phase 3. Exact capacity enforcement and multiple physical shards begin in Phase 5.
