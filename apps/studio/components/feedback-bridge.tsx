"use client";

import { useEffect } from "react";

/**
 * Runs inside the preview iframe. A right-click on any part of the page picks
 * it: the page, the section it belongs to and the element, described in words
 * the AI can act on, go up to the studio around it, which asks for the note.
 * Only when framed by the studio — opened on its own, the page behaves normally.
 */
export type Pick = {
  route: string;
  section: string | null;
  sectionType: string | null;
  element: string;
  x: number;
  y: number;
};

const ROLE: Record<string, string> = { H1: "heading", H2: "heading", H3: "heading", H4: "heading", P: "text", A: "link", BUTTON: "button", IMG: "image", LI: "list item", LABEL: "form label", INPUT: "form field", TEXTAREA: "form field", SELECT: "form field", TD: "table cell", TH: "table heading" };

function describe(el: Element): string {
  // Climb to something a person would name: a heading, a button, a card…
  let e: Element | null = el;
  while (e && !ROLE[e.tagName] && !e.matches("[class*='card'], [class*='item'], figure") && e.parentElement && !e.matches("[data-section]")) e = e.parentElement;
  const target = e ?? el;
  const role = ROLE[target.tagName] ?? (target.matches("figure") ? "picture" : "block");
  if (target.tagName === "IMG") {
    const img = target as HTMLImageElement;
    return `the ${role}${img.alt ? ` “${img.alt.slice(0, 80)}”` : ""}`;
  }
  // A block is named by its heading, the way a person would point at it.
  if (role === "block") {
    const h = target.querySelector("h1, h2, h3, h4");
    const title = (h as HTMLElement | null)?.innerText.replace(/\s+/g, " ").trim();
    if (title) return `the block headed “${title.slice(0, 90)}”`;
  }
  const text = ((target as HTMLElement).innerText ?? target.textContent ?? "").replace(/\s+/g, " ").trim();
  return `the ${role}${text ? ` “${text.length > 90 ? `${text.slice(0, 90)}…` : text}”` : ""}`;
}

export function FeedbackBridge({ base }: { base: string }) {
  useEffect(() => {
    if (window.parent === window) return;
    let picked: Element | null = null;
    const clear = () => {
      picked?.removeAttribute("data-zs-picked");
      picked = null;
    };
    const onMenu = (ev: MouseEvent) => {
      const el = ev.target as Element | null;
      if (!el || ev.shiftKey) return; // shift + right-click keeps the browser's own menu
      ev.preventDefault();
      clear();
      const block = el.closest("[data-section]");
      const chrome = el.closest("header.zs-nav") ? "header" : el.closest("footer.zs-footer") ? "footer" : null;
      picked = el;
      el.setAttribute("data-zs-picked", "");
      const route = location.pathname.startsWith(base) ? location.pathname.slice(base.length) || "/" : location.pathname;
      const pick: Pick = {
        route,
        section: block?.getAttribute("data-section") ?? chrome,
        sectionType: block?.getAttribute("data-type") ?? chrome,
        element: describe(el),
        x: ev.clientX,
        y: ev.clientY,
      };
      window.parent.postMessage({ zsFeedback: "pick", pick }, location.origin);
    };
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin === location.origin && ev.data?.zsFeedback === "clear") clear();
    };
    document.addEventListener("contextmenu", onMenu);
    window.addEventListener("message", onMessage);
    const style = document.createElement("style");
    style.textContent =
      "[data-zs-picked]{outline:2px solid #7c3aed!important;outline-offset:3px;border-radius:4px}" +
      "[data-section]:hover{box-shadow:inset 0 0 0 1px rgba(124,58,237,.35)}";
    document.head.appendChild(style);
    return () => {
      document.removeEventListener("contextmenu", onMenu);
      window.removeEventListener("message", onMessage);
      style.remove();
    };
  }, [base]);
  return null;
}
