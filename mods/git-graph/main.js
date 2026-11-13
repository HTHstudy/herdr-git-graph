// Role dispatcher by props(): `diff` is the diff pane (one per tab), `menu` the right-click
// popup, `dialog` an action dialog; anything else the Graph panel.
import { View } from "gpui-kit";
import { Panel } from "./ui/panel.js";
import { DiffPane } from "./ui/diff-pane.js";
import { Menu } from "./ui/menu.js";
import { Dialog } from "./ui/dialog.js";

export default class GitGraph extends View {
  init(props, cx) {
    this.view = props?.diff?.tab ? new DiffPane() : props?.menu ? new Menu() : props?.dialog ? new Dialog() : new Panel();
    this.view.init(props, cx);
  }

  render(cx) {
    return this.view.render(cx);
  }
}
