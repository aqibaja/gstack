import controls from "../styles/Controls.module.css";

interface GoalComposerProps {
  goalDraft: string;
  disabled: boolean;
  onGoalChange: (value: string) => void;
  onSubmit: () => void;
}

export function GoalComposer({ goalDraft, disabled, onGoalChange, onSubmit }: GoalComposerProps) {
  return (
    <section className={controls.composer}>
      <p className={controls.helperText}>No active automation. Enter a goal to begin.</p>
      <textarea
        className={controls.textarea}
        rows={3}
        value={goalDraft}
        placeholder="Search for flights to NYC"
        onChange={(event) => onGoalChange(event.target.value)}
      />
      <button className={controls.primaryButton} disabled={disabled || goalDraft.trim().length === 0} onClick={onSubmit}>
        Start
      </button>
    </section>
  );
}
