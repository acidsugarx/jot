import { describe, expect, it } from 'vitest';

import { todayDateInput, tokenize } from '@/lib/formatting';

describe('tokenize', () => {
  it('highlights tags, priorities, and @zettel markers without dropping text', () => {
    expect(tokenize('Ship #release !urgent @zettel today')).toEqual([
      { text: 'Ship ', color: null },
      { text: '#release', color: 'rgb(34 211 238)' },
      { text: ' ', color: null },
      { text: '!urgent', color: 'rgb(248 113 113)' },
      { text: ' ', color: null },
      { text: '@zettel', color: 'rgb(167 139 250)' },
      { text: ' today', color: null },
    ]);
  });
});

describe('todayDateInput', () => {
  it('returns a yyyy-mm-dd value for date inputs', () => {
    expect(todayDateInput()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
