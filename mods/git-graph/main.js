// Role dispatcher: the default role is the Graph panel (Task 10 adds the diff pane role).
import { View } from "gpui-kit";
import { Panel } from "./ui/panel.js";

export default class GitGraph extends View {
  init(props, cx) {
    this.view = new Panel();
    this.view.init(props, cx);
  }

  render(cx) {
    return this.view.render(cx);
  }
}
