import type { PopupStepState } from "../../shared/messages";
import { formatActionLabel, getActionIcon } from "../state/popup-view-model";
import stepCard from "../styles/StepCard.module.css";

interface StepCardProps {
  goal: string | null;
  step: PopupStepState;
}

export function StepCard({ goal, step }: StepCardProps) {
  return (
    <section className={stepCard.card} tabIndex={0}>
      <div className={stepCard.metaRow}>
        <span className={stepCard.stepNumber}>Step {step.stepNumber}</span>
        <span className={stepCard.stepProgress}>of {step.totalSteps}</span>
      </div>
      {goal ? <p className={stepCard.goalPill}>{goal}</p> : null}
      <div className={stepCard.actionRow}>
        <span className={stepCard.icon}>{getActionIcon(step.action)}</span>
        <span className={stepCard.actionLabel}>{formatActionLabel(step.action)}</span>
      </div>
      <p className={stepCard.reasoning}>{step.reasoning}</p>
      <div className={stepCard.selectorBlock}>
        <span className={stepCard.selectorLabel}>Target selector</span>
        <code className={stepCard.selectorValue}>{step.selector}</code>
      </div>
    </section>
  );
}
