import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme } from "herdr";

export default class GitGraph extends View {
  render(_cx) {
    const t = theme();
    return v_flex().size_full().rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).p(14)
      .child(div().font_semibold().child("Graph"));
  }
}
