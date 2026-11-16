// The diff pane: one per tab, beside the work (split mode, props().diff.tab = the tab id), or
// alone in the space's diff tab (tab mode, props().diff.tab = "space:<spaceId>").
// Shows `shared("git-graph.diff.<key>")`.
// Draws its own line rows (per-line +/- backgrounds), no token syntax highlighting.
import { div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { theme, settings, shared, setShared, panes, spaces, focused, run, exec, appHome, readTextFile, notify, nextCommand } from "herdr";
import { git } from "./repo.js";
import { diffArgs } from "../lib/diff.js";
import { sameTarget, targetLabel, absPath, diffOutcome, diffRows, gutterDigits, diffPaneOf, gitGraphPanes, keySpace, findDiffTab, sameDiffTab, diffWhere, diffCloseCommand } from "../lib/diffview.js";

const LINE = 20;
export const diffKey = (tab) => "git-graph.diff." + tab;
export const paneKey = (tab) => "git-graph.diffPane." + tab;
/** Tab mode: the space's diff tab, {tab, pane}. */
export const tabKey = (space) => "git-graph.diffTab." + space;
const nvimBin = () => `${appHome()}/mods/herdr-nvim/bin/herdr-nvim`;

export class DiffPane {
  init(props, cx) {
    this.tab = props.diff.tab;
    /** Tab mode: the space whose diff tab this is (null: a split pane of tab `this.tab`). */
    this.space = keySpace(this.tab);
    /** The target the shown result belongs to, and its load state. */
    this.target = null; this.state = "empty"; this.result = null; this.error = null;
    this.rowsCache = null; this.loadGen = 0; this.grabbed = false;
    this.scroll = VirtualListScrollHandle.new();
    this.handle = cx.focus_handle();
    this.nvim = false;
    cx.spawn(async (cx) => {
      try { this.nvim = (await readTextFile(nvimBin())) !== null; } catch { this.nvim = false; }
      cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        else if (c === "close") this.close();
        cx.notify();
      }
    });
    this.adopt();
  }

  /** Tab mode: this space's diff tab {tab, pane}, verified (re-recorded when found anew), or null. */
  diffTab() {
    const stored = shared(tabKey(this.space));
    const found = findDiffTab(spaces(), panes(), this.space, stored);
    if (found && !sameDiffTab(found, stored)) setShared(tabKey(this.space), found);
    return found;
  }

  /** After a restart (pane ids may change) the tab's only git-graph pane is this one: record it. */
  adopt() {
    if (this.space) { this.diffTab(); return; }
    const list = panes();
    if (diffPaneOf(list, this.tab, shared(paneKey(this.tab)))) return;
    const mine = gitGraphPanes(list, this.tab);
    if (mine.length === 1) setShared(paneKey(this.tab), mine[0]);
  }

  /** This pane's id: the recorded one, else the focused pane when it is a git-graph pane of the tab. */
  paneId() {
    if (this.space) return this.diffTab()?.pane ?? null;
    const list = panes(), stored = diffPaneOf(list, this.tab, shared(paneKey(this.tab)));
    if (stored) return stored;
    const f = focused()?.pane;
    return f && gitGraphPanes(list, this.tab).includes(f) ? f : null;
  }

  /**
   * Once a target has loaded and the app's focused pane is this one (just split in, or adopted),
   * take the keyboard so Esc works without a click first. Once per target.
   */
  grab(cx) {
    if (this.grabbed || this.state === "loading" || this.state === "empty") return;
    const mine = this.space ? shared(tabKey(this.space))?.pane : diffPaneOf(panes(), this.tab, shared(paneKey(this.tab)));
    if (!mine || focused()?.pane !== mine) return;
    this.grabbed = true;
    cx.spawn(async () => { this.handle.focus(); });
  }

  /**
   * Esc / ✕: a split pane closes; in tab mode the diff tab closes when this pane is all it holds,
   * else only this pane (a shell split in beside it lives on).
   */
  close() {
    if (this.space) {
      const cmd = diffCloseCommand(panes(), this.diffTab());
      if (cmd) { run(cmd.name, cmd.args); return; }
      // Not recorded (or ambiguous): the focused pane when it is a git-graph one (this pane, here).
      const f = focused()?.pane;
      if (f && panes().some((p) => p.pane === f && p.mod === "git-graph")) run("pane.close", { pane: f });
      return;
    }
    const pane = this.paneId();
    if (pane) run("pane.close", { pane });
  }

  /** The shared target changed: load it; a result for an older target is dropped. */
  load(target, cx) {
    this.target = target; this.result = null; this.error = null; this.rowsCache = null; this.grabbed = false;
    this.state = target ? "loading" : "empty";
    const gen = ++this.loadGen;
    if (!target) return;
    cx.spawn(async (cx) => {
      let out;
      try {
        const r = await git(target.root, target.on, diffArgs(target));
        out = diffOutcome(target, r);
      } catch (e) {
        out = { state: "error", error: String(e?.message ?? e) };
      }
      if (gen !== this.loadGen || !sameTarget(shared(diffKey(this.tab)), target)) return;
      this.state = out.state;
      this.result = out.state === "ready" ? out : null;
      this.error = out.state === "error" ? out.error : null;
      if (out.state === "ready") this.scroll.scroll_to_item(0, "top");
      cx.notify();
    });
  }

  rows(mode) {
    const c = this.rowsCache, r = this.result;
    if (c && c.result === r && c.mode === mode) return c;
    const next = { result: r, mode, rows: diffRows(r.diff, mode, this.target.from), digits: gutterDigits(r.diff) };
    this.rowsCache = next;
    return next;
  }

  openInNvim() {
    const t = this.target;
    if (!t) return;
    const tab = this.space ? this.diffTab()?.tab ?? focused()?.tab : this.tab;
    const space = this.space ?? spaces().find((s) => s.tabs?.some((x) => x.id === tab))?.id ?? focused()?.space;
    const ctx = JSON.stringify({ space, tab, terminal: null, cwd: null });
    exec(nvimBin(), ["open", absPath(t), "--ctx", ctx]).then((r) => {
      if (r.code !== 0) notify({ title: "herdr-nvim open failed", body: (r.stderr || r.stdout).trim().slice(-400), level: "error" });
    }, (e) => notify({ title: "herdr-nvim open failed", body: String(e?.message ?? e), level: "error" }));
  }

  key(e, cx) {
    if (e.keystroke !== "escape") return;
    this.close();
    cx.stop_propagation();
  }

  button(id, t, on, active = false) {
    return div().id(id).flex_none().h(22).px(8).flex().items_center().rounded(5).text_size(12)
      .text_color(active ? t.foreground : t.muted).when(active, (e) => e.bg(t.selected))
      .hover((s) => s.bg(active ? t.selected : t.hover)).on_click((_e, cx) => { on(); cx.stop_propagation(); cx.notify(); });
  }

  header(t, mode) {
    const tg = this.target;
    const canOpen = this.nvim && tg && !tg.on && this.state === "ready" && !this.result.deleted;
    const seg = h_flex().flex_none().rounded(6).border_1().border_color(t.border).p(1).gap(1)
      .child(this.button("dm-unified", t, () => setShared("git-graph.diffMode", "unified"), mode === "unified").child("Unified"))
      .child(this.button("dm-split", t, () => setShared("git-graph.diffMode", "split"), mode === "split").child("Split"));
    const where = diffWhere(shared("git-graph.diffWhere"));
    const open = h_flex().flex_none().gap(4).items_center()
      .child(div().text_size(11).text_color(t.dim).child("Open in:"))
      .child(h_flex().rounded(6).border_1().border_color(t.border).p(1).gap(1)
        .child(this.button("dw-tab", t, () => setShared("git-graph.diffWhere", "tab"), where === "tab").child("Tab"))
        .child(this.button("dw-split", t, () => setShared("git-graph.diffWhere", "split"), where === "split").child("Pane")));
    return h_flex().w_full().flex_none().h(36).px(10).gap(8).items_center().border_b_1().border_color(t.border).bg(t.surface)
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_size(13).child(tg ? (tg.from ? `${tg.from} → ${tg.path}` : tg.path) : "Diff"))
        .when(Boolean(tg), (e) => e.child(div().truncate().text_size(11).text_color(t.dim).child(targetLabel(tg)))))
      .when(Boolean(tg), (e) => e.child(seg))
      .child(open)
      .when(Boolean(canOpen), (e) => e.child(this.button("dm-nvim", t, () => this.openInNvim()).child("Open in nvim")))
      .child(this.button("dm-close", t, () => this.close()).w(22).px(0).justify_center().child("✕"));
  }

  message(t, text, color) {
    return div().p(14).text_size(13).text_color(color ?? t.dim).child(text);
  }

  /** One side of a line: its gutter numbers (old/new unified, one per side split), then the text, on the line's color. */
  cell(l, t, o, nums) {
    const bg = !l ? t.surface : l.kind === "+" ? t.ansi2 + "22" : l.kind === "-" ? t.ansi1 + "22" : null;
    const num = (n) => div().w(o.numW).flex_none().pr(6).text_right().text_color(t.dim).child(n == null ? "" : String(n));
    const sign = l ? (l.kind === " " ? " " : l.kind) : "";
    const signColor = l?.kind === "+" ? t.ansi2 : l?.kind === "-" ? t.ansi1 : t.dim;
    return h_flex().flex_1().min_w(0).h(LINE).items_center().overflow_hidden().when(Boolean(bg), (e) => e.bg(bg))
      .children(nums.map(num))
      .child(div().w(14).flex_none().text_color(signColor).child(sign))
      .child(div().flex_1().min_w(0).whitespace_nowrap().overflow_hidden().child(l ? l.text || " " : ""));
  }

  rowElement(r, t, o) {
    const base = h_flex().w_full().h(LINE).flex_none().items_center();
    if (r.type === "hunk") return base.px(8).bg(t.surface).text_color(t.dim).child(div().truncate().child(r.text));
    if (r.type === "notice") return base.px(12).text_color(t.dim).child(r.text);
    if (r.type === "line") return base.child(this.cell(r.line, t, o, [r.line.old, r.line.new]));
    return base.child(this.cell(r.left, t, o, [r.leftNo])).child(div().w(1).h_full().flex_none().bg(t.border)).child(this.cell(r.right, t, o, [r.rightNo]));
  }

  body(t, mode) {
    if (this.state === "empty") return this.message(t, "Pick a file in Graph");
    if (this.state === "loading") return this.message(t, "Loading…");
    if (this.state === "gone") return this.message(t, "This file is no longer available");
    if (this.state === "error") return this.message(t, this.error, t.ansi1);
    const { rows, digits } = this.rows(mode);
    const mono = settings().font_family ?? "JetBrains Mono";
    const o = { numW: digits * 8 + 10 };
    const id = "diff-rows";
    return div().flex_1().min_h(0).relative().font_family(mono).text_size(12)
      .child(v_virtual_list(id, rows.length, LINE, (i) => rows[i]?.key ?? String(i),
        (range) => {
          const out = [];
          for (let i = range.start; i < range.end; i++) out.push(this.rowElement(rows[i], t, o));
          return out;
        }).track_scroll(this.scroll).size_full())
      .child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0());
  }

  render(cx) {
    const target = shared(diffKey(this.tab)) ?? null;
    if (!sameTarget(target, this.target)) this.load(target, cx);
    this.grab(cx);
    const t = theme(), mode = shared("git-graph.diffMode") === "split" ? "split" : "unified";
    return v_flex().id("git-graph-diff").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .child(this.header(t, mode))
      .child(this.body(t, mode));
  }
}
