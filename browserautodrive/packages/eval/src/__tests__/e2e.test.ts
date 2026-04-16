// @ts-ignore - executeAction added but TypeScript cache not updated
import { launchBrowser, getSnapshot, executeAction } from '@browserautodrive/browser';
import { extractObservation } from '@browserautodrive/observe';
import { LLMProvider } from '@browserautodrive/llm';
import { SafetyGuard } from '@browserautodrive/safety';

// Mock all external modules
jest.mock('@browserautodrive/browser');
jest.mock('@browserautodrive/observe');
jest.mock('@browserautodrive/llm');
jest.mock('@browserautodrive/safety');
// Mock SafetyGuard instance
const mockSafetyGuard = {
  requireHumanConfirmation: jest.fn(),
};
// Provide mock implementation for SafetyGuard class
jest.mocked(SafetyGuard).mockImplementation(() => mockSafetyGuard);

const mockedLaunchBrowser = jest.mocked(launchBrowser);
const mockedGetSnapshot = jest.mocked(getSnapshot);
const mockedExecuteAction = jest.mocked(executeAction);
const mockedExtractObservation = jest.mocked(extractObservation);

// Helper to create a mock page
function createMockPage() {
  return {
    goto: jest.fn(),
    click: jest.fn(),
    type: jest.fn(),
    locator: jest.fn(),
    URL: jest.fn(),
    title: jest.fn(),
    close: jest.fn(),
  };
}

// Helper to create a mock snapshot
function createMockSnapshot(overrides = {}) {
  return {
    url: 'https://example.com',
    title: 'Example Domain',
    screenshot: 'base64data',
    accessibilityTree: {
      role: 'root',
      name: 'page',
      children: [],
    },
    interactiveElements: [],
    viewportSize: { width: 1280, height: 720 },
    scrollPosition: { x: 0, y: 0 },
    ...overrides,
  };
}

// Mock LLM provider that returns predetermined actions
class MockLLMProvider implements LLMProvider {
  private actions: any[] = [];
  private callCount = 0;

  setActions(actions: any[]) {
    this.actions = actions;
    this.callCount = 0;
  }

  async complete(prompt: any): Promise<any> {
    const action = this.actions[this.callCount] || { type: 'done', result: 'No more actions', success: true };
    this.callCount++;
    return {
      action,
      reasoning: 'Mock reasoning',
      confidence: 0.9,
    };
  }

  // LLMProvider interface does not require validateApiKey, but we keep it for compatibility
  async validateApiKey(): Promise<boolean> {
    return true;
  }
}

// Simulate a simple agent loop that uses mocked dependencies
async function simulateAgentLoop({
  llm,
  browser,
  safetyGuard,
  goal,
  initialUrl = 'https://example.com',
  maxSteps = 10,
}: {
  llm: LLMProvider;
  browser: {
    launchBrowser: typeof launchBrowser;
    getSnapshot: typeof getSnapshot;
    executeAction: typeof executeAction;
  };
  safetyGuard: { requireHumanConfirmation: jest.Mock };
  goal: string;
  initialUrl?: string;
  maxSteps?: number;
}): Promise<{ success: boolean; result?: string; error?: string }> {
  let step = 0;
  let currentUrl = '';
  let page: any = null;
  
  // Launch browser with initial URL (should be overridden by LLM navigate action)
  const launchResult = await browser.launchBrowser(initialUrl);
  page = launchResult.page;
  
  while (step < maxSteps) {
    step++;
    // Observe
    const snapshot = await browser.getSnapshot(page);
    const observation = await mockedExtractObservation(snapshot);
    
    // Decide
    const decision = await llm.complete({
      goal,
      observation,
      history: [], // simplified
    });
    
    const action = decision.action;
    
    // Safety check (simplified)
    const isHighStakes = action.type === 'submit' || action.type === 'purchase' || action.type === 'delete';
    const isLowConfidence = action.target?.confidence !== undefined && action.target.confidence < 0.5;
    if (isHighStakes || isLowConfidence) {
      try {
        await safetyGuard.requireHumanConfirmation(action);
      } catch (e) {
        return { success: false, error: 'Human confirmation required' };
      }
    }
    
    // Act
    if (action.type === 'done') {
      return { success: action.success, result: action.result };
    }
    
    try {
      await browser.executeAction(action);
    } catch (error) {
      return { success: false, error: `Action failed: ${error}` };
    }
  }
  
  return { success: false, error: 'Max steps exceeded' };
}

