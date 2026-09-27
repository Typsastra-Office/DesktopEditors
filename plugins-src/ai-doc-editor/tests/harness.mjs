/*
 * Offline contract test for the AI Doc Bridge plugin.
 *
 * It loads the real code.js into a sandbox with a fake editor plugin host.
 * The fake `callCommand` evaluates the plugin's stringified command bodies
 * against a mock Document Builder `Api`, so we test the actual operations the
 * plugin would perform on a live document.
 *
 * Run: node tests/harness.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(here, "..", "code.js"), "utf8");

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
    if (cond) {
        passed++;
        console.log("  PASS  " + name);
    } else {
        failed++;
        console.log("  FAIL  " + name + (extra ? "  -> " + extra : ""));
    }
}

// ---- mock Document Builder Api (records what the plugin does) ------------
function makeMockApi(ops) {
    const range = {
        SetBold: (b) => ops.push(["range.SetBold", b]),
        SetItalic: (b) => ops.push(["range.SetItalic", b]),
        SetColor: (c) => ops.push(["range.SetColor", c]),
        SetFontSize: (s) => ops.push(["range.SetFontSize", s]),
        AddText: (t, p) => ops.push(["range.AddText", t, p]),
    };
    const doc = {
        GetRangeBySelect: () => range,
        InsertContent: (arr) => ops.push(["doc.InsertContent", arr.length]),
        GetAllStyles: () => ({
            Normal: { GetName: () => "Normal" },
            Heading1: { GetName: () => "Heading 1" },
        }),
    };
    return {
        GetDocument: () => doc,
        HexColor: (h) => ({ hex: h }),
        CreateParagraph: () => {
            const p = { AddText: (t) => { ops.push(["para.AddText", t]); return p; } };
            return p;
        },
    };
}

// ---- build the sandbox ---------------------------------------------------
const ops = [];
const methodCalls = [];
const mockApi = makeMockApi(ops);

const sandbox = { console };
sandbox.window = sandbox; // window === global, like a browser-ish plugin frame
sandbox.document = { getElementById: () => null };

let hostPlugin;
const fakeCallCommand = (func, isClose, isCalc, cb) => {
    sandbox.Api = mockApi;
    sandbox.scope = sandbox.window.Asc.scope;
    let result;
    try {
        result = func();
    } catch (e) {
        result = { error: String(e) };
    }
    if (typeof cb === "function") cb(result);
};
const canned = {
    GetSelectedText: "SELECTED TEXT",
    GetSelectedContent: "<p>SELECTED TEXT</p>",
    ReplaceTextSmart: true,
    GetCurrentPage: 0,
    GetPageImage: "data:image/png;base64,AAAA",
};
const fakeExecuteMethod = (name, args, cb) => {
    methodCalls.push({ name, args });
    if (typeof cb === "function") cb(canned[name]);
};

vm.createContext(sandbox);
sandbox.window.Asc = {
    plugin: {
        info: {},
        executeMethod: fakeExecuteMethod,
        callCommand: fakeCallCommand,
        executeCommand: () => {},
        init: null,
        button: null,
    },
};
vm.runInContext(code, sandbox, { filename: "code.js" });
hostPlugin = sandbox.window.Asc.plugin;

const bridge = sandbox.window.AscAiBridge;

console.log("AI Doc Bridge - offline contract tests");
console.log("---------------------------------------");

// 1. selection read
bridge.getSelection((text) => {
    check("getSelection -> GetSelectedText", text === "SELECTED TEXT", JSON.stringify(text));
    check(
        "getSelection passes Numbering:false",
        methodCalls.some((c) => c.name === "GetSelectedText" && c.args[0] && c.args[0].Numbering === false)
    );
});

bridge.getSelectionHtml((html) => {
    check("getSelectionHtml -> html", html === "<p>SELECTED TEXT</p>", html);
});

// 2. in-place rewrite of the selected paragraph
bridge.replaceSelection("Rewritten by AI", (ok) => {
    const call = methodCalls.find((c) => c.name === "ReplaceTextSmart");
    check("replaceSelection uses ReplaceTextSmart", !!call, "no call recorded");
    check(
        "replaceSelection sends [[text]]",
        !!call && Array.isArray(call.args[0]) && call.args[0][0] === "Rewritten by AI",
        call ? JSON.stringify(call.args) : ""
    );
    check("replaceSelection reports true", ok === true, String(ok));
});

// 3. insert generated content at the cursor
bridge.insertContent("Inspection summary", () => {
    check("insertContent adds paragraph text", ops.some((o) => o[0] === "para.AddText" && o[1] === "Inspection summary"));
    check("insertContent calls InsertContent", ops.some((o) => o[0] === "doc.InsertContent"));
});

// 4. apply style to selection
bridge.applyStyle({ bold: true, color: "#C00000" }, (ok) => {
    check("applyStyle sets bold", ops.some((o) => o[0] === "range.SetBold" && o[1] === true));
    check("applyStyle sets color via HexColor", ops.some((o) => o[0] === "range.SetColor" && o[1] && o[1].hex === "#C00000"));
    check("applyStyle reports true", ok === true, String(ok));
});

// 5. style inspection
bridge.getStyles((names) => {
    check("getStyles returns style names", Array.isArray(names) && names.join(",") === "Normal,Heading 1", JSON.stringify(names));
});

// 6. snapshot (PDF path)
bridge.snapshotPage(0, (dataUrl) => {
    check("snapshotPage returns image data", typeof dataUrl === "string" && dataUrl.startsWith("data:image"), String(dataUrl));
});

// 7. lifecycle init must not throw without DOM
try {
    hostPlugin.init();
    check("plugin.init() safe without DOM", true);
} catch (e) {
    check("plugin.init() safe without DOM", false, String(e));
}

console.log("---------------------------------------");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
