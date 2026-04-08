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
});
