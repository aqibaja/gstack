import type { PopupViewModel } from "../../shared/messages";
import { getStatusLabel } from "../state/popup-view-model";
import shell from "../styles/PopupShell.module.css";

interface StatusBarProps {
  viewModel: PopupViewModel;
}

export function StatusBar({ viewModel }: StatusBarProps) {
  return (
    <header className={shell.header}>
      <div>
        <p className={shell.eyebrow}>BrowserAutoDrive</p>
        <h1 className={shell.title}>Popup Control</h1>
      </div>
      <div className={shell.headerMeta}>
        <span className={viewModel.tier === "pro" ? shell.badgePro : shell.badgeFree}>
          {viewModel.tier === "pro" ? "Pro" : "Free"}
        </span>
        <span className={shell.statusText}>{getStatusLabel(viewModel.screen)}</span>
      </div>
    </header>
  );
}
