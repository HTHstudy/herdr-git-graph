// The action dialog (styled like the shipped `confirm` / `prompt` dialogs): the Dialog's fields
// (text, checkbox, radio, select), Cancel / confirm. ⏎ confirms, Esc cancels. A danger dialog's
// confirm button is red. Confirming builds the plan from the Target captured at the right-click
// and hands it to the panel that opened the menu, which runs it (overlay tasks stop on close).
//
// props().dialog = {owner, root, on, target, ctx, id, label} (+ tag for id "tagDetails", a
// read-only view of an annotated tag).
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Checkbox } from "gpui-base";
import { props, closeOverlay, theme, settings, exec, pickFolder } from "herdr";
import { dialogFor, planFor } from "../lib/actions.js";
import { initialValues, missingFields, cleanValues, tagDetailsArgs, parseTagDetails } from "../lib/targets.js";
import { absoluteDate } from "../lib/details.js";
import { request } from "./menu.js";

export class Dialog {
  init(_props, cx) {
    const p = this.p();
    this.handle = cx.focus_handle();
    this.done = false;
    this.focusedKey = null;
    this.inputs = new Map();
    if (p.id === "tagDetails") { this.loadTag(p, cx); this.handle.focus(); return; }
    this.dialog = dialogFor(p.id, p.target, p.ctx);
    this.values = this.dialog ? initialValues(this.dialog) : {};
    for (const f of this.dialog?.fields ?? []) {
      if (f.type !== "text") continue;
      const st = InputState.new({ value: String(f.value ?? "") });
      if (f.value) st.set_selected_range({ start: 0, end: String(f.value).length });
      st.on("change", (_e, cx) => { this.values[f.key] = st.value(); cx.notify(); });
      st.on("submit", (_e, cx) => this.confirm(cx));
      st.on("focus", (_e, cx) => { this.focusedKey = f.key; cx.notify(); });
      st.on("blur", (_e, cx) => { if (this.focusedKey === f.key) this.focusedKey = null; cx.notify(); });
      this.inputs.set(f.key, st);
    }
    const first = this.inputs.values().next().value;
    const focus = () => (first ? first.focus() : this.handle.focus());
    focus();
    cx.timer.after(600, () => { if (!this.focusedKey) focus(); }); // as the shipped prompt: the overlay may take focus late
  }

  p() { return props()?.dialog ?? {}; }

  close() { this.done = true; closeOverlay(props()?.overlay); }

  missing() {
    return this.dialog ? missingFields(this.p().id, this.dialog, this.values) : [];
  }

  confirm(_cx) {
    if (this.done || !this.dialog || this.missing().length) return;
    const p = this.p();
    const plan = planFor(p.id, p.target, cleanValues(this.dialog, this.values), p.ctx);
    this.done = true;
    if (plan.steps) request(p, { run: { label: p.label, plan } });
    closeOverlay(props()?.overlay);
  }

  loadTag(p, cx) {
    this.tag = { state: "loading" };
    cx.spawn(async (cx) => {
      try {
        const r = await exec("git", tagDetailsArgs(p.tag), { cwd: p.root, on: p.on });
        const info = r.code === 0 ? parseTagDetails(r.stdout, p.tag) : null;
        this.tag = info ? { state: "ready", info } : { state: "error", error: (r.stderr || "").trim() || "Tag not found" };
      } catch (e) {
        this.tag = { state: "error", error: String(e?.message ?? e) };
      }
      cx.notify();
    });
  }

