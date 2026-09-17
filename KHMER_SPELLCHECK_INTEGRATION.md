# Khmer WASM spellcheck integration

For the public preview, AI-assisted development, upstream-contribution, and
distribution policy, see the
[Typsastra Office Preview Release Policy](TYPSASTRA_PREVIEW_RELEASE_POLICY.md).

## Scope

This integration adds Khmer spelling diagnostics and correction suggestions to
Euro Office by embedding `Sovichea/khmer_segmenter` `v0.2.0-rc3` as a lazy-loaded
WASM provider. It supports:

- red underlines for probable Khmer misspellings;
- red underlines for segments marked unknown by the Khmer analyzer, even when
  the typing profile does not emit a separate diagnostic record;
- correction suggestions in the existing spelling context menu;
- adding a Khmer word to the user's local dictionary;
- clearing the local Khmer user dictionary;
- continuous Khmer text without synthetic spaces;
- spell ranges that remain correct when a word crosses formatting runs.

Predictive completion is intentionally not integrated.

## Compatibility boundary

The provider plugs into the existing `SpellCheckApi` rather than replacing the
editor spellchecking subsystem:

```text
Word/Presentation paragraph collector
        |
        | Khmer LCID 0x0453 (1107)
        v
Khmer provider adapter (common/spell/khmer.js)
        |
        +-- khmer_segmenter.js
        +-- khmer_segmenter_bg.wasm
        +-- khmer_dictionary.kdict
        |
        v
Existing SpellCheck_CallBack and spelling UI
```

Non-Khmer requests continue to use the existing desktop spellchecker or web
worker. Mixed request batches are split and merged without changing their
original word order.

## Source layout

The implementation is split between two submodules:

### `sdkjs`

- `common/spell/khmer.js` — lazy loader, provider adapter, request routing,
  suggestions, and local user dictionary.
- `common/spell/khmer/khmer_segmenter.js` — wasm-bindgen no-modules glue.
- `common/spell/khmer/khmer_segmenter_bg.wasm` — Rust/WASM engine.
- `common/spell/khmer/khmer_dictionary.kdict` — runtime linguistic data.
- `common/spell/khmer/LICENSE-MIT.txt` — engine software license.
- `common/spell/khmer/DATA_LICENSE.md` — dictionary provenance and data terms.
- `common/apiBase.js` — `SpellCheckApi` wrapping and readiness handling.
- `word/Editor/SpellChecker/ParagraphCollector.js` — Khmer segmentation and
  UTF-16 source-position mapping.
- `common/spell/spell.js` — registers Khmer LCID `1107` as `km_KH`.
- `configs/{word,cell,slide,visio}.json` — bundles the provider adapter.
- `build/scripts/deploy-assets.cjs` — deploys the WASM, glue, dictionary, and
  notices without re-minifying generated wasm-bindgen glue.
- `tests/word/unit-tests/khmerSpellcheck.*` — integration regression tests.

### `web-apps`

- `apps/documenteditor/main/app/view/Statusbar.js` — constrains the language
  popup to a high-DPI-friendly `280px` width and `180px` height.

## Runtime behavior

The provider loads asynchronously. Khmer is advertised to the language menu as
spellcheck-capable only after all three runtime assets load and the WASM engine
successfully constructs. Readiness triggers a full spelling rescan.

The paragraph collector keeps authoritative document text unchanged. It asks
the segmenter for source UTF-16 ranges and creates one editor spelling element
per returned segment. Separate start and end maps preserve exact ranges across
run boundaries.

The user dictionary is stored in browser-local storage under:

```text
euro-office.khmer-spellcheck.user-words.v1
```

No user words are written into the bundled `.kdict` file.

## Applying Khmer spelling language

Spellchecking follows the document language metadata. Existing content tagged
as English is not silently retagged.

To check an existing document:

1. Select the Khmer text, or press `Ctrl+A` for the entire document.
2. Choose **Khmer – Cambodia** from the status-bar language menu.
3. Wait for the WASM provider to initialize; the document is rescanned
   automatically.

Choosing Khmer with no selection changes the current editing location rather
than every existing paragraph.

## Building for Desktop Editors

The SDK must be built with the desktop platform and matching product metadata:

```powershell
Set-Location sdkjs/build
$env:SDK_PLATFORM = 'desktop'
$env:PRODUCT_VERSION = '9.3.1'
$env:BUILD_NUMBER = '60'
npm run build
```

`SDK_PLATFORM=desktop` is mandatory. Omitting it excludes
`common/Local/license.js`, causing the desktop UI to receive the generic license
state and display a misleading **License expired** dialog.

Build the document-editor frontend with the same version and build number:

```powershell
Set-Location web-apps/build
$env:PRODUCT_VERSION = '9.3.1'
$env:BUILD_NUMBER = '60'
$env:THEME = 'euro-office'
npx grunt deploy-documenteditor --skip-imagemin --skip-babel
```

Do not use the package defaults (`4.3.0`, build `0`) for a `9.3.1.60` desktop
package. A mismatched frontend can also fail the permission/version handshake.

## Deploying into the local desktop build

From the repository root:

```powershell
Copy-Item -Path 'sdkjs/deploy/sdkjs/*' `
  -Destination 'desktopeditors/editors/sdkjs' -Recurse -Force

Copy-Item -Path 'web-apps/deploy/web-apps/*' `
  -Destination 'desktopeditors/editors/web-apps' -Recurse -Force
```

Close every running `DesktopEditors.exe` process before replacing the bundles,
then launch:

```text
desktopeditors/DesktopEditors.exe
```

The deployed Khmer assets must exist at:

```text
desktopeditors/editors/sdkjs/common/spell/khmer/
```

Relative resource URLs are converted to `ascdesktop://fonts/<absolute-path>` for
desktop binary loading.

## Verification

Run syntax and diff checks:

```powershell
node --check sdkjs/common/spell/khmer.js
node --check sdkjs/common/apiBase.js
node --check sdkjs/word/Editor/SpellChecker/ParagraphCollector.js
git -C sdkjs diff --check
git -C web-apps diff --check
```

The Khmer QUnit suite covers:

- continuous Khmer segmentation and UTF-16 ranges;
- detection of a known typo;
- correction suggestions;
- words crossing formatting runs;
- merging Khmer and non-Khmer spell responses;
- add-to-dictionary behavior.

A minimal expected runtime result is:

```text
សសេរ  -> misspelled
សរសេរ -> correct
first suggestion for សសេរ -> សរសេរ
```

## Troubleshooting

### Khmer appears but shows zero errors

Check, in order:

1. The selected text is tagged with LCID `1107`, not English.
2. The language menu shows Khmer as spellcheck-capable after WASM readiness.
3. The `.js`, `.wasm`, and `.kdict` files exist in the deployed runtime path.
4. `sdk-all-min.js` contains the Khmer provider and was copied after the latest
   SDK build.
5. The application was fully restarted after deployment.

Initialization failures are also logged as `Khmer spellcheck initialization
failed` in the renderer console.

### License expired after rebuilding

Confirm both of the following:

- SDK build output reports `SDK_PLATFORM desktop`.
- SDK and web-app builds use `PRODUCT_VERSION=9.3.1` and `BUILD_NUMBER=60`.

The deployed Word bundle must contain the desktop local-license adapter from
`common/Local/license.js`.

## Licensing

The Rust/WASM software is MIT licensed. The bundled linguistic data has separate
noncommercial attribution requirements documented in
`sdkjs/common/spell/khmer/DATA_LICENSE.md`. Redistributions must retain that
notice and its credits.
