# Enhanced Unicode Phase 0 baseline

This directory implements Phase 0 of `ENHANCED_UNICODE_IMPLEMENTATION_PLAN.md`. It creates a controlled Unicode document and captures reproducible evidence from PDFs exported by DesktopEditors.

No runtime behavior is changed in this phase.

## What this baseline exercises

The corpus covers:

- Ordinary Latin text
- Latin ligature candidates
- Combining marks
- Distinct authored normalization forms
- Visually similar whitespace with different Unicode semantics
- Variation selectors
- Supplementary Unicode and a ZWJ sequence
- Arabic
- Hebrew with marks
- Mixed LTR and RTL text
- Khmer
- Devanagari
- Thai
- Lao
- CJK fallback fonts

`corpus.json` is the authoritative source for fixture text. Cases that contain supplementary or presentation-sensitive characters use hexadecimal code-point arrays so source files do not contain literal emoji.

## Prerequisites

Required:

- Python 3
- DesktopEditors built and runnable
- Poppler tools: `pdftotext.exe`, `pdftoppm.exe`, and `pdffonts.exe`
- qpdf

Optional but recommended:

- veraPDF

The default local veraPDF path is:

```text
C:\Users\Sovichea\AppData\Local\Programs\veraPDF\verapdf.bat
```

## 1. Generate the source document

From the repository root:

```powershell
python .\tests\enhanced-unicode\generate_corpus.py
```

The generator writes:

```text
tests\enhanced-unicode\generated\enhanced-unicode-corpus.docx
```

The DOCX is deterministic. Re-running the generator with the same Python and manifest content should produce identical bytes.

## 2. Export through DesktopEditors

This step is intentionally performed through the DesktopEditors application because the Enhanced Unicode work will connect the `sdkjs` shaping path to the native PDF writer.

1. Start the staged application:

   ```powershell
   .\desktopeditors\DesktopEditors.exe
   ```

2. Open:

   ```text
   tests\enhanced-unicode\generated\enhanced-unicode-corpus.docx
   ```

3. Use the application's PDF export function.
4. Save the output as:

   ```text
   tests\enhanced-unicode\generated\desktopeditors-baseline.pdf
   ```

Do not use `x2t` as the authoritative Phase 0 export. A direct converter invocation does not prove that the `sdkjs` shaping and metafile path was exercised.

Record any font-substitution warning or visibly missing glyph before continuing.

## 3. Capture the baseline

```powershell
.\tests\enhanced-unicode\capture_baseline.ps1 `
    -PdfPath .\tests\enhanced-unicode\generated\desktopeditors-baseline.pdf `
    -Name phase-0
```

The result is written under:

```text
tests\enhanced-unicode\results\phase-0\
```

It contains:

- The captured PDF
- SHA-256 and exact repository revisions
- Normal Poppler extraction
- Raw Poppler extraction
- An exact code-point audit against `corpus.json`
- Rendered PNG pages at a fixed DPI
- Embedded-font inventory
- qpdf syntax report
- veraPDF report when installed

Generated documents and results are ignored by Git. Promote selected expected outputs into a separately reviewed fixture directory only after confirming that they do not contain machine-specific paths or nondeterministic metadata.

## 4. Compare a later candidate

Capture the candidate under a different name, then run:

```powershell
.\tests\enhanced-unicode\compare_baseline.ps1 `
    -BaselineDir .\tests\enhanced-unicode\results\phase-0 `
    -CandidateDir .\tests\enhanced-unicode\results\candidate
```

The strict comparison checks:

- Normal extraction bytes
- Raw extraction bytes
- Rendered PNG page bytes

A difference is not automatically a defect. Enhanced Unicode is expected to improve some extraction output. Every difference must nevertheless be reviewed and explained.

## Baseline acceptance checklist

- The generated DOCX opens successfully.
- Every corpus heading and test line is present.
- No expected script is replaced entirely by missing-glyph boxes.
- DesktopEditors exports the document without crashing.
- `qpdf --check` passes.
- Poppler produces normal and raw extraction files.
- Every PDF page renders to PNG.
- The font inventory and repository revisions are recorded.
- veraPDF runs, or its absence is explicitly recorded.
- `extraction-audit.json` records expected and observed code points.
- Known extraction errors are documented before implementation starts.

The checked Phase 0 findings are summarized in `PHASE_0_BASELINE.md`.

## Current automation boundary

No stable headless DesktopEditors PDF-export option was identified in the checked application path. Corpus generation and PDF analysis are automated; the UI export is the only manual step.

If a future automation route is added, it must demonstrate that it exercises:

```text
sdkjs shaping
    -> metafile text commands
    -> native renderer
    -> CPdfWriter
```

before replacing the manual export procedure.
