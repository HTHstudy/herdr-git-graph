// Lane painting for one graph row: PathBuilder geometry drawn with window.paint_path.
import { div, PathBuilder } from "gpui-kit";
import { laneX } from "../lib/format.js";
import { laneColorKey } from "../lib/lanes.js";

const DOT = 4;
/** A lane's color: its LANE_PALETTE theme key (blue first). */
export const laneColor = (t, color) => t[laneColorKey(color)];

function segment(x0, y0, x1, y1) {
  const p = PathBuilder.stroke(1.5).move_to(x0, y0);
  if (x0 === x1) return p.line_to(x1, y1).build();
  const k = (y1 - y0) / 2;
  return p.cubic_bezier_to(x1, y1, x0, y0 + k, x1, y1 - k).build();
}

function circle(builder, cx, cy, r) {
  return builder.move_to(cx + r, cy).arc_to(r, r, 0, false, true, cx - r, cy).arc_to(r, r, 0, false, true, cx + r, cy).close().build();
}

const layer = (path, color) => window.paint_path(path, color).absolute().top(0).left(0).size_full();

/**
 * The graph cell for one row: its lines, then its dot (filled commit, hollow stash, dashed uncommitted).
 * @param {import("../lib/lanes.js").Row} row
 * @param {Record<string,string>} t theme()
 * @param {number} height row height
 * @param {number} width graph cell width (shared by every row)
 */
export function paintRow(row, t, height, width) {
  const mid = height / 2;
  const layers = row.lines.map((l) => {
    const [y0, y1] = l.half === "top" ? [0, mid] : [mid, height];
    return layer(segment(laneX(l.from), y0, laneX(l.to), y1), laneColor(t, l.color));
  });
  const x = laneX(row.lane), color = laneColor(t, row.color);
  if (row.kind === "commit") layers.push(layer(circle(PathBuilder.fill(), x, mid, DOT), color));
  else {
    layers.push(layer(circle(PathBuilder.fill(), x, mid, DOT), t.background));
    let ring = PathBuilder.stroke(1.5);
    if (row.kind === "uncommitted") ring = ring.dash_array([2, 2]);
    layers.push(layer(circle(ring, x, mid, DOT - 0.75), color));
  }
  return div().relative().flex_none().w(width).h(height).children(layers);
}

/**
 * A graph cell with only straight vertical lanes over its full height (under an expanded row).
 * @param {{x:number, color:number}[]} lanes
 */
export function paintThrough(lanes, t, height, width) {
  const layers = lanes.map((l) => layer(segment(laneX(l.x), 0, laneX(l.x), height), laneColor(t, l.color)));
  return div().relative().flex_none().w(width).h(height).children(layers);
}
