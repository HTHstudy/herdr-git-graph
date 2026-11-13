#!/usr/bin/env node
// Adds the Graph panel to a Herdr layout and swaps the tabs bar for git-graph-tabs.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const walk = (n, f) => {
  if (!n || typeof n !== "object") return;
  f(n);
  for (const v of Object.values(n)) walk(v, f);
};

export function patchLayout(layout) {
  let body = null;
  walk(layout, n => { if (!body && n.id === "panel-body" && n.type === "stack") body = n; });
  if (!body) throw new Error("layout has no panel-body stack");
  if (!Array.isArray(body.children)) throw new Error("panel-body has no children array");
  if (!body.children.some(c => c.id === "graph"))
    body.children.push({ id: "graph", type: "block", content: { mod: "git-graph" } });
  let tabs = false;
  walk(layout, n => {
    if (n.type !== "block") return;
    if (n.content?.mod === "tabs") {
      n.content = { mod: "git-graph-tabs", props: { replaces: { mod: "tabs" } } };
      tabs = true;
    } else if (n.content?.mod === "git-graph-tabs") tabs = true;
  });
  if (!tabs) throw new Error("layout has no tabs block");
  return layout;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error("usage: patch-layout.mjs <layout.json>"); process.exit(2); }
  let tmp;
  try {
    const raw = fs.readFileSync(file, "utf8");
    const indent = /^ {4}\S/m.test(raw) ? 4 : 2;
    const out = JSON.stringify(patchLayout(JSON.parse(raw)), null, indent) + "\n";
    if (!fs.existsSync(file + ".bak")) fs.writeFileSync(file + ".bak", raw);
    tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, file);
    tmp = undefined;
    console.log(`patched ${file}`);
  } catch (e) {
    console.error(`patch-layout: ${e.message}`);
    process.exitCode = 1;
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
}
