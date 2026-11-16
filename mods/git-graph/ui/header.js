// The Graph panel's header: title + branch + busy spinner, Fetch / Refresh, the Branches
// dropdown (a layer floating over the graph, see branchesDropdown), Show Remote Branches, and Find.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, Checkbox } from "gpui-base";
import { runPlan, busyOf } from "./run.js";
import { branchEntries, filterLabel, matchCount, dropMaxHeight } from "../lib/filter.js";

const ICONS = "mods/git-graph/icons/";
const icon = (name, color, size = 14) => svg(ICONS + name + ".svg").size(size).flex_none().text_color(color);
/** Below this panel width the controls show icons only. */
export const COMPACT = 360;
/** The header's rows; with its bottom border, HEADER_H is where the dropdown hangs. */
const TITLE_H = 36, CONTROLS_H = 34;
export const HEADER_H = TITLE_H + CONTROLS_H + 1;
/** The action label running on a repo, or null (re-exported from run.js). */
export { busyOf };

/**
 * Header Fetch: `git fetch --all` (no prune) through runPlan: busy lock, error toast,
 * then every copy refreshes.
 * @param {string} root
 * @param {string|null} on
 */
export function fetchAll(root, on) {
  return runPlan(root, on, "Fetch", { steps: [["fetch", "--all"]] });
}

function button(id, t, { name, label, compact, disabled, active, onClick }) {
  return div().id(id).flex_none().h(24).px(compact ? 5 : 8).gap(5).flex().items_center().rounded(6)
    .border_1().border_color(active ? t.accent : t.border).text_size(12)
    .text_color(disabled ? t.dim : t.foreground)
    .when(!disabled, (e) => e.hover((s) => s.bg(t.hover)).on_click(onClick))
    .when(Boolean(name), (e) => e.child(icon(name, disabled ? t.dim : t.muted)))
    .when(Boolean(label) && !compact, (e) => e.child(div().min_w(0).flex_shrink(1).truncate().child(label)));
}

function box(checked, t) {
  return div().size(13).flex_none().rounded(3).border_1().border_color(checked ? t.accent : t.input)
    .flex().items_center().justify_center().when(checked, (e) => e.bg(t.accent).text_color(t.accent_foreground).text_size(10).child("✓"));
}

function checkRow(id, t, checked, label, onChange) {
  return Checkbox.new(id).checked(checked).on_change(onChange)
    .h(24).px(10).flex().items_center().gap(8).flex_none().hover((s) => s.bg(t.hover))
    .child(box(checked, t)).child(div().min_w(0).truncate().text_size(12).child(label));
}

/**
 * The header rows. `p` is the Panel; it owns all state and actions.
 * @param {any} p
 * @param {Record<string,string>} t
 */
