import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { patchLayout } from "../scripts/patch-layout.mjs";

const real = path.join(os.homedir(), ".config/herdr-app/layouts/main-copy.json");
const sample = {
  type: "row", children: [
    { id: "tabs", type: "block", content: { mod: "tabs" } },
    { id: "panel-body", type: "stack", children: [
      { id: "files", type: "block", content: { mod: "files" } },
      { id: "changes", type: "block", content: { mod: "changes" } },
    ] },
  ],
};
const find = (n, f) => { if (!n || typeof n !== "object") return null; if (f(n)) return n; for (const v of Object.values(n)) { const r = find(v, f); if (r) return r; } return null; };

for (const [name, src] of [["sample", () => structuredClone(sample)], ["real main-copy.json", () => JSON.parse(fs.readFileSync(real, "utf8"))]]) {
  test(`patchLayout: ${name}`, { skip: name !== "sample" && !fs.existsSync(real) }, () => {
    const out = patchLayout(src());
    assert.deepEqual(find(out, n => n.id === "panel-body").children.map(c => c.id), ["files", "changes", "graph"]);
    assert.deepEqual(find(out, n => n.id === "graph"), { id: "graph", type: "block", content: { mod: "git-graph" } });
    assert.deepEqual(find(out, n => n.id === "tabs").content, { mod: "git-graph-tabs", props: { replaces: { mod: "tabs" } } });
    assert.deepEqual(patchLayout(structuredClone(out)), out);
  });
}

test("patchLayout throws without panel-body", () => {
  assert.throws(() => patchLayout({ type: "row", children: [] }), /panel-body/);
});

test("CLI writes .bak once and is idempotent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pl-"));
  const f = path.join(dir, "l.json");
  fs.writeFileSync(f, JSON.stringify(sample));
  const run = () => execFileSync("node", [path.resolve("scripts/patch-layout.mjs"), f]);
  run();
  const once = fs.readFileSync(f, "utf8");
  assert.deepEqual(JSON.parse(fs.readFileSync(f + ".bak", "utf8")), sample);
  run();
  assert.equal(fs.readFileSync(f, "utf8"), once);
  assert.deepEqual(JSON.parse(fs.readFileSync(f + ".bak", "utf8")), sample);
});
