#!/usr/bin/env node
// Reproduce "image disappears from an autofit table after resizing it in
// Advanced Settings", and contrast it with the equivalent direct (mouse)
// resize, against the real desktop editor over CDP.
//
//   node tests/image-table-resize/repro.mjs
//   node tests/image-table-resize/repro.mjs --keep      (attach to a running editor)
//
// It builds a docx with one autofit table holding an inline image, opens it,
// then:
//   advanced : select the drawing and call the same entry point the Advanced
//              Settings dialog uses (ImgApply with Width/Height).
//   mouse    : manipulate the transform exactly like ResizeTrackShapeImage.
// and prints the resulting table grid and drawing geometry for both.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDocx } from "./fixture.mjs";
import { listTargets, waitForCdp, connect } from "../caret-graphemes/cdp.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n, d) => {
	const i = args.indexOf(n);
	return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const PORT = Number(value("--port", "9333"));
const KEEP = flag("--keep");
const ANCHORED = flag("--anchored");
const ANCHOR_CURRENT = flag("--anchor-current");
const OFFSET_MM = Number(value("--offset", "0"));
const SAVE = flag("--save");
const LOAD = flag("--load");
const READONLY = flag("--readonly");
const FORCE = flag("--force");
const APP = path.resolve(
	value(
		"--app",
		path.join(REPO, "build_tools", "out", "win_64", "onlyoffice", "DesktopEditors", "DesktopEditors.exe")
	)
);

const PROBE = `(() => {
  try {
    const ANCHOR_CURRENT_FLAG = ${ANCHOR_CURRENT};
    const SAVE_FLAG = ${SAVE};
    const SAVE_FIX_FLAG = ${FORCE};
    const READONLY_FLAG = ${READONLY};
    const ed = window.editor || (window.Asc && window.Asc.editor);
    if (!ed || !ed.private_GetLogicDocument) return null;
    const doc = ed.private_GetLogicDocument();
    const dos = doc.DrawingObjects;
    if (!dos || !dos.drawingObjects) return "ERR:no DrawingObjects";
    const table = doc.Content[0];
    if (!table || !table.GetRowsCount) return "ERR:no table";

    const r = (x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : x);

    function findPd() {
      for (let row = 0; row < table.GetRowsCount(); row++) {
        const cells = table.GetRow(row).GetCellsCount();
        for (let c = 0; c < cells; c++) {
          const content = table.GetRow(row).GetCell(c).Content;
          for (let e = 0; e < content.GetElementsCount(); e++) {
            const para = content.GetElement(e);
            if (!para.GetAllDrawingObjects) continue;
            const arr = para.GetAllDrawingObjects();
            if (arr && arr.length) return arr[0];
          }
        }
      }
      return null;
    }
    function findGr() {
      const pd = findPd();
      return pd ? pd.GraphicObj : null;
    }

    function snap() {
      const g = findGr();
      if (!g) return { error: "no drawing" };
      const pd = g.parent;
      return {
        grid : table.TableGridCalc ? table.TableGridCalc.map(r) : null,
        layout : table.GetTableLayout ? table.GetTableLayout() : null,
        inline : pd.Is_Inline(),
        wrap : pd.wrappingType,
        sizeRelH : pd.SizeRelH ? JSON.stringify(pd.SizeRelH) : null,
        sizeRelV : pd.SizeRelV ? JSON.stringify(pd.SizeRelV) : null,
        extX : r(g.spPr.xfrm.extX),
        extY : r(g.spPr.xfrm.extY),
        offX : r(g.spPr.xfrm.offX),
        offY : r(g.spPr.xfrm.offY),
        x : r(pd.X),
        y : r(pd.Y),
        posV : pd.PositionV ? JSON.stringify(pd.PositionV) : null,
        boundsW : r(g.bounds && g.bounds.w),
        boundsH : r(g.bounds && g.bounds.h),
        pdW : r(pd.Width),
        pdH : r(pd.Height),
        extentW : r(pd.Extent && pd.Extent.W),
        extentH : r(pd.Extent && pd.Extent.H),
        effectL : r(pd.EffectExtent && pd.EffectExtent.L),
        effectT : r(pd.EffectExtent && pd.EffectExtent.T),
        boundsCached : r(g.bounds && g.bounds.w)
      };
    }

    const out = {};
    const BIG = 152.4;
    const SMALL = 40;
    const DESC = AscDFH.historydescription_Document_ApplyImagePr;

    function resetBig() {
      doc.StartAction(DESC);
      const g = findGr();
      const pd = g.parent;
      pd.SetSizeRelH(undefined);
      pd.SetSizeRelV(undefined);
      g.spPr.xfrm.setOffX(0);
      g.spPr.xfrm.setOffY(0);
      g.spPr.xfrm.setExtX(BIG);
      g.spPr.xfrm.setExtY(BIG);
      g.checkDrawingBaseCoords();
      pd.CheckWH();
      doc.Recalculate();
      doc.FinalizeAction();
    }

    if (ANCHOR_CURRENT_FLAG) {
      doc.StartAction(DESC);
      const g = findGr();
      const pd = g.parent;
      pd.Set_DrawingType(drawing_Anchor);
      pd.Set_WrappingType(WRAPPING_TYPE_NONE);
      pd.Set_BehindDoc(false);
      g.checkDrawingBaseCoords();
      pd.CheckWH();
      doc.Recalculate();
      doc.FinalizeAction();
    }

    out.loaded = snap();

    if (SAVE_FLAG) {
      selectDrawing();
      ed.ImgApply(makeProps());
      out.afterResize = snap();
      try { ed.asc_Save(); out.saved = true; } catch (e) { out.saveErr = "" + e; }
      return JSON.stringify(out);
    }

    if (SAVE_FIX_FLAG) {
      selectDrawing();
      ed.ImgApply(makeProps());
      out.afterResize = snap();
      const gg = findGr();
      try { gg.recalculate(); gg.parent.CheckWH(); doc.Recalculate(); } catch (e) { out.fixErr = "" + e; }
      out.afterForceRecalc = snap();
      return JSON.stringify(out);
    }

    if (READONLY_FLAG) {
      try { doc.Recalculate(); } catch (e) { out.recalcErr = "" + e; }
      out.settled = snap();
      return JSON.stringify(out);
    }

    resetBig();
    out.initial = snap();

    function selectDrawing() {
      const g = findGr();
      try { doc.Select_DrawingObject(g.parent.Get_Id()); } catch (e) { out.selectErr = "" + e; }
      return g;
    }
    function makeProps() {
      const p = new Asc.asc_CImgProperty();
      p.put_Width(SMALL);
      p.put_Height(SMALL);
      p.asc_putLockAspect(true);
      p.asc_putRot(0);
      p.asc_putFlipH(false);
      p.asc_putFlipV(false);
      return p;
    }

    // --- Advanced Settings: DrawingObjects.setProps ------------------------
    (function () {
      doc.StartAction(DESC);
      selectDrawing();
      out.selLen = dos.selectedObjects.length;
      dos.setProps(makeProps());
      doc.Recalculate();
      doc.FinalizeAction();
    })();
    out.advancedSetProps = snap();

    // --- Advanced Settings: the exact API the dialog calls (ImgApply) ------
    resetBig();
    (function () {
      selectDrawing();
      ed.ImgApply(makeProps());
    })();
    out.advancedImgApply = snap();

    // Restore the big extent so the mouse path starts from the same place.
    resetBig();
    out.restored = snap();

    // --- Mouse (ResizeTrackShapeImage.trackEnd) equivalent -----------------
    (function () {
      doc.StartAction(DESC);
      const g = findGr();
      const xfrm = g.spPr.xfrm;
      xfrm.setOffX(0);
      xfrm.setOffY(0);
      xfrm.setExtX(SMALL);
      xfrm.setExtY(SMALL);
      g.ResetParametersWithResize();
      g.checkDrawingBaseCoords();
      g.parent.CheckWH();
      doc.Recalculate();
      doc.FinalizeAction();
    })();
    out.mouse = snap();

    return JSON.stringify(out);
  } catch (e) {
    return "ERR:" + (e && e.message) + "\\n" + (e && e.stack);
  }
})()`;