export function headerElement(p, t) {
  const d = p.status === "ready" ? p.data : null;
  const compact = p.width > 0 && p.width < COMPACT;
  const branch = d ? (d.head ?? d.headHash.slice(0, 7)) : "";
  const busy = busyOf(d?.root);
  const s = d ? p.repo(d.key) : null;

  const title = h_flex().h(TITLE_H).flex_none().px(12).gap(8).items_center()
    .child(div().flex_none().font_semibold().child("Graph"))
    .when(Boolean(branch), (e) => e.child(div().min_w(0).flex_shrink(1).truncate().text_size(12).text_color(t.muted).child(branch)))
    .when(Boolean(busy), (e) => e.child(h_flex().flex_none().gap(4).items_center()
      .child(icon("spinner", t.accent, 12).spin(900))
      .when(!compact, (e) => e.child(div().text_size(11).text_color(t.muted).child(String(busy) + "…")))))
    .child(div().flex_1())
    .child(button("gg-fetch", t, { name: "fetch", label: "Fetch", compact, disabled: !d || Boolean(busy) || !d.remotes.length, onClick: (_e, cx) => p.fetch(cx) }))
    .child(button("gg-refresh", t, { name: "refresh", label: "Refresh", compact, onClick: (_e, cx) => p.reload(cx) }));

  if (!d) return v_flex().flex_none().border_b(1).border_color(t.border).child(title);

  const filter = s.branches;
  const matches = p.matches(), count = p.query.trim() ? matchCount(matches, p.findCur) : "";
  const controls = h_flex().h(CONTROLS_H).flex_none().px(12).gap(6).items_center()
    .child(button("gg-branches", t, {
      name: "branch", compact: false, active: p.branchesOpen || Boolean(filter),
      label: (compact ? "" : "Branches: ") + filterLabel(filter) + " ▾",
      onClick: (_e, cx) => {
        // A press here first closed it (on_mouse_down_out): that press must not reopen it.
        if (!p.branchesOpen && Date.now() - (p.branchesClosedAt ?? 0) < CLOSE_GRACE) return;
        p.setBranchesOpen(!p.branchesOpen); cx.notify();
      },
    }).max_w(compact ? 120 : 200).min_w(0))
    .child(Checkbox.new("gg-remotes").checked(s.remotes).on_change((v, cx) => p.setRemotes(v, cx))
      .flex_none().h(24).px(4).flex().items_center().gap(5).rounded(6).hover((st) => st.bg(t.hover))
      .child(box(s.remotes, t))
      .child(compact ? icon("cloud", t.muted) : div().text_size(12).truncate().child(p.width < 560 ? "Remotes" : "Show Remote Branches")))
    .child(div().id("gg-find").flex_1().min_w(60).h(24).px(6).gap(5).flex().items_center().rounded(6).border_1()
      .border_color(p.finding ? t.accent : t.border).cursor_text()
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); p.focusFind(); })
      .on_key_down((e, cx) => p.findKey(e, cx))
      .child(icon("search", t.dim, 12))
      .child(Input.new(p.find).flex_1().min_w(0).h_full().text_size(12).text_color(t.foreground))
      .when(Boolean(count), (e) => e.child(div().flex_none().text_size(11)
        .text_color(matches.length ? t.muted : t.ansi1).child(count))));

  return v_flex().flex_none().border_b(1).border_color(t.border).child(title).child(controls);
}

const DROP_W = 260, DROP_MAX_H = 320, DROP_LEFT = 12, DROP_MARGIN = 16;
/** How long after an outside press closed the dropdown the Branches button won't reopen it. */
const CLOSE_GRACE = 300;

/**
 * The Branches dropdown, floating over the graph (null when closed): an absolute layer in the
 * panel's (relative) root, under the Branches button. Show All closes it; the checkboxes keep it
 * open. A press outside closes it; presses inside don't reach the list beneath.
 * @param {any} p the Panel
 * @param {Record<string,string>} t
 */
export function branchesDropdown(p, t) {
  const d = p.status === "ready" ? p.data : null;
  if (!d || !p.branchesOpen) return null;
  const s = p.repo(d.key), filter = s.branches;
  const entries = branchEntries(d.refs, filter, s.remotes);
  const width = p.width > 0 ? Math.max(120, Math.min(DROP_W, p.width - 16)) : DROP_W;
  const stop = (_e, cx) => cx.stop_propagation();
  // The positioned box and the scrolling box are separate: a scrollbar area doesn't keep
  // absolute positioning (the dropdown fell into the flow under the list).
  const list = v_flex().id("gg-branch-scroll").w_full()
    // The panel's measured height (less its 1px top and bottom borders) caps it: a short panel
    // never clips the list's bottom.
    .max_h(dropMaxHeight(p.height > 0 ? p.height - 2 : 0, HEADER_H, DROP_MAX_H, DROP_MARGIN)).overflow_y_scrollbar().py(4)
    .child(checkRow("gg-br-all", t, !filter, "Show All", (_v, cx) => { p.setBranchesOpen(false); p.setBranches(null, cx); }))
    .children(entries.map((en) => checkRow("gg-br-" + en.name, t, en.checked,
      en.kind === "remote" ? div().text_color(t.muted).child(en.label) : en.label,
      (_v, cx) => p.toggleBranch(en.name, cx))));
  return div().id("gg-branch-list").absolute().top(HEADER_H).left(DROP_LEFT).w(width)
    .bg(t.popover).border_1().border_color(t.border).rounded(8).shadow_lg().overflow_hidden()
    .on_mouse_down("left", stop).on_mouse_down("right", stop)
    .on_mouse_down_out((_e, cx) => { p.setBranchesOpen(false); cx.notify(); })
    .child(list);
}
