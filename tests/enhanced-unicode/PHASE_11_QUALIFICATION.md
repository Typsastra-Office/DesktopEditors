# Phase 11: Conformance, interoperability, and performance qualification

## Status

Phase 11 qualifies the supported logical-font primitive implemented through the production `CPdfWriter` path.

Enhanced Unicode is qualified as an explicit PDF export option. Ordinary PDF exports retain the compatibility path, while **PDF (Enhanced Unicode)** applies the renderer capability before recalculation:

```javascript
AscCommon.ApplyEnhancedUnicodeOption({ enhancedUnicode: true });
```

The public switch remains available as a developer and rollback control.

The current result is:

```text
supported TrueType logical-font primitive: qualified
DesktopEditors Enhanced Unicode path:       explicit Save As option
broader corpus and viewer coverage:         continuing qualification
```

## Objective

Phase 11 evaluates PDF syntax, logical-font validity, extraction, source ordering, rendering comparison infrastructure, bounded font publication, and production telemetry. It also records the remaining qualification work for the opt-in export path.

## Deferred shard finalization

Phase 10 published a complete immutable logical PDF font snapshot whenever a shard gained a semantic CID. For a growing shard, that caused repeated subset construction and could approach quadratic work and output growth.

Phase 11 changes the lifecycle to:

```text
one mutable PDF font object graph per physical shard
    -> update one in-memory CID width while commands are queued
    -> mark the shard dirty when semantics grow
    -> rebuild /W, FontFile2, CIDToGIDMap, ToUnicode, and metrics once before save
```

`CPdfWriter::FinalizeLogicalFonts()` runs before `SaveToFile()` and `SaveToMemory()`. A finalization error is an explicit document save failure; the writer does not silently emit a stale CID mapping or reinterpret the failed logical command as legacy text.

The production scale fixture allocates 32 distinct semantic CIDs that share one visual record. It produces one logical Type 0 font object graph rather than 32 progressively larger snapshots. Per-command width tracking is amortized constant-time and does not rebuild `/W`; the complete `/W` array is rebuilt only during finalization.

## Embedded TrueType identity

The compact TrueType builder now accepts the generated PDF subset name. Logical fonts replace the embedded `name` table with deterministic Windows UTF-16BE records:

- name ID 1: `Logical`
- name ID 4: the generated subset name
- name ID 6: the generated subset name

For example:

```text
PDF /BaseFont:                 AAAAAB+Logical
PDF descriptor /FontName:     AAAAAB+Logical
embedded PostScript name ID 6: AAAAAB+Logical
```

Existing subset-builder callers that do not provide a logical font name preserve the source font's original `name` table.

## Production metrics

`core/PdfFile/LogicalTextMetrics.h` introduces `CLogicalTextMetrics`, exposed through:

```cpp
CPdfWriter::GetLogicalTextMetrics()
CPdfFile::GetLogicalTextMetrics()
```

Only source-font states with a published logical PDF font contribute source, shard, CID, visual, and embedded-GID totals. Unsupported states that fall back before publication are excluded.

The counters report:

- units received
- logical units completed
- compatibility fallbacks completed
- source fonts
- physical shards
- semantic CIDs
- visual records
- compact embedded GIDs
- logical PDF font publications
- bytes in the most recently finalized embedded logical fonts

Fallback accounting increments only after every compatibility component succeeds. `UnitsReceived` remains an attempted-command counter. `FinalEmbeddedFontBytes` describes the last successful finalization; live CID and visual counts can be newer while a shard is dirty.

The ordinary production fixture records:

```text
UnitsReceived: 2
LogicalUnits:  1
FallbackUnits: 1
```

The bounded scale fixture records:

```text
UnitsReceived:          32
LogicalUnits:           32
FallbackUnits:          0
SourceFonts:            1
Shards:                 1
SemanticCids:           32
VisualRecords:          1
FontPublications:       1
FinalEmbeddedFontBytes: nonzero
```

