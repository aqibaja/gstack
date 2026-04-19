import type { PopupScreen, PopupViewModel } from "../../shared/messages";

export const defaultPopupViewModel: PopupViewModel = {
  screen: "idle",
  goalDraft: "",
  tier: "free",
  autoExecuteEnabled: false,
  autoExecuteDelayMs: 500,
  run: null,
  step: null,
  error: null,
};

const ACTION_ICONS: Record<string, string> = {
  navigate: "\u2192",
  click: "\u25CF",
  type: "\u270E",
  scroll: "\u2195",
  select: "\u25BE",
  submit: "\u2714",
  extract: "\u2B07",
  wait: "\u23F3",
  done: "\u2714",
  default: "\u25A0",
};

export function getActionIcon(action: string): string {
  return ACTION_ICONS[action] ?? ACTION_ICONS.default;
}

export function formatActionLabel(action: string): string {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

export function getStatusLabel(screen: PopupScreen): string {
  switch (screen) {
    case "preview":
      return "Awaiting confirmation";
    case "executing":
      return "Executing";
    case "done":
      return "Complete";
    case "error":
      return "Needs attention";
    default:
      return "Ready";
  }
}
