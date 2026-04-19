import { useEffect, useState } from "react";
import { ControlBar } from "./components/ControlBar";
import { GoalComposer } from "./components/GoalComposer";
import { StatusBar } from "./components/StatusBar";
import { StepCard } from "./components/StepCard";
import { usePopupRuntime } from "./hooks/usePopupRuntime";
import shell from "./styles/PopupShell.module.css";

export function PopupApp() {
  const {
    viewModel,
    pendingAction,
    startGoal,
    confirmStep,
    skipStep,
    markUserIntervened,
    toggleAutoExecute,
    resetPopup,
  } = usePopupRuntime();
  const [goalDraft, setGoalDraft] = useState(viewModel.goalDraft);

  useEffect(() => {
    if (viewModel.screen === "idle") {
      setGoalDraft(viewModel.goalDraft);
    }
  }, [viewModel.goalDraft, viewModel.screen]);

  const currentStep = viewModel.step;
  const canDecide = viewModel.screen === "preview" && currentStep != null;

  const handleSubmitGoal = () => {
    const nextGoal = goalDraft.trim();
    if (nextGoal.length === 0) return;
    void startGoal(nextGoal);
  };

  const handleConfirm = () => {
    if (!currentStep) return;
    void markUserIntervened(currentStep.stepId);
    void confirmStep(currentStep.stepId);
  };

  const handleSkip = () => {
    if (!currentStep) return;
    void markUserIntervened(currentStep.stepId);
    void skipStep(currentStep.stepId);
  };

  const handleReset = () => {
    void resetPopup();
  };

  return (
    <main className={shell.appShell}>
      <StatusBar viewModel={viewModel} />

      {viewModel.screen === "idle" ? (
        <GoalComposer
          disabled={pendingAction === "start-goal"}
          goalDraft={goalDraft}
          onGoalChange={setGoalDraft}
          onSubmit={handleSubmitGoal}
        />
      ) : null}

      {currentStep ? (
        <section
          className={shell.contentStack}
          onFocusCapture={() => void markUserIntervened(currentStep.stepId)}
          onMouseEnter={() => void markUserIntervened(currentStep.stepId)}
        >
          <StepCard goal={viewModel.run?.goal ?? null} step={currentStep} />
          <ControlBar
            autoExecuteDelayMs={viewModel.autoExecuteDelayMs}
            autoExecuteEnabled={viewModel.autoExecuteEnabled}
            canDecide={canDecide}
            pendingAction={pendingAction}
            tier={viewModel.tier}
            onConfirm={handleConfirm}
            onSkip={handleSkip}
            onToggleAutoExecute={(enabled) => void toggleAutoExecute(enabled)}
          />
        </section>
      ) : null}

      {viewModel.screen === "executing" ? (
        <section className={shell.panel}>
          <p className={shell.panelTitle}>Execution in progress</p>
          <p className={shell.panelBody}>The worker owns execution state. Reopening the popup will resync from the latest worker snapshot.</p>
        </section>
      ) : null}

      {viewModel.screen === "done" ? (
        <section className={shell.panel}>
          <p className={shell.panelTitle}>Automation complete</p>
          <p className={shell.panelBody}>The current run has finished. Start a new goal when you are ready.</p>
          <button className={shell.secondaryButton} onClick={handleReset}>
            New Goal
          </button>
        </section>
      ) : null}

      {viewModel.screen === "error" && viewModel.error ? (
        <section className={shell.errorPanel}>
          <p className={shell.panelTitle}>{viewModel.error.code}</p>
          <p className={shell.panelBody}>{viewModel.error.message}</p>
          <button className={shell.secondaryButton} onClick={handleReset}>
            Dismiss
          </button>
        </section>
      ) : null}
    </main>
  );
}
