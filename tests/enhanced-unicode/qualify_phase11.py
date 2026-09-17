#!/usr/bin/env python3
"""Qualify an Enhanced Unicode PDF with independent readers and font validators."""

from __future__ import annotations

import argparse
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
from pathlib import Path
from typing import Any

import fitz
from fontTools.ttLib import TTFont
from pdfminer.high_level import extract_text as pdfminer_extract_text
from pypdf import PdfReader
from pypdf.generic import ContentStream


def run(command: list[str]) -> dict[str, Any]:
    started = time.perf_counter()
    process = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return {
        "command": command,
        "exit_code": process.returncode,
        "elapsed_seconds": time.perf_counter() - started,
        "stdout": process.stdout,
        "stderr": process.stderr,
    }


def tool(name: str) -> str:
    resolved = shutil.which(name)
    if not resolved:
        raise RuntimeError(f"required tool not found: {name}")
    return resolved


def poppler_tool(name: str) -> str:
    renderer = Path(tool("pdftoppm"))
    sibling = renderer.with_name(name + renderer.suffix)
    return str(sibling) if sibling.exists() else tool(name)


def decode_pdf_name(value: object) -> str:
    return str(value or "").lstrip("/")


def name_record(font: TTFont, name_id: int) -> str | None:
    if "name" not in font:
        return None
    preferred = sorted(
        (record for record in font["name"].names if record.nameID == name_id),
        key=lambda record: (record.platformID != 3, record.langID != 0x0409),
    )
    for record in preferred:
        try:
            return record.toUnicode()
        except UnicodeDecodeError:
            continue
    return None


def width_coverage(widths: object) -> set[int]:
    covered: set[int] = set()
    if not isinstance(widths, list):
        return covered
    index = 0
    while index + 1 < len(widths):
        first = int(widths[index])
        second = widths[index + 1]
        if isinstance(second, list):
            covered.update(range(first, first + len(second)))
            index += 2
        elif index + 2 < len(widths):
            covered.update(range(first, int(second) + 1))
            index += 3
        else:
            break
    return covered


