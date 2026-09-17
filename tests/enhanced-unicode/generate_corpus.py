#!/usr/bin/env python3
"""Generate a deterministic DOCX for the Enhanced Unicode baseline corpus."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

FIXED_TIMESTAMP = (2026, 1, 1, 0, 0, 0)

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"""

DOCUMENT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
"""

STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/><w:basedOn w:val="Normal"/>
    <w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
    <w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr>
  </w:style>
</w:styles>
"""

CORE_PROPERTIES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>DesktopEditors Enhanced Unicode baseline corpus</dc:title>
  <dc:creator>Enhanced Unicode Phase 0 generator</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified>
</cp:coreProperties>
"""

APP_PROPERTIES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Enhanced Unicode Phase 0 generator</Application>
</Properties>
"""


def case_text(case: dict[str, object]) -> str:
    prefix = case.get("prefix", "")
    suffix = case.get("suffix", "")
    if not isinstance(prefix, str) or not isinstance(suffix, str):
        raise ValueError(f"Case {case.get('id')} has a non-string prefix or suffix")

    text = case.get("text")
    if isinstance(text, str):
        return prefix + text + suffix
    points = case.get("code_points")
    if not isinstance(points, list):
        raise ValueError(f"Case {case.get('id')} has neither text nor code_points")
    return prefix + "".join(chr(int(str(point), 16)) for point in points) + suffix


def run_xml(text: str, font: str, rtl: bool = False, italic: bool = False) -> str:
    properties = [
        f'<w:rFonts w:ascii="{escape(font)}" w:hAnsi="{escape(font)}" w:eastAsia="{escape(font)}" w:cs="{escape(font)}"/>'
    ]
    if rtl:
        properties.append("<w:rtl/>")
    if italic:
        properties.append("<w:i/><w:iCs/>")
    return f'<w:r><w:rPr>{"".join(properties)}</w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def paragraph_xml(text: str, font: str, style: str | None = None, rtl: bool = False, italic: bool = False) -> str:
    paragraph_properties = []
    if style:
        paragraph_properties.append(f'<w:pStyle w:val="{style}"/>')
    if rtl:
        paragraph_properties.extend(("<w:bidi/>", "<w:jc w:val=\"right\"/>"))
    ppr = f'<w:pPr>{"".join(paragraph_properties)}</w:pPr>' if paragraph_properties else ""
    return f'<w:p>{ppr}{run_xml(text, font, rtl=rtl, italic=italic)}</w:p>'



def document_xml(manifest: dict[str, object]) -> str:
    font = str(manifest.get("default_font", "Arial"))
    body = [paragraph_xml(str(manifest["title"]), font, style="Title")]
    body.append(paragraph_xml("Generated from corpus.json. Do not edit the DOCX manually.", font, italic=True))

    cases = manifest.get("cases")
    if not isinstance(cases, list):
        raise ValueError("Manifest cases must be a list")

    for index, case in enumerate(cases, start=1):
        if not isinstance(case, dict):
            raise ValueError("Each corpus case must be an object")
        label = f"{index}. {case['label']} [{case['id']}]"
        body.append(paragraph_xml(label, font, style="Heading1"))
        body.append(paragraph_xml(case_text(case), font, rtl=case.get("direction") == "rtl"))
        body.append(paragraph_xml(f"Purpose: {case['purpose']}", font, italic=True))

    section = """<w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>"""
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>%s%s</w:body>
</w:document>
""" % ("".join(body), section)


def write_entry(archive: ZipFile, name: str, content: str) -> None:
    info = ZipInfo(name, FIXED_TIMESTAMP)
    info.compress_type = ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    archive.writestr(info, content.encode("utf-8"))


def generate(manifest_path: Path, output_path: Path) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output_path, "w") as archive:
        write_entry(archive, "[Content_Types].xml", CONTENT_TYPES)
        write_entry(archive, "_rels/.rels", ROOT_RELS)
        write_entry(archive, "word/document.xml", document_xml(manifest))
        write_entry(archive, "word/styles.xml", STYLES)
        write_entry(archive, "word/_rels/document.xml.rels", DOCUMENT_RELS)
        write_entry(archive, "docProps/core.xml", CORE_PROPERTIES)
        write_entry(archive, "docProps/app.xml", APP_PROPERTIES)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    script_dir = Path(__file__).resolve().parent
    parser.add_argument("--manifest", type=Path, default=script_dir / "corpus.json")
    parser.add_argument("--output", type=Path, default=script_dir / "generated" / "enhanced-unicode-corpus.docx")
    args = parser.parse_args()
    generate(args.manifest.resolve(), args.output.resolve())
    print(args.output.resolve())
