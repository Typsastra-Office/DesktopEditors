# Phase 0 baseline findings

## Status

Phase 0 baseline capture completed on 2026-08-31.

The baseline is intentionally a record of current behavior, including extraction failures. It is not an expected-correct output snapshot.

## Revisions

| Repository | Revision |
| --- | --- |
| `DesktopEditors` | `d1346335ec1667cbaffe94f7f9171fca3892a168` |
| `core` | `b40af1f8cd2dcfadbb89801a251199ca518ff256` |
| `sdkjs` | `bf4a2db383f2dc9712c328e8704d3c58abb6a93e` |

## Artifacts

| Artifact | Value |
| --- | --- |
| Generated DOCX | `generated/enhanced-unicode-corpus.docx` |
| DOCX SHA-256 | `b3cbd3dc1e6298ac5b8a1d842d48de90d7e54a6a9b328542c4ccbfeac6356d5a` |
| DesktopEditors PDF | `generated/desktopeditors-baseline.pdf` |
| PDF SHA-256 | `ad266d96ffe5a05975ce3f202ee6b03e84e4c11a8e7b8cb1503ce3c250e63aca` |
| PDF size | 352,122 bytes |
| PDF version | 1.7 |
| Render resolution | 144 DPI |

Generated inputs and captured results are ignored by Git. Recreate them with the commands in `README.md`.

## Tools

- qpdf 12.4.0
- Poppler 25.07.0
- veraPDF 1.30.2
- Python 3.10

## Validation summary

### PDF syntax

`qpdf --check` passes:

```text
No syntax or stream encoding errors found
```

### Font inventory

The PDF contains 11 embedded and subset CID TrueType fonts. Every listed font reports a Unicode map:

- Arial Bold
- Arial Italic
- Arial
- Segoe UI Emoji
- Segoe UI Symbol
- Khmer Pen Teu
- Nirmala UI
- Tahoma
- Leelawadee UI
- SimSun
- Batang

Poppler reports one non-fatal warning:

```text
Syntax Warning: Invalid Font Weight
```

### veraPDF

veraPDF reports failure against PDF/A-1b. The export was made as an ordinary PDF rather than through a declared PDF/A export mode, so this result records the current baseline but is not treated as a Phase 0 blocker.

```text
FAIL ... 1b
```

A later conformance corpus should use DesktopEditors' explicit PDF/A export option when testing PDF/A requirements.

## Extraction audit

The automated comparison checks each authoritative string from `corpus.json` against Poppler extraction.

| Metric | Result |
| --- | --- |
| Cases | 15 |
| Exact normal extraction | 6/15 |
| Exact string present in normal extraction | 6/15 |
| Exact string present in raw extraction | 4/15 |

### Exact normal extraction

- `latin-basic`
- `latin-ligatures`
- `combining-marks`
- `emoji-zwj`
- `lao`
- `cjk`

### Failed exact normal extraction

- `normalization-distinction`
- `whitespace-semantics`
- `variation-selectors`
- `arabic`
- `hebrew`
- `mixed-bidi`
- `khmer`
- `devanagari`
- `thai`

The complete expected and observed code-point arrays are recorded in:

```text
results/phase-0/extraction-audit.json
```

## Observed failure classes

### Authored normalization is not preserved

The composed half of the normalization fixture is extracted in decomposed form. Visually equivalent text survives, but exact authored Unicode does not.

### Distinct whitespace semantics collapse

The no-break space fixture is extracted as an ordinary space. The two visually similar strings therefore lose their semantic distinction.

### Variation selectors are lost or changed

The text and presentation-selector cases do not both preserve their exact authored scalar sequences.

### RTL source order is not preserved

Arabic, Hebrew, and mixed-direction fixtures do not extract as the authoritative source strings. Poppler output includes directional controls and reordered or incorrectly associated characters.

Raw extraction fragments RTL clusters further, confirming that the current per-GID PDF semantics are not a reliable logical representation.

### Complex-script clusters change extraction

The Khmer, Devanagari, and Thai fixtures contain duplicated, replaced, or reordered characters in extracted text even though the PDF fonts report `/ToUnicode` support.

This is the strongest Phase 0 evidence that the problem is mapping identity rather than simply a missing CMap.

### Raw extraction fragments visual components

Raw extraction splits the ZWJ fixture into separate component lines. Normal extraction reconstructs the expected sequence in this viewer, but raw content demonstrates that the PDF stores visual components independently rather than as one semantic unit.

## Visual inspection

The one-page 144 DPI render was inspected.

- Basic Latin, ligature candidates, combining marks, Arabic, Hebrew, mixed bidi, Devanagari, Thai, Lao, and CJK are visibly rendered.
- The supplementary ZWJ fixture appears as separate person glyphs rather than one joined family visual in this font/rendering path.
- The Khmer fallback has an unusually heavy geometric appearance but is present rather than replaced by missing-glyph boxes.
- Both variation-selector examples appear visually similar in the monochrome baseline.
- No entire test line is replaced by missing-glyph boxes.

Visual limitations are retained as baseline behavior. Phase 0 does not attempt to fix shaping or fallback-font selection.

## Baseline conclusion

The baseline satisfies the Phase 0 objective:

- DesktopEditors successfully exports the controlled corpus.
- The PDF is syntactically valid.
- All fonts are embedded subsets with Unicode maps.
- Rendering evidence is captured.
- Exact repository revisions and hashes are recorded.
- Current extraction failures are reproducible and classified.

The result supports proceeding to Phase 1. The existing PDF path can render the document, but its per-GID semantic assignments do not preserve authoritative Unicode for 9 of the 15 controlled cases.
