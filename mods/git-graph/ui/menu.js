// The right-click menu (a popup, styled like the shipped `menu` mod): ↑/↓ move, ⏎ runs, Esc
// closes. Opened by the Graph panel with props().menu = {owner, root, on, target, ctx}; the
// Target was captured at the right-click and is never re-read from live data.
//
// Choosing an item: copy → clipboard + toast; openChanges → shows the Changes side panel;
// tagDetails → the details dialog; an item with a dialog → the dialog; anything else → its
// plan goes to the panel that opened the menu (`request`), which runs it.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, openOverlay, theme, run, notify, setShared } from "herdr";
import { menuFor, dialogFor, planFor } from "../lib/actions.js";
import { actionLabel } from "../lib/run.js";
import { dialogHeight, targetTitle } from "../lib/targets.js";

export const DIALOG_WIDTH = 440;

/**
 * Hand work to the Graph panel copy `owner` (overlays can't run long tasks: theirs stop
 * when they close). `git-graph.request` = {id, at, owner, root, on, run?: {label, plan}, unselect?: name}.
 * The owner ignores a request older than REQUEST_TTL (10 s): nothing runs late. The sender has
 * closed by then and can't know whether it was picked up, so it only logs what it sent.
 */
export function request(m, body) {
  const req = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, at: Date.now(), owner: m.owner, root: m.root, on: m.on, ...body };
  console.log("git-graph: request", req.id, body.run ? body.run.label : `unselect ${body.unselect}`);
  setShared("git-graph.request", req);
}

/** Open the dialog overlay for an action (props().dialog = {...menu props, id, label}). */
export function openDialog(m, id, label, dialog) {
  openOverlay({
    mod: "git-graph", kind: "dialog", width: DIALOG_WIDTH, height: dialogHeight(dialog, id === "archive" ? 36 : 0),
    modal: id === "archive", // the folder picker takes the pointer: a click there must not close it
    props: { dialog: { ...m, id, label } },
  });
}

export class Menu {
  init(_props, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  m() { return props()?.menu ?? {}; }

  list() {
    const m = this.m();
    return m.target ? menuFor(m.target, m.ctx) : [];
  }

  /** Indexes of real items (not separators). */
  choices(list) {
    const out = [];
    list.forEach((it, i) => { if (it !== "sep") out.push(i); });
    return out;
  }

  choose(it, cx) {
    const m = this.m(), label = actionLabel(it.label);
    closeOverlay(props()?.overlay);
    const dialog = dialogFor(it.id, m.target, m.ctx);
    if (dialog) { openDialog(m, it.id, label, dialog); return; }
    const plan = planFor(it.id, m.target, {}, m.ctx);
    if ("copy" in plan) {
      cx.write_to_clipboard(plan.copy);
      notify({ title: "Copied", body: plan.copy, level: "info", timeout: 2000 });
    } else if ("ui" in plan) {
      if (plan.ui === "openChanges") {
        // The same commands the tabs mod's Changes button runs.
        run("layout.select", { stack: "panel-body", child: "changes" });
        run("layout.show", { id: "panel" });
      } else if (plan.ui === "unselect") request(m, { unselect: plan.arg });
      else if (plan.ui === "tagDetails") {
        openOverlay({ mod: "git-graph", kind: "dialog", width: DIALOG_WIDTH, height: 320, props: { dialog: { ...m, id: "tagDetails", label, tag: plan.arg } } });
      }
    } else request(m, { run: { label, plan } });
  }

  key(e, cx) {
    const list = this.list(), ch = this.choices(list);
    if (!ch.length) { if (e.key === "escape") closeOverlay(props()?.overlay); return; }
    const pos = Math.max(0, ch.indexOf(this.at));
    if (e.key === "down") this.at = ch[(pos + 1) % ch.length];
    else if (e.key === "up") this.at = ch[(pos + ch.length - 1) % ch.length];
    else if (e.key === "enter") { if (e.is_held) return; this.choose(list[ch[pos]], cx); } // a held ⏎ must not run on
    else if (e.key === "escape") closeOverlay(props()?.overlay);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  render(_cx) {
    const t = theme(), list = this.list(), ch = this.choices(list);
    if (!ch.includes(this.at) && ch.length) this.at = ch[0];
    return v_flex().id("gg-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(div().h(26).flex_none().px(8).flex().items_center().text_size(11.5).text_color(t.dim)
        .child(div().min_w(0).truncate().child(targetTitle(this.m().target))))
      .children(list.map((it, i) => it === "sep"
        ? div().mx(7).my(4).h(1).flex_none().bg(t.border)
        : h_flex().id(`gg-mi-${i}`).h(31).flex_none().px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.choose(it, cx))
          .child(div().flex_1().min_w(0).truncate().child(it.label))));
  }
}
