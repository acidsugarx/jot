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

/**
 * Inline styles that come from external paste (e.g. Google Docs, Word) that
 * force specific fonts, line-heights, etc. We strip those but KEEP color and
 * background-color since Yougile uses them intentionally in task descriptions.
 * We also keep CSS custom properties (--ck-*) used by CKEditor 5.
 */
const STRIP_STYLE_RE = /(?:^|;)\s*(?:font-family|mso-[a-z-]+|line-height|letter-spacing|white-space)\s*:[^;]*/gi;

function stripUnwantedStyles(html: string): string {
  return html.replace(
    /(<[^>]+\sstyle=)("[^"]*"|'[^']*')/gi,
    (_match, prefix: string, quoted: string) => {
      const quote = quoted[0];
      const inner = quoted.slice(1, -1);
      const cleaned = inner.replace(STRIP_STYLE_RE, '').replace(/;{2,}/g, ';').replace(/^[;\s]+/, '').replace(/[;\s]+$/, '');
      return cleaned ? `${prefix}${quote}${cleaned}${quote}` : '';
    },
  );
}

export function sanitizeHtml(dirty: string): string {
  const clean = purify.sanitize(dirty);
  return stripUnwantedStyles(clean);
}