Saving the same writer a second time preserves `FontPublications` and `FinalEmbeddedFontBytes`. Byte-for-byte repeated serialization is not claimed: the existing document metadata path creates additional indirect metadata state on repeated saves and is outside the logical-font implementation.

## Qualification tools

### `qualify_phase11.py`

`tests/enhanced-unicode/qualify_phase11.py` combines independent syntax, reader, and font checks:

- `qpdf --check`
- Poppler normal extraction
- Poppler raw extraction
- pypdf extraction
- PyMuPDF extraction and search
- pdfminer extraction
- logical Type 0 font inventory
- `FontFile2` parsing and checksum validation with fontTools
- required static TrueType table checks
- embedded PostScript-name matching
- `/CIDToGIDMap` length and GID-range validation
- CID 0 to GID 0 validation
- `/CIDToGIDMap` coverage for every logical CID used directly by page content
- `/W` coverage for every logical CID used directly by page content
- `/ToUnicode` presence
- direct decoding of source-order CIDs through each logical font's `/ToUnicode`
- PDF byte, page, and logical-font counts

Expectation modes are:

```text
exact         every reader must return exactly the expected text
contains      every reader must contain the exact expected fragment
content-exact decoded logical PDF content must be exact; reader behavior is diagnostic
```

`content-exact` separates the producer invariant from reader bidi and layout heuristics.

### Rendering comparator

`tests/enhanced-unicode/compare_rendering.py` records:

- page dimensions
- changed pixel count and ratio
- maximum channel delta
- mean absolute error
- root mean square error

Thresholds are explicit in `tests/enhanced-unicode/phase11-thresholds.json`. A self-comparison passed with zero changed pixels and zero RMSE. This proves the comparator and threshold path, not pixel equivalence of a full feature-enabled DesktopEditors corpus export.

### PowerShell harness

`tests/enhanced-unicode/run_phase11.ps1` orchestrates:

1. baseline evidence capture
2. strict Phase 11 PDF qualification
3. optional rendering comparison

A strict structural smoke run completed successfully on the bounded logical-font fixture and found the installed Poppler, qpdf, Python, and veraPDF tools. Extraction is asserted only when `Expected` is supplied; the bounded private-use fixture intentionally runs structural checks without a reader-text expectation.

### Extraction audit

`tests/enhanced-unicode/audit_extraction.py --strict` now returns nonzero unless every normal corpus line exactly matches its authoritative source text.

## Production artifact results

### Combining sequence and compatibility fallback

Artifact:

```text
core/build/phase1-msvc/phase10-production-logical-unit.pdf
```

Result:

```text
PDF bytes:          10,631
logical fonts:      1
qpdf:               passed
fontTools:          passed
CIDToGIDMap:        passed
embedded name:      passed
reader expectation: exact U+0041 U+0301 fragment
```

All five extraction engines preserve the exact `U+0041 U+0301` fragment:

- Poppler normal
- Poppler raw
- pypdf
- PyMuPDF
- pdfminer

The Phase 10 statement that Poppler returned only `U+0041` came from an older artifact or a different Poppler executable. The Phase 11 harness resolves `pdftotext` beside `pdftoppm` and supersedes that observation.

### Bounded semantic growth

Artifact:

```text
core/build/phase1-msvc/phase11-bounded-logical-font.pdf
```

Result:

```text
PDF bytes:       10,722
logical fonts:   1
semantic CIDs:   32
visual records:  1
font publications: 1
qpdf:            passed
fontTools:       passed
```

This fixture demonstrates visual reuse and bounded publication for a growing semantic namespace. It is not a substitute for corpus-scale time and memory measurement.

## Source-order bidi fixture

Artifact:

```text
core/build/phase1-msvc/phase11-source-order-bidi.pdf
```

The production writer receives four units in this authoritative order:

```text
U+0627 U+0654
U+05E9 U+05C1
U+0041
U+05D1
```

Their visual X positions are deliberately nonmonotonic:

