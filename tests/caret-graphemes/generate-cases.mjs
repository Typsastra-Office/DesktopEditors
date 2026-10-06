#!/usr/bin/env node
// Regenerates cases.json for the complex script caret fixture.
//
//   node generate-cases.mjs
//
// Two tiers of cases are produced:
//
//   cluster  short, isolated clusters that pinpoint a single rule
//   sentence real sentences taken from tests/enhanced-unicode/corpus.json, so
//            word boundaries, spaces, punctuation and long runs of adjacent
//            clusters are exercised the way a reader meets them
//
// Each case records three things:
//
//   cps          the paragraph text as code points
//   icuClusters  what the ICU shipped in the desktop runtime reports, in code
//                point ranges. It splits a Khmer Coeng sequence, because UAX #29
//                has no Khmer rule.
//   expected     the caret stops we require, that is icuClusters after our
//                Coeng merge, expressed as code point offsets
//
// expected and icuClusters are frozen here rather than recomputed during a test
// run. Asking Intl.Segmenter what the answer should be only proves the
// implementation agrees with whichever ICU is installed, which is exactly how a
// real Coeng defect survived an earlier test: a host with modern ICU merges the
// sequence anyway, so the broken merge looked correct.
//
// Review the diff before committing. A new case is a claim about what a reader
// expects, not a recording of current behaviour.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, "..", "enhanced-unicode", "corpus.json");
const OUT = path.join(HERE, "cases.json");

const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const S = (...cps) => String.fromCodePoint(...cps);
const H = (s) => [...s].map((c) => c.codePointAt(0));

