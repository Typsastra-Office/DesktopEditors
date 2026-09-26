# Typsastra Office — Typst-IR Agentic DOCX Editing Plan

Status: deferred proposal · Scope: later text-only agent editing via Typst

**Current priority:** finish the Typst → DOCX converter and its deterministic
fidelity tests first. The active roadmap lives in the separate Typst repository
at `crates/typst-docx/IMPLEMENTATION_PLAN.md`. Nothing in this agentic plan is a
prerequisite for running the converter, and existing live sdkjs tools need not
be expanded while converter fidelity is the focus.

## Objective

Use **Typst as the editable intermediate representation** between a text-only
LLM provider and an editable DOCX. The agent reads and changes textual Typst IR,
compiles it to DOCX, and receives textual compilation/export diagnostics. It
does not need screenshots, image understanding, or an editor-in-the-loop review
to produce the document.

The `typst-docx` tool is responsible for deterministic fidelity. **During tool
development and CI only**, compare its output against a PDF generated from the
same Typst revision, using machine-readable geometry and structure rather than
human or model-based visual inspection. This comparison calibrates and tests the
converter; it is not repeated by the LLM for every editing request. The
Typsastra Office sdkjs DOCX layout IR is an independent read-side observation
of DOCX layout, not part of the Typst IR or `typst-docx`'s internal IR.

An existing DOCX needs an explicit DOCX → Typst import with a coverage report
before the agent can edit it. New documents can begin directly in Typst. Once
imported or authored, the Typst IR is the source of truth for subsequent agent
edits and DOCX exports.

## Architecture

```text
  existing DOCX ── importer + coverage report ──┐
                                                  ├─ textual Typst IR + assets
  new document ── Typst template ─────────────────┘             │
                                                       text-only LLM edits IR
                                                                 │
                                                   Typst compiler + typst-docx
                                                                 │
                                                 editable DOCX + diagnostics

  Tool development / CI only:
  same Typst IR ── Typst PDF + layout geometry (reference)
                └─ DOCX → sdkjs DOCX layout IR (independent observation)
                       └─ external deterministic fidelity assertions
```

The reference PDF and DOCX are compiled from the **same** Typst source, assets,
fonts, and pinned tool versions. The compiler's layout geometry is the primary
machine-readable counterpart of the PDF; the existing sdkjs
`GetAgentDocumentSnapshot` can supply DOCX page and paragraph geometry in tests.
Extend its coverage (e.g. drawings and columns) as needed without moving that
schema into `typst-docx`. No screenshot or multimodal LLM judgment is part of
the acceptance path.

## Separate responsibilities for the two IRs

| Representation | Owner | Purpose |
| --- | --- | --- |
| Typst IR | Typst source/compiler and the agent editing layer | Authoritative, textual, editable document model and PDF/layout reference |
| DOCX layout IR | Typsastra Office sdkjs | Read-only measurement of the imported DOCX; may also provide **textual** agent diagnostics |
| Export mapping | `typst-docx` | Source id → OOXML id/media relationship for correlating the two, without embedding sdkjs types in Typst |

The build-time comparator consumes both independent representations. At runtime
an agent may optionally use sdkjs layout findings as text to choose another
Typst edit, but neither the sdkjs IR nor a PDF comparison is a prerequisite for
normal export, and the agent never mutates the DOCX layout IR.

## Text-only Typst IR contract

- The canonical editable representation is Typst source plus a manifest of
  stable asset handles, source-node ids, style tokens, and import/export coverage.
  Keep the manifest textual and bounded; binary assets remain external files.
- Expose a compact text outline to the provider: section hierarchy, paragraphs,
  tables, figures, labels, styles, and source ranges. The provider never needs
  to read raw OOXML or an image to select an edit target.
- Support source-aware patch operations keyed by stable ids or ranges; reject
  stale revisions and report Typst diagnostics with source locations. Edits
  retain an undoable Typst revision and regenerate the DOCX deterministically.
- Keep semantic constructs explicit: headings, lists, tables, equations,
  captions, references, columns, headers/footers, and floating placements must
  not be silently flattened or dropped during export.
- For imported DOCX, report unsupported constructs and fidelity limits as text
  before edits. Do not imply lossless round-tripping where the importer cannot
  represent a feature in Typst IR.

## DOCX export contract

- Emit native editable Word paragraphs, styles, lists, tables, equations,
  captions, columns, and page-region content wherever the representation permits.
- For complex vector drawings such as CeTZ, keep the **drawing code in Typst**.
  Render the evaluated drawing frame to SVG **at export time**, embed that SVG
  as DOCX media with the correct dimensions and relationship, and keep the
  caption as editable Word text. Do not replace the Typst drawing with a
  pre-rendered image in the IR. Mark the DOCX drawing as an intentional visual
  fallback; subsequent agent edits still change the Typst source.
