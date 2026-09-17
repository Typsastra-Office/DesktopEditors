# Typsastra Office Preview Release Policy

Status: Draft

Last updated: 2026-09-06

## Purpose

This document defines how the project can deliver Khmer-focused improvements to
Cambodian users without waiting for those changes to be accepted upstream. It
also defines a separate, slower path for preparing contributions that can be
explained and maintained during upstream review.

The proposed public distribution name is **Typsastra Office Preview**. The name,
logo placement, and other branding remain subject to the licensing and
trademark review described below.

## Development principles

The project prioritizes making useful Khmer-language functionality available
early, gathering feedback from relevant users, and correcting defects quickly.
That approach must be paired with clear expectations and safeguards because an
office suite handles important user documents.

- Preview releases must be identified as experimental rather than stable.
- AI-assisted implementation must be disclosed honestly.
- A binary must always have corresponding, buildable public source code.
- Features with a risk of changing document output must be opt-in until they
  have sufficient regression coverage.
- Users must be encouraged to retain their original documents and backups.
- Known limitations must be published with each release.

## Two-track development model

### Cambodia-first release track

The shipping branch should remain independent of upstream review, for example:

```text
release/typsastra-preview
```

This branch may integrate tested features at a faster pace and publish preview
binaries from the project's own repositories. Suggested versioning is:

```text
Typsastra Office Preview 0.1
Based on Euro Office 9.3.1
Build 9.3.1-typsastra.1
```

The release must not claim upstream approval or upstream-grade stability.

### Upstream contribution track

Upstream pull requests should be prepared later as small, independent changes.
Before submitting one, the maintainer should have personally reviewed the
affected paths and be able to explain:

- the problem and intended behavior;
- the data flow and important invariants;
- why the selected implementation is appropriate;
- ownership and licensing of included code and data;
- tests performed and their limitations;
- likely failure modes and compatibility impact;
- how the change will be maintained after merge.

Candidate upstream changes should be separated into digestible topics:

1. Unicode word-boundary handling.
2. Khmer language registration.
3. WASM resource loading and lifecycle.
4. Khmer spellcheck routing, suggestions, and user dictionary behavior.
5. PDF logical-unit transport.
6. Logical-font and Unicode extraction support.
7. Desktop exact-layout export integration.

There is no requirement for the upstream contribution schedule to block public
preview releases.

## AI-assisted development policy

AI-assisted implementation is permitted and should be treated as a development
method, not as a substitute for project ownership. Preview binaries may contain
code that has not yet received complete line-by-line human review when all of
the following are true:

- the release is explicitly experimental;
- relevant behavior has focused tests;
- the scope and known risks are documented;
- changes affecting document integrity have conservative defaults;
- users have a public place to report reproducible defects;
- the exact source used to build the binary is published.

Code in security-sensitive paths, installers, update mechanisms, cryptography,
or code capable of silent document loss requires human review before public
release.

Recommended release disclosure:

> Typsastra Office Preview is developed with AI-assisted implementation and
> human-directed testing. Some changes have not yet received complete
> line-by-line human review. It is an experimental release intended to make
> Khmer-language functionality available early. Retain backups of important
> documents and report reproducible issues through the public issue tracker.

An upstream pull request has a higher readiness standard than a preview
release. It should not be submitted until its author can reasonably answer a
reviewer's technical and maintenance questions.

## Feature risk policy

### Khmer spellcheck

Khmer spellcheck is relatively low risk because it annotates text without
changing document content unless the user accepts a correction. It may be
enabled in preview releases after tests cover:

- continuous Khmer text segmentation;
- exact UTF-16 source ranges across formatting runs;
- unknown and misspelled word underlines;
- correction suggestions;
- adding a word to the local user dictionary;
- mixed Khmer and non-Khmer spellcheck routing.

Dictionary-policy decisions, such as whether colloquial forms are accepted,
must be distinguished from integration defects.

### Enhanced-Unicode PDF export

Enhanced-Unicode PDF export changes serialized output and has a higher risk.
Until it has broad regression coverage, it must:

