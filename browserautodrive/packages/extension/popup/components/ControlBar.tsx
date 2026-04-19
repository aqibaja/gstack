import controls from "../styles/Controls.module.css";

interface ControlBarProps {
  canDecide: boolean;
  tier: "free" | "pro";
  autoExecuteEnabled: boolean;
  autoExecuteDelayMs: number;
  pendingAction: string | null;
  onConfirm: () => void;
  onSkip: () => void;
  onToggleAutoExecute: (enabled: boolean) => void;
}

export function ControlBar({
  canDecide,
  tier,
  autoExecuteEnabled,
  autoExecuteDelayMs,
  pendingAction,
  onConfirm,
  onSkip,
  onToggleAutoExecute,
}: ControlBarProps) {
  const disabled = !canDecide || pendingAction === "confirm-step" || pendingAction === "skip-step";

  return (
    <div className={controls.controlStack}>
      <div className={controls.buttonRow}>
        <button className={controls.primaryButton} disabled={disabled} onClick={onConfirm}>
          Confirm
        </button>
        <button className={controls.secondaryButton} disabled={disabled} onClick={onSkip}>
          Skip
        </button>
      </div>
      {tier === "pro" ? (
        <label className={controls.toggleRow}>
          <input
            checked={autoExecuteEnabled}
            disabled={pendingAction === "toggle-auto-execute"}
            type="checkbox"
            onChange={(event) => onToggleAutoExecute(event.target.checked)}
          />
          <span>Auto-execute after {autoExecuteDelayMs}ms</span>
        </label>
      ) : null}
    </div>
  );
}
