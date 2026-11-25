import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = ["p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "h2", "h3", "blockquote", "a", "hr"];

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    // TownMart's own pages (only CMS content may link to them) open in place.
    if (/^\/(?![/\\])/.test(node.getAttribute("href") ?? "")) {
      node.removeAttribute("target");
      node.removeAttribute("rel");
      return;
    }
    node.setAttribute("rel", "nofollow noopener noreferrer");
    node.setAttribute("target", "_blank");
  }
});

/** Sanitises seller-written rich text before it is stored. Run on the server, always. */
export function sanitizeRichText(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "rel", "target"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:)/i,
  }).trim();
}

/** TownMart's own content (help centre, about): the same allowlist, plus links to TownMart paths. */
export function sanitizeCmsHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "rel", "target"],
    // "/path" only: never "//host" or "/\host", which browsers treat as another site.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/(?![/\\]))/i,
  }).trim();
}

/** Plain text for meta descriptions and search snippets. */
export function htmlToText(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: [] }).replace(/\s+/g, " ").trim();
}
