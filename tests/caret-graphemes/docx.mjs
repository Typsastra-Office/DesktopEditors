// Minimal dependency-free .docx writer for the caret fixture.
// A .docx is a ZIP, so we only need stored/deflated entries plus a CRC32.
import zlib from "node:zlib";

const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[i] = c;
	}
	return table;
})();

function crc32(buf) {
	let c = -1;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}

function zip(entries) {
	const locals = [];
	const centrals = [];
	let offset = 0;

	for (const [name, text] of entries) {
		const nameBuf = Buffer.from(name, "utf8");
		const data = Buffer.from(text, "utf8");
		const deflated = zlib.deflateRawSync(data, { level: 9 });
		const crc = crc32(data);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(0, 6); // flags
		local.writeUInt16LE(8, 8); // deflate
		local.writeUInt16LE(0, 10); // time
		local.writeUInt16LE(0x21, 12); // date (1980-01-01)
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(deflated.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		local.writeUInt16LE(0, 28);
		locals.push(local, nameBuf, deflated);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt16LE(0, 12);
		central.writeUInt16LE(0x21, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(deflated.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE(0, 30); // extra + comment lengths
		central.writeUInt16LE(0, 34); // disk
		central.writeUInt32LE(0, 38); // external attributes
		central.writeUInt32LE(offset, 42);
		centrals.push(central, nameBuf);

		offset += local.length + nameBuf.length + deflated.length;
	}

	const centralBuf = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralBuf.length, 12);
	end.writeUInt32LE(offset, 16);

	return Buffer.concat([...locals, centralBuf, end]);
}

const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// One paragraph per fixture case, in fixture order.
export function buildDocx(paragraphTexts, fontName = "Khmer OS") {
	const body = paragraphTexts
		.map(
			(t) =>
				`<w:p><w:r><w:rPr><w:rFonts w:ascii="${escapeXml(fontName)}" ` +
				`w:hAnsi="${escapeXml(fontName)}" w:cs="${escapeXml(fontName)}"/></w:rPr>` +
				`<w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r></w:p>`
		)
		.join("");

	const document =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
		`<w:body>${body}<w:sectPr/></w:body></w:document>`;

	const contentTypes =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
		'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
		'<Default Extension="xml" ContentType="application/xml"/>' +
		'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
		"</Types>";

	const rels =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
		'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
		"</Relationships>";

	return zip([
		["[Content_Types].xml", contentTypes],
		["_rels/.rels", rels],
		["word/document.xml", document],
	]);
}
