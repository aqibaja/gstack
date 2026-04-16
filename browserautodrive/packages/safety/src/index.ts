export class SafetyGuard {
  async requireHumanConfirmation(action: any): Promise<void> {
    throw new Error('Human confirmation required');
  }
}