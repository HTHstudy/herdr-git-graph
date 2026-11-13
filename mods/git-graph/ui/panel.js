// The Graph panel: loads the focused repository and draws its commit graph.
import { div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, VirtualListScrollHandle, InputState } from "gpui-base";
import { watchFolder, theme, settings, shared, setShared, nextCommand, focused, panes, run } from "herdr";
import { location, loadRepo, git } from "./repo.js";
import { paintRow } from "./graph-cell.js";
import { detailElement } from "./details.js";
import { headerElement, fetchAll, busyOf } from "./header.js";
import { graphWidth, visibleColumns, relativeDate, refChips } from "../lib/format.js";
import { commitInfoArgs, commitFilesArgs, commitStatusArgs } from "../lib/git.js";
import { parseCommitInfo, parseNumstat, parseNameStatus } from "../lib/parse.js";
import { detailItems, commitFiles, commitTarget, uncommittedTarget, pruneState } from "../lib/details.js";
import { diffPaneOf, newDiffPane, gitGraphPanes } from "../lib/diffview.js";
import { paneKey } from "./diff-pane.js";
import { toggleBranch, removeBranch, pruneFilter, findMatches, stepMatch } from "../lib/filter.js";

export const ROW_HEIGHT = 26;
const PAGE = 300;
/** Loaded commit details kept for instant re-expanding. */
const DETAIL_CACHE = 50;
/** How long a fresh split may take to show in panes(). */
const SPLIT_WAIT = 2000;

