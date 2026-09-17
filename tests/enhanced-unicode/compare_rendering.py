#!/usr/bin/env python3
"""Compare rendered PDF pages using explicit pixel tolerances."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def compare_page(baseline: Path, candidate: Path, changed_delta: int) -> dict[str, object]:
    base = np.asarray(Image.open(baseline).convert("RGBA"), dtype=np.int16)
    test = np.asarray(Image.open(candidate).convert("RGBA"), dtype=np.int16)
    if base.shape != test.shape:
        return {"page": baseline.name, "passed": False, "error": f"dimensions differ: {base.shape} != {test.shape}"}
    delta = np.abs(base - test)
    per_pixel = np.max(delta, axis=2)
    changed = per_pixel > changed_delta
    return {
        "page": baseline.name,
        "dimensions": [int(base.shape[1]), int(base.shape[0])],
        "changed_pixels": int(np.count_nonzero(changed)),
        "changed_pixel_ratio": float(np.mean(changed)),
        "maximum_channel_delta": int(np.max(delta)),
        "mean_absolute_error": float(np.mean(delta)),
        "root_mean_square_error": float(np.sqrt(np.mean(delta.astype(np.float64) ** 2))),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--thresholds", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()
    thresholds = json.loads(args.thresholds.read_text(encoding="utf-8"))["rendering"]
    baseline_pages = sorted(args.baseline.glob("*.png")) if args.baseline.is_dir() else []
    candidate_pages = (
        {page.name: page for page in args.candidate.glob("*.png")}
        if args.candidate.is_dir()
        else {}
    )
    pages = []
    failures = []
    if not args.baseline.is_dir():
        failures.append(f"baseline directory does not exist: {args.baseline}")
    if not args.candidate.is_dir():
        failures.append(f"candidate directory does not exist: {args.candidate}")
    if not baseline_pages:
        failures.append("baseline contains no rendered PNG pages")
    if not candidate_pages:
        failures.append("candidate contains no rendered PNG pages")
    if len(baseline_pages) != len(candidate_pages):
        failures.append(f"page count differs: {len(baseline_pages)} != {len(candidate_pages)}")
    for baseline in baseline_pages:
        candidate = candidate_pages.get(baseline.name)
        if candidate is None:
            failures.append(f"missing candidate page: {baseline.name}")
            continue
        result = compare_page(baseline, candidate, int(thresholds["changed_channel_delta"]))
        if "error" not in result:
            result["passed"] = (
                result["changed_pixel_ratio"] <= float(thresholds["maximum_changed_pixel_ratio"])
                and result["maximum_channel_delta"] <= int(thresholds["maximum_channel_delta"])
                and result["root_mean_square_error"] <= float(thresholds["maximum_rmse"])
            )
        if not result["passed"]:
            failures.append(f"rendering threshold failed: {baseline.name}")
        pages.append(result)
    report = {"schema_version": 1, "passed": not failures, "thresholds": thresholds, "pages": pages, "failures": failures}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    for failure in failures:
        print(f"FAIL: {failure}")
    return 1 if args.strict and failures else 0


if __name__ == "__main__":
    sys.exit(main())
