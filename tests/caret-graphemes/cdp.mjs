// Minimal Chrome DevTools Protocol client, using the WebSocket built into Node.
// Enough to attach to the desktop editor frame and evaluate expressions.
export async function listTargets(port) {
	const res = await fetch(`http://127.0.0.1:${port}/json/list`);
	return res.json();
}

export async function waitForCdp(port, timeoutMs = 60000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (res.ok) return (await res.json()).Browser;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`CDP did not come up on port ${port} within ${timeoutMs}ms`);
}

export async function connect(port, target) {
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	let nextId = 0;
	const pending = new Map();
	const contexts = [];

	ws.addEventListener("message", (ev) => {
		const msg = JSON.parse(ev.data);
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
			return;
		}
		if (msg.method === "Runtime.executionContextCreated") contexts.push(msg.params.context);
		else if (msg.method === "Runtime.executionContextsCleared") contexts.length = 0;
	});

	const send = (method, params) =>
		new Promise((resolve, reject) => {
			const id = ++nextId;
			pending.set(id, { resolve, reject });
			ws.send(JSON.stringify({ id, method, params: params || {} }));
		});

	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", () => reject(new Error("CDP socket failed")), { once: true });
	});

	await send("Runtime.enable");
	return {
		contexts,
		send,
		close: () => ws.close(),
		// The SDK lives in the document editor frame, so evaluate in every
		// context and let the caller pick the one that has the editor.
		async evaluate(expression) {
			const out = [];
			for (const ctx of contexts) {
				let res;
				try {
					res = await send("Runtime.evaluate", {
						contextId: ctx.id,
						expression,
						returnByValue: true,
						awaitPromise: true,
						userGesture: true,
					});
				} catch {
					continue;
				}
				if (res.exceptionDetails) continue;
				out.push({ contextId: ctx.id, value: res.result.value });
			}
			return out;
		},
	};
}

// The probe returns one entry per non-empty paragraph: its code points, the
// caret stops walking right, the stops walking left, and what this runtime's
// own Intl.Segmenter says (kept only for diagnostics, never as the oracle).
export const PROBE = `(() => {
  try {
    if (typeof window.editor === "undefined" || !window.editor.private_GetLogicDocument) return null;
    const doc = window.editor.private_GetLogicDocument();
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const toCodePoints = (s) => { const m = []; let n = 0; for (const c of s) { m.push(n); n += c.length; } m.push(n); return m; };
    const rows = [];
    for (let pi = 0; pi < doc.Content.length; pi++) {
      const para = doc.Content[pi];
      if (!para || !para.Content) continue;
      // A paragraph can hold several runs: long and bidirectional sentences are
      // split, and the paragraph mark sits in a trailing run. Collect the text
      // of every run in content order.
      const items = [];
      for (let j = 0; j < para.Content.length; j++) {
        const run = para.Content[j];
        if (!run || !run.Content || typeof run.Content.length !== "number") continue;
        for (let k = 0; k < run.Content.length; k++) {
          const it = run.Content[k];
          // Collect every element that owns a caret position. Spaces are
          // CRunSpace with IsText() false but a real code point, while the
          // paragraph mark reports null, so test the code point itself.
          if (it && typeof it.GetCodePoint === "function") {
            const cp = it.GetCodePoint();
            if (typeof cp === "number") items.push(cp);
          }
        }
      }
      if (!items.length) continue;
      const s = String.fromCodePoint.apply(null, items);

      const fwd = [];
      para.MoveCursorToStartPos();
      for (let k = 0; k < 300; k++) {
        fwd.push(para.Get_ParaContentPos(false, false).Get(1));
        if (para.MoveCursorRight(false, false) === false) break;
      }
      para.MoveCursorToEndPos();
      const back = [];
      for (let k = 0; k < 300; k++) {
        back.push(para.Get_ParaContentPos(false, false).Get(1));
        if (para.MoveCursorLeft(false, false) === false) break;
      }

      const raw = [];
      for (const p of seg.segment(s)) raw.push({ start: p.index, end: p.index + p.segment.length });
      const merged = [];
      for (let i = 0; i < raw.length; i++) {
        const last = merged[merged.length - 1];
        if (last && s.codePointAt(last.end - 1) === 0x17D2) last.end = raw[i].end;
        else merged.push({ start: raw[i].start, end: raw[i].end });
      }
      const u16 = toCodePoints(s);
      const icu = [0];
      merged.forEach((g) => icu.push(u16.indexOf(g.end)));

      rows.push({ cps: items, fwd, back, icu });
    }
    return JSON.stringify(rows);
  } catch (e) {
    return "ERR:" + (e && e.message);
  }
})()`;
