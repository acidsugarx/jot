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

  it('preserves inline color styles (Yougile uses them intentionally)', () => {
    const clean = sanitizeHtml(
      '<span style="color: #6BC125; background-color: #A9D4D4">text</span>',
    );
    expect(clean).toContain('color:');
    expect(clean).toContain('background-color:');
    expect(clean).toContain('text');
  });

  it('preserves background-color in inline styles', () => {
    const clean = sanitizeHtml(
      '<span style="background-color: #A9D4D4; font-style: italic">text</span>',
    );
    expect(clean).toContain('background-color:');
    expect(clean).toContain('font-style: italic');
    expect(clean).toContain('text');
  });

  it('preserves color property in inline styles', () => {
    const clean = sanitizeHtml(
      '<span style="color: black; background-color: white">text</span>',
    );
    expect(clean).toContain('style=');
    expect(clean).toContain('color:');
    expect(clean).toContain('background-color:');
    expect(clean).toContain('text');
  });

  it('strips event handler attributes', () => {
    const clean = sanitizeHtml(
      '<div onmouseover="alert(1)" onload="evil()">content</div>',
    );
    expect(clean).not.toContain('onmouseover');
    expect(clean).not.toContain('onload');
    expect(clean).toContain('content');
  });

  it('strips font-family and mso- styles but preserves color', () => {
    const clean = sanitizeHtml(
      '<span style="font-family: Arial; color: #6BC125; mso-bidi-font-weight: normal">text</span>',
    );
    expect(clean).not.toContain('font-family');
    expect(clean).not.toContain('mso-');
    expect(clean).toContain('color:');
    expect(clean).toContain('text');
  });

  it('handles CKEditor todo-list HTML (span variant)', () => {
    const html = '<ul class="todo-list"><li><span class="todo-list__label todo-list__label_without-description"><span contenteditable="false"><input type="checkbox" tabindex="-1"></span></span><p> </p></li></ul>';
    const clean = sanitizeHtml(html);
    expect(clean).toContain('todo-list');
    expect(clean).toContain('contenteditable="false"');
    expect(clean).toContain('type="checkbox"');
  });

  it('handles Yougile API todo-list HTML (label variant)', () => {
    const html = '<ul class="todo-list"><li><label class="todo-list__label todo-list__label_without-description"><input type="checkbox" disabled="disabled"></label><p> </p></li></ul>';
    const clean = sanitizeHtml(html);
    expect(clean).toContain('todo-list');
    expect(clean).toContain('disabled="disabled"');
    expect(clean).toContain('type="checkbox"');
  });

  it('preserves CKEditor data attributes', () => {
    const clean = sanitizeHtml(
      '<li data-list-item-id="abc123"><p>text</p></li>',
    );
    expect(clean).toContain('data-list-item-id="abc123"');
  });

  it('preserves text-align in inline styles', () => {
    const clean = sanitizeHtml(
      '<p style="text-align: justify;">text</p>',
    );
    expect(clean).toContain('text-align');
  });

  it('preserves CSS custom properties (--ck-*)', () => {
    const clean = sanitizeHtml(
      '<li class="ck-list-marker-color" style="--ck-content-list-marker-color: #6BC125;"><p>text</p></li>',
    );
    expect(clean).toContain('--ck-content-list-marker-color');
  });
});