```text
60, 52, 20, 44 millimetres
```

The decoded PDF content remains exact source order:

```text
<0001> <0002> <0003> <0004>

0001 -> 0627 0654
0002 -> 05E9 05C1
0003 -> 0041
0004 -> 05D1
```

The strict `content-exact` qualification passes. Reader text APIs do not agree on one presentation because they apply bidi, geometry, line, and spacing heuristics:

- Poppler adds bidi controls and changes presentation order
- pypdf returns only part of the deliberately displaced line
- PyMuPDF splits the first unit onto a separate line
- pdfminer inserts a geometry-derived space

These results do not change the producer's source-order CID invariant, but they show that exact mixed-bidi copy behavior cannot be claimed from this synthetic placement fixture. A real shaped corpus and manual viewer selection tests remain required.

## PDF/A and PDF/UA

The installed veraPDF 1.30.2 ran successfully through the harness. It reports the ordinary PDF 1.7 fixture as failing PDF/A-1b, which is expected because the file has not been authored as PDF/A-1b.

Logical PDF output is deliberately disabled when `CDocument::IsPDFA()` is true and falls back to the existing path. Logical `/CIDSet` support has not been implemented. No PDF/A or PDF/UA conformance claim is made for Enhanced Unicode.

## Build and test results

The production `PdfFile` target and logical-text test executable compile and link with MSVC Release configuration.

Aggregate test result:

```text
106 tests from 13 suites
106 passed
```

The integration suite now covers:

- production logical Type 0 output
- successful compatibility fallback and accounting
- one PDF font publication for 32 semantic CIDs
- repeated-save logical metric stability
- source-order bidi CIDs at nonmonotonic visual positions

Zed diagnostics report no errors or warnings in the changed C++ and Python files. `git diff --check` passes.

## Performance assessment

Phase 11 removes the known quadratic snapshot behavior and demonstrates these bounded properties:

- one font publication per physical shard
- 32 semantic CIDs sharing one visual record
- one compact logical font in a 10,722-byte PDF
- final subset construction deferred to save

The configured ratio thresholds for PDF size, export time, and peak memory remain prospective. They cannot be accepted or rejected until the same real DesktopEditors corpus is exported once with Enhanced Unicode disabled and once enabled through the complete `sdkjs -> command 84 -> CPdfWriter` path.

## Remaining limitations and follow-up qualification

1. No stable headless path currently exports the full corpus through `sdkjs` shaping, command 84, and `CPdfWriter`.
2. Spaces, NBSP, tabs, numbering, math, breaks, temporary glyphs, forced glyphs, gaps, and text-to-path output are not uniformly represented as logical units.
3. Supported logical units and legacy commands can coexist in one document; whole-document preflight and replay are not implemented.
4. Multi-component compatibility fallback assigns semantic `U+0020` to later visual components and is sequential rather than atomic. `/ActualText` fallback is not implemented.
5. Logical PDF/A output, `/CIDSet`, PDF/UA, and tagged-PDF behavior are not qualified.
6. A real feature-enabled corpus has not been compared pixel-by-pixel against the Phase 0 export.
7. Adobe Reader, Chromium, Edge, Firefox, PDFium, selection order, and copied text still require manual interoperability testing.
8. Full-corpus export time, peak memory, PDF-size ratio, synthetic-glyph ratio, and visual-reuse ratio have not been measured.
9. A deferred finalization failure is fatal to save by design; transactional rollback to compatibility output is not implemented.

## Readiness verdict

Phase 11 validates the core representation and production logical-font bridge for the controlled static TrueType fixtures. The project has accepted the documented limitations and enabled Enhanced Unicode by default while broader corpus and viewer qualification continues.

Therefore:

```text
enable Enhanced Unicode by default
retain the feature switch as an immediate rollback boundary
keep compatibility fallback for unsupported units and font states
continue corpus, viewer, PDF/A, PDF/UA, and performance qualification
```
