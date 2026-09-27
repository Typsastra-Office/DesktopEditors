/*
 * AI Doc Bridge - local editor plugin prototype.
 *
 * Purpose: prove that a normal editor plugin can drive the LIVE document
 * (read the selection, rewrite the selected paragraph in place, insert
 * generated content, apply styles) and snapshot a page - all without any
 * native/core changes.
 *
 * Design rules that matter:
 *  - `callCommand` bodies are stringified and evaluated in the editor's
 *    isolated sandbox. They must be self-contained: no closures, only the
 *    injected globals `Api`, `Asc` and the parameter bag `scope`.
 *  - Everything the model needs to read back must be a serializable value.
 */
(function () {
    "use strict";

    window.Asc = window.Asc || {};
    window.Asc.plugin = window.Asc.plugin || {};

    var plugin = window.Asc.plugin;

    function log(msg) {
        var el = (typeof document !== "undefined") ? document.getElementById("status") : null;
        if (el)
            el.textContent = msg;
    }

    function callMethod(name, args, callback) {
        plugin.executeMethod(name, args || [], function (result) {
            if (typeof callback === "function")
                callback(result);
        });
    }

    function runCommand(func, data, callback) {
        window.Asc.scope = data || {};
        plugin.callCommand(func, false, false, function (result) {
            if (typeof callback === "function")
                callback(result);
        });
    }

    var bridge = {
        // ---- read the live document -------------------------------------
        getSelection: function (cb) {
            callMethod("GetSelectedText", [{ Numbering: false }], function (text) {
                cb(text || "");
            });
        },

        getSelectionHtml: function (cb) {
            callMethod("GetSelectedContent", [{ type: "html" }], function (html) {
                cb(html || "");
            });
        },

        // ---- write to the live document ---------------------------------
        // Rewrite the selected paragraph(s) in place. This is the exact
        // "select a paragraph, ask the agent, text changes in the document"
        // action. ReplaceTextSmart replaces each selected paragraph.
        replaceSelection: function (text, cb) {
            callMethod("ReplaceTextSmart", [[text]], function (ok) {
                cb(ok === true);
            });
        },

        // Insert new content at the cursor / selection (removes selection).
        insertContent: function (text, cb) {
            runCommand(function () {
                var doc = Api.GetDocument();
                var p = Api.CreateParagraph();
                p.AddText(scope.text);
                doc.InsertContent([p]);
                return true;
            }, { text: text }, cb);
        },

        // Apply character formatting to the current selection.
        applyStyle: function (style, cb) {
            runCommand(function () {
                var range = Api.GetDocument().GetRangeBySelect();
                if (!range)
                    return false;
                if (typeof scope.bold === "boolean")
                    range.SetBold(scope.bold);
                if (typeof scope.italic === "boolean")
                    range.SetItalic(scope.italic);
                if (scope.color) {
                    var col = scope.color;
                    if (typeof col === "string") {
                        if (typeof Api.HexColor === "function")
                            col = Api.HexColor(col);
                        else if (typeof Api.CreateColorFromRGB === "function") {
                            var h = col.replace("#", "");
                            col = Api.CreateColorFromRGB(parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16));
                        }
                    }
                    range.SetColor(col);
                }
                if (scope.fontSize)
                    range.SetFontSize(scope.fontSize);
                return true;
            }, style || {}, cb);
        },

        // ---- style inspection (used for "match the source document style") ----
        getStyles: function (cb) {
            runCommand(function () {
                var doc = Api.GetDocument();
                var all = doc.GetAllStyles() || {};
                var names = [];
                for (var k in all) {
                    if (Object.prototype.hasOwnProperty.call(all, k))
                        names.push(all[k].GetName ? all[k].GetName() : k);
                }
                return names;
            }, {}, cb);
        },

        // ---- snapshot ----------------------------------------------------
        // PDF pages can be rasterized from JS. Word/slide/cell cannot (needs
        // the native converter), so this only advertises what actually works.
        snapshotPage: function (pageIndex, cb) {
            callMethod("GetPageImage", [pageIndex, { maxSize: 1200, annotations: true, fields: true }], cb);
        },

        getCurrentPage: function (cb) {
            callMethod("GetCurrentPage", [], cb);
        }
    };

    window.AscAiBridge = bridge;
    plugin.bridge = bridge;

    // ---- lifecycle ------------------------------------------------------
    plugin.init = function () {
        log("Ready. Select some text, then use the panel.");

        function el(id) {
            return (typeof document !== "undefined") ? document.getElementById(id) : null;
        }

        var read = el("btn-read");
        if (read) {
            read.addEventListener("click", function () {
                bridge.getSelection(function (text) {
                    var box = el("selection");
                    if (box)
                        box.value = text;
                    log(text ? "Selection captured (" + text.length + " chars)." : "Nothing selected.");
                });
            });
        }

        var snap = el("btn-snapshot");
        if (snap) {
            snap.addEventListener("click", function () {
                bridge.getCurrentPage(function (page) {
                    bridge.snapshotPage(page || 0, function (dataUrl) {
                        var host = el("snapshot");
                        if (host && typeof dataUrl === "string" && dataUrl.indexOf("data:image") === 0) {
                            host.innerHTML = '<img src="' + dataUrl + '" alt="page snapshot" />';
                            log("Snapshot captured for page " + (page || 0) + ".");
                        } else {
                            log("Snapshot not supported by this editor (PDF only).");
                        }
                    });
                });
            });
        }

        var rewrite = el("btn-rewrite");
        if (rewrite) {
            rewrite.addEventListener("click", function () {
                var box = el("replacement");
                var text = box ? box.value : "";
                bridge.replaceSelection(text, function (ok) {
                    log(ok ? "Selection rewritten in place." : "Rewrite failed (make a selection first).");
                });
            });
        }

        var insert = el("btn-insert");
        if (insert) {
            insert.addEventListener("click", function () {
                var box = el("replacement");
                var text = box ? box.value : "";
                bridge.insertContent(text, function () {
                    log("Content inserted.");
                });
            });
        }

        function styleBtn(id, style) {
            var b = el(id);
            if (b)
                b.addEventListener("click", function () {
                    bridge.applyStyle(style, function (ok) {
                        log(ok ? "Style applied." : "No selection to style.");
                    });
                });
        }
        styleBtn("btn-bold", { bold: true });
        styleBtn("btn-italic", { italic: true });
        styleBtn("btn-red", { color: "#C00000" });
        styleBtn("btn-size", { fontSize: 16 });
    };

    plugin.button = function () {
        this.executeCommand("close", "");
    };
})();