async function isCdpUp() {
	try {
		const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
		return res.ok;
	} catch {
		return false;
	}
}

const docxPath = path.resolve(
	value("--docx", path.join(os.tmpdir(), `typsastra-image-table-resize-${process.pid}-${Date.now()}.docx`))
);
if (!LOAD) fs.writeFileSync(docxPath, buildDocx(152.4, ANCHORED, OFFSET_MM));
console.log(`fixture document: ${docxPath} (${LOAD ? "load existing" : ANCHORED ? "anchored" : "inline"})`);

let child = null;
if (!(await isCdpUp())) {
	if (!fs.existsSync(APP)) {
		console.error(`app not found: ${APP}`);
		process.exit(2);
	}
	console.log(`launching ${APP}`);
	child = spawn(APP, [`--remote-debugging-port=${PORT}`, docxPath], { detached: true, stdio: "ignore" });
	child.unref();
} else {
	console.log(`attaching to editor on port ${PORT}`);
}

const cleanup = () => {
	if (child && !KEEP) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
};

try {
	await waitForCdp(PORT);

	let result = null;
	const deadline = Date.now() + 120000;
	while (Date.now() < deadline && !result) {
		for (const target of (await listTargets(PORT)).filter((t) => t.type === "page")) {
			let client;
			try {
				client = await connect(PORT, target);
			} catch {
				continue;
			}
			try {
				for (const r of await client.evaluate(PROBE)) {
					if (typeof r.value !== "string") continue;
					if (r.value.startsWith("ERR:")) continue;
					let parsed;
					try {
						parsed = JSON.parse(r.value);
					} catch {
						continue;
					}
					if (!parsed || parsed.error) continue;
					result = parsed;
					break;
				}
			} finally {
				client.close();
			}
			if (result) break;
		}
		if (!result) await new Promise((r) => setTimeout(r, 2000));
	}

	if (!result) throw new Error("could not read state from the editor");
	console.log(JSON.stringify(result, null, 2));
	if (SAVE) {
		console.log(`waiting for save; document: ${docxPath}`);
		await new Promise((r) => setTimeout(r, 20000));
		console.log(`saved file size: ${fs.existsSync(docxPath) ? fs.statSync(docxPath).size : "missing"}`);
	}
} finally {
	cleanup();
}