// --- cluster tier: [id, script, note, code points] ---------------------------
const CLUSTERS = [
	["km-simple-vowel", "Khmer", "Dependent vowel sign stays with its base consonant.", [0x179a, 0x17bb]],
	["km-coeng", "Khmer", "Coeng (U+17D2) subscript must not be split from its base.", [0x1781, 0x17d2, 0x1798, 0x17c2, 0x179a]],
	["km-coeng-two", "Khmer", "Two subscripts separated by a base stay in one cluster.", [0x1781, 0x17d2, 0x1784, 0x17d2, 0x1780]],
	["km-shadow", "Khmer", "Word with two subscripts; no stop between base and subscript.", [0x1781, 0x17d2, 0x1784, 0x1782, 0x17d2, 0x1798, 0x17b6, 0x179a]],
	["km-long", "Khmer", "Word mixing subscripts and dependent vowels.", [0x1792, 0x17d2, 0x179a, 0x17bd, 0x178f, 0x1796, 0x17b7, 0x1793, 0x17b7, 0x178f, 0x17d2, 0x1799]],
	["km-symbol-coeng", "Khmer", "Coeng applied after a spacing symbol.", [0x1787, 0x17c5, 0x17c4, 0x1784]],
	["dv-conjunct", "Devanagari", "Half form joined by virama.", [0x915, 0x94d, 0x937]],
	["dv-conjunct-matra", "Devanagari", "Half form plus a matra.", [0x915, 0x94d, 0x937, 0x93f]],
	["dv-vowel", "Devanagari", "Dependent vowel sign.", [0x915, 0x93f]],
	["dv-virama", "Devanagari", "Trailing virama.", [0x915, 0x94d]],
	["bn-conjunct", "Bengali", "Half form joined by virama.", [0x995, 0x9cd, 0x9b7]],
	["bn-vowel", "Bengali", "Dependent vowel sign.", [0x995, 0x9bf]],
	["pa-nukta", "Gurmukhi", "Nukta composition; UAX #29 keeps the spacing letter separate.", [0xa15, 0xa38, 0xa3c]],
	["gu-conjunct", "Gujarati", "Half form joined by virama.", [0xa95, 0xacd, 0xab7]],
	["or-conjunct", "Oriya", "Half form joined by virama.", [0xb15, 0xb4d, 0xb37]],
	["ta-vowel", "Tamil", "Dependent vowel sign.", [0xb95, 0xbc1]],
	["ta-pulli", "Tamil", "Pulli.", [0xb95, 0xbcd]],
	["te-vowel", "Telugu", "Dependent vowel sign.", [0xc15, 0xc41]],
	["kn-vowel", "Kannada", "Dependent vowel sign.", [0xc95, 0xcc1]],
	["ml-vowel", "Malayalam", "Dependent vowel sign.", [0xd15, 0xd41]],
	["si-vowel", "Sinhala", "Dependent vowel sign.", [0xd9a, 0xdd4]],
	["th-vowel", "Thai", "Dependent vowel sign.", [0xe01, 0xe34]],
	["th-sara-am", "Thai", "Sara Am plus an above mark.", [0xe17, 0xe35, 0xe48]],
	["lo-vowel", "Lao", "Dependent vowel sign.", [0xe81, 0xeb4]],
	["my-conjunct", "Myanmar", "Medial wa plus vowel.", [0x1000, 0x102d, 0x102f]],
	["my-pv", "Myanmar", "Asat.", [0x1000, 0x103b]],
	["ar-lam-alef", "Arabic", "Lam-alef is two caret stops, as in Chrome and Word.", [0x644, 0x627]],
	["ar-fatha", "Arabic", "Combining harakah.", [0x628, 0x64e]],
	["he-niqqud", "Hebrew", "Points attached to their letters.", [0x5e9, 0x5b8, 0x5c1, 0x5dc, 0x5d5, 0x5b9, 0x5dd]],
	["hangul-precomposed", "Hangul", "Precomposed syllable is one stop.", [0xac01]],
	["hangul-jamo", "Hangul", "Decomposed syllable is one stop.", [0x1100, 0x1161, 0x11a8]],
	["comb-single", "Latin", "Combining acute stays with its base.", [0x61, 0x301, 0x62]],
	["comb-stacked", "Latin", "Two stacked combining marks stay with the base.", [0x61, 0x302, 0x301, 0x62]],
	["comb-trailing", "Latin", "Combining mark at the end of a word.", [0x61, 0x301]],
	["emoji-zwj", "Emoji", "ZWJ family sequence is one stop.", [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467]],
	["emoji-flag", "Emoji", "Regional indicator pair is one stop.", [0x1f1e8, 0x1f1f3]],
	["emoji-skin", "Emoji", "Emoji modifier is one stop.", [0x1f44d, 0x1f3fd]],
	["emoji-vs16", "Emoji", "Variation selector stays with its base.", [0x2764, 0xfe0f]],
	["latin-precomposed", "Latin", "Precomposed accent is its own stop.", [0x63, 0x61, 0x66, 0xe9]],
	["latin-decomposed", "Latin", "Same text decomposed takes one fewer stop.", [0x63, 0x61, 0x66, 0x65, 0x301]],
];

// --- sentence tier ----------------------------------------------------------
const SENTENCE_SCRIPTS = {
	khmer: "Khmer",
	devanagari: "Devanagari",
	thai: "Thai",
	lao: "Lao",
	arabic: "Arabic",
	hebrew: "Hebrew",
	cjk: "CJK",
	"latin-basic": "Latin",
	"latin-ligatures": "Latin",
	"combining-marks": "Latin",
	"normalization-distinction": "Latin",
	"mixed-bidi": "Mixed",
};

function utf16Offsets(cps) {
	const out = [0];
	for (const cp of cps) out.push(out[out.length - 1] + String.fromCodePoint(cp).length);
	return out;
}

function analyse(cps) {
	const s = S(...cps);
	const off = utf16Offsets(cps);
	const raw = [];
	for (const p of seg.segment(s)) raw.push({ start: p.index, end: p.index + p.segment.length });

	// Model the ICU that ships in the desktop runtime: it splits a Khmer
	// sequence straight after each Coeng. Modern ICU merges them, which is why
	// the host Intl cannot be used to exercise our Coeng rule.
	const icuClusters = [];
	for (const g of raw) {
		let from = off.indexOf(g.start);
		const to = off.indexOf(g.end);
		for (let p = from; p < to; p++) {
			if (cps[p] === 0x17d2 && p + 1 < to) {
				icuClusters.push([from, p + 1]);
				from = p + 1;
			}
		}
		icuClusters.push([from, to]);
	}

	const merged = [];
	for (let i = 0; i < raw.length; i++) {
		const last = merged[merged.length - 1];
		if (last && s.codePointAt(last.end - 1) === 0x17d2) last.end = raw[i].end;
		else merged.push({ start: raw[i].start, end: raw[i].end });
	}
	const expected = [0];
	merged.forEach((g) => expected.push(off.indexOf(g.end)));
	const clusters = merged.map((g) => H(s.slice(g.start, g.end)).map((c) => c.toString(16).toUpperCase()));

	return { icuClusters, expected, clusters };
}

