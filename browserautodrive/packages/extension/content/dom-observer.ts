// BrowserAutoDrive — DOM Observer Content Script
// Extracts accessibility tree and interactive elements directly from the DOM.
// Watches for page mutations and notifies the background service worker.

// ─── Types ───────────────────────────────────────────────────────────────────

interface AccessibilityNode {
  role: string;
  name: string;
  children: AccessibilityNode[];
  boundingBox?: { x: number; y: number; width: number; height: number };
}

interface ElementDescriptor {
  selector: string;
  text?: string;
  role?: string;
  ariaLabel?: string;
  confidence: number;
}

interface FormFieldDescriptor {
  selector: string;
  type: string;
  label?: string;
  name?: string;
  value?: string;
  required?: boolean;
}

interface DOMSnapshot {
  accessibilityTree: AccessibilityNode;
  interactiveElements: ElementDescriptor[];
  formFields: FormFieldDescriptor[];
  url: string;
  title: string;
  timestamp: number;
  viewportSize: { width: number; height: number };
  scrollPosition: { x: number; y: number };
}

// ─── Implicit Role Mapping ───────────────────────────────────────────────────

const TAG_ROLE_MAP: Record<string, string> = {
  a: "link",
  button: "button",
  input: "textbox",
  select: "combobox",
  textarea: "textbox",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  img: "img",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  aside: "complementary",
  form: "form",
  table: "table",
  ul: "list",
  ol: "list",
  li: "listitem",
  dialog: "dialog",
  progress: "progressbar",
  output: "status",
  summary: "button",
  fieldset: "group",
  legend: null as unknown as string,
  section: "region",
  article: "article",
};

const INPUT_TYPE_ROLE_MAP: Record<string, string> = {
  text: "textbox",
  password: "textbox",
  email: "textbox",
  tel: "textbox",
  url: "textbox",
  number: "spinbutton",
  search: "searchbox",
  checkbox: "checkbox",
  radio: "radio",
  range: "slider",
  date: "textbox",
  "datetime-local": "textbox",
  month: "textbox",
  week: "textbox",
  time: "textbox",
  color: "textbox",
  file: "button",
  submit: "button",
  reset: "button",
  button: "button",
  image: "button",
  hidden: null as unknown as string,
};

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "menuitem",
  "tab",
  "slider",
  "spinbutton",
  "switch",
  "option",
  "treeitem",
  "menuitemradio",
  "menuitemcheckbox",
]);

// ─── State ───────────────────────────────────────────────────────────────────

let mutationObserver: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastSnapshot: DOMSnapshot | null = null;

const MUTATION_DEBOUNCE_MS = 300;

// ─── Accessibility Extraction ────────────────────────────────────────────────

function getImplicitRole(el: Element): string {
  const tag = el.tagName.toLowerCase();

  if (tag === "input") {
    const type = (el as HTMLInputElement).type?.toLowerCase() || "text";
    return INPUT_TYPE_ROLE_MAP[type] || "textbox";
  }

  if (tag === "a") {
    const href = el.getAttribute("href");
    return href ? "link" : "generic";
  }

  return TAG_ROLE_MAP[tag] || "generic";
}

function getExplicitRole(el: Element): string | null {
  const ariaRole = el.getAttribute("role");
  return ariaRole || null;
}

function getAccessibleName(el: Element): string {
  // aria-label takes precedence
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim();

  // aria-labelledby — resolve referenced elements
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/);
    const parts: string[] = [];
    for (const id of ids) {
      const ref = document.getElementById(id);
      if (ref) parts.push(ref.textContent?.trim() || "");
    }
    const name = parts.join(" ").trim();
    if (name) return name;
  }

  // For inputs, check associated <label>
  if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
    const inputEl = el as HTMLInputElement;
    if (inputEl.labels?.length) {
      return Array.from(inputEl.labels)
        .map((l) => l.textContent?.trim() || "")
        .join(" ")
        .trim();
    }
    // placeholder as fallback
    const placeholder = inputEl.getAttribute("placeholder");
    if (placeholder) return placeholder.trim();
  }

  // For images, use alt
  if (el.tagName === "IMG") {
    return (el as HTMLImageElement).alt?.trim() || "";
  }

  // For buttons/links, use text content (but cap it)
  if (el.tagName === "BUTTON" || el.tagName === "A") {
    return (el.textContent || "").trim().slice(0, 200);
  }

  // For headings, use text content
  if (/^h[1-6]$/.test(el.tagName.toLowerCase())) {
    return (el.textContent || "").trim().slice(0, 200);
  }

  return "";
}

