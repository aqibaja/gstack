export interface LLMProvider {
  complete(prompt: any): Promise<any>;
}

export class GLMAdapter implements LLMProvider {
  async complete(prompt: any): Promise<any> {
    throw new Error('Not implemented');
  }
}

export class OpenAIAdapter implements LLMProvider {
  async complete(prompt: any): Promise<any> {
    throw new Error('Not implemented');
  }
}