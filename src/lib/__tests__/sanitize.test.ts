import { describe, expect, it } from 'vitest';

import { sanitizeHtml } from '@/lib/sanitize';

describe('sanitizeHtml', () => {
  it('preserves allowed data attributes while removing unsafe scripting', () => {
    const clean = sanitizeHtml(
      '<div data-task-id="123" onclick="alert(1)"><a href="https://example.com" data-kind="external">open</a></div>',
    );

    expect(clean).toContain('data-task-id="123"');
    expect(clean).toContain('data-kind="external"');
    expect(clean).not.toContain('onclick=');
  });

  it('strips script tags entirely', () => {
    const clean = sanitizeHtml('<script>alert("xss")</script><p>Safe</p>');
    expect(clean).not.toContain('<script');
    expect(clean).toContain('Safe');
  });

  it('strips javascript: URLs from href', () => {
    const clean = sanitizeHtml(
      '<a href="javascript:alert(1)">click</a>',
    );
    expect(clean).not.toContain('javascript:');
  });

  it('preserves safe HTML formatting tags', () => {
    const html = '<b>bold</b> <i>italic</i> <a href="https://example.com">link</a>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('preserves checklist input elements', () => {
    const html = '<input type="checkbox" checked />';
    const clean = sanitizeHtml(html);
    expect(clean).toContain('type="checkbox"');
    expect(clean).toContain('checked');
  });

  it('strips iframe tags', () => {
    const clean = sanitizeHtml('<iframe src="https://evil.com"></iframe><p>text</p>');
    expect(clean).not.toContain('<iframe');
    expect(clean).toContain('text');
  });

  it('preserves list structures', () => {
    const html = '<ul><li>item 1</li><li>item 2</li></ul>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('handles empty string input', () => {
    expect(sanitizeHtml('')).toBe('');
  });

  it('preserves data attributes with various prefixes', () => {
    const clean = sanitizeHtml(
      '<div data-index="0" data-column-id="abc" data-is-checked="true">content</div>',
    );
    expect(clean).toContain('data-index="0"');
    expect(clean).toContain('data-column-id="abc"');
    expect(clean).toContain('data-is-checked="true"');
  });

  it('strips event handler attributes', () => {
    const clean = sanitizeHtml(
      '<div onmouseover="alert(1)" onload="evil()">content</div>',
    );
    expect(clean).not.toContain('onmouseover');
    expect(clean).not.toContain('onload');
    expect(clean).toContain('content');
  });
});
