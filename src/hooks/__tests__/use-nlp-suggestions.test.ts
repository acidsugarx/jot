import { describe, expect, it } from 'vitest';

import { detectNlpContext } from '@/hooks/use-nlp-suggestions';

describe('detectNlpContext', () => {
  const tags = ['bug', 'feature', 'frontend', 'auth', 'ux'];

  it('detects tag token at end of input', () => {
    const state = detectNlpContext('Fix login #b', 'Fix login #b'.length, tags);
    expect(state).not.toBeNull();
    expect(state!.type).toBe('tag');
    expect(state!.filter).toBe('b');
    // #b matches "bug" by substring + offers create-new #b (no exact match)
    expect(state!.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(state!.suggestions[0]!.label).toBe('#bug');
  });

  it('shows all tags when just # is typed', () => {
    const state = detectNlpContext('Fix login #', 'Fix login #'.length, tags);
    expect(state).not.toBeNull();
    expect(state!.type).toBe('tag');
    expect(state!.filter).toBe('');
    expect(state!.suggestions.length).toBe(5);
  });

  it('offers create-new when no existing tag matches', () => {
    const state = detectNlpContext('Fix login #xyz', 'Fix login #xyz'.length, tags);
    expect(state).not.toBeNull();
    expect(state!.suggestions).toHaveLength(1);
    expect(state!.suggestions[0]!.hint).toBe('New tag');
    expect(state!.suggestions[0]!.label).toBe('#xyz');
  });

  it('does not offer create-new for exact match', () => {
    const state = detectNlpContext('Fix login #bug', 'Fix login #bug'.length, tags);
    expect(state).not.toBeNull();
    const hasNew = state!.suggestions.some((s) => s.id === 'tag-new');
    expect(hasNew).toBe(false);
  });

  it('detects priority token at end of input', () => {
    const state = detectNlpContext('Ship feature !h', 'Ship feature !h'.length, tags);
    expect(state).not.toBeNull();
    expect(state!.type).toBe('priority');
    expect(state!.filter).toBe('h');
    expect(state!.suggestions.length).toBeGreaterThan(0);
    expect(state!.suggestions.map((s) => s.label)).toContain('!high');
  });

  it('shows all priorities when just ! is typed', () => {
    const state = detectNlpContext('Ship feature !', 'Ship feature !'.length, tags);
    expect(state).not.toBeNull();
    expect(state!.type).toBe('priority');
    expect(state!.suggestions).toHaveLength(4);
  });

  it('detects @zettel token', () => {
    const state = detectNlpContext('Write note @z', 'Write note @z'.length, tags);
    expect(state).not.toBeNull();
    expect(state!.type).toBe('zettel');
    expect(state!.suggestions[0]!.label).toBe('@zettel');
  });

  it('returns null for plain text token', () => {
    const state = detectNlpContext('Fix login bug', 'Fix login bug'.length, tags);
    expect(state).toBeNull();
  });

  it('returns null for empty input', () => {
    const state = detectNlpContext('', 0, tags);
    expect(state).toBeNull();
  });

  it('returns null when no tags exist and # is typed', () => {
    const state = detectNlpContext('Fix #', 'Fix #'.length, []);
    expect(state).toBeNull();
  });

  it('returns null when no priorities match filter', () => {
    const state = detectNlpContext('Fix !xyz', 'Fix !xyz'.length, tags);
    expect(state).toBeNull();
  });

  it('tracks correct tokenStart for replacement', () => {
    const state = detectNlpContext('Fix login #b', 'Fix login #b'.length, tags);
    expect(state!.tokenStart).toBe(10); // index of '#'
  });

  it('matches tags case-insensitively', () => {
    const state = detectNlpContext('Fix #F', 'Fix #F'.length, tags);
    expect(state).not.toBeNull();
    expect(state!.suggestions.some((s) => s.label === '#feature')).toBe(true);
    expect(state!.suggestions.some((s) => s.label === '#frontend')).toBe(true);
  });
});
