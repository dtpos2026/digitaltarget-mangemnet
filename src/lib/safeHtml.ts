import DOMPurify from "dompurify";

// Print / export windows are built from template strings that include user
// data (lead names, notes, client names…). Everything written into a window
// or into innerHTML goes through DOMPurify so a name like
// `<img src=x onerror=…>` cannot run script with the user's session.

export function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Sanitises an HTML fragment (keeps inline styles, <style>, data: images). */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { ADD_TAGS: ["style"], FORCE_BODY: true });
}

/**
 * Writes a full HTML document into a popup window after sanitising it.
 * `<head>` styles and the title are kept; scripts and event handlers are removed.
 */
export function writeSafeDocument(w: Window, html: string) {
  const clean = DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true, ADD_TAGS: ["style", "title"] });
  w.document.open();
  w.document.write("<!doctype html>" + clean);
  w.document.close();
}
