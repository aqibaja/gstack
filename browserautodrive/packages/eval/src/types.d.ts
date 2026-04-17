declare module '@browserautodrive/browser' {
  export function launchBrowser(url?: string): Promise<any>;
  export function getSnapshot(page: any): Promise<any>;
}

declare module '@browserautodrive/observe' {
  export function extractObservation(page: any): Promise<any>;
}

declare module '@browserautodrive/core' {
  export function executeAction(action: any): Promise<any>;
}

declare module '@browserautodrive/llm' {
  export interface LLMProvider {
    complete(prompt: any): Promise<any>;
  }
}

declare module '@browserautodrive/safety' {
  export class SafetyGuard {
    requireHumanConfirmation(action: any): Promise<void>;
  }
}