#!/usr/bin/env node
// Complex script caret movement fixture runner.
//
//   node run.mjs --unit              fast check of Paragraph.js logic, no app
//   node run.mjs                     drive the real desktop editor over CDP
//   node run.mjs --filter km         only cases whose id contains "km"
//
// Both modes assert against the frozen expectations in cases.json. They never
// call Intl.Segmenter to decide what is correct: that would only prove the
// implementation agrees with whatever ICU the runtime ships, which is how the
// Khmer Coeng defect passed an earlier test.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDocx } from "./docx.mjs";
import { listTargets, waitForCdp, connect, PROBE } from "./cdp.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "cases.json"), "utf8"));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const MODE = flag("--unit") ? "unit" : flag("--emit-docx") ? "emit" : "runtime";
const PORT = Number(value("--port", "9222"));
const FILTER = value("--filter", "");
const KEEP = flag("--keep");
const APP = path.resolve(
	value(
		"--app",
		path.join(REPO, "build_tools", "out", "win_64", "onlyoffice", "DesktopEditors", "DesktopEditors.exe")
	)
);

const cases = FIXTURE.cases.filter((c) => !FILTER || c.id.includes(FILTER));
if (cases.length === 0) {
	console.error("no cases matched filter: " + FILTER);
	process.exit(2);
}

const text = (cps) => String.fromCodePoint(...cps);

function report(results, extra) {
	const pad = Math.max(...results.map((r) => r.id.length));
	const brief = (a) => {
		const v = JSON.stringify(a);
		return Array.isArray(a) && a.length > 10 ? `[${a.length} stops]` : v;
	};
	let failed = 0;
	for (const r of results) {
		const ok = r.ok;
		if (!ok) failed++;
		const notes = [];
		if (r.error) notes.push(r.error);
		if (r.icuNote) notes.push(r.icuNote);
		const noteText = notes.length ? "   [" + notes.join("; ").slice(0, 200) + "]" : "";
		let got = "";
		if (!ok) {
			got = Array.isArray(r.got)
				? ` got=${brief(r.got)}`
				: ` got.fwd=${brief(r.got.fwd)} got.back=${brief(r.got.back)}`;
		}
		console.log(
			`${ok ? "PASS" : "FAIL"}  ${r.id.padEnd(pad)}  ${r.script.padEnd(12)} stops=${brief(r.expected)}` +
				got +
				noteText
		);
	}
	console.log(`\n${results.length - failed}/${results.length} passed`);
	if (extra) console.log(extra);
	return failed;
}

// ---------------------------------------------------------------------------
// Unit mode: exercise Paragraph.js directly with lightweight stand-ins.
// ---------------------------------------------------------------------------
function runUnit() {
	const sourcePath = path.join(REPO, "sdkjs", "word", "Editor", "Paragraph.js");
	const source = fs.readFileSync(sourcePath, "utf8");
	const start = source.indexOf("var paragraphGraphemeSegmenter = null;");
	const end = source.indexOf("Paragraph.prototype.getSearchPosByXY =", start);
	if (start < 0 || end < 0) throw new Error("could not locate the caret helpers in Paragraph.js");
	const region = source.slice(start, end);
	// The helpers only look at a bounded window either side of the caret, so the
	// stub has to reproduce that window. Read the limit from the source so the
	// two cannot drift apart.
	const limitMatch = /GRAPHEME_SCAN_LIMIT\s*=\s*(\d+)/.exec(region);
	if (!limitMatch) throw new Error("could not find the grapheme scan limit in Paragraph.js");
	const SCAN_LIMIT = Number(limitMatch[1]);

	class Pos {
		constructor(index, run = 0) { this.index = index; this.run = run; }
		Copy() { return new Pos(this.index, this.run); }
		Compare(other) { return this.index - other.index; }
		GetDepth() { return 2; }
		Get(i) { return i === 0 ? this.run : this.index; }
	}
	class Search {
		constructor() { this.Reset(); }
		Reset() { this.Found = false; this.Pos = null; }
		IsFound() { return this.Found; }
		GetPos() { return this.Pos; }
	}
	class Paragraph {
		constructor(cps) {
			this.items = cps.map((cp, index) => ({
				run: 0,
				IsText: () => true,
				GetCodePoint: () => cp,
				GetWidthVisible: () => 1,
				IsCombiningMark: () => cp >= 0x300 && cp <= 0x36f,
			}));
		}
		GetPrevRunElement(pos) { return this.items[pos.index - 1] || null; }
		GetNextRunElement(pos) { return this.items[pos.index] || null; }
		Get_LeftPos(search, pos) {
			if (pos.index > 0) { search.Pos = new Pos(pos.index - 1); search.Found = true; }
		}
		Get_RightPos(search, pos) {
			if (pos.index < this.items.length) { search.Pos = new Pos(pos.index + 1); search.Found = true; }
		}
	}

	// Replay the fixture's icuClusters instead of calling the host's
	// Intl.Segmenter. The host ICU already merges Khmer Coeng, so using it
	// would make the Coeng rule untestable. A fresh context per case is needed
	// because the helpers cache the segmenter on first use.
	const utf16 = (cps) => {
		const out = [0];
		for (const cp of cps) out.push(out[out.length - 1] + String.fromCodePoint(cp).length);
		return out;
	};

	const results = cases.map((c) => {
		const full = text(c.cps);
		const off = utf16(c.cps);
		const n = c.cps.length;
		let caret = 0;

		const IntlStub = {
			Segmenter: function () {
				this.segment = (str) => {
					const from = Math.max(0, caret - SCAN_LIMIT);
					const to = Math.min(n, caret + SCAN_LIMIT);
					const want = full.slice(off[from], off[to]);
					if (str !== want) {
						throw new Error(
							`stub segmenter window mismatch for ${c.id}: caret=${caret} ` +
								`expected length ${want.length}, got ${str.length}`
						);
					}
					return {
						[Symbol.iterator]: function* () {
							for (const [s, e] of c.icuClusters) {
								const a = Math.max(s, from);
								const b = Math.min(e, to);
								if (a >= b) continue;
								yield { index: off[a] - off[from], segment: full.slice(off[a], off[b]) };
							}
						},
					};
				};
			},
		};

		vm.runInNewContext(region, { Paragraph, CParagraphSearchPos: Search, window: { Intl: IntlStub } }, {
			filename: "Paragraph.js",
		});

		const para = new Paragraph(c.cps);
		const stops = [];
		let pos = new Pos(0);
		for (let guard = 0; guard <= n + 2; guard++) {
			stops.push(pos.index);
			const search = new Search();
			para.Get_RightPos(search, pos);
			if (!search.IsFound()) break;
			caret = search.GetPos().index;
			pos = para.private_CorrectPosInCombiningMark(search.GetPos(), true);
		}
		return {
			id: c.id,
			script: c.script,
			expected: c.expected,
			got: stops,
			ok: JSON.stringify(stops) === JSON.stringify(c.expected),
		};
	});

	process.exit(report(results, "unit mode: Paragraph.js caret helpers, no app launched") ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Runtime mode: drive the real editor.
// ---------------------------------------------------------------------------
async function isCdpUp() {
	try {
		const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
		return res.ok;
	} catch {
		return false;
	}
}

async function runRuntime() {
	const docxPath = path.resolve(
		value(
			"--docx",
			// A unique name per run: the editor keeps the document open, and on
			// Windows we cannot overwrite a file that is still held.
			path.join(os.tmpdir(), `typsastra-caret-graphemes-${process.pid}-${Date.now()}.docx`)
		)
	);
	fs.writeFileSync(docxPath, buildDocx(cases.map((c) => text(c.cps))));
	console.log(`fixture document: ${docxPath} (${cases.length} paragraphs)`);

	let child = null;
	if (!(await isCdpUp())) {
		if (!fs.existsSync(APP)) {
			console.error(`app not found: ${APP}\nBuild it first, or pass --app <DesktopEditors.exe>.`);
			process.exit(2);
		}
		console.log(`launching ${APP}`);
		child = spawn(APP, [`--remote-debugging-port=${PORT}`, docxPath], { detached: true, stdio: "ignore" });
		child.unref();
	} else {
		console.log(`attaching to the editor already listening on port ${PORT}`);
	}

	const cleanup = () => {
		if (child && !KEEP) {
			// Kill the whole tree: the shell spawns editors.exe helpers.
			spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
		}
	};

	try {
		await waitForCdp(PORT);

		let rows = null;
		const deadline = Date.now() + 120000;
		while (Date.now() < deadline && !rows) {
			const targets = await listTargets(PORT);
			for (const target of targets.filter((t) => t.type === "page")) {
				let client;
				try {
					client = await connect(PORT, target);
				} catch {
					continue;
				}
				try {
					for (const r of await client.evaluate(PROBE)) {
						if (typeof r.value !== "string" || r.value.startsWith("ERR:")) continue;
						const parsed = JSON.parse(r.value);
						if (Array.isArray(parsed) && parsed.length) {
							rows = parsed;
							break;
						}
					}
				} finally {
					client.close();
				}
				if (rows) break;
			}
			if (!rows) await new Promise((r) => setTimeout(r, 2000));
		}
		if (!rows) throw new Error("could not read caret positions from the editor");

		if (rows.length !== cases.length) {
			console.error(`expected ${cases.length} paragraphs, editor reported ${rows.length}`);
			process.exit(2);
		}

		const results = cases.map((c, i) => {
			const row = rows[i];
			const gotCps = row.cps;
			const fwd = row.fwd;
			const back = [...row.back].reverse();
			const expected = c.expected;

			const diff = (a, b) => {
				const n = Math.min(a.length, b.length);
				for (let k = 0; k < n; k++) if (a[k] !== b[k]) return `at ${k}: expected ${b[k]}, got ${a[k]}`;
				return a.length === b.length ? "" : `length ${a.length} vs ${b.length}`;
			};

			const textDiff = diff(gotCps, c.cps);
			const fwdDiff = diff(fwd, expected);
			const backDiff = diff(back, expected);
			const icuNote =
				JSON.stringify(row.icu) === JSON.stringify(expected)
					? ""
					: `runtime ICU differs (${diff(row.icu, expected)})`;

			const parts = [];
			if (textDiff) parts.push(`text ${textDiff}`);
			if (fwdDiff) parts.push(`forward ${fwdDiff}`);
			if (backDiff) parts.push(`backward ${backDiff}`);

			return {
				id: c.id,
				script: c.script,
				expected,
				got: fwdDiff && !backDiff ? back : { fwd, back },
				ok: !parts.length,
				icuNote,
				error: parts.join("; "),
			};
		});

		process.exit(report(results, "runtime mode: real editor driven over CDP") ? 1 : 0);
	} finally {
		cleanup();
	}
}

if (MODE === "unit") runUnit();
else if (MODE === "emit") {
	// Write the fixture document and stop. Useful for launching the editor
	// yourself and then running runtime mode with --keep (attach only).
	const out = path.resolve(value("--emit-docx", path.join(process.cwd(), "caret-fixture.docx")));
	fs.writeFileSync(out, buildDocx(cases.map((c) => text(c.cps))));
	console.log(out);
} else await runRuntime();