const cases = [];

for (const [id, script, note, cps] of CLUSTERS) {
	cases.push({ id, tier: "cluster", script, note, cps, ...analyse(cps) });
}

const corpus = JSON.parse(fs.readFileSync(CORPUS, "utf8"));
for (const c of corpus.cases) {
	const script = SENTENCE_SCRIPTS[c.id];
	if (!script || typeof c.text !== "string" || !c.text.length) continue;
	const cps = H(c.text);
	cases.push({
		id: "sentence-" + c.id,
		tier: "sentence",
		script,
		note: c.purpose || c.label || "Real sentence.",
		source: "tests/enhanced-unicode/corpus.json#" + c.id,
		cps,
		...analyse(cps),
	});
}

const doc = {
	description:
		"Complex script caret movement fixture. Offsets are code point indices into the paragraph " +
		"text, which is the unit the editor addresses run elements in. 'expected' lists the caret " +
		"stops, so its length is the number of clusters plus one.",
	expectations:
		"Derived from UAX #29 grapheme clustering plus the Khmer Coeng rule, then frozen by " +
		"generate-cases.mjs. A test run never asks Intl.Segmenter what the answer should be.",
	unitMode:
		"Unit mode replays icuClusters through a stub segmenter instead of the host Intl, so the " +
		"Coeng rule is exercised everywhere. A host with modern ICU merges the sequence on its own " +
		"and would hide a broken merge.",
	cases,
};

// Keep numeric arrays on one line. Pretty-printing them one element per line
// turns the fixture into twenty thousand lines that nobody will review.
const inline = (a) =>
	"[" + a.map((x) => (Array.isArray(x) ? inline(x) : JSON.stringify(x))).join(", ") + "]";
const out = [];
out.push("{");
out.push(`\t"description": ${JSON.stringify(doc.description)},`);
out.push(`\t"expectations": ${JSON.stringify(doc.expectations)},`);
out.push(`\t"unitMode": ${JSON.stringify(doc.unitMode)},`);
out.push(`\t"cases": [`);
cases.forEach((c, i) => {
	out.push("\t\t{");
	out.push(`\t\t\t"id": ${JSON.stringify(c.id)},`);
	out.push(`\t\t\t"tier": ${JSON.stringify(c.tier)},`);
	out.push(`\t\t\t"script": ${JSON.stringify(c.script)},`);
	out.push(`\t\t\t"note": ${JSON.stringify(c.note)},`);
	if (c.source) out.push(`\t\t\t"source": ${JSON.stringify(c.source)},`);
	out.push(`\t\t\t"cps": ${inline(c.cps)},`);
	out.push(`\t\t\t"icuClusters": ${inline(c.icuClusters)},`);
	out.push(`\t\t\t"expected": ${inline(c.expected)},`);
	out.push(`\t\t\t"clusters": ${inline(c.clusters)}`);
	out.push("\t\t}" + (i < cases.length - 1 ? "," : ""));
});
out.push("\t]");
out.push("}");

fs.writeFileSync(OUT, out.join("\n") + "\n", "utf8");
const sentences = cases.filter((c) => c.tier === "sentence").length;
console.log(`wrote ${OUT}`);
console.log(`${cases.length} cases (${cases.length - sentences} cluster, ${sentences} sentence)`);
for (const c of cases) {
	if (c.tier !== "sentence") continue;
	console.log(`  ${c.id.padEnd(34)} cps=${String(c.cps.length).padStart(4)} stops=${c.expected.length}`);
}
