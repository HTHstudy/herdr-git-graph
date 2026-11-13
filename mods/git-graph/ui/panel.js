// The Graph panel: loads the focused repository and draws its commit graph.
import { div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { watchFolder, theme, settings, shared } from "herdr";
import { location, loadRepo } from "./repo.js";
import { paintRow } from "./graph-cell.js";
import { graphWidth, visibleColumns, relativeDate, refChips } from "../lib/format.js";

export const ROW_HEIGHT = 26;
const PAGE = 300;

export class Panel {
  init(_props, cx) {
    /** Per repository (`on` + root): what the person chose there. */
    this.repos = new Map();
    /** Location key → repo key of the last load there, so a revisit loads with that repo's options. */
    this.repoOf = new Map();
    this.context = null; this.data = null; this.status = "loading"; this.error = null;
    this.chips = new Map(); this.graphW = graphWidth([]); this.width = 0;
    this.range = { start: 0, end: 0 };
    this.seenChanged = shared("git-graph.changed")?.at ?? null;
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  /** Per-repo state, created on first use. */
  repo(repoKey) {
    let s = this.repos.get(repoKey);
    if (!s) {
      s = { expanded: null, branches: null, remotes: true, count: PAGE, scroll: VirtualListScrollHandle.new() };
      this.repos.set(repoKey, s);
    }
    return s;
  }

  current(context) {
    return this.context === context && location().key === context;
  }

  watch(root, on, cx) {
    if (on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root && this.context === context) {
          await watchFolder(root);
          if (this.watched === root && this.current(context)) this.refresh(cx);
        }
      } catch { if (this.watched === root) this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading) { this.again = true; return; }
    const { cwd, on, key } = location(), context = key;
    if (context !== this.context) {
      this.context = context; this.data = null; this.status = "loading"; this.error = null;
      this.chips = new Map(); this.graphW = graphWidth([]); this.watched = null; this.range = { start: 0, end: 0 };
    }
    if (!cwd) { this.status = "nofolder"; return; }
    const known = this.repoOf.get(context), state = known ? this.repo(known) : null;
    const opts = { branches: state?.branches ?? null, remotes: state?.remotes ?? true, count: state?.count ?? PAGE };
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const data = await loadRepo(cwd, on, opts);
        if (!this.current(context)) return;
        if (data.notRepo) { this.data = null; this.status = "notRepo"; this.error = null; return; }
        if (data.empty) { this.data = null; this.status = "empty"; this.error = null; return; }
        const repoKey = JSON.stringify([on, data.root]), s = this.repo(repoKey);
        this.repoOf.set(context, repoKey);
        // First visit from this location, but the repo was seen with other options: load again with them.
        if (s.branches !== opts.branches || s.remotes !== opts.remotes || s.count !== opts.count) this.again = true;
        this.data = { ...data, on, key: repoKey };
        this.chips = refChips(data.refs, data.head, data.headHash);
        this.graphW = graphWidth(data.rows);
        this.status = "ready"; this.error = null;
        this.watch(data.root, on, cx);
      } catch (e) {
        if (this.current(context)) { this.error = String(e?.message ?? e); this.status = this.data ? "ready" : "error"; }
      } finally {
        this.loading = false;
        if (this.again) { this.again = false; this.refresh(cx); }
        else this.checkMore(cx);
        cx.notify();
      }
    });
  }

  /** The rows the list shows (Task 8 adds detail rows between them). */
  items() {
    return this.data?.rows ?? [];
  }

  /** Scrolled to the end with more history: load another page. */
  checkMore(cx) {
    const d = this.data;
    if (!d || !d.more || this.loading || this.status !== "ready") return;
    if (this.range.end < this.items().length) return;
    const s = this.repo(d.key);
    if (s.count > d.commits.length) return; // a bigger load is already asked for
    s.count += PAGE;
    this.refresh(cx);
    cx.notify();
  }

  chip(c, t) {
    const color = c.kind === "head" ? t.accent : c.kind === "tag" ? t.ansi3 : t.muted;
    return div().flex_none().max_w(160).h(18).px(5).flex().items_center().rounded(4).border_1().border_color(color)
      .text_size(11).text_color(color).when(c.kind === "head", (e) => e.bg(t.accent + "22")).when(c.bold, (e) => e.font_bold())
      .child(div().truncate().child(c.label));
  }

  row(r, t, cols, now, mono) {
    const d = this.data;
    let subject, author = "", date = 0, hash = "", dim = false, chips = [];
    if (r.kind === "uncommitted") {
      subject = `Uncommitted Changes (${d.status.length})`; dim = true;
    } else if (r.kind === "stash") {
      subject = r.stash.subject; date = r.stash.date; hash = r.hash.slice(0, 7);
      chips = [{ label: r.stash.selector, kind: "stash", bold: false, ref: null }];
    } else {
      const c = r.commit;
      subject = c.subject; author = c.author; date = c.date; hash = c.hash.slice(0, 7);
      dim = c.parents.length > 1; chips = this.chips.get(c.hash) ?? [];
    }
    return h_flex().w_full().h(ROW_HEIGHT).flex_none().items_center().pr(10).hover((s) => s.bg(t.hover))
      .child(paintRow(r, t, ROW_HEIGHT, this.graphW))
      .child(h_flex().flex_1().min_w(0).gap(4).items_center()
        .children(chips.map((c) => this.chip(c, t)))
        .child(div().flex_1().min_w(0).truncate().text_color(dim ? t.dim : t.foreground).child(subject || " ")))
      .when(cols.author, (e) => e.child(div().w(110).flex_none().pl(10).truncate().text_color(t.muted).child(author)))
      .when(cols.date, (e) => e.child(div().w(76).flex_none().pl(10).truncate().text_color(t.muted).child(date ? relativeDate(date, now) : "")))
      .when(cols.hash, (e) => e.child(div().w(70).flex_none().pl(10).font_family(mono).text_size(11).text_color(t.dim).child(hash)));
  }

  message(t) {
    const text = this.status === "notRepo" ? "Not a git repository"
      : this.status === "empty" ? "No commits yet"
      : this.status === "nofolder" ? "No folder"
      : this.status === "error" ? this.error
      : "Loading…";
    return div().p(14).text_color(this.status === "error" ? t.ansi1 : t.dim).child(text);
  }

  list(t) {
    const d = this.data, items = this.items(), s = this.repo(d.key);
    const cols = visibleColumns(this.width), now = Date.now() / 1000, mono = settings().font_family ?? "JetBrains Mono";
    const id = "graph-rows";
    return div().id("graph-list").flex_1().min_h(0).relative()
      .on_scroll_wheel((_e, cx) => cx.timer.after(120, (cx) => this.checkMore(cx)))
      .on_mouse_up("left", (_e, cx) => cx.timer.after(120, (cx) => this.checkMore(cx)))
      .child(v_virtual_list(id, items.length + (d.more ? 1 : 0), ROW_HEIGHT,
        (i) => items[i]?.hash ?? "more",
        (range) => {
          this.range = range;
          const out = [];
          for (let i = range.start; i < range.end; i++) {
            out.push(i < items.length ? this.row(items[i], t, cols, now, mono)
              : div().h(ROW_HEIGHT).flex_none().px(12).flex().items_center().text_color(t.dim).child("Loading more commits…"));
          }
          return out;
        }).track_scroll(s.scroll).size_full())
      .child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0());
  }

  render(cx) {
    if (location().key !== this.context) this.refresh(cx);
    const changed = shared("git-graph.changed");
    if (changed && changed.at !== this.seenChanged) {
      this.seenChanged = changed.at;
      if (this.data && changed.root === this.data.root) this.refresh(cx);
    }
    const t = theme(), d = this.status === "ready" ? this.data : null;
    const branch = d ? (d.head ?? d.headHash.slice(0, 7)) : "";
    return v_flex().id("git-graph").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Graph"))
        .when(Boolean(branch), (e) => e.child(div().min_w(0).truncate().text_size(12).text_color(t.muted).child(branch))))
      .when(Boolean(d && this.error), (e) => e.child(div().px(12).py(4).text_size(11).text_color(t.ansi1).truncate().child(this.error)))
      .child(d ? this.list(t) : this.message(t));
  }
}