def vertical_metric_coverage(metrics: object) -> set[int]:
    covered: set[int] = set()
    if not isinstance(metrics, list):
        return covered
    index = 0
    while index + 1 < len(metrics):
        first = int(metrics[index])
        second = metrics[index + 1]
        if isinstance(second, list):
            if len(second) % 3:
                return set()
            covered.update(range(first, first + len(second) // 3))
            index += 2
        elif index + 4 < len(metrics):
            covered.update(range(first, int(second) + 1))
            index += 5
        else:
            break
    return covered


def inspect_logical_fonts(reader: PdfReader, used_cids: dict[str, set[int]]) -> list[dict[str, Any]]:
    seen: set[tuple[int, int] | int] = set()
    fonts: list[dict[str, Any]] = []
    for page in reader.pages:
        resources = page.get("/Resources") or {}
        font_resources = resources.get("/Font") or {}
        for reference in font_resources.values():
            identity = getattr(reference, "idnum", id(reference))
            generation = getattr(reference, "generation", 0)
            key = (identity, generation) if isinstance(identity, int) else identity
            if key in seen:
                continue
            seen.add(key)
            parent = reference.get_object()
            if parent.get("/Subtype") != "/Type0":
                continue
            pdf_name = decode_pdf_name(parent.get("/BaseFont"))
            if "+Logical" not in pdf_name:
                continue
            errors: list[str] = []
            encoding = decode_pdf_name(parent.get("/Encoding"))
            font_file = b""
            gids: list[int] = []
            glyph_count = None
            internal_name = None
            try:
                descendants = parent.get("/DescendantFonts") or []
                if len(descendants) != 1:
                    raise ValueError("expected one descendant font")
                descendant = descendants[0].get_object()
                descriptor_reference = descendant.get("/FontDescriptor")
                if descriptor_reference is None:
                    raise ValueError("logical descendant has no FontDescriptor")
                descriptor = descriptor_reference.get_object()
                font_file_reference = descriptor.get("/FontFile2")
                if font_file_reference is None:
                    raise ValueError("logical descriptor has no FontFile2")
                font_file = font_file_reference.get_object().get_data()
                cid_map_reference = descendant.get("/CIDToGIDMap")
                if cid_map_reference is None:
                    raise ValueError("logical descendant has no CIDToGIDMap")
                cid_map = cid_map_reference.get_object().get_data()
                if len(cid_map) < 2 or len(cid_map) % 2:
                    errors.append("CIDToGIDMap length is invalid")
                gids = [int.from_bytes(cid_map[index:index + 2], "big") for index in range(0, len(cid_map), 2)]
                if gids and gids[0] != 0:
                    errors.append("CID zero does not map to GID zero")
                required_cids = used_cids.get(pdf_name, set())
                if required_cids and len(gids) <= max(required_cids):
                    errors.append("CIDToGIDMap does not cover every CID used by page content")

                font = TTFont(io.BytesIO(font_file), checkChecksums=2, lazy=False)
                glyph_count = int(font["maxp"].numGlyphs)
                internal_name = name_record(font, 6)
                if any(gid >= glyph_count for gid in gids):
                    errors.append("CIDToGIDMap references a GID outside maxp.numGlyphs")
                if internal_name != pdf_name:
                    errors.append(f"embedded PostScript name {internal_name!r} does not match {pdf_name!r}")
                required_tables = {"head", "hhea", "hmtx", "maxp", "loca", "glyf", "cmap", "name", "post"}
                missing = sorted(required_tables.difference(font.keys()))
                if missing:
                    errors.append("missing TrueType tables: " + ", ".join(missing))
                font.close()

                widths = descendant.get("/W")
                if widths is None:
                    errors.append("logical descendant has no /W entry")
                elif not required_cids.issubset(width_coverage(widths)):
                    errors.append("logical /W does not cover every CID used by page content")
                if parent.get("/ToUnicode") is None:
                    errors.append("logical parent has no /ToUnicode entry")
                if encoding == "Identity-V":
                    if descendant.get("/DW2") is None:
                        errors.append("logical Identity-V descendant has no /DW2 entry")
                    vertical_metrics = descendant.get("/W2")
                    if vertical_metrics is None:
                        errors.append("logical Identity-V descendant has no /W2 entry")
                    elif not required_cids.issubset(vertical_metric_coverage(vertical_metrics)):
                        errors.append("logical /W2 does not cover every vertical CID used by page content")
                elif encoding != "Identity-H":
                    errors.append(f"logical Type 0 font uses unsupported encoding {encoding!r}")
            except Exception as error:
                errors.append(str(error))
            fonts.append({
                "pdf_name": pdf_name,
                "encoding": encoding,
                "font_file_bytes": len(font_file),
                "cid_count": len(gids),
                "max_gid": max(gids, default=0),
                "glyph_count": glyph_count,
                "internal_postscript_name": internal_name,
                "valid": not errors,
                "errors": errors,
            })
    return fonts


def to_unicode_map(font: object) -> dict[int, str]:
    cmap_reference = font.get("/ToUnicode")
    if cmap_reference is None:
        return {}
    cmap = cmap_reference.get_object().get_data().decode("ascii", errors="replace")
    mappings: dict[int, str] = {}
    for block in re.findall(r"beginbfchar(.*?)endbfchar", cmap, flags=re.DOTALL):
        for cid_hex, unicode_hex in re.findall(r"<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]+)>", block):
            try:
                mappings[int(cid_hex, 16)] = bytes.fromhex(unicode_hex).decode("utf-16-be")
            except (UnicodeDecodeError, ValueError):
                continue
    return mappings


def inspect_logical_content_order(reader: PdfReader) -> tuple[str, dict[str, set[int]]]:
    text: list[str] = []
    used_cids: dict[str, set[int]] = {}
    for page in reader.pages:
        resources = page.get("/Resources") or {}
        font_resources = resources.get("/Font") or {}
        cmaps = {}
        for name, reference in font_resources.items():
            font = reference.get_object()
            pdf_name = decode_pdf_name(font.get("/BaseFont"))
            if font.get("/Subtype") == "/Type0" and "+Logical" in pdf_name:
                cmaps[str(name)] = (pdf_name, to_unicode_map(font))
        current_font: tuple[str, dict[int, str]] | None = None
        for operands, operator in ContentStream(page.get_contents(), reader).operations:
            if operator == b"Tf":
                current_font = cmaps.get(str(operands[0]))
                continue
            if current_font is None or operator not in (b"Tj", b"TJ", b"'", b'"'):
                continue
            values = operands[0] if operator == b"TJ" else [operands[-1]]
            for value in values:
                if isinstance(value, (bytes, bytearray)):
                    codes = bytes(value)
                else:
                    codes = getattr(value, "original_bytes", b"")
                for offset in range(0, len(codes) - 1, 2):
                    cid = int.from_bytes(codes[offset:offset + 2], "big")
                    pdf_name, current_cmap = current_font
                    used_cids.setdefault(pdf_name, set()).add(cid)
                    text.append(current_cmap.get(cid, "\uFFFD"))
    return "".join(text), used_cids


def classify(expected: str | None, observed: str) -> str:
    if expected is None:
        return "not-asserted"
    observed = observed.rstrip("\r\n\f")
    if observed == expected:
        return "exact"
    if unicodedata.normalize("NFC", observed) == unicodedata.normalize("NFC", expected):
        return "nfc-equivalent"
    if unicodedata.normalize("NFD", observed) == unicodedata.normalize("NFD", expected):
        return "nfd-equivalent"
    if expected in observed:
        return "contains-exact"
    return "different"


def qualify(pdf_path: Path, expected: str | None, expected_mode: str) -> dict[str, Any]:
    qpdf = run([tool("qpdf"), "--check", str(pdf_path)])
    with tempfile.TemporaryDirectory(prefix="phase11-") as directory:
        normal_path = Path(directory) / "normal.txt"
        raw_path = Path(directory) / "raw.txt"
        pdftotext = poppler_tool("pdftotext")
        normal_run = run([pdftotext, "-enc", "UTF-8", str(pdf_path), str(normal_path)])
        raw_run = run([pdftotext, "-raw", "-enc", "UTF-8", str(pdf_path), str(raw_path)])
        poppler_normal = normal_path.read_text(encoding="utf-8-sig") if normal_path.exists() else ""
        poppler_raw = raw_path.read_text(encoding="utf-8-sig") if raw_path.exists() else ""

    reader = PdfReader(str(pdf_path), strict=True)
    pypdf_text = "".join(page.extract_text() or "" for page in reader.pages)
    document = fitz.open(str(pdf_path))
    pymupdf_text = "".join(page.get_text("text") for page in document)
    pymupdf_raw_blocks = sum((page.get_text("rawdict").get("blocks", []) for page in document), [])
    search_count = sum(len(page.search_for(expected)) for page in document) if expected else None
    document.close()
    pdfminer_text = pdfminer_extract_text(str(pdf_path))
    logical_content_text, used_cids = inspect_logical_content_order(reader)
    fonts = inspect_logical_fonts(reader, used_cids)
    logical_content_classification = classify(expected, logical_content_text)

    readers = {
        "poppler_normal": {"text": poppler_normal, "classification": classify(expected, poppler_normal)},
        "poppler_raw": {"text": poppler_raw, "classification": classify(expected, poppler_raw)},
        "pypdf": {"text": pypdf_text, "classification": classify(expected, pypdf_text)},
        "pymupdf": {"text": pymupdf_text, "classification": classify(expected, pymupdf_text)},
        "pdfminer": {"text": pdfminer_text, "classification": classify(expected, pdfminer_text)},
    }
    failures = []
    if qpdf["exit_code"] != 0:
        failures.append("qpdf rejected the PDF")
    if normal_run["exit_code"] != 0 or raw_run["exit_code"] != 0:
        failures.append("Poppler extraction failed")
    if not fonts:
        failures.append("no logical Type 0 font was found")
    for font in fonts:
        failures.extend(f"{font['pdf_name']}: {error}" for error in font["errors"])
    if expected is not None:
        if expected_mode == "content-exact":
            if logical_content_classification != "exact":
                failures.append(
                    f"logical content order is {logical_content_classification}, not exact"
                )
        else:
            accepted = {"exact"} if expected_mode == "exact" else {"exact", "contains-exact"}
            for name, result in readers.items():
                if result["classification"] not in accepted:
                    failures.append(
                        f"{name} extraction is {result['classification']}, not {expected_mode}"
                    )

    return {
        "schema_version": 1,
        "pdf": str(pdf_path.resolve()),
        "pdf_bytes": pdf_path.stat().st_size,
        "page_count": len(reader.pages),
        "qpdf": qpdf,
        "poppler_normal_run": normal_run,
        "poppler_raw_run": raw_run,
        "expected": expected,
        "expected_mode": expected_mode,
        "expected_code_points": [f"U+{ord(character):04X}" for character in expected] if expected else None,
        "readers": readers,
        "logical_content_order": {
            "text": logical_content_text,
            "classification": logical_content_classification,
        },
        "pymupdf_raw_block_count": len(pymupdf_raw_blocks),
        "pymupdf_search_count": search_count,
        "logical_font_count": len(fonts),
        "logical_fonts": fonts,
        "passed": not failures,
        "failures": failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected")
    parser.add_argument("--expected-code-points", nargs="+")
    parser.add_argument(
        "--expected-mode",
        choices=("exact", "contains", "content-exact"),
        default="exact",
        help="validate every reader, allow an exact fragment, or validate decoded logical content order only",
    )
    parser.add_argument("--strict", action="store_true", help="return nonzero when any qualification fails")
    args = parser.parse_args()
    if not args.pdf.is_file():
        parser.error(f"PDF does not exist: {args.pdf}")
    expected = args.expected
    if args.expected_code_points:
        expected = "".join(chr(int(point, 16)) for point in args.expected_code_points)
    report = qualify(args.pdf, expected, args.expected_mode)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"logical fonts: {report['logical_font_count']}; bytes: {report['pdf_bytes']}; passed: {report['passed']}")
    for failure in report["failures"]:
        print(f"FAIL: {failure}")
    return 1 if args.strict and not report["passed"] else 0


if __name__ == "__main__":
    sys.exit(main())
