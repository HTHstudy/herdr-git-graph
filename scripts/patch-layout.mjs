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
  if (!body.children.some(c => c.id === "graph"))
    body.children.push({ id: "graph", type: "block", content: { mod: "git-graph" } });
  walk(layout, n => {
    if (n.type === "block" && n.content?.mod === "tabs")
      n.content = { mod: "git-graph-tabs", props: { replaces: { mod: "tabs" } } };
  });
  return layout;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error("usage: patch-layout.mjs <layout.json>"); process.exit(2); }
  const raw = fs.readFileSync(file, "utf8");
  const out = JSON.stringify(patchLayout(JSON.parse(raw)), null, 2) + "\n";
  if (!fs.existsSync(file + ".bak")) fs.writeFileSync(file + ".bak", raw);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, file);
  console.log(`patched ${file}`);
}