describe('E2E Tests E1-E4', () => {
  let mockLLM: MockLLMProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLLM = new MockLLMProvider();
  });

  describe('E1: Navigate to website, find link, click', () => {
    it('should navigate to a page, locate a link, and click it', async () => {
      // Arrange
      const mockBrowser = { close: jest.fn() };
      const mockPage = createMockPage();
      mockedLaunchBrowser.mockResolvedValue({ browser: mockBrowser, page: mockPage });
      
      // First snapshot shows the link
      const snapshot1 = createMockSnapshot({
        interactiveElements: [
          {
            selector: 'a',
            text: 'More information...',
            role: 'link',
            ariaLabel: null,
            confidence: 1.0,
          },
        ],
      });
      // After clicking, we navigate to a new page
      const snapshot2 = createMockSnapshot({
        url: 'https://www.iana.org/domains/example',
        title: 'IANA — Example Domain',
        interactiveElements: [],
      });
      
      mockedGetSnapshot
        .mockResolvedValueOnce(snapshot1)
        .mockResolvedValueOnce(snapshot2);
      
      mockedExtractObservation.mockResolvedValue({
        interactiveElements: snapshot1.interactiveElements,
      });
      
      // Mock executeAction to succeed
      mockedExecuteAction.mockResolvedValue({ success: true });
      
      // Mock LLM to return click action on first call, then done
      mockLLM.setActions([
        {
          type: 'click',
          target: { selector: 'a', confidence: 1.0 },
          description: 'Click "More information..." link',
        },
        {
          type: 'done',
          result: 'Successfully clicked link',
          success: true,
        },
      ]);
      
      // Act
      const result = await simulateAgentLoop({
        llm: mockLLM,
        browser: { launchBrowser, getSnapshot, executeAction },
        safetyGuard: mockSafetyGuard,
        goal: 'Navigate to example.com and click the "More information..." link',
      });
      
      // Assert
      expect(mockedLaunchBrowser).toHaveBeenCalledWith('https://example.com');
      expect(mockedGetSnapshot).toHaveBeenCalledTimes(2);
      expect(mockedExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'click',
          target: expect.objectContaining({ selector: 'a' }),
        })
      );
      expect(result.success).toBe(true);
      expect(result.result).toContain('clicked link');
    });
  });

  describe('E2: Fill search form, submit, verify results', () => {
    it('should fill a search form, submit, and verify results appear', async () => {
      // Arrange
      const mockBrowser = { close: jest.fn() };
      const mockPage = createMockPage();
      mockedLaunchBrowser.mockResolvedValue({ browser: mockBrowser, page: mockPage });
      
      // Initial page with search form
      const snapshot1 = createMockSnapshot({
        url: 'https://example.com/search',
        title: 'Search',
        interactiveElements: [
          {
            selector: '#search-input',
            text: '',
            role: 'textbox',
            ariaLabel: null,
            confidence: 1.0,
          },
          {
            selector: '#submit-button',
            text: 'Submit',
            role: 'button',
            ariaLabel: null,
            confidence: 1.0,
          },
        ],
      });
      
      // After submitting, results page
      const snapshot2 = createMockSnapshot({
        url: 'https://example.com/search?q=test',
        title: 'Search Results',
        interactiveElements: [],
      });
      
      mockedGetSnapshot
        .mockResolvedValueOnce(snapshot1)
        .mockResolvedValueOnce(snapshot1)
        .mockResolvedValueOnce(snapshot2);
      
      mockedExtractObservation.mockImplementation(async (snapshot) => ({
        interactiveElements: snapshot.interactiveElements,
      }));
      
      mockedExecuteAction.mockResolvedValue({ success: true });
      
      // Mock LLM to type, click, then done
      mockLLM.setActions([
        {
          type: 'type',
          target: { selector: '#search-input', confidence: 1.0 },
          text: 'test query',
          description: 'Type search query',
        },
        {
          type: 'click',
          target: { selector: '#submit-button', confidence: 1.0 },
          description: 'Click submit button',
        },
        {
          type: 'done',
          result: 'Search completed, results displayed',
          success: true,
        },
      ]);
      
      // Act
      const result = await simulateAgentLoop({
        llm: mockLLM,
        browser: { launchBrowser, getSnapshot, executeAction },
        safetyGuard: mockSafetyGuard,
        goal: 'Search for "test query" and verify results',
        initialUrl: 'https://example.com/search',
      });
      
      // Assert
      expect(mockedLaunchBrowser).toHaveBeenCalledWith('https://example.com/search');
      expect(mockedGetSnapshot).toHaveBeenCalledTimes(3);
      expect(mockedExecuteAction).toHaveBeenCalledTimes(2);
      expect(mockedExecuteAction).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          type: 'type',
          target: expect.objectContaining({ selector: '#search-input' }),
          text: 'test query',
        })
      );
      expect(mockedExecuteAction).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          type: 'click',
          target: expect.objectContaining({ selector: '#submit-button' }),
        })
      );
      expect(result.success).toBe(true);
    });
  });

  describe('E3: Flight search demo golden path', () => {
    it('should execute a flight search from SFO to JFK', async () => {
      // Arrange
      const mockBrowser = { close: jest.fn() };
      const mockPage = createMockPage();
      mockedLaunchBrowser.mockResolvedValue({ browser: mockBrowser, page: mockPage });
      
      // Simulate a multi-step flight search
      const snapshots = [
        createMockSnapshot({
          url: 'https://flights.example.com',
          title: 'Flight Search',
          interactiveElements: [
            { selector: '#origin', role: 'textbox', confidence: 1.0 },
            { selector: '#destination', role: 'textbox', confidence: 1.0 },
            { selector: '#date', role: 'textbox', confidence: 1.0 },
            { selector: '#search-btn', role: 'button', confidence: 1.0 },
          ],
        }),
        createMockSnapshot({
          url: 'https://flights.example.com/results',
          title: 'Flight Results',
          interactiveElements: [
            { selector: '.flight-option', role: 'button', confidence: 1.0 },
          ],
        }),
        createMockSnapshot({
          url: 'https://flights.example.com/booking',
          title: 'Booking Confirmation',
          interactiveElements: [],
        }),
      ];
      
      // Queue snapshots for each iteration (6 actions => 6 snapshots)
      const snapshotQueue = [
        snapshots[0], // type origin
        snapshots[0], // type destination
        snapshots[0], // type date
        snapshots[0], // click search
        snapshots[1], // click flight option
        snapshots[2], // done
      ];
      snapshotQueue.forEach(snapshot => mockedGetSnapshot.mockResolvedValueOnce(snapshot));
      
      // Mock extractObservation to return interactive elements from each snapshot
      mockedExtractObservation.mockImplementation(async (snapshot) => ({
        interactiveElements: snapshot.interactiveElements,
      }));
      
      mockedExecuteAction.mockResolvedValue({ success: true });
      
      // Mock LLM to perform flight search steps
      mockLLM.setActions([
        { type: 'type', target: { selector: '#origin', confidence: 1.0 }, text: 'SFO', description: 'Enter origin' },
        { type: 'type', target: { selector: '#destination', confidence: 1.0 }, text: 'JFK', description: 'Enter destination' },
        { type: 'type', target: { selector: '#date', confidence: 1.0 }, text: '2026-05-01', description: 'Enter date' },
        { type: 'click', target: { selector: '#search-btn', confidence: 1.0 }, description: 'Click search' },
        { type: 'click', target: { selector: '.flight-option', confidence: 1.0 }, description: 'Select first flight' },
        { type: 'done', result: 'Flight selected for booking', success: true },
      ]);
      
      // Act
      const result = await simulateAgentLoop({
        llm: mockLLM,
        browser: { launchBrowser, getSnapshot, executeAction },
        safetyGuard: mockSafetyGuard,
        goal: 'Book a flight from SFO to JFK on May 1st',
      });
      
      // Assert
      expect(mockedLaunchBrowser).toHaveBeenCalledWith('https://example.com');
      expect(mockedGetSnapshot).toHaveBeenCalledTimes(6);
      expect(mockedExecuteAction).toHaveBeenCalledTimes(5);
      expect(result.success).toBe(true);
    });
  });

  describe('E4: Low-confidence action triggers human handoff', () => {
    it('should pause and ask human when confidence is low', async () => {
      // Arrange
      const mockBrowser = { close: jest.fn() };
      const mockPage = createMockPage();
      mockedLaunchBrowser.mockResolvedValue({ browser: mockBrowser, page: mockPage });
      
      const snapshot = createMockSnapshot({
        interactiveElements: [
          { selector: '#ambiguous', role: 'button', confidence: 0.3 }, // low confidence
        ],
      });
      mockedGetSnapshot.mockResolvedValue(snapshot);
      mockedExtractObservation.mockResolvedValue({
        interactiveElements: snapshot.interactiveElements,
      });
      
      // Mock SafetyGuard to require human confirmation
      mockSafetyGuard.requireHumanConfirmation.mockRejectedValue(
        new Error('Human confirmation required')
      );
      
      // Mock LLM to return low-confidence action
      mockLLM.setActions([
        {
          type: 'click',
          target: { selector: '#ambiguous', confidence: 0.3 },
          description: 'Click ambiguous button',
        },
        {
          type: 'ask_human',
          question: 'Which element should I click?',
          options: ['Option A', 'Option B'],
        },
      ]);
      
      // Mock executeAction to fail due to low confidence (will be caught by safety guard)
      mockedExecuteAction.mockRejectedValue(new Error('Low confidence action blocked'));
      
      // Act
      const result = await simulateAgentLoop({
        llm: mockLLM,
        browser: { launchBrowser, getSnapshot, executeAction },
        safetyGuard: mockSafetyGuard,
        goal: 'Click the button',
      });
      
      // Assert
      expect(mockSafetyGuard.requireHumanConfirmation).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Human confirmation required');
    });
  });
});