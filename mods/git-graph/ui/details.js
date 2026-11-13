// Inline details under an expanded row: one element per detail item (see lib/details.js).
// Drawn inside the list's renderer, so no handlers here: clicks arrive through the list's on_item_click.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { fileCounts, absoluteDate, TEXT, PAD } from "../lib/details.js";
import { paintThrough } from "./graph-cell.js";

const KIND = { A: "ansi2", M: "ansi3", D: "ansi1", R: "ansi4", U: "ansi2" };

/** Color of a change letter; conflicts use `blocked`. */
const kindColor = (t, status, conflict) => (conflict ? t.blocked : t[KIND[status] ?? "muted"]);

/**
 * @param {import("../lib/details.js").DetailItem} item
 * @param {{t: Record<string,string>, mono: string, graphW: number, rows: Map<string, any>, copied: string|null}} o
 */
export function detailElement(item, o) {
  // The expanded row's lanes run down through the block; the surface covers only the text.
  return h_flex().w_full().h(item.size).flex_none()
    .child(paintThrough(item.lanes ?? [], o.t, item.size, o.graphW))
    .child(div().w(8).h_full().flex_none())
    .child(content(item, o));
}

function content(item, o) {
  const { t, mono } = o;
  const box = h_flex().flex_1().min_w(0).h(item.size).items_center().pl(0).pr(12).bg(t.surface).overflow_hidden();
  const label = (s) => div().w(78).flex_none().text_color(t.dim).text_size(12).child(s);
  const clickable = (e) => e.hover((s) => s.bg(t.hover));
  const path = (f) => (f.from ? `${f.from} → ${f.path}` : f.path);
  switch (item.part) {
    case "hash":
      return clickable(box.gap(6)).child(label("Commit"))
        .child(div().font_family(mono).text_size(12).truncate().child(item.hash))
        .child(div().flex_none().text_size(11).text_color(o.copied === item.key ? t.accent : t.dim)
          .child(o.copied === item.key ? "Copied" : "click to copy"));
    case "parent": {
      const row = o.rows.get(item.hash);
      const subject = row?.commit?.subject ?? row?.stash?.subject ?? null;
      return (row ? clickable(box) : box).gap(6).child(label("Parent"))
        .child(div().flex_none().font_family(mono).text_size(12).text_color(row ? t.accent : t.muted).child(item.hash.slice(0, 7)))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(subject ?? "not loaded"));
    }
    case "meta": {
      const i = item.info;
      const line = (name, value) => h_flex().h(TEXT).items_center().gap(6).child(label(name))
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(value));
      return box.items_start().child(v_flex().w_full().min_w(0)
        .child(line("Author", `${i.author} <${i.email}>`))
        .child(line("Committer", `${i.committer} <${i.committerEmail}>`))
        .child(line("Date", absoluteDate(i.date))));
    }
    case "body":
      return box.items_start().py(PAD).child(v_flex().w_full().min_w(0).pl(84).font_family(mono).text_size(12)
        .children(item.lines.map((l) => div().h(TEXT).truncate().child(l || " "))));
    case "group":
      return box.child(div().text_size(12).font_semibold().text_color(t.muted).child(item.title));
    case "file":
    case "ufile": {
      const f = item.file;
      return clickable(box.gap(8))
        .child(div().w(14).flex_none().font_family(mono).text_size(12).font_bold().text_color(kindColor(t, f.status, f.conflict)).child(f.status))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(f.conflict ? t.blocked : t.foreground).child(path(f)))
        .when(item.part === "file", (e) => e.child(div().flex_none().font_family(mono).text_size(11).text_color(t.dim).child(fileCounts(f))));
    }
    case "note":
      return box.child(div().truncate().text_size(12).text_color(item.error ? t.ansi1 : t.dim).child(item.text));
    default:
      return box;
  }
}