  chooseFolder(cx) {
    const st = this.inputs.get("folder");
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "Folder for the archive" }).catch(() => null);
      if (folder && st) { st.set_value(folder); this.values.folder = folder; }
      cx.notify();
    });
  }

  key(e, cx) {
    if (e.key === "escape") this.close();
    else if (e.key === "enter" && !this.focusedKey) {
      if (this.p().id === "tagDetails") this.close(); else this.confirm(cx);
    } else return;
    cx.stop_propagation();
  }

  field(f, t) {
    const label = (text) => div().pt(10).pb(5).text_size(11.5).text_color(t.dim).child(text);
    const v = this.values[f.key];
    if (f.type === "text") {
      const input = Input.new(this.inputs.get(f.key)).flex_1().min_w(0).h(32).px(10).rounded(8).border_1()
        .border_color(this.focusedKey === f.key ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground);
      const row = this.p().id === "archive" && f.key === "folder"
        ? h_flex().gap(6).items_center().child(input)
          .child(button("gg-dlg-pick", "Choose folder…", t, { onClick: (_e, cx) => this.chooseFolder(cx) }))
        : input;
      return v_flex().flex_none().child(label(f.label)).child(row);
    }
    if (f.type === "checkbox") {
      return Checkbox.new(`gg-dlg-${f.key}`).checked(Boolean(v)).on_change((c, cx) => { this.values[f.key] = c; cx.notify(); })
        .h(28).flex().flex_none().items_center().gap(8).cursor_pointer()
        .child(box(Boolean(v), t, false)).child(div().min_w(0).truncate().text_size(12.5).child(f.label));
    }
    if (f.type === "radio") {
      return v_flex().flex_none().child(label(f.label))
        .children(f.options.map((o, i) => h_flex().id(`gg-dlg-${f.key}-${i}`).h(26).gap(8).items_center().cursor_pointer()
          .on_click((_e, cx) => { this.values[f.key] = o.value; cx.notify(); })
          .child(box(v === o.value, t, true)).child(div().min_w(0).truncate().text_size(12.5).child(o.label))));
    }
    // select: one button per choice
    return v_flex().flex_none().child(label(f.label))
      .child(h_flex().gap(6).flex_wrap().children(f.options.map((o, i) =>
        button(`gg-dlg-${f.key}-${i}`, o.label, t, { active: v === o.value, onClick: (_e, cx) => { this.values[f.key] = o.value; cx.notify(); } }))));
  }

  tagBody(t) {
    const tg = this.tag, mono = settings().font_family ?? "JetBrains Mono";
    if (tg.state !== "ready") return div().text_color(tg.state === "error" ? t.ansi1 : t.dim).child(tg.state === "error" ? tg.error : "Loading…");
    const i = tg.info;
    const line = (name, value) => h_flex().h(22).gap(8).items_center()
      .child(div().w(70).flex_none().text_size(12).text_color(t.dim).child(name))
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(value));
    return v_flex().flex_1().min_h(0)
      .child(line("Tagger", i.email ? `${i.tagger} <${i.email}>` : i.tagger))
      .child(line("Date", i.date ? absoluteDate(i.date) : ""))
      .child(line("Commit", h_flex().child(div().font_family(mono).child(i.commit.slice(0, 10)))))
      .child(div().id("gg-tag-msg").mt(8).flex_1().min_h(0).overflow_y_scrollbar().p(8).rounded(8).bg(t.background)
        .font_family(mono).text_size(12).children(i.message.split("\n").map((l) => div().child(l || " "))));
  }

  render(_cx) {
    const t = theme(), p = this.p();
    const tagView = p.id === "tagDetails";
    const title = tagView ? `Tag ${p.tag}` : this.dialog?.title ?? p.label ?? "";
    const head = h_flex().flex_none().items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(title))
      .child(div().text_size(11).text_color(t.dim).child("Esc"));
    const root = v_flex().id("gg-dialog").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).p(18).bg(t.popover).text_size(13).text_color(t.foreground).child(head);
    if (tagView) {
      return root.child(div().h(10).flex_none()).child(this.tagBody(t))
        .child(h_flex().flex_none().pt(14).justify_end()
          .child(button("gg-dlg-close", "Close", t, { onClick: () => this.close() })));
    }
    const d = this.dialog;
    if (!d) return root.child(div().pt(10).text_color(t.ansi1).child("Nothing to confirm"));
    const blocked = this.missing().length > 0;
    return root
      .child(div().pt(6).flex_none().text_color(t.muted).truncate().child(d.detail ?? ""))
      .child(v_flex().id("gg-dlg-fields").flex_1().min_h(0).overflow_y_scrollbar().children(d.fields.map((f) => this.field(f, t))))
      .child(h_flex().flex_none().pt(14).gap(8).justify_end().text_size(12)
        .child(button("gg-dlg-cancel", "Cancel", t, { onClick: () => this.close() }))
        .child(button("gg-dlg-ok", d.confirm, t, { primary: true, danger: d.danger, disabled: blocked, onClick: (_e, cx) => this.confirm(cx) })));
  }
}

/** Check box (square) or radio dot (round). */
function box(on, t, round) {
  return div().size(14).flex_none().rounded(round ? 7 : 3).border_1().border_color(on ? t.accent : t.input)
    .flex().items_center().justify_center()
    .when(on && !round, (e) => e.bg(t.accent).text_color(t.accent_foreground).text_size(10).child("✓"))
    .when(on && round, (e) => e.child(div().size(6).rounded(3).bg(t.accent)));
}

function button(id, text, t, { primary = false, danger = false, active = false, disabled = false, onClick }) {
  const bg = primary ? (danger ? t.ansi1 : t.solid) : t.raised;
  const fg = primary ? t.solid_foreground : t.foreground;
  return h_flex().id(id).h(32).px(14).flex_none().items_center().rounded(8).border_1()
    .border_color(primary ? bg : active ? t.accent : t.input).bg(bg).text_color(fg).text_size(12.5).font_medium()
    .when(disabled, (e) => e.opacity(0.45))
    .when(!disabled, (e) => e.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(onClick))
    .child(text);
}