- Record source-node → OOXML node/media relationships so textual diagnostics
  can name the affected Typst source location and exported object.
- Detect missing content explicitly. An empty figure, lost column text, broken
  image relationship, or omitted equation must fail a coverage check rather
  than produce an apparently successful DOCX.

## Deterministic build-time fidelity checks

For a pinned benchmark corpus, generate PDF, compiler-native layout data, and
DOCX from the same Typst IR. Compare **data**, not rendered screenshots:

1. **Semantic coverage:** source and DOCX text in reading order, headings,
   table cells, captions, equations, figures, columns, footnotes, and links.
2. **Geometry:** page size/count, margins, text baselines and bounding boxes,
   column widths/gutters, table tracks, image/SVG bounds, and header/footer
   positions. Match source nodes to DOCX objects using the export map; compare
   sdkjs DOCX layout IR to the Typst PDF/layout reference with explicit units
   and tolerances in an **external test harness**, not inside `typst-docx`.
3. **Vector assets:** assert the CeTZ frame produced nonempty SVG, is packaged
   in `word/media`, referenced from DrawingML, and has the expected aspect
   ratio and displayed bounds. Check that its caption remains editable text.
4. **Repeatability:** identical pinned inputs yield the same logical DOCX
   structure, media content, and diagnostics; normalize ZIP timestamps and
   volatile ids before byte-level comparisons.

If sdkjs layout IR lacks the required geometry, check OOXML structure and
declared dimensions and mark those measurements **unmeasured** until sdkjs
exposes them. Do not claim a visual match from source measurements alone.

The `complex-benchmark.typ` fixture covers CeTZ flowcharts, a graph and chart,
Calibri typography, double/triple columns, floats, images, equations, listings,
tables and captions. It should remain authored as Typst, including its CeTZ
code; generated SVGs belong only in the DOCX package.

## Agent loop (text only)

1. **INSPECT:** receive the Typst outline, source ids, import coverage (if
   applicable), and textual compiler/export diagnostics.
2. **EDIT:** apply a bounded source-aware Typst patch.
3. **COMPILE:** run Typst and `typst-docx`; return diagnostics and a new DOCX.
4. **REPAIR:** if compilation or coverage fails, patch the cited Typst nodes;
   stop on success or a bounded retry limit.

The agent does **not** render or compare pages. PDF/layout-versus-DOCX fidelity
is a converter development test, not a per-document agent tool call.

## Later implementation milestones

### Prerequisite — converter qualification (active in the Typst repository)

Meet the content-coverage, native editability, and measured-geometry gates in
`crates/typst-docx/IMPLEMENTATION_PLAN.md` before starting work below. Build-time
comparison with the Typst PDF/layout reference may use the **separate** sdkjs
DOCX layout IR; it is not part of `typst-docx`'s internal representation or a
per-request agent workflow.

### Future phase 1 — DOCX import and textual editing surface

- Import supported existing DOCX objects into Typst IR and external assets;
  publish a textual coverage report for unsupported objects.
- Provide stable source ids, bounded textual outlines, typed patch operations,
  revision checks, undo, and source-linked diagnostics for text-only providers.

Acceptance: a provider can edit an imported or new document and export a DOCX
without receiving images or raw OOXML; unsupported import is never silent.

### Future phase 2 — Existing-document synchronization

- For Typst-authored DOCX, persist a source/asset bundle and an export mapping.
  Translate supported subsequent user edits into Typst source changes before
  regeneration; surface conflicts rather than overwriting user work.
- For arbitrary existing DOCX, keep unsupported parts explicit and preserve
  them through a documented import/export strategy. Until import coverage is
  sufficient, use the existing sdkjs live-edit path for those documents.

Acceptance: regenerating DOCX from Typst does not silently discard a user edit,
and unsupported edits have a clear conflict or native-edit path.

### Future phase 3 — Agent workflow qualification

- Exercise text-only providers against new and imported Typst-backed documents,
  including user-edit conflicts and unsupported-import diagnostics.
- Measure patch success, source/DOCX synchronization, tool rounds and how often
  the agent resolves a textual diagnostic without damaging unrelated content.

Acceptance: the provider receives actionable textual diagnostics, and its edits
preserve existing user work without needing image-based feedback.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Typst HTML drops CeTZ placement and column content | Export evaluated drawings as SVG; add semantic column support; fail coverage checks until fixed |
| SVG is not an editable Word shape | Preserve editable CeTZ in Typst IR and document the export fallback |
| Word and Typst paginate differently | Use measured DOCX geometry in build tests, calibrated against the same-source Typst PDF/layout |
| Import cannot express an existing DOCX object | Report loss and block unsupported round-trip claims; preserve an explicit asset or opaque reference only when safe |
| Font substitution changes line breaks | Pin fonts during development tests and report substitutions |
| Source ids drift across edits | Bind ids to source-aware nodes and persist an export mapping per revision |
