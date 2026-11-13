import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { patchLayout } from "../scripts/patch-layout.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/patch-layout.mjs", import.meta.url));
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
  const run = () => execFileSync("node", [SCRIPT, f]);
  run();
  const once = fs.readFileSync(f, "utf8");
  assert.deepEqual(JSON.parse(fs.readFileSync(f + ".bak", "utf8")), sample);
  run();
  assert.equal(fs.readFileSync(f, "utf8"), once);
  assert.deepEqual(JSON.parse(fs.readFileSync(f + ".bak", "utf8")), sample);
});

test("patchLayout throws without tabs block or with bad children", () => {
  assert.throws(() => patchLayout({ id: "panel-body", type: "stack", children: [] }), /no tabs block/);
  assert.throws(() => patchLayout({ id: "panel-body", type: "stack", children: {} }), /children/);
});

test("CLI: bad input exits 1 with one line and writes nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pl-"));
  const bad = path.join(dir, "bad.json"), notabs = path.join(dir, "n.json");
  fs.writeFileSync(bad, "{nope");
  fs.writeFileSync(notabs, JSON.stringify({ id: "panel-body", type: "stack", children: [] }));
  for (const f of [bad, notabs]) {
    const r = spawnSync("node", [SCRIPT, f], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.equal(r.stderr.trim().split("\n").length, 1);
    assert.deepEqual(fs.readdirSync(dir).filter(n => n.endsWith(".bak") || n.includes(".tmp")), []);
  }
});

test("CLI keeps 4-space indentation; real layout is a no-op", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pl-"));
  const f = path.join(dir, "l.json");
  fs.writeFileSync(f, JSON.stringify(sample, null, 4) + "\n");
  execFileSync("node", [SCRIPT, f]);
  assert.match(fs.readFileSync(f, "utf8"), /^ {4}"type"/m);
  if (fs.existsSync(real)) {
    const raw = fs.readFileSync(real, "utf8"), g = path.join(dir, "real.json");
    fs.writeFileSync(g, raw);
    execFileSync("node", [SCRIPT, g]);
    assert.equal(fs.readFileSync(g, "utf8"), raw);
  }
});

test("CLI refuses Herdr's shipped layouts (by basename), writes nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pl-"));
  for (const name of ["main.json", "terminals.json", "win98.json"]) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, JSON.stringify(sample));
    const r = spawnSync("node", [SCRIPT, f], { encoding: "utf8" });
    assert.equal(r.status, 1, name);
    assert.equal(r.stderr.trim().split("\n").length, 1);
    assert.match(r.stderr, /shipped Herdr layout/);
    assert.deepEqual(JSON.parse(fs.readFileSync(f, "utf8")), sample, "untouched");
  }
  assert.deepEqual(fs.readdirSync(dir).sort(), ["main.json", "terminals.json", "win98.json"], "no .bak / tmp");
});
