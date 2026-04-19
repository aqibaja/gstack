// BrowserAutoDrive — Content Script: Element Highlight Overlay
// Injected into every page via manifest.json content_scripts.
// Receives PREVIEW_STEP from service worker, highlights target element,
// returns ElementSnapshot. CLEAR_PREVIEW removes overlay.

interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
}

interface ElementSnapshot {
  elementRect: ElementRect;
  tagName: string;
  text: string;
  ariaLabel: string;
}

interface PreviewStepPayload {
  stepId: string;
  stepNumber: number;
  totalSteps: number;
  selector: string;
  action: string;
  value?: string;
  reasoning: string;
  tier: "free" | "pro";
}

// ─── State ───────────────────────────────────────────────────────────────────

let activeOverlay: HTMLDivElement | null = null;
let activeTargetElement: Element | null = null;
let activeStepId: string | null = null;
let scrollHandler: (() => void) | null = null;
let resizeHandler: (() => void) | null = null;
let mutationObserver: MutationObserver | null = null;
let scrollAnimationId: number | null = null;

const OVERLAY_ID = "bad-preview-overlay";
const SCROLL_TIMEOUT_MS = 2000;
const HIGHLIGHT_STYLE = "2px dashed #facc15"; // yellow-400

// ─── Selector Validation ─────────────────────────────────────────────────────

function isValidSelector(selector: string): boolean {
  if (typeof selector !== "string" || selector.length === 0) return false;
  if (selector.length > 2048) return false; // prevent pathological selectors
  try {
    document.querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

// ─── Element Snapshot ────────────────────────────────────────────────────────

function captureSnapshot(el: Element): ElementSnapshot {
  const rect = el.getBoundingClientRect();
  const text = (el.textContent || "").trim().slice(0, 500);
  const ariaLabel = el.getAttribute("aria-label") || "";

  return {
    elementRect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
    },
    tagName: el.tagName.toLowerCase(),
    text,
    ariaLabel,
  };
}

function isElementVisible(el: Element): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// ─── Overlay Management ──────────────────────────────────────────────────────

function removeOverlay(): void {
  if (activeOverlay && activeOverlay.parentNode) {
    activeOverlay.parentNode.removeChild(activeOverlay);
  }
  activeOverlay = null;
  activeTargetElement = null;
  activeStepId = null;

  if (scrollHandler) {
    window.removeEventListener("scroll", scrollHandler, true);
    scrollHandler = null;
  }
  if (resizeHandler) {
    window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;
  }
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
  if (scrollAnimationId !== null) {
    cancelAnimationFrame(scrollAnimationId);
    scrollAnimationId = null;
  }
}

function positionOverlay(overlay: HTMLDivElement, el: Element): void {
  const rect = el.getBoundingClientRect();
  // position:fixed uses viewport-relative coords — no scroll offset needed
  overlay.style.top = `${rect.top}px`;
  overlay.style.left = `${rect.left}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
}

function createOverlay(el: Element): HTMLDivElement {
  // Remove any existing overlay first
  removeOverlay();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.setAttribute("data-bad-overlay", "true");

  // Use position:fixed with viewport-relative getBoundingClientRect() coords.
  // position:absolute breaks when any ancestor has a positioning context.
  overlay.style.cssText = `
    position: fixed;
    border: ${HIGHLIGHT_STYLE};
    pointer-events: none;
    z-index: 2147483647;
    box-sizing: border-box;
    transition: top 0.15s ease, left 0.15s ease, width 0.15s ease, height 0.15s ease;
  `;

  positionOverlay(overlay, el);
  document.body.appendChild(overlay);

  // Update position on scroll (capture phase to handle nested scroll containers)
  scrollHandler = () => positionOverlay(overlay, el);
  window.addEventListener("scroll", scrollHandler, true);

  resizeHandler = () => positionOverlay(overlay, el);
  window.addEventListener("resize", resizeHandler);

  // Remove overlay if target element is removed from DOM
  mutationObserver = new MutationObserver(() => {
    if (!document.contains(el)) {
      removeOverlay();
    }
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });

  return overlay;
}

// ─── Scroll Into View ────────────────────────────────────────────────────────

function scrollElementIntoView(el: Element): Promise<void> {
  return new Promise((resolve) => {
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });

    // Resolve after scroll settles or timeout
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (scrollAnimationId !== null) {
        cancelAnimationFrame(scrollAnimationId);
        scrollAnimationId = null;
      }
      resolve();
    };

    // Use scroll event to detect when scrolling stops
    let scrollEndTimeout: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
      scrollEndTimeout = setTimeout(() => {
        window.removeEventListener("scroll", onScroll, true);
        settle();
      }, 100);
    };
    window.addEventListener("scroll", onScroll, true);

    // Hard timeout — never block indefinitely
    setTimeout(() => {
      window.removeEventListener("scroll", onScroll, true);
      if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
      settle();
    }, SCROLL_TIMEOUT_MS);
  });
}

// ─── Preview Handler ─────────────────────────────────────────────────────────

async function handlePreviewStep(payload: PreviewStepPayload): Promise<void> {
  const { stepId, selector } = payload;

  // Validate selector
  if (!isValidSelector(selector)) {
    sendSnapshot(stepId, null);
    return;
  }

  const el = document.querySelector(selector);
  if (!el) {
    sendSnapshot(stepId, null);
    return;
  }

  // Warn but proceed if element is hidden — snapshot will have 0x0 rect
  if (!isElementVisible(el)) {
    console.warn("[BAD] Target element is hidden:", selector);
  }

  activeStepId = stepId;
  activeTargetElement = el;

  // Scroll into view if off-screen
  const rect = el.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const isOffScreen =
    rect.bottom < 0 ||
    rect.top > viewportHeight ||
    rect.right < 0 ||
    rect.left > viewportWidth;

  if (isOffScreen) {
    await scrollElementIntoView(el);
  }

  // Re-query after scroll (element may have shifted)
  const freshEl = document.querySelector(selector);
  if (!freshEl || !document.contains(freshEl)) {
    sendSnapshot(stepId, null);
    return;
  }

  activeTargetElement = freshEl;

  // Create highlight overlay
  activeOverlay = createOverlay(freshEl);

  // Capture and return snapshot
  const snapshot = captureSnapshot(freshEl);
  sendSnapshot(stepId, snapshot);
}

function sendSnapshot(stepId: string, snapshot: ElementSnapshot | null): void {
  chrome.runtime.sendMessage({
    type: "ELEMENT_SNAPSHOT",
    payload: { stepId, snapshot },
  });
}

// ─── Message Listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, _sendResponse) => {
  // Only accept messages from our own extension — reject page-injected messages
  if (sender.id !== chrome.runtime.id) return false;

  switch (message.type) {
    case "PREVIEW_STEP":
      handlePreviewStep(message.payload);
      return false; // async handling via sendMessage, no need for sendResponse

    case "CLEAR_PREVIEW":
      removeOverlay();
      return false;

    default:
      return false;
  }
});

export {};
