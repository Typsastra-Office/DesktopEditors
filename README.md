[![License](https://img.shields.io/badge/License-GNU%20AGPL%20V3-green.svg?style=flat)](LICENSE)
[![Platforms Windows | macOS | Linux](https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg?style=flat)](https://github.com/Typsastra-Office/DesktopEditors/releases)
[![Release](https://img.shields.io/github/v/tag/Typsastra-Office/DesktopEditors?sort=semver&style=flat&label=Release&color=blue)](https://github.com/Typsastra-Office/DesktopEditors/tags)

<img src="./typsastra/assets/typsastra-wordmark.png" alt="Typsastra Office" width="360">

## Welcome to the Typsastra Office repo!

**Typsastra Office** is a free office suite that combines text, spreadsheet, presentation, and PDF editors & Diagram Viewer. The application allows creating, viewing and editing documents stored on your Windows/Linux PC or Mac without an Internet connection. It is fully compatible with Office Open XML formats: .docx, .xlsx, .pptx.

<img src="./typsastra/assets/typsastra-office-preview.png" alt="Typsastra Office Desktop Editors">

> Typsastra Office is a modified distribution of [ONLYOFFICE Desktop Editors](https://github.com/ONLYOFFICE/DesktopEditors).
> See [License](#license-) and [NOTICE](NOTICE) for the original copyright and attribution.

## Features you'll love ✨

Take advantage of the powerful editors included in Typsastra Office:

* Document Editor
* Spreadsheet Editor
* Presentation Editor
* Form Creator
* PDF Editor
* Diagram Viewer

The suite empowers you to create, edit, save, and export text documents, spreadsheets, presentations, PDFs, fill out PDF forms, open diagrams, all while offering additional advanced features such as:

* Connection to the cloud (ONLYOFFICE, Moodle, Box, Dropbox, ownCloud, Nextcloud, Seafile, Liferay, kDrive) for real-time collaboration ☁️
* AI-powered assistants & agents 🤖
* Digital signatures ✍️🔏
* Password protection 🔒🔑
* Scalable UI options (including dark mode 🌓)

## Localization 🌐

Typsastra Office is constantly improving localization of the editors to make the suite accessible to all users, all over the world.

* Interface available in 46 languages
* RTL support
* Hieroglyph support 🈴

## Plugins 🧩

Typsastra Office offers support for plugins allowing developers to add specific features to the editors that are not directly related to the OOXML format. The plugin API is compatible with the [ONLYOFFICE plugin API](https://api.onlyoffice.com/docs/plugin-and-macros/structure/getting-started/).

## Components 📦

Typsastra Office contains the following components:

* [desktop-apps](https://github.com/Typsastra-Office/desktop-apps) - the frontend for Typsastra Office which is used to build the program interface for the operating system selected.
* [desktop-sdk](https://github.com/Typsastra-Office/desktop-sdk) - SDK which is a core part of Typsastra Office.
* [core](https://github.com/Typsastra-Office/core) - server core components for [ONLYOFFICE Document Server][2] which is a part of Typsastra Office and is used to enable the conversion between the most popular office document formats (DOC, DOCX, ODT, RTF, TXT, PDF, HTML, EPUB, XPS, DjVu, XLS, XLSX, ODS, CSV, PPT, PPTX, ODP).
* [sdkjs](https://github.com/Typsastra-Office/sdkjs) - JavaScript SDK for the [ONLYOFFICE Document Server][2] which is a part of Typsastra Office and contains API for all the included components client-side interaction.
* [web-apps](https://github.com/Typsastra-Office/web-apps) - the frontend for [ONLYOFFICE Document Server][2] which is a part of Typsastra Office that allows the user to create, edit, save and export text, spreadsheet and presentation documents using the common interface of a document editor.
* [dictionaries](https://github.com/Typsastra-Office/dictionaries) - the dictionaries of various languages used for spellchecking in Typsastra Office.

## Installation

Prebuilt packages are produced by the release workflows in this repository and attached to the [GitHub releases](https://github.com/Typsastra-Office/DesktopEditors/releases):

* **Windows** — Inno Setup installer (`.exe`) and portable `.zip`
* **Linux** — `.deb`, `.rpm` and generic `.tar.gz` packages

## License 📄

Typsastra Office is a modified version of ONLYOFFICE Desktop Editors and is licensed under the GNU Affero General Public License, version 3.0 (AGPLv3), as supplemented by the original Section 7 additional terms. The original copyright, license, warranty and attribution notices are retained.

* [LICENSE](LICENSE) — AGPLv3 and the Section 7 additional terms
* [NOTICE](NOTICE) — copyright and attribution

ONLYOFFICE is a trademark of Ascensio System SIA. Typsastra Office is not affiliated with, sponsored by, or endorsed by Ascensio System SIA, and the ONLYOFFICE trademarks and logos are not used in this product.

## How to build 🛠

See the [build_tools](https://github.com/Typsastra-Office/build_tools#desktop-editors) documentation for the full instructions.

This repository builds the branded product with the `typsastra` branding:

```bash
python build_tools/configure.py --branding typsastra --branding-name typsastra --platform win_64 --module desktop --vs-version 2019 --compiler msvc2022
python build_tools/make.py
```

Release automation lives in [`.github/workflows`](.github/workflows) with the platform entry points in [`ci/`](ci).

## 💡 User feedback and support

If you face any issues or have questions about Typsastra Office, please open an issue in this repository: [github.com/Typsastra-Office/DesktopEditors/issues](https://github.com/Typsastra-Office/DesktopEditors/issues).

For the upstream project, see [community.onlyoffice.com][1] and the [ONLYOFFICE API documentation](https://api.onlyoffice.com/).

  [1]: https://community.onlyoffice.com/
  [2]: https://github.com/ONLYOFFICE/DocumentServer
