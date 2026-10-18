import DOMPurify from 'dompurify';
import { marked } from 'marked';

/** Tags a chat message may use. Anything else is removed, keeping its text. */
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
];

// Links from chat open in a new tab, and the page they open can't reach back into DevVerse (window.opener), learn
// where the click came from, or gain search ranking from it.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
});

/**
 * A chat message as safe HTML.
 * [CONCEPT: XSS Prevention] Markdown can contain raw HTML (<img onerror=…>, <script>, javascript: links). marked turns
 * the message into HTML, then DOMPurify keeps only the tags and attributes above and drops unsafe URL schemes, so
 * nothing a sender writes can run code in other people's browsers.
 */
export function renderMarkdown(body: string): string {
  const html = marked.parse(body, { gfm: true, breaks: true, async: false });
  const safe = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href'],
    // Only web and mail links; DOMPurify already blocks javascript:, this also blocks data: and the rest.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
  return safe.trim();
}

/** What a message says without its formatting, e.g. for a screen-reader announcement ("MDN", not "[MDN](https://…)"). */
export function markdownToText(body: string): string {
  const doc = new DOMParser().parseFromString(renderMarkdown(body), 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}
