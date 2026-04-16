// BrowserAutoDrive — Observation System

import { Page } from "playwright";
import {
  AccessibilityNode,
  ElementDescriptor,
  FormFieldDescriptor,
  PageSnapshot,
} from "@browserautodrive/core";
import { captureScreenshot, getPageInfo } from "@browserautodrive/browser";

export async function extractAccessibilityTree(
  page: Page
): Promise<AccessibilityNode> {
  // Playwright exposes accessibility via page.accessibility.snapshot()
  // Types may not include this in all versions; use type assertion for compatibility
  const accessibility = (page as any).accessibility;
  const snapshot = accessibility
    ? await accessibility.snapshot()
    : null;
  if (!snapshot) {
    return { role: "root", name: "", children: [] };
  }
  return mapAccessibilityNode(snapshot);
}

function mapAccessibilityNode(node: any): AccessibilityNode {
  const result: AccessibilityNode = {
    role: node.role || "unknown",
    name: node.name || "",
    children: [],
  };

  if (node.value) {
    result.name += `: ${node.value}`;
  }

  if (node.boundingBox || (node as any).bounding) {
    const box = (node as any).bounding || node.boundingBox;
    result.boundingBox = {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };
  }

  if (node.children) {
    result.children = node.children.map((child: any) =>
      mapAccessibilityNode(child)
    );
  }

  return result;
}

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

function isInteractiveRole(role: string): boolean {
  return INTERACTIVE_ROLES.has(role);
}

export async function extractInteractiveElements(
  page: Page
): Promise<ElementDescriptor[]> {
  const tree = await extractAccessibilityTree(page);
  const elements: ElementDescriptor[] = [];
  collectInteractiveElements(tree, elements);
  return elements;
}

function collectInteractiveElements(
  node: AccessibilityNode,
  elements: ElementDescriptor[]
): void {
  if (isInteractiveRole(node.role)) {
    const selector = generateSelector(node);
    elements.push({
      selector,
      text: node.name,
      role: node.role,
      confidence: node.boundingBox ? 0.9 : 0.6,
    });
  }

  for (const child of node.children) {
    collectInteractiveElements(child, elements);
  }
}

function generateSelector(node: AccessibilityNode): string {
  if (node.role === "button") {
    return `button:has-text("${node.name.replace(/"/g, '\\"')}")`;
  }
  if (node.role === "link") {
    return `a:has-text("${node.name.replace(/"/g, '\\"')}")`;
  }
  if (node.role === "textbox" || node.role === "searchbox") {
    if (node.name) {
      return `[aria-label="${node.name.replace(/"/g, '\\"')}"]`;
    }
    return `input[type="text"]`;
  }
  if (node.role === "combobox") {
    return `select`;
  }
  return `[role="${node.role}"]`;
}

export async function extractFormFields(
  page: Page
): Promise<FormFieldDescriptor[]> {
  const fields: FormFieldDescriptor[] = [];

  const rawFields = await page.evaluate(() => {
    const formElements = document.querySelectorAll(
      "input, select, textarea"
    );
    const results: Array<{
      id: string | null;
      name: string | null;
      type: string;
      label: string | null;
      value: string | null;
      required: boolean;
      ariaLabel: string | null;
      tagName: string;
    }> = [];

    formElements.forEach((el) => {
      const htmlEl = el as HTMLInputElement;
      results.push({
        id: htmlEl.id || null,
        name: htmlEl.name || null,
        type: htmlEl.type || htmlEl.tagName.toLowerCase(),
        label: htmlEl.labels?.[0]?.textContent ?? null,
        value: htmlEl.value || null,
        required: htmlEl.required,
        ariaLabel: htmlEl.getAttribute("aria-label") || null,
        tagName: htmlEl.tagName.toLowerCase(),
      });
    });

    return results;
  });

  for (const raw of rawFields) {
    const selector = raw.id
      ? `#${raw.id}`
      : raw.name
      ? `[name="${raw.name}"]`
      : raw.ariaLabel
      ? `[aria-label="${raw.ariaLabel}"]`
      : raw.tagName;

    fields.push({
      selector,
      type: raw.type || raw.tagName,
      label: raw.label ?? undefined,
      name: raw.name ?? undefined,
      value: raw.value ?? undefined,
      required: raw.required,
    });
  }

  return fields;
}

export async function extractObservation(page: Page): Promise<PageSnapshot> {
  const [accessibilityTree, interactiveElements, formFields, screenshot, pageInfo] =
    await Promise.all([
      extractAccessibilityTree(page),
      extractInteractiveElements(page),
      extractFormFields(page),
      captureScreenshot(page),
      getPageInfo(page),
    ]);

  const scrollPosition = await page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
  }));

  return {
    url: pageInfo.url,
    title: pageInfo.title,
    timestamp: Date.now(),
    accessibilityTree,
    interactiveElements,
    screenshot,
    viewportSize: pageInfo.viewportSize,
    scrollPosition,
    formFields,
  };
}

export { extractAccessibilityTree as getAccessibilityTree };