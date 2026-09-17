#!/usr/bin/env python3
"""Compare extracted baseline lines with the authoritative corpus strings."""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path

BIDI_CONTROLS = {
    0x061C,
    0x200E,
    0x200F,
    0x202A,
    0x202B,
    0x202C,
    0x202D,
    0x202E,
    0x2066,
    0x2067,
    0x2068,
    0x2069,
}


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


def code_points(text: str) -> list[str]:
    return [f"U+{ord(character):04X}" for character in text]


def without_bidi_controls(text: str) -> str:
    return "".join(character for character in text if ord(character) not in BIDI_CONTROLS)


def observed_case_line(lines: list[str], case_id: str) -> str | None:
    marker = f"[{case_id}]"
    for index, line in enumerate(lines):
        if marker not in line:
            continue
        for candidate in lines[index + 1 :]:
            if candidate.strip():
                return candidate
    return None


def audit(manifest_path: Path, normal_path: Path, raw_path: Path) -> dict[str, object]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    normal_text = normal_path.read_text(encoding="utf-8-sig")
    raw_text = raw_path.read_text(encoding="utf-8-sig")
    normal_lines = normal_text.splitlines()

    results = []
    for case in manifest["cases"]:
        expected = case_text(case)
        observed = observed_case_line(normal_lines, str(case["id"]))
        observed_without_controls = without_bidi_controls(observed) if observed is not None else None
        results.append(
            {
                "id": case["id"],
                "label": case["label"],
                "expected": expected,
                "expected_code_points": code_points(expected),
                "observed_normal_line": observed,
                "observed_normal_code_points": code_points(observed) if observed is not None else None,
                "normal_line_exact": observed == expected,
                "normal_contains_exact": expected in normal_text,
                "raw_contains_exact": expected in raw_text,
                "normal_without_bidi_controls_exact": observed_without_controls == expected,
                "normal_nfc_equal": (
                    unicodedata.normalize("NFC", observed_without_controls)
                    == unicodedata.normalize("NFC", expected)
                    if observed_without_controls is not None
                    else False
                ),
                "normal_nfd_equal": (
                    unicodedata.normalize("NFD", observed_without_controls)
                    == unicodedata.normalize("NFD", expected)
                    if observed_without_controls is not None
                    else False
                ),
            }
        )

    return {
        "manifest_version": manifest["version"],
        "case_count": len(results),
        "normal_exact_count": sum(result["normal_line_exact"] for result in results),
        "normal_contains_count": sum(result["normal_contains_exact"] for result in results),
        "raw_contains_count": sum(result["raw_contains_exact"] for result in results),
        "cases": results,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    script_dir = Path(__file__).resolve().parent
    parser.add_argument("--manifest", type=Path, default=script_dir / "corpus.json")
    parser.add_argument("--normal", type=Path, required=True)
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--strict", action="store_true", help="fail unless every normal extraction line is exact")
    args = parser.parse_args()

    report = audit(args.manifest, args.normal, args.raw)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"normal exact: {report['normal_exact_count']}/{report['case_count']}; "
        f"normal contains: {report['normal_contains_count']}/{report['case_count']}; "
        f"raw contains: {report['raw_contains_count']}/{report['case_count']}"
    )
    if args.strict and report["normal_exact_count"] != report["case_count"]:
        sys.exit(1)
