import { describe, expect, it } from 'vitest';

import {
  escapeHtml,
  toDateInputValue,
  todayDateInput,
  tokenize,
} from '@/lib/formatting';

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

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('returns single plain token for text without markers', () => {
    expect(tokenize('just plain text')).toEqual([
      { text: 'just plain text', color: null },
    ]);
  });

  it('handles multiple tags', () => {
    const result = tokenize('#alpha #beta #gamma');
    expect(result).toEqual([
      { text: '#alpha', color: 'rgb(34 211 238)' },
      { text: ' ', color: null },
      { text: '#beta', color: 'rgb(34 211 238)' },
      { text: ' ', color: null },
      { text: '#gamma', color: 'rgb(34 211 238)' },
    ]);
  });

  it('colors each priority level differently', () => {
    const low = tokenize('!low')[0];
    expect(low).toBeDefined();
    expect(low!.color).toBe('rgb(96 165 250)'); // blue-400

    const medium = tokenize('!medium')[0];
    expect(medium).toBeDefined();
    expect(medium!.color).toBe('rgb(250 204 21)'); // yellow-400

    const high = tokenize('!high')[0];
    expect(high).toBeDefined();
    expect(high!.color).toBe('rgb(251 146 60)'); // orange-400

    const urgent = tokenize('!urgent')[0];
    expect(urgent).toBeDefined();
    expect(urgent!.color).toBe('rgb(248 113 113)'); // red-400
  });

  it('does not match @mentions other than @zettel', () => {
    const result = tokenize('@person do something');
    expect(result).toEqual([{ text: '@person do something', color: null }]);
  });

  it('is case-insensitive for priority keywords', () => {
    const result = tokenize('!URGENT');
    expect(result[0]).toEqual({
      text: '!URGENT',
      color: 'rgb(248 113 113)',
    });
  });

  it('handles input that is only markers', () => {
    expect(tokenize('#tag')).toEqual([
      { text: '#tag', color: 'rgb(34 211 238)' },
    ]);
  });
});

describe('toDateInputValue', () => {
  it('converts ISO string to yyyy-mm-dd', () => {
    expect(toDateInputValue('2026-04-08T14:30:00Z')).toBe('2026-04-08');
  });

  it('pads single-digit months and days', () => {
    expect(toDateInputValue('2026-01-05T00:00:00Z')).toBe('2026-01-05');
  });

  it('returns empty string for invalid input', () => {
    expect(toDateInputValue('not-a-date')).toBe('');
  });
});

describe('todayDateInput', () => {
  it('returns a yyyy-mm-dd value for date inputs', () => {
    expect(todayDateInput()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('returns plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('handles all special characters together', () => {
    expect(escapeHtml('<a>&')).toBe('&lt;a&gt;&amp;');
  });
});
