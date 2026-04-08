import DOMPurify from 'dompurify';

const purify = DOMPurify(window);

purify.setConfig({
  ALLOWED_TAGS: [
    'p', 'br', 'b', 'i', 'em', 'strong', 'a', 'img', 'ul', 'ol', 'li',
    'code', 'pre', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'details', 'summary', 'hr', 's', 'strike', 'del', 'u', 'input', 'label',
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'target', 'rel', 'class', 'style',
    'width', 'height', 'type', 'checked', 'disabled', 'open',
    'contenteditable', 'tabindex', 'dir', 'lang', 'role',
    'aria-label', 'aria-checked', 'aria-labelledby', 'aria-hidden',
    'aria-haspopup', 'aria-expanded', 'aria-disabled',
    'data-*',
  ],
  ALLOW_DATA_ATTR: true,
});

export function sanitizeHtml(dirty: string): string {
  return purify.sanitize(dirty);
}