export class Panel {
  init(_props, cx) {
    /** Per repository (`on` + root): what the person chose there. */
    this.repos = new Map();
    /** Location key → repo key of the last load there, so a revisit loads with that repo's options. */
    this.repoOf = new Map();
    this.context = null; this.data = null; this.status = "loading"; this.error = null;
    this.chips = new Map(); this.graphW = graphWidth([]); this.width = 0;
    this.range = { start: 0, end: 0 }; this.watched = null; this.watchGen = 0; this.moreQueued = false; this.pageFailed = false;
    this.seenChanged = shared("git-graph.changed")?.at ?? null;
    /** repoKey + hash → CommitDetail, oldest first (bounded). */
    this.details = new Map();
    this.itemCache = null; this.viewH = 0; this.copied = null;
    this.handle = cx.focus_handle();
    /** Find: the query (for every repo), the current match's hash, whether the box has the keyboard. */
    this.query = ""; this.findCur = null; this.finding = false; this.findCache = null;
    this.branchesOpen = false;
    /** A diff pane split in flight: {tab, at}. */
    this.splitting = null;
    this.find = InputState.new({ placeholder: "Find" });
    this.find.on("change", (_e, cx) => this.setQuery(this.find.value(), cx));
    this.find.on("submit", (e, cx) => this.stepFind(e?.shift ? -1 : 1, cx));
    this.find.on("focus", (_e, cx) => { this.finding = true; cx.notify(); });
    this.find.on("blur", (_e, cx) => { this.finding = false; cx.notify(); });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        else this.command(c, cx); // "up" | "down" | "toggle" | "collapse" | "find": bindable in keys.json
        cx.notify();
      }
    });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  /** Per-repo state, created on first use. */
  repo(repoKey) {
    let s = this.repos.get(repoKey);
    if (!s) {
      s = { expanded: null, selected: null, branches: null, remotes: true, count: PAGE, scroll: VirtualListScrollHandle.new() };
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
    // One live loop at most: resetting `watched` bumps the generation, so an older loop
    // still parked in watchFolder ends when it wakes instead of running beside a new one.
    const gen = ++this.watchGen, context = this.context;
    cx.spawn(async (cx) => {
      try {
        while (this.watchGen === gen) {
          await watchFolder(root);
          if (this.watchGen === gen && this.current(context)) this.refresh(cx);
        }
      } catch { if (this.watchGen === gen) this.unwatch(); }
    });
  }

  unwatch() {
    this.watched = null; this.watchGen++;
  }

  refresh(cx) {
    const { cwd, on, key } = location(), context = key;
    // Reset before the in-flight check: a focus change mid-load must not keep showing the old repo.
    if (context !== this.context) {
      this.context = context; this.data = null; this.status = "loading"; this.error = null; this.branchesOpen = false;
      this.chips = new Map(); this.graphW = graphWidth([]); this.range = { start: 0, end: 0 };
      this.unwatch(); this.moreQueued = false; this.pageFailed = false;
    }
    if (this.loading) { this.again = true; return; }
    if (!cwd) { this.status = "nofolder"; return; }
    const known = this.repoOf.get(context), state = known ? this.repo(known) : null;
    const opts = { branches: state?.branches ?? null, remotes: state?.remotes ?? true, count: state?.count ?? PAGE };
    this.loading = true;
    let failed = false;
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
        // A filtered branch that is gone (or a remote one now hidden) drops out; none left → Show All.
        const pruned = pruneFilter(s.branches, data.refs, s.remotes);
        if (pruned !== s.branches) { s.branches = pruned; this.again = true; }
        this.data = { ...data, on, key: repoKey, shownRemotes: opts.remotes };
        this.chips = this.makeChips();
        this.graphW = graphWidth(data.rows);
        this.status = "ready"; this.error = null; this.pageFailed = false;
        pruneState(s, data.rows); // a vanished row (clean tree, dropped stash) must not re-open later
        this.watch(data.root, on, cx);
      } catch (e) {
        failed = true;
        if (this.current(context)) {
          this.error = String(e?.message ?? e); this.status = this.data ? "ready" : "error";
          // A failed extra page gives its count back, so scrolling to the end can ask again.
          const s = this.data && this.repos.get(this.data.key);
          if (s && s.count === opts.count && opts.count > this.data.commits.length) {
            s.count = Math.max(PAGE, this.data.commits.length);
            this.pageFailed = true; // no automatic retry until a good load or the person scrolls
          }
        }
      } finally {
        this.loading = false;
        if (this.again) { this.again = false; this.refresh(cx); }
        else if (!failed) this.checkMore(cx);
        cx.notify();
      }
    });
  }

  /**
   * What the list shows: each graph row, and under the expanded one its detail items.
   * Each entry has a unique `key` and its own `size`. Rebuilt only when the data, the
   * expanded row or its detail changes.
   * @returns {({key:string, part:"row", size:number, row:any} | import("../lib/details.js").DetailItem)[]}
   */
  items() {
    const d = this.data;
    if (!d) return [];
    const exp = this.repo(d.key).expanded;
    const det = exp ? this.details.get(this.detailKey(d.key, exp)) ?? null : null;
    const c = this.itemCache;
    if (c && c.data === d && c.exp === exp && c.det === det) return c.items;
    const items = [], index = new Map(), rows = new Map();
    for (const row of d.rows) {
      rows.set(row.hash, row);
      index.set(row.hash, items.length);
      items.push({ key: row.hash, part: "row", size: ROW_HEIGHT, row });
      if (row.hash === exp) for (const it of detailItems(row, det, d.status)) { index.set(it.key, items.length); items.push(it); }
    }
    this.itemCache = { data: d, exp, det, items, index, rows };
    return items;
  }

  /** Index of an item key in items(), or -1. */
  indexOf(key) {
    this.items();
    return this.itemCache?.index.get(key) ?? -1;
  }

  detailKey(repoKey, hash) {
    return repoKey + "\0" + hash;
  }

  setDetail(key, value) {
    this.details.delete(key);
    this.details.set(key, value);
    while (this.details.size > DETAIL_CACHE) this.details.delete(this.details.keys().next().value);
  }

  /** The expanded commit or stash has no detail yet: load it. */
  ensureDetail(cx) {
    const d = this.data;
    if (!d || this.status !== "ready") return;
    const repoKey = d.key, hash = this.repo(repoKey).expanded;
    if (!hash || hash === "*") return;
    const key = this.detailKey(repoKey, hash);
    if (this.details.has(key)) return; // loaded, loading, or failed (reopening the row retries)
    const row = d.rows.find((r) => r.hash === hash);
    if (!row) return;
    const parent = row.kind === "stash" ? row.stash.base || null : row.commit.parents[0] ?? null;
    const entry = { state: "loading" }, context = this.context, { root, on } = d;
    this.setDetail(key, entry);
    cx.spawn(async (cx) => {
      let result;
      try {
        const [info, num, names] = await Promise.all([
          git(root, on, commitInfoArgs(hash)), git(root, on, commitFilesArgs(hash, parent)), git(root, on, commitStatusArgs(hash, parent)),
        ]);
        for (const r of [info, num, names]) if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `git exited ${r.code}`);
        result = { state: "ready", info: parseCommitInfo(info.stdout), files: commitFiles(parseNumstat(num.stdout), parseNameStatus(names.stdout)), parent };
      } catch (e) {
        result = { state: "error", error: String(e?.message ?? e) };
      }
      if (this.details.get(key) !== entry) return;
      // Stale: another location or repo, or the row was collapsed meanwhile. Drop it.
      if (!this.current(context) || this.data?.key !== repoKey || this.repo(repoKey).expanded !== hash) { this.details.delete(key); return; }
      this.setDetail(key, result);
      cx.notify();
    });
  }

  /** Expand a row (collapsing any other), or collapse it if it is the open one. */
  toggle(hash) {
    const d = this.data;
    if (!d) return;
    const s = this.repo(d.key);
    s.selected = hash;
    s.expanded = s.expanded === hash ? null : hash;
    // A failed load is retried when the row is opened again.
    const key = s.expanded && this.detailKey(d.key, s.expanded);
    if (key && this.details.get(key)?.state === "error") this.details.delete(key);
  }

  /**
   * Show a file's diff in this tab's diff pane: the target goes to the tab's shared key
   * (the pane follows it), and the pane is split in on the right unless the tab has one.
   */
  openDiff(target, cx) {
    const tab = focused()?.tab; // before any await: the person may switch tabs
    if (!tab) return;
    setShared("git-graph.diff." + tab, target);
    const list = panes();
    if (diffPaneOf(list, tab, shared(paneKey(tab)))) return;
    // A split asked for a moment ago may not be in panes() yet: don't make a second one.
    if (this.splitting?.tab === tab && Date.now() - this.splitting.at < SPLIT_WAIT) return;
    const before = gitGraphPanes(list, tab), mark = { tab, at: Date.now() };
    this.splitting = mark;
    run("pane.split", { direction: "right", mod: "git-graph", props: { diff: { tab } } });
    cx.spawn(async (cx) => {
      const end = Date.now() + SPLIT_WAIT;
      while (Date.now() < end) {
        const pane = newDiffPane(panes(), tab, before);
        if (pane) { setShared(paneKey(tab), pane); break; }
        await cx.sleep(20);
      }
      if (this.splitting === mark) this.splitting = null;
    });
  }

  /** Ref chips for the loaded data; remote ones only when remote branches are shown. */
  makeChips() {
    const d = this.data;
    const remotes = d.shownRemotes && this.repo(d.key).remotes;
    return refChips(remotes ? d.refs : d.refs.filter((r) => r.kind !== "remote"), d.head, d.headHash);
  }

  /** Reload this repo with its (changed) options from the first page. */
  reloadWith(change, cx) {
    const d = this.data;
    if (!d) return;
    const s = this.repo(d.key);
    change(s);
    s.count = PAGE;
    this.chips = this.makeChips(); this.findCache = null;
    this.refresh(cx);
    cx.notify();
  }

  /** Branches dropdown: the filter, null = Show All. */
  setBranches(filter, cx) {
    this.reloadWith((s) => { s.branches = filter; }, cx);
  }

  toggleBranch(name, cx) {
    this.reloadWith((s) => { s.branches = toggleBranch(s.branches, name); }, cx);
  }

  /**
   * Remove a branch (full ref name or short name) from the current repo's filter; an empty
   * filter is Show All. For Task 11's "Unselect in Branches Dropdown".
   */
  unselectBranch(name, cx) {
    this.reloadWith((s) => { s.branches = removeBranch(s.branches, name); }, cx);
  }

  setRemotes(on, cx) {
    const refs = this.data?.refs ?? [];
    this.reloadWith((s) => { s.remotes = on; s.branches = pruneFilter(s.branches, refs, on); }, cx);
  }

  /** Header Fetch: git fetch --all, then every copy refreshes. */
  fetch(cx) {
    const d = this.data;
    if (!d || busyOf(d.root)) return;
    cx.spawn(async (cx) => { await fetchAll(d.root, d.on); cx.notify(); });
  }

  /** Header Refresh. */
  reload(cx) {
    this.pageFailed = false;
    this.refresh(cx);
    cx.notify();
  }

  /** Hashes of the loaded rows matching the Find query, in row order (cached). */
  matches() {
    const d = this.status === "ready" ? this.data : null;
    if (!d) return [];
    const c = this.findCache;
    if (c && c.data === d && c.query === this.query && c.chips === this.chips) return c.list;
    const list = findMatches(d.rows, this.chips, this.query);
    this.findCache = { data: d, query: this.query, chips: this.chips, list, set: new Set(list) };
    return list;
  }

  /** Typing in Find: jump to the first match. */
  setQuery(q, cx) {
    if (q === this.query) return;
    this.query = q;
    this.findCur = null;
    this.stepFind(1, cx);
  }

  /** ⏎ / ⇧⏎ in Find: the next / previous match, wrapping around. */
  stepFind(delta, cx) {
    const m = this.matches();
    this.findCur = stepMatch(m, this.findCur, delta);
    const i = this.findCur ? this.indexOf(this.findCur) : -1;
    if (i >= 0) { this.repo(this.data.key).scroll.scroll_to_item(i, "center"); this.moved(cx); }
    cx.notify();
  }

  /** Keys inside the Find box: Esc clears it and gives the keyboard back to the list. */
  findKey(e, cx) {
    if (e.keystroke !== "escape") return;
    this.find.set_value("");
    this.query = ""; this.findCur = null; this.finding = false;
    this.handle.focus();
    cx.stop_propagation();
    cx.notify();
  }

  focusFind() {
    this.find.focus();
  }

  /** A click anywhere in the list, by item key. */
  click(key, cx) {
    const d = this.data;
    if (!d) return;
    const items = this.items(), item = items[this.indexOf(key)];
    if (!item) return;
    const s = this.repo(d.key);
    this.handle.focus();
    if (item.part === "row") this.toggle(key);
    else if (item.part === "hash") {
      cx.write_to_clipboard(item.hash);
      this.copied = key;
      cx.timer.after(1500, (cx) => { if (this.copied === key) { this.copied = null; cx.notify(); } });
    } else if (item.part === "parent") {
      const i = this.indexOf(item.hash);
      if (i >= 0) { s.selected = item.hash; s.scroll.scroll_to_item(i, "center"); this.moved(cx); }
    } else if (item.part === "file") {
      const det = this.details.get(this.detailKey(d.key, s.expanded));
      if (det?.state === "ready") this.openDiff(commitTarget(d.root, d.on, det.info.hash, det.parent, item.file), cx);
    } else if (item.part === "ufile") this.openDiff(uncommittedTarget(d.root, d.on, item.file), cx);
    else return;
    cx.notify();
  }

  /** ↑/↓: select the previous/next graph row and bring it on screen. */
  move(delta, cx) {
    const d = this.data;
    if (!d) return;
    const items = this.items(), s = this.repo(d.key);
    let i = s.selected ? this.indexOf(s.selected) : -1;
    if (i < 0) i = delta > 0 ? Math.max(0, this.range.start) - 1 : Math.min(items.length, this.range.end);
    for (let j = i + delta; j >= 0 && j < items.length; j += delta) {
      if (items[j].part !== "row") continue;
      s.selected = items[j].key;
      this.reveal(j, s);
      break;
    }
    this.moved(cx);
  }

  /** Scroll only as far as needed to show item `i` whole. */
  reveal(i, s) {
    const { start, end } = this.range;
    if (i <= start) { s.scroll.scroll_to_item(i, "top"); return; }
    if (i < end - 1) return;
    const items = this.items();
    let top = i, h = items[i].size;
    while (top > 0 && h + items[top - 1].size <= this.viewH) h += items[--top].size;
    s.scroll.scroll_to_item(top, "top");
  }

  /** A keyboard action by name; false when it did nothing (so the key can go on). */
  command(c, cx) {
    if (c === "find") { this.focusFind(); return true; }
    const d = this.status === "ready" ? this.data : null;
    if (!d) return false;
    const s = this.repo(d.key);
    if (c === "up") this.move(-1, cx);
    else if (c === "down") this.move(1, cx);
    else if (c === "toggle") { if (!s.selected) return false; this.toggle(s.selected); }
    else if (c === "collapse") { if (!s.expanded) return false; s.expanded = null; }
    else return false;
    return true;
  }

  key(e, cx) {
    if (this.finding) return; // the Find box has the keyboard: its keys are its own
    if (e.keystroke === "escape" && this.branchesOpen) { this.branchesOpen = false; cx.stop_propagation(); cx.notify(); return; }
    const c = e.keystroke === "up" ? "up" : e.keystroke === "down" ? "down" : e.keystroke === "enter" ? "toggle"
      : e.keystroke === "escape" ? "collapse" : e.key === "/" || e.key_char === "/" ? "find" : null;
    if (!c || !this.command(c, cx)) return;
    cx.stop_propagation();
    cx.notify();
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

  /**
   * The automatic trigger (render and the list's row renderer, which runs on every scroll
   * re-layout): when the trailing row is on screen, check once after this frame.
   * Skipped after a failed page so a failing load never retries in a loop.
   */
  autoMore(cx) {
    if (this.moreQueued || this.pageFailed || this.loading || !this.data?.more || this.range.end <= this.items().length) return;
    this.moreQueued = true;
    try { cx.timer.after(0, (cx) => { this.moreQueued = false; this.checkMore(cx); }); }
    catch { this.moreQueued = false; /* timers refused here: the wheel / mouse-up path still checks */ }
  }

  /** The person scrolled or dragged (Task 8: keyboard movement too): retry even after a failed page. */
  moved(cx) {
    this.pageFailed = false;
    cx.timer.after(120, (cx) => this.checkMore(cx));
  }

  chip(c, t) {
    const color = c.kind === "head" ? t.accent : c.kind === "tag" ? t.ansi3 : t.muted;
    return div().flex_none().max_w(160).h(18).px(5).flex().items_center().rounded(4).border_1().border_color(color)
      .text_size(11).text_color(color).when(c.kind === "head", (e) => e.bg(t.accent + "22")).when(c.bold, (e) => e.font_bold())
      .child(div().truncate().child(c.label));
  }

  row(r, t, cols, now, mono, s) {
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
    const selected = s.selected === r.hash, open = s.expanded === r.hash;
    const current = this.findCur === r.hash, match = !current && Boolean(this.findCache?.set.has(r.hash));
    const bg = selected || current ? t.selected : match ? t.selection : open ? t.surface : null;
    return h_flex().w_full().h(ROW_HEIGHT).flex_none().items_center().pr(10)
      .when(Boolean(bg), (e) => e.bg(bg))
      .hover((st) => st.bg(selected || current ? t.selected : match ? t.selection : t.hover))
      .child(paintRow(r, t, ROW_HEIGHT, this.graphW))
      .child(h_flex().flex_1().min_w(0).gap(4).items_center()
        .children(chips.map((c) => this.chip(c, t)))
        .child(div().flex_1().min_w(0).truncate().text_color(current ? t.accent : dim ? t.dim : t.foreground).child(subject || " ")))
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
    const sizes = items.map((it) => it.size);
    if (d.more) sizes.push(ROW_HEIGHT);
    const detail = { t, mono, graphW: this.graphW, rows: this.itemCache.rows, copied: this.copied };
    return div().id("graph-list").flex_1().min_h(0).relative()
      .on_size_change((size) => { this.viewH = size.height; })
      .on_scroll_wheel((_e, cx) => this.moved(cx))
      .on_mouse_up("left", (_e, cx) => this.moved(cx))
      .child(v_virtual_list(id, sizes.length, sizes,
        (i) => items[i]?.key ?? "more",
        (range, cx) => {
          this.range = range;
          // Scrolling (wheel or scrollbar) lays the list out again without a render: when the
          // trailing row comes on screen, ask for the next page after this frame.
          this.autoMore(cx);
          const out = [];
          for (let i = range.start; i < range.end; i++) {
            const it = items[i];
            out.push(!it ? div().h(ROW_HEIGHT).flex_none().px(12).flex().items_center().text_color(t.dim).child("Loading more commits…")
              : it.part === "row" ? this.row(it.row, t, cols, now, mono, s)
              : detailElement(it, detail));
          }
          return out;
        }).track_scroll(s.scroll).size_full().on_item_click((key, cx) => this.click(key, cx)))
      .child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0());
  }

  render(cx) {
    if (location().key !== this.context) this.refresh(cx);
    const changed = shared("git-graph.changed");
    if (changed && changed.at !== this.seenChanged) {
      this.seenChanged = changed.at;
      if (this.data && changed.root === this.data.root) this.refresh(cx);
    }
    // The list's own scrolling may swallow the wheel event that reached the end: whenever a
    // render sees the trailing row on screen, check again after this frame.
    this.autoMore(cx);
    this.ensureDetail(cx);
    const t = theme(), d = this.status === "ready" ? this.data : null;
    this.matches(); // keeps the row highlights' match set current
    return v_flex().id("git-graph").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .child(headerElement(this, t))
      .when(Boolean(d && this.error), (e) => e.child(div().px(12).py(4).text_size(11).text_color(t.ansi1).truncate().child(this.error)))
      .child(d ? this.list(t) : this.message(t));
  }
}
