// BrowserAutoDrive — Browser Control Layer (Playwright)

import { chromium, Browser, Page, BrowserContext } from "playwright";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export interface ClickOptions {
  timeout?: number;
  force?: boolean;
}

export interface TypeOptions {
  delay?: number;
  clear?: boolean;
}

export interface ScrollOptions {
  amount?: number;
}

const DEFAULT_TIMEOUT = 30000;
const NAVIGATION_TIMEOUT = 60000;

export async function launchBrowser(
  url?: string,
  options?: { headless?: boolean }
): Promise<BrowserSession> {
  const browser = await chromium.launch({
    headless: options?.headless ?? true,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  context.setDefaultTimeout(DEFAULT_TIMEOUT);
  context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);

  const page = await context.newPage();

  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }

  return { browser, context, page };
}

export async function closeBrowser(session: BrowserSession): Promise<void> {
  await session.context.close();
  await session.browser.close();
}

export async function navigateTo(
  page: Page,
  url: string
): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
}

export async function captureScreenshot(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: "png" });
  return buffer.toString("base64");
}

export async function clickElement(
  page: Page,
  selector: string,
  options?: ClickOptions
): Promise<void> {
  const locator = page.locator(selector).first();
  await locator.click({
    timeout: options?.timeout ?? DEFAULT_TIMEOUT,
    force: options?.force ?? false,
  });
}

export async function typeText(
  page: Page,
  selector: string,
  text: string,
  options?: TypeOptions
): Promise<void> {
  const locator = page.locator(selector).first();
  if (options?.clear) {
    await locator.fill("");
  }
  await locator.fill(text);
}

export async function scrollPage(
  page: Page,
  direction: "up" | "down",
  amount: number = 500
): Promise<void> {
  const delta = direction === "down" ? amount : -amount;
  await page.mouse.wheel(0, delta);
  await page.waitForTimeout(300);
}

export async function selectOption(
  page: Page,
  selector: string,
  value: string
): Promise<void> {
  await page.selectOption(selector, value);
}

export async function extractText(
  page: Page,
  selector: string
): Promise<string> {
  const locator = page.locator(selector).first();
  return (await locator.textContent()) ?? "";
}

export async function getPageInfo(page: Page): Promise<{
  url: string;
  title: string;
  viewportSize: { width: number; height: number };
}> {
  const url = page.url();
  const title = await page.title();
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  return { url, title, viewportSize: viewport };
}

export async function waitForSelector(
  page: Page,
  selector: string,
  timeout?: number
): Promise<void> {
  await page.waitForSelector(selector, {
    timeout: timeout ?? DEFAULT_TIMEOUT,
    state: "visible",
  });
}

export async function executeBrowserAction(
  page: Page,
  action: {
    type: string;
    target?: { selector: string };
    text?: string;
    url?: string;
    direction?: "up" | "down";
    amount?: number;
    value?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    switch (action.type) {
      case "navigate":
        if (!action.url) throw new Error("navigate requires url");
        await navigateTo(page, action.url);
        break;
      case "click":
        if (!action.target) throw new Error("click requires target");
        await clickElement(page, action.target.selector);
        break;
      case "type":
        if (!action.target || !action.text)
          throw new Error("type requires target and text");
        await typeText(page, action.target.selector, action.text);
        break;
      case "scroll":
        await scrollPage(
          page,
          action.direction ?? "down",
          action.amount ?? 500
        );
        break;
      case "select":
        if (!action.target || !action.value)
          throw new Error("select requires target and value");
        await selectOption(page, action.target.selector, action.value);
        break;
      case "extract":
        if (!action.target) throw new Error("extract requires target");
        await extractText(page, action.target.selector);
        break;
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
    return { success: true };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown browser error";
    return { success: false, error: message };
  }
}