import sanitizeHtml from "sanitize-html";

const allowedTags = ["p", "br", "strong", "em", "u", "ul", "ol", "li", "h2", "h3", "blockquote"];

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

function prepare(value: string) {
  if (/<\/?(?:p|br|strong|b|em|i|u|ul|ol|li|h2|h3|blockquote)\b/i.test(value)) return value;
  return value.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
}

export function sanitizeRichText(value: string) {
  return sanitizeHtml(prepare(value.trim()), {
    allowedTags,
    allowedAttributes: {},
    transformTags: { b: "strong", i: "em", h1: "h2" },
    disallowedTagsMode: "discard",
  }).trim();
}

export function richTextToPlainText(value: string) {
  return sanitizeHtml(sanitizeRichText(value), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasRichText(value: string) { return richTextToPlainText(value).length > 0; }
