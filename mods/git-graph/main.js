// Role dispatcher: `props().diff` is the diff pane (one per tab), anything else the Graph panel.
import { View } from "gpui-kit";
import { Panel } from "./ui/panel.js";
import { DiffPane } from "./ui/diff-pane.js";

export default class GitGraph extends View {
  init(props, cx) {
    this.view = props?.diff?.tab ? new DiffPane() : new Panel();
    this.view.init(props, cx);
  }

  render(cx) {
    return this.view.render(cx);
  }
}