function isVisible(el: Element): boolean {
  if (el === document.documentElement || el === document.body) return true;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getBoundingBox(el: Element): { x: number; y: number; width: number; height: number } | undefined {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return undefined;
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function buildAccessibilityTree(root: Element): AccessibilityNode {
  const explicitRole = getExplicitRole(root);
  const role = explicitRole || getImplicitRole(root);
  const name = getAccessibleName(root);
  const boundingBox = getBoundingBox(root);

  const children: AccessibilityNode[] = [];

  // Walk shadow DOM if present
  if ((root as HTMLElement).shadowRoot) {
    const shadowRoot = (root as HTMLElement).shadowRoot!;
    for (const child of shadowRoot.children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childNode = buildAccessibilityTree(child);
        if (childNode.role !== "generic" || childNode.children.length > 0 || childNode.name) {
          children.push(childNode);
        }
      }
    }
  }

  // Walk regular children
  for (const child of root.children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const skip = shouldSkipInTree(child);
      if (skip) continue;

      const childNode = buildAccessibilityTree(child);
      // Collapse empty generic nodes
      if (childNode.role === "generic" && childNode.children.length === 0 && !childNode.name) {
        continue;
      }
      // Collapse generics with a single child into the parent
      if (childNode.role === "generic" && childNode.children.length === 1) {
        children.push(childNode.children[0]);
      } else {
        children.push(childNode);
      }
    }
  }

  const result: AccessibilityNode = { role, name, children };
  if (boundingBox) result.boundingBox = boundingBox;
  return result;
}

function shouldSkipInTree(el: Element): boolean {
  const tag = el.tagName.toLowerCase();

  // Skip script/style/meta/br/hr/noscript/template
  if (["script", "style", "meta", "link", "br", "hr", "noscript", "template", "svg"].includes(tag)) {
    return true;
  }

  // Skip our own overlay
  if (el.hasAttribute("data-bad-overlay")) return true;

  // Skip hidden elements
  if (!isVisible(el)) return true;

  // Skip elements with aria-hidden="true"
  if (el.getAttribute("aria-hidden") === "true") return true;

  return false;
}

// ─── Interactive Element Extraction ──────────────────────────────────────────

function generateUniqueSelector(el: Element): string {
  // Try id first
  if (el.id) {
    const escaped = CSS.escape(el.id);
    if (document.querySelectorAll(`#${escaped}`).length === 1) {
      return `#${escaped}`;
    }
  }

  // Try data-testid
  const testId = el.getAttribute("data-testid");
  if (testId) {
    const selector = `[data-testid="${CSS.escape(testId)}"]`;
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  // Build path-based selector
  const path: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.body) {
    let part = current.tagName.toLowerCase();

    if (current.id) {
      part = `#${CSS.escape(current.id)}`;
      path.unshift(part);
      break;
    }

    // Add classes (skip utility classes)
    const classes = Array.from(current.classList)
      .filter((c) => !c.startsWith("__bad") && c.length < 40)
      .slice(0, 3);
    if (classes.length > 0) {
      part += "." + classes.map((c) => CSS.escape(c)).join(".");
    }

    // Add nth-child if needed for uniqueness
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (s) => s.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        part += `:nth-of-type(${index})`;
      }
    }

    path.unshift(part);
    current = current.parentElement;
  }

  return path.join(" > ");
}

function isInteractiveElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();

  // Always interactive
  if (["button", "a", "select", "textarea"].includes(tag)) return true;

  // Input elements (except hidden)
  if (tag === "input") {
    const type = (el as HTMLInputElement).type?.toLowerCase();
    return type !== "hidden";
  }

  // Elements with explicit interactive role
  const role = getExplicitRole(el);
  if (role && INTERACTIVE_ROLES.has(role)) return true;

  // Elements with tabindex >= 0
  const tabIndex = el.getAttribute("tabindex");
  if (tabIndex !== null && parseInt(tabIndex, 10) >= 0) return true;

  // Elements with click handlers (heuristic: onclick attribute)
  if (el.hasAttribute("onclick")) return true;

  // Contenteditable
  if (el.getAttribute("contenteditable") === "true") return true;

  return false;
}

