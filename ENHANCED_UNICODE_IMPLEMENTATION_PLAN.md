# Enhanced Unicode Implementation Plan

## Purpose

This document defines a phased implementation plan for bringing the PDF Logical Text Units Version 4 architecture to DesktopEditors.

Reference architecture:

- [Krilla PDF Logical Text Units](https://github.com/Sovichea/krilla/blob/pdf-logical-unit/PDF_LOGICAL_UNITS.md)

Target repositories:

- `DesktopEditors`: integration, pinned submodule revisions, build, and end-to-end validation
- `core`: native renderer protocol, logical PDF fonts, derived TrueType fonts, and PDF serialization
- `sdkjs`: authoritative Unicode collection, shaped logical-unit construction, and metafile emission

Initial revisions used during planning:

- `core`: `fb7bb6af7ab4241fe3f80dbc45f07da1ca21218c`
- `sdkjs`: `bf4a2db383f2dc9712c328e8704d3c58abb6a93e`

Development forks:

- `https://github.com/Sovichea/core`
- `https://github.com/Sovichea/sdkjs`

## Progress

- Phase 0: complete; baseline corpus and findings are documented in `tests/enhanced-unicode/PHASE_0_BASELINE.md`
- Phase 1: complete in `core` commit `939e3e5bf5`; see `tests/enhanced-unicode/PHASE_1_NATIVE_LOGICAL_UNIT.md`
- Phase 2: complete in `core` commit `bfd601292d`; see `tests/enhanced-unicode/PHASE_2_SEMANTIC_VISUAL_ALLOCATION.md`
- Phase 3: complete in `core` commit `6714ccd998`; see `tests/enhanced-unicode/PHASE_3_COMPACT_SOURCE_FONTS.md`
- Phase 4: complete in `core` commit `20d7bb7525`; see `tests/enhanced-unicode/PHASE_4_SYNTHETIC_TRUE_TYPE.md`
- Phase 5: complete in `core` commit `95d6bef926`; see `tests/enhanced-unicode/PHASE_5_CAPACITY_SHARDING.md`
- Phase 6: complete in `core` commit `bf6b5da695`; see `tests/enhanced-unicode/PHASE_6_SOURCE_ORDER_SERIALIZATION.md`
- Phase 7: complete in `core` commit `62c618c6c3`; see `tests/enhanced-unicode/PHASE_7_LOGICAL_METAFILE_PROTOCOL.md`
- Phase 8: complete in `sdkjs` commit `4f8209a901`; see `tests/enhanced-unicode/PHASE_8_SDKJS_LOGICAL_UNITS.md`
- Phase 9: complete in `sdkjs` commit `e6fbf921fd`; see `tests/enhanced-unicode/PHASE_9_LOGICAL_METAFILE_EMISSION.md`
- Phase 10: complete in `core` commit `f0d766a85f`; see `tests/enhanced-unicode/PHASE_10_PDF_INTEGRATION.md`
- Phase 11: complete; logical-font primitive qualified and Enhanced Unicode enabled by default; see `tests/enhanced-unicode/PHASE_11_QUALIFICATION.md`
- Identity-V: explicit vertical logical units supported; see `tests/enhanced-unicode/IDENTITY_V_SUPPORT.md`
- Phase 12: not started

## Goals

The Enhanced Unicode path must keep the following identities separate:

```text
authoritative Unicode
    != shaping cluster
    != visual glyph construction
    != PDF semantic CID
    != embedded TrueType GID
```

For every logical text unit, the completed implementation must preserve:

- Exact authored Unicode without normalization or script-specific rewriting
- Authoritative source order in the PDF content stream
- Already-shaped visual glyph order within the unit
- Component advances and offsets
- An independent visual origin for bidirectional placement
- An unambiguous `/ToUnicode` mapping
- Exact visual output through either a source-backed or synthetic embedded glyph

The implementation must not normally rely on:

- An invisible duplicate text layer
- `/ActualText` as the primary semantic mechanism
- Visual-order PDF character codes
- GID-only semantic identity
- Non-standard PDF character-code widths

## Non-goals for the first implementation

The first implementation will not attempt to support every font format. The compact derived-font path will initially target static TrueType `glyf` fonts.

The following remain on the existing rendering path until separately designed and tested:

- CFF and CFF2 fonts
- Variable fonts that have not been instantiated to a supported static font
- Color, SVG, or bitmap-only glyph formats
- Fonts that cannot legally or technically be embedded and rewritten
- Automatic classification of rotated text as vertical writing; true vertical units use the explicit Identity-V contract

The existing ordinary text and PDF export paths must remain available and unchanged for unsupported cases.

## Core invariants

Every phase must preserve these invariants:

1. The ordinary renderer and ordinary PDF font path continue to work.
2. Enhanced Unicode is an additional path, not a global reinterpretation of existing GID commands.
3. Semantic identity is based on exact Unicode plus visual identity.
4. Visual identity contains no Unicode.
5. Different semantic units may share one visual embedded GID.
6. One semantic CID has exactly one `/ToUnicode` meaning.
7. Logical units remain in authoritative source order during PDF serialization.
8. Visual positioning is reconstructed from independent visual origins and logical advances.
9. CID 0 and embedded GID 0 remain reserved for `.notdef`.
10. A physical logical-font shard never exceeds 65,535 semantic CIDs or 65,535 compact embedded GIDs.
11. One visual and all of its source-glyph dependencies fit in one physical font shard.
12. Unsupported or invalid units fail explicitly or use a documented fallback; they must not silently corrupt extraction.

## Proposed data contract

The language-specific types may differ, but the cross-submodule contract should be equivalent to:

```text
PdfLogicalUnit {
    exact_unicode: Unicode scalar sequence
    logical_advance: number
    visual_x: number
    visual_y: number
    components: [
        {
            source_gid: integer
            x: number
            y: number
        }
    ]
    optional_debug_location
}
```

Contract rules:

- Units are emitted in authoritative Unicode source order.
- Components remain in shaped visual order within the unit.
- Unicode comes from the editor source model, not reconstructed per glyph.
- Component positions are relative to a stable unit origin.
- The visual origin is independent of the unit's source-order position.
- Coordinates, advances, counts, and Unicode scalars are validated before allocation.

## Branch and commit strategy

Use one feature branch in each repository:

```text
DesktopEditors: enhanced-unicode
core:           enhanced-unicode
sdkjs:          enhanced-unicode
```

Each phase should be committed independently. Update the top-level submodule pointer only after the corresponding submodule phase passes its tests.

Do not combine build-system cleanup, unrelated refactoring, and Enhanced Unicode behavior in the same commit.

---

# Phase 0: Freeze the baseline and build the corpus

## Objective

Establish reproducible rendering, extraction, and conformance baselines before changing text behavior.

## Work

- Record the exact `DesktopEditors`, `core`, and `sdkjs` revisions.
- Preserve the successful Windows build procedure.
- Create a controlled source-document corpus containing:
  - Plain Latin text
  - Latin ligatures such as `fi`, `ffi`, and `ffl`
  - Combining-mark sequences
  - Canonically equivalent but byte-distinct Unicode sequences
  - Emoji variation selectors and ZWJ sequences
  - Arabic
  - Hebrew
  - Mixed LTR and RTL text
  - Khmer
  - Devanagari
  - Thai and Lao
  - CJK text
  - Repeated identical visuals with different source Unicode
  - Repeated identical Unicode with different shaping or font features
- Export baseline PDFs.
- Capture:
  - Rendered page images
  - Poppler plain and raw extraction
  - Font and CMap inspection output
  - `qpdf --check` output
  - File sizes and embedded font glyph counts

## Tests

- The current application builds from a clean checkout with documented prerequisites.
- Every corpus file exports without a crash.
- Baseline output artifacts are reproducible enough for comparison.
- Existing known extraction failures are recorded rather than treated as test regressions.

## Exit criteria

- The corpus and baseline results are versioned or stored in a documented test-fixture location.
- Every later phase can run the same comparison commands.

## Rollback boundary

No runtime behavior changes occur in this phase.

---

# Phase 1: Define and test the native logical-unit contract

## Objective

Introduce a native logical-unit representation in `core` without changing metafile parsing or PDF output.

## Work in `core`

- Add native structures equivalent to:
  - `PdfLogicalUnit`
  - `LogicalComponent`
  - `LogicalUnitPlan`
  - `VisualUnitKey`
  - `SemanticUnitKey`
- Add validation for:
  - Empty Unicode sequences
  - Invalid Unicode scalars
  - Invalid GIDs
  - Empty component arrays
  - Non-finite coordinates and advances
  - Integer overflow during font-unit conversion
- Round visual coordinates and advances into source-font units before constructing keys.
- Keep the source font identity outside or as an implicit owner of the visual key.
- Add a test-only entry point that accepts manually constructed units.

## Tests

- Identical text and identical visual data produce equal semantic keys.
- Different text with the same visual data produces different semantic keys.
- The same text with different visual data produces different semantic keys.
- Equivalent floating-point inputs round deterministically into the same visual key.
- Invalid values are rejected with useful diagnostics.
- No existing `IRenderer` or PDF behavior changes.

## Exit criteria

- Native logical units can be created and planned entirely in tests.
- Key equality and validation behavior are deterministic.
- Existing `core` tests still pass.

## Rollback boundary

The new types have no production callers and can be removed without affecting existing export.

---

# Phase 2: Add semantic and visual allocation without font synthesis

## Objective

Prove the independent semantic-CID and visual-GID namespaces using manually constructed units.

## Work in `core`

- Add a dedicated `LogicalFontMapper` separate from the ordinary `CFontCidTrueType` path.
- Add a logical-font shard containing:
  - Semantic key to CID mapping
  - CID to exact Unicode mapping
  - Visual key to visual-record mapping
  - CID to visual-record mapping
  - CID width data
- Reserve CID 0.
- Allocate semantic CIDs in deterministic encounter order.
- Reuse an existing semantic CID only for an identical semantic key.
- Reuse a visual record when different semantic keys have identical visual keys.
- Do not serialize a font yet.

## Tests

- Identical semantic units reuse one CID.
- Different Unicode sharing one visual receives different CIDs.
- Different CIDs can reference one visual record.
- Identical Unicode with distinct visual constructions receives distinct CIDs.
- CID 0 is never allocated to normal text.
- Allocation order is deterministic.
- Ordinary PDF font allocation remains unchanged.

## Exit criteria

- Mapping tables exactly represent semantic and visual independence.
- Tests demonstrate the Krilla Version 4 collision cases.

## Rollback boundary

The mapper is test-only and is not connected to PDF serialization.

---

# Phase 3: Build compact source-backed TrueType fonts

## Objective

Serialize logical fonts containing only exact source-backed visuals, without synthetic composites.

## Work in `core`

- Implement compact GID remapping for used source glyphs.
- Read `glyf` and `loca` safely.
- Compute the transitive closure of dependencies for source composite glyphs.
- Reserve embedded GID 0 for `.notdef`.
- Rebuild or remap the required tables:
  - `glyf`
  - `loca`
  - `hmtx`
  - `hhea`
  - `maxp`
  - `head`
  - `post`
- Preserve or deliberately drop optional tables according to a documented policy.
- Support a visual as source-backed only when:
  - It contains exactly one component
  - The component offset is zero
  - The source GID is valid
  - The logical advance equals the nominal source-glyph advance
- Emit a Type 0 font containing:
  - `/Encoding /Identity-H`
  - `CIDFontType2`
  - `/ToUnicode`
  - Explicit `/CIDToGIDMap`
  - `/W`
  - Compact `/FontFile2`

## Tests

- A low source GID maps to a compact embedded GID.
- A high source GID such as 65,000 also maps to a small compact GID.
- Source composite dependencies are included transitively.
- Unused source glyphs are absent from the compact namespace.
- Different semantic CIDs can map to the same compact embedded GID.
- `/ToUnicode` preserves exact multi-scalar strings and supplementary characters.
- The generated font loads in FreeType or another strict font parser.
- Generated PDFs pass `qpdf --check`.
- Rendered output matches the ordinary source-backed path.

## Exit criteria

- Manually constructed one-glyph logical units render and extract correctly.
- Compact capacity depends on used glyphs and dependencies, not the source font's maximum GID.

## Rollback boundary

Only the test-only logical path uses the compact font builder.

---

# Phase 4: Add synthetic TrueType visual construction

## Objective

Represent positioned, multi-component, or altered-advance logical units as synthetic composite glyphs.

## Work in `core`

- Classify every visual as source-backed or synthetic.
- Append synthetic composite glyphs after compact source glyphs.
- Remap source component GIDs into the compact namespace.
- Encode component positions using valid TrueType composite arguments and flags.
- Store each logical visual's advance in `hmtx`.
- Recalculate:
  - Glyph bounding boxes
  - Font bounding box when required
  - `loca` offsets
  - `maxp` glyph count
  - Composite depth and component-count fields
  - `hhea` metric counts and extrema
  - Checksums and `checkSumAdjustment`
- Enforce component coordinate and logical-width limits.
- Reject visuals that cannot be represented exactly enough by the supported composite format.

## Tests

- A positioned single component becomes synthetic.
- A single component with a changed advance becomes synthetic.
- Multiple components become one synthetic embedded GID.
- Existing source composite components retain their own dependencies.
- Negative and positive component offsets render correctly.
- Boundary-valid component coordinates succeed.
- Out-of-range offsets and advances fail deterministically.
- Synthetic visual reuse occurs when the same visual key appears again.
- Different semantics sharing a synthetic visual map to one embedded GID.
- The derived font passes strict font parsing and PDF syntax checks.
- Pixel output matches the manually supplied component geometry.

## Exit criteria

- One PDF CID can paint a complete multi-GID logical unit.
- Synthetic construction is script-independent and driven only by geometry.

## Rollback boundary

Source-backed logical units continue to work even if synthetic support is disabled.

---

# Phase 5: Implement exact capacity tracking and sharding

## Objective

Prevent CID and embedded-GID overflow while retaining standard two-byte PDF codes.

## Work in `core`

- Add a compact glyph tracker that predicts:
  - `.notdef`
  - Unique used source glyphs
  - Transitive source composite dependencies
  - Unique synthetic visual glyphs
- Track semantic CID capacity independently from embedded GID capacity.
- Start a new physical logical-font shard before either capacity is exceeded.
- Keep repeated semantic keys attached to their original shard.
- Ensure one visual and all dependencies remain in one shard.
- Remove any possibility of wrapping an `unsigned short` allocation counter.

## Tests

- Semantic CID exhaustion creates a new shard.
- Embedded compact-GID exhaustion creates a new shard.
- Repeated semantic units do not consume additional capacity.
- Repeated visual units do not consume additional embedded GID capacity.
- Shared source dependencies are counted once.
- A large source font using only a few glyphs remains in one shard.
- A single visual that cannot fit in an empty shard fails explicitly.
- CID and GID 0 remain reserved in every shard.

## Exit criteria

- Capacity tests can exercise boundaries using reduced test limits.
- No allocation counter can wrap silently.

## Rollback boundary

Documents below one-shard capacity behave exactly as in Phase 4.

---

# Phase 6: Serialize logical CIDs in source order with `Tj` and `TJ`

## Objective

Render manually constructed logical units in authoritative source order while reproducing independent visual positions.

## Work in `core`

- Add a dedicated PDF command for drawing planned logical units.
- Retain active logical-font shard state.
- Emit `Tf` only when the shard changes or normal text-state rules require it.
- Keep semantic CIDs in input order.
- Group compatible units by shard and baseline.
- Emit one `Tm` at a group's visual origin.
- Emit `Tj` when units are exactly contiguous.
- Emit `TJ` when safe horizontal displacement is required.
- Calculate displacement using:

```text
expected_x = current_visual_x + current_logical_advance
displacement = next_visual_x - expected_x
TJ adjustment = -displacement * 1000
```

- End a group on:
  - Shard transition
  - Baseline change
  - Non-finite coordinate
  - Unsafe or insufficiently precise displacement
  - Tagging or marked-content boundary
  - Incompatible PDF graphics or text state
- Fall back to a new `Tm` group rather than reordering CIDs.

## Tests

- Contiguous LTR units use `Tj`.
- Gapped LTR units use a negative `TJ` adjustment.
- Backward RTL visual movement uses a positive `TJ` adjustment.
- CID byte order remains authoritative source order for LTR and RTL.
- Baseline changes create a new group.
- Shard changes emit the correct font resource.
- Rounded displacement reconstructs visual positions within the documented tolerance.
- Text operations do not cross tagging boundaries.
- Manually constructed Arabic, Hebrew, and mixed-direction runs render and extract correctly.

## Exit criteria

- Native tests prove source-order content and visual-order placement are independent.
- PDF text extraction matches the manual logical-unit input exactly.

## Rollback boundary

The ordinary `CCommandManager` and `CTextLine` paths remain unchanged.

---

# Phase 7: Add a versioned logical-unit metafile command

## Objective

Transport complete logical units from `sdkjs` to native `core` without breaking existing renderers.

## Work in `core`

- Define a new metafile command rather than changing command 83 in place.
- Specify a bounded binary layout containing:
  - Command/version identifier
  - Unicode scalar count and values
  - Logical advance
  - Visual origin
  - Component count
  - Source GID and relative X/Y for every component
  - Optional diagnostic source location only if needed and stable
- Add strict bounds and remaining-buffer checks before allocation.
- Reject negative or unreasonable counts.
- Validate Unicode scalars and coordinates.
- Extend `IRenderer` with a compatibility-safe logical-unit method.
- Implement the method in `CPdfWriter`.
- Define fallback behavior for renderers that do not implement Enhanced Unicode.
- Update metadata-only scanners and command skipping logic.

## Tests

- A serialized unit round-trips every field exactly or within defined numeric precision.
- Multiple units retain their input order.
- Multi-component units retain component order.
- Zero, negative, truncated, and excessive counts are rejected safely.
- Unknown command versions fail or skip according to the protocol policy.
- Existing command-83 files continue to parse unchanged.
- Existing non-PDF renderers continue to build and follow the documented fallback.

## Exit criteria

- A native metafile fixture can exercise the complete logical PDF path.
- Malformed input cannot cause an unbounded allocation or out-of-bounds read.

## Rollback boundary

Older documents and command 83 remain supported.

---

# Phase 8: Construct authoritative logical units in `sdkjs`

## Objective

Combine authored editor Unicode with HarfBuzz visual geometry without using `FillCodePoints()` as the semantic source.

## Work in `sdkjs`

- Identify authoritative source spans in the editor run model.
- Preserve original authored Unicode separately from substituted shaping input.
- Associate each shaped HarfBuzz cluster with its authoritative source span.
- Build an export-only logical unit containing:
  - Exact source Unicode
  - Logical advance
  - Positioned GID components
  - Independent visual origin
- Keep the existing grapheme representation for screen rendering.
- Do not make the current font/GID grapheme cache authoritative for Unicode.
- Ensure source-order unit traversal is explicit for:
  - LTR
  - RTL
  - Mixed bidi runs
  - Multi-code-point clusters
- Add an internal diagnostic mode that logs logical and visual order without changing output.

## Tests

- Latin ligatures produce one unit with exact source Unicode.
- Combining sequences preserve every authored scalar exactly.
- Font substitution does not replace authoritative Unicode metadata.
- Multi-glyph clusters retain all components in visual order.
- Emoji ZWJ and variation-selector sequences remain exact.
- Canonically equivalent strings remain distinct when authored distinctly.
- Arabic and Hebrew units are emitted in source order while retaining independent visual origins.
- Mixed-direction paragraphs produce stable logical order.
- Existing screen rendering is unchanged.

## Exit criteria

- Diagnostic logical units match source text and shaped geometry for the full corpus.
- No PDF or metafile behavior changes yet unless explicitly enabled for testing.

## Rollback boundary

The export-only logical-unit builder can be disabled without changing ordinary grapheme drawing.

---

# Phase 9: Emit logical units through the metafile

## Objective

Connect `sdkjs` logical units to the Phase 7 native command.

## Work in `sdkjs`

- Add the new metafile command constant and writer.
- Serialize one complete logical unit per command.
- Emit commands in authoritative source order.
- Preserve visual component order within each command.
- Add a capability or export-mode gate so existing renderers can continue receiving per-GID `tg()` calls.
- Avoid emitting both logical text and visible duplicate text for the same export operation.

## Tests

- JS-generated binary fixtures decode to the expected native structures.
- Exact Unicode survives JS-to-native transport.
- Multi-component positioning survives numeric serialization.
- Logical source order survives mixed bidi text.
- Legacy renderer mode emits the existing command sequence.
- Enhanced PDF mode emits only logical-unit commands for supported units.

## Exit criteria

- The complete corpus reaches `CPdfWriter` as validated logical units.
- Legacy behavior remains selectable and unchanged.

## Rollback boundary

Disable the capability gate to restore existing command-83 export.

---

# Phase 10: End-to-end PDF integration and fallback policy

## Objective

Enable Enhanced Unicode PDF export for supported units while safely retaining the ordinary path elsewhere.

## Work

- Add an explicit feature switch or export capability during development.
- Select the logical path only when:
  - The source font is supported
  - Embedding permits the derived font
  - The unit passes geometry and Unicode validation
  - The visual and dependencies can fit in a shard
- Define fallback granularity:
  - Whole run
  - Whole font
  - Whole page
  - Whole document
- Prefer a stable, documented boundary over mixing incompatible semantics unpredictably.
- Surface diagnostics for unsupported formats and validation failures.
- Keep ordinary PDF export as the default until the corpus passes.

## Tests

- Supported TrueType runs use logical fonts.
- Unsupported CFF/CFF2 runs use the documented fallback.
- Documents mixing supported and unsupported fonts remain valid.
- No invisible duplicate text is introduced.
- No logical unit is emitted twice.
- Ordinary export remains byte- or render-compatible when the feature is disabled.
- Enhanced export remains searchable and selectable.

## Exit criteria

- Feature-enabled builds produce valid PDFs across the corpus.
- Feature-disabled builds preserve current behavior.

## Rollback boundary

Disable the feature switch without reverting the underlying implementation.

---

# Phase 11: Conformance, interoperability, and performance qualification

## Objective

Decide whether Enhanced Unicode is ready to become the default supported TrueType export path.

## Validation matrix

For every corpus fixture, collect:

- Pixel rendering comparison
- Poppler normal extraction
- Poppler raw extraction
- Search results and match counts
- Selection order and copied text
- `qpdf --check`
- veraPDF PDF/A results when applicable
- veraPDF PDF/UA results when applicable
- Embedded font validity
- Embedded glyph count
- PDF size
- Export time
- Peak memory use

Test with multiple readers where practical:

- Poppler tools
- Adobe Acrobat or Reader
- Chromium PDF viewer
- Microsoft Edge PDF viewer
- Firefox PDF viewer
- PDFium-based tooling

## Required corpus outcomes

- Exact extraction for Latin ligatures and combining sequences
- Exact extraction for Arabic and Hebrew
- Correct source order for mixed bidi text
- Exact preservation of variation selectors and ZWJ sequences where represented by logical units
- Pixel-equivalent rendering within the accepted tolerance
- No malformed embedded fonts
- No CID or GID overflow
- No regression when Enhanced Unicode is disabled

## Performance thresholds

Set explicit thresholds after Phase 0 baselines. At minimum, measure:

- Additional export time
- Additional peak memory
- Resulting PDF size
- Logical-font shard count
- Semantic CID count
- Compact embedded GID count
- Synthetic glyph ratio
- Visual reuse ratio

Unexpected shard growth or low visual reuse should be treated as a potential keying or dependency-accounting defect.

## Exit criteria

- All required fixtures meet rendering, extraction, and syntax requirements.
- Known viewer-specific differences are documented as interoperability fixtures.
- Performance costs are understood and accepted.
- The feature can be enabled by default for its declared supported-font set.

---

# Phase 12: Documentation and upstream proposal

## Objective

Prepare the implementation for review and possible upstream adoption.

## Work

- Document the logical-unit contract in both `sdkjs` and `core`.
- Document the metafile command version and binary layout.
- Document supported fonts and fallback behavior.
- Include diagrams showing semantic CID, visual key, and embedded GID separation.
- Publish corpus results and reproducible validation commands.
- Keep commits separated by subsystem and phase.
- Open an architecture/research feature request before requesting a large merge.

## Exit criteria

- A reviewer can understand and test each subsystem independently.
- The implementation does not require knowledge of the Krilla source to understand its invariants.
- All submodule revisions are pinned in the top-level integration branch.

---

# Suggested test layers

## `core` unit tests

- Key identity and reuse
- Unicode scalar validation
- Font-unit rounding
- Compact dependency closure
- Composite serialization
- Metric rebuilding
- Capacity accounting
- Sharding
- `/ToUnicode`
- `/CIDToGIDMap`
- `Tj` and `TJ` positioning

## `core` binary fixture tests

- Valid logical-unit metafile commands
- Truncated and malformed commands
- Multi-component units
- RTL source-order units
- Shard transitions

## `sdkjs` unit tests

- Source span association
- Original versus substituted Unicode
- HarfBuzz cluster grouping
- Logical source order
- Visual component order
- Metafile encoding

## Top-level integration tests

- Build with pinned fork revisions
- Export controlled source documents
- Compare rendering and extraction
- Run PDF syntax and conformance tools

# Initial risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Original Unicode cannot be reliably associated with every shaped cluster | Incorrect extraction | Prove source-span construction in Phase 8 before enabling export |
| RTL units are emitted in visual order | Reversed extraction | Assert source-order unit sequences and inspect raw PDF codes |
| Existing grapheme cache supplies stale semantics or geometry | Incorrect units | Construct export units from source spans and current shaping output, not cached per-GID Unicode |
| Metafile counts are malformed or unbounded | Crash or memory exhaustion | Strict count and remaining-buffer validation in Phase 7 |
| Compact subset omits composite dependencies | Missing outlines | Test transitive dependency closure before synthesis |
| Synthetic offsets or advances overflow TrueType fields | Invalid embedded font | Validate before shard allocation and serialization |
| CID or GID counters wrap | Corrupt PDF | Preflight both capacities and shard before allocation |
| Unsupported font silently uses an invalid logical representation | Rendering or extraction failure | Explicit supported-font check and documented fallback |
| Logical output crosses tagging boundaries | PDF/UA regression | Reuse existing marked-content boundaries and add conformance fixtures |
| Viewer behavior differs despite valid PDF mappings | Inconsistent highlighting or search | Record reader-specific interoperability fixtures without rewriting Unicode |
| Derived-font work increases export time or memory excessively | Feature is impractical | Track performance from Phase 0 and inspect reuse/sharding metrics |

# Definition of done

Enhanced Unicode is complete for the declared supported path when:

- `sdkjs` emits exact authored Unicode in authoritative source order.
- Every logical unit retains its complete positioned visual construction.
- The metafile transports each unit atomically and safely.
- `core` separates semantic, visual, and embedded identities.
- Source-backed visuals reuse compact source glyphs.
- Other supported visuals use valid synthetic composites.
- Semantic and embedded capacities shard safely.
- PDF content codes remain in source order.
- `Tj`, `TJ`, and text matrices reproduce the shaped geometry.
- `/ToUnicode` maps every semantic CID to its exact Unicode sequence.
- Supported corpus documents render, extract, search, and select correctly.
- Generated PDFs and fonts pass syntax and conformance validation.
- Existing export remains available for unsupported fonts and as a rollback path.
