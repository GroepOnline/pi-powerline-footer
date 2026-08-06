import type { WelcomeWidget } from "../types.ts";
import { SystemWidget } from "./system-widget.ts";
import { QueueWidget } from "./queue-widget.ts";
import { ShortcutsWidget } from "./shortcuts-widget.ts";
import { SessionsWidget } from "./sessions-widget.ts";
import { graphWidget } from "./graph-widget.ts";

export { SystemWidget } from "./system-widget.ts";
export { QueueWidget } from "./queue-widget.ts";
export { ShortcutsWidget } from "./shortcuts-widget.ts";
export { SessionsWidget } from "./sessions-widget.ts";
export { graphWidget } from "./graph-widget.ts";

export const ALL_WELCOME_WIDGETS: WelcomeWidget[] = [
  SystemWidget,
  graphWidget,
  QueueWidget,
  ShortcutsWidget,
  SessionsWidget,
];
