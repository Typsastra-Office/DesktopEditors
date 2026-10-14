// Minimal .docx fixture: a single autofit table with one cell holding an
// inline image. Used to reproduce the "image disappears after Advanced
// Settings resize" defect against the real desktop editor.
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

	for (const [name, data] of entries) {
		const nameBuf = Buffer.from(name, "utf8");
		const deflated = zlib.deflateRawSync(data, { level: 9 });
		const crc = crc32(data);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0, 6);
		local.writeUInt16LE(8, 8);
		local.writeUInt16LE(0, 10);
		local.writeUInt16LE(0x21, 12);
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
		central.writeUInt32LE(0, 30);
		central.writeUInt16LE(0, 34);
		central.writeUInt32LE(0, 38);
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

// Solid-colour RGB PNG, enough for the image loader to size and draw it.
function png(width, height, rgb) {
	const stride = width * 3 + 1;
	const raw = Buffer.alloc(stride * height, 0);
	for (let y = 0; y < height; y++) {
		const row = y * stride;
		for (let x = 0; x < width; x++) {
			const o = row + 1 + x * 3;
			raw[o] = rgb[0];
			raw[o + 1] = rgb[1];
			raw[o + 2] = rgb[2];
		}
	}
	const idat = zlib.deflateSync(raw);
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const t = Buffer.from(type, "ascii");
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
		return Buffer.concat([len, t, data, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // colour type: truecolour
	const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const EMU_PER_MM = 36000;

// extentMm is the size the image claims in the document (a "big" paste).
// anchored=true emulates a floating (wrap: none) picture inside the cell.
// anchorOffsetMm places the anchor relative to the column/paragraph.
export function buildDocx(extentMm = 152.4, anchored = false, anchorOffsetMm = 0) {
	const emu = Math.round(extentMm * EMU_PER_MM);
	const twips = Math.round((extentMm / 25.4) * 1440);
	const offEmu = Math.round(anchorOffsetMm * EMU_PER_MM);

	const pic =
		'<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
		"<pic:pic>" +
		'<pic:nvPicPr><pic:cNvPr id="1" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
		'<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
		"<pic:spPr>" +
		`<a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu}" cy="${emu}"/></a:xfrm>` +
		'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
		"</pic:spPr>" +
		"</pic:pic>" +
		"</a:graphicData></a:graphic>";

	const drawing = anchored
		? '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
			'relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
			'<wp:simplePos x="0" y="0"/>' +
			`<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>` +
			`<wp:positionV relativeFrom="paragraph"><wp:posOffset>${offEmu}</wp:posOffset></wp:positionV>` +
			`<wp:extent cx="${emu}" cy="${emu}"/>` +
			'<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
			"<wp:wrapNone/>" +
			'<wp:docPr id="1" name="Picture 1"/>' +
			"<wp:cNvGraphicFramePr/>" +
			pic +
			"</wp:anchor></w:drawing>"
		: '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
			`<wp:extent cx="${emu}" cy="${emu}"/>` +
			'<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
			'<wp:docPr id="1" name="Picture 1"/>' +
			"<wp:cNvGraphicFramePr/>" +
			pic +
			"</wp:inline></w:drawing>";

	const table =
		"<w:tbl>" +
		'<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/>' +
		'<w:tblLook w:val="0000"/></w:tblPr>' +
		`<w:tblGrid><w:gridCol w:w="${twips}"/></w:tblGrid>` +
		"<w:tr><w:tc>" +
		'<w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>' +
		`<w:p><w:r>${drawing}</w:r></w:p>` +
		"</w:tc></w:tr></w:tbl>" +
		"<w:p/>";

	const document =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
		'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
		'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
		'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
		'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
		`<w:body>${table}<w:sectPr/></w:body></w:document>`;

	const contentTypes =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
		'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
		'<Default Extension="xml" ContentType="application/xml"/>' +
		'<Default Extension="png" ContentType="image/png"/>' +
		'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
		"</Types>";

	const rels =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
		'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
		"</Relationships>";

	const docRels =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
		'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
		"</Relationships>";

	return zip([
		["[Content_Types].xml", Buffer.from(contentTypes, "utf8")],
		["_rels/.rels", Buffer.from(rels, "utf8")],
		["word/_rels/document.xml.rels", Buffer.from(docRels, "utf8")],
		["word/document.xml", Buffer.from(document, "utf8")],
		["word/media/image1.png", png(256, 256, [255, 212, 0])],
	]);
}
