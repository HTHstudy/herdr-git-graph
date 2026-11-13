import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const ISOLATED_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

function env() {
  return { ...process.env, ...ISOLATED_ENV };
}

export function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, env: env(), encoding: "utf8" }).trimEnd();
}

export function gitRaw(dir, ...args) {
  const r = spawnSync("git", args, { cwd: dir, env: env(), encoding: "utf8" });
  return { code: r.status, stdout: r.stdout };
}

let template;
function buildTemplate() {
  if (!template) {
    template = mkdtempSync(join(tmpdir(), "gg-template-"));
    execFileSync("bash", [join(here, "..", "scripts", "make-fixture.sh"), template], {
      env: env(),
      stdio: "pipe",
    });
  }
  return template;
}

export async function fixture() {
  const src = buildTemplate();
  const dst = mkdtempSync(join(tmpdir(), "gg-fixture-"));
  cpSync(src, dst, { recursive: true, verbatimSymlinks: true });
  git(join(dst, "work"), "remote", "set-url", "origin", join(dst, "origin.git"));
  return join(dst, "work");
}