function extractInteractiveElements(root: Element = document.body): ElementDescriptor[] {
  const elements: ElementDescriptor[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let current = walker.currentNode as Element | null;

  while (current) {
    if (isInteractiveElement(current) && isVisible(current) && current.getAttribute("aria-hidden") !== "true") {
      const role = getExplicitRole(current) || getImplicitRole(current);
      const text = (current.textContent || "").trim().slice(0, 300);
      const ariaLabel = current.getAttribute("aria-label") || undefined;

      let confidence = 0.7;
      if (role && INTERACTIVE_ROLES.has(role)) confidence = 0.9;
      if (current.id) confidence = Math.min(confidence + 0.1, 1.0);
      if (ariaLabel) confidence = Math.min(confidence + 0.1, 1.0);

      elements.push({
        selector: generateUniqueSelector(current),
        text: text || undefined,
        role,
        ariaLabel,
        confidence,
      });
    }
    current = walker.nextNode() as Element | null;
  }

  return elements;
}

// ─── Form Field Extraction ───────────────────────────────────────────────────

function extractFormFields(root: Element = document.body): FormFieldDescriptor[] {
  const fields: FormFieldDescriptor[] = [];
  const formElements = root.querySelectorAll("input, select, textarea");

  for (const el of formElements) {
    if (el.getAttribute("aria-hidden") === "true") continue;

    const htmlEl = el as HTMLInputElement;
    const type = htmlEl.type?.toLowerCase() || htmlEl.tagName.toLowerCase();

    // Skip hidden inputs
    if (type === "hidden") continue;

    let label: string | undefined;
    if (htmlEl.labels?.length) {
      label = Array.from(htmlEl.labels)
        .map((l) => l.textContent?.trim() || "")
        .join(" ")
        .trim();
    }
    if (!label) {
      label = htmlEl.getAttribute("placeholder") || htmlEl.getAttribute("aria-label") || undefined;
    }

    fields.push({
      selector: generateUniqueSelector(el),
      type,
      label,
      name: htmlEl.name || undefined,
      value: htmlEl.value || undefined,
      required: htmlEl.required,
    });
  }

  return fields;
}

// ─── Snapshot Capture ────────────────────────────────────────────────────────

function captureSnapshot(): DOMSnapshot {
  const accessibilityTree = buildAccessibilityTree(document.documentElement);
  const interactiveElements = extractInteractiveElements();
  const formFields = extractFormFields();

  return {
    accessibilityTree,
    interactiveElements,
    formFields,
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    viewportSize: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    scrollPosition: {
      x: window.scrollX,
      y: window.scrollY,
    },
  };
}

// ─── MutationObserver ────────────────────────────────────────────────────────

function handleMutations(mutations: MutationRecord[]): void {
  // Filter out our own overlay mutations
  const meaningful = mutations.filter((m) => {
    // Ignore mutations on our overlay
    if (m.target instanceof Element && m.target.hasAttribute("data-bad-overlay")) return false;
    // Ignore mutations on the overlay div itself
    if (m.target instanceof Element && m.target.id === "bad-preview-overlay") return false;

    // Check added nodes
    for (const node of m.addedNodes) {
      if (node instanceof Element && node.hasAttribute("data-bad-overlay")) return false;
    }
    // Check removed nodes
    for (const node of m.removedNodes) {
      if (node instanceof Element && node.hasAttribute("data-bad-overlay")) return false;
    }

    return true;
  });

  if (meaningful.length === 0) return;

  // Debounce — accumulate rapid mutations into a single snapshot
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    notifyPageMutated();
  }, MUTATION_DEBOUNCE_MS);
}

function startObserving(): void {
  if (mutationObserver) return;

  mutationObserver = new MutationObserver(handleMutations);
  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "class",
      "style",
      "disabled",
      "hidden",
      "aria-hidden",
      "aria-label",
      "aria-expanded",
      "aria-selected",
      "aria-checked",
      "aria-disabled",
      "role",
      "tabindex",
      "href",
      "value",
      "checked",
      "selected",
    ],
    characterData: true,
  });
}

function stopObserving(): void {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

// ─── Messaging ───────────────────────────────────────────────────────────────

function notifyPageMutated(): void {
  chrome.runtime.sendMessage({
    type: "PAGE_MUTATED",
    payload: {
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
    },
  });
}

function handleSnapshotRequest(): DOMSnapshot {
  const snapshot = captureSnapshot();
  lastSnapshot = snapshot;
  return snapshot;
}

// ─── Message Listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only accept messages from our own extension
  if (sender.id !== chrome.runtime.id) return false;

  switch (message.type) {
    case "GET_SNAPSHOT": {
      const snapshot = handleSnapshotRequest();
      sendResponse({ type: "SNAPSHOT_RESPONSE", payload: snapshot });
      return true; // keep sendResponse channel open for async
    }

    case "START_OBSERVING": {
      startObserving();
      sendResponse({ success: true });
      return false;
    }

    case "STOP_OBSERVING": {
      stopObserving();
      sendResponse({ success: true });
      return false;
    }

    default:
      return false;
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────

// Start observing immediately when injected
startObserving();

export {};