- remain opt-in and be labelled **Experimental**;
- use Save As or Export rather than silently overwriting the source document;
- preserve unrelated page geometry;
- retain image rendering and page layout;
- verify copy, search, and text extraction for Khmer and other complex scripts;
- report known overflow or fidelity limitations;
- recommend keeping the source document.

The normal PDF export path should remain available as a fallback.

## Branding and attribution

The codebase is derived from Euro Office and ultimately from ONLYOFFICE. Its
license and trademark obligations must be reviewed separately from the
technical ability to change build-time names and assets.

The repository's `LICENSE` requires preservation of legal notices and contains
an additional condition concerning the original ONLYOFFICE logo. ONLYOFFICE's
published licensing FAQ also states that its logo may not be removed or
replaced under its AGPL distribution and directs co-branding requests to its
sales department:

- <https://www.onlyoffice.com/license-faq>
- <https://www.onlyoffice.com/trademark-policy>

Accordingly:

- use **Typsastra Office Preview** only after an ordinary name and trademark
  clearance appropriate to the intended markets;
- state clearly that the program is an unofficial modified fork and is not
  affiliated with or endorsed by Euro Office or ONLYOFFICE;
- retain required copyright, license, warranty, modification, and origin
  notices;
- identify ONLYOFFICE as the original developer and Euro Office as the
  intermediate fork in the About and legal-information interfaces;
- do not replace a required ONLYOFFICE logo with the Typsastra logo without
  written permission or qualified legal advice;
- obtain written guidance before treating a secondary Typsastra logo as
  permitted co-branding;
- do not treat Euro Office's existing branding as proof that another rebrand
  satisfies inherited license or trademark conditions.

This document records a conservative project policy and is not legal advice.

## Khmer linguistic-data restriction

The Khmer segmenter software is MIT licensed, but the bundled Khmer linguistic
data has separate terms documented in:

```text
sdkjs/common/spell/khmer/DATA_LICENSE.md
```

The bundled dictionary is currently described as redistributable for
**noncommercial use with attribution**. Any release containing it must:

- remain noncommercial;
- retain the data notice and required credits;
- identify the Royal Academy of Cambodia source and Seanghay Hay's published
  extraction;
- retain provenance for adapted and correction data.

Before any paid, commercially bundled, or commercially licensed distribution,
the project must obtain permission for that data or replace it with a
commercially compatible dictionary. Independently supplied dictionaries may be
used with the MIT-licensed segmenter subject to their own terms.

## Binary release requirements

Every public binary release must provide:

- a permanent release tag matching the binaries;
- complete corresponding source under the applicable AGPL terms;
- exact submodule commit IDs;
- build scripts and the configuration required to reproduce the build;
- license, attribution, warranty, and modification notices;
- all required third-party notices, including the Khmer data notice;
- SHA-256 checksums for downloadable artifacts;
- a changelog and known-issues list;
- supported operating system and architecture information;
- preferably a software bill of materials;
- code signing when practical.

A suggested source tag is:

```text
typsastra-office-preview-v0.1.0
```

The release page and the application's legal-information interface should link
to the matching public source tag. A network-hosted version must also provide
users the source access required by AGPL section 13.

## Release gates

Before publishing a preview build:

1. Build from a clean, tagged commit and pinned submodule revisions.
2. Run syntax, unit, integration, and relevant regression tests.
3. Open, edit, save, close, and reopen representative DOCX files.
4. Export representative Latin and Khmer documents through both PDF paths.
5. Compare PDF page count, layout, images, highlights, and text extraction.
6. Verify Khmer underlines, suggestions, and user-dictionary behavior.
7. Confirm that the standard PDF path remains functional.
8. Confirm that required legal and data notices ship with the binary.
9. Publish checksums, matching source, known issues, and the AI-assistance
   disclosure.
10. Provide a public issue template requesting reproduction steps, input files
    when shareable, application version, operating system, and screenshots.

## Stability promotion

A preview build should not be described as stable merely because no new bugs
have been reported. Promotion requires evidence across a representative Khmer
document corpus, sustained use without data-loss incidents, repeatable builds,
an update and rollback process, and human review of critical paths.

Until those conditions are met, rapid public delivery should continue through
clearly versioned preview releases.
