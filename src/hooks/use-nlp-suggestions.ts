export interface NlpSuggestion {
  id: string;
  label: string;
  hint?: string;
  accentClass?: string;
  replacement: string;
}

export interface NlpSuggestionState {
  type: 'tag' | 'priority' | 'zettel';
  tokenStart: number;
  filter: string;
  suggestions: NlpSuggestion[];
}

const PRIORITY_SUGGESTIONS: NlpSuggestion[] = [
  {
    id: 'p-urgent',
    label: '!urgent',
    hint: 'Immediate action',
    accentClass: 'text-red-400',
    replacement: '!urgent',
  },
  {
    id: 'p-high',
    label: '!high',
    hint: 'This week',
    accentClass: 'text-orange-400',
    replacement: '!high',
  },
  {
    id: 'p-medium',
    label: '!medium',
    hint: 'This sprint',
    accentClass: 'text-yellow-400',
    replacement: '!medium',
  },
  {
    id: 'p-low',
    label: '!low',
    hint: 'When possible',
    accentClass: 'text-blue-400',
    replacement: '!low',
  },
];

const ZETTEL_SUGGESTIONS: NlpSuggestion[] = [
  {
    id: 'zettel',
    label: '@zettel',
    hint: 'Create linked Zettelkasten note',
    accentClass: 'text-violet-400',
    replacement: '@zettel',
  },
];

/**
 * Detect NLP autocomplete context at cursor position.
 * Returns null when the token under the cursor doesn't start with # ! or @.
 */
export function detectNlpContext(
  text: string,
  cursorPos: number,
  existingTags: string[],
): NlpSuggestionState | null {
  if (cursorPos <= 0) return null;

  // Walk back from cursor to find current token boundary
  let start = cursorPos;
  while (start > 0 && text[start - 1] !== ' ') {
    start--;
  }

  const token = text.slice(start, cursorPos);
  if (!token) return null;

  // ── #tag ──────────────────────────────────────────────────────────────────
  if (token.startsWith('#')) {
    const filter = token.slice(1).toLowerCase();

    const matched = existingTags
      .filter((tag) => tag.toLowerCase().includes(filter))
      .slice(0, 8);

    const suggestions: NlpSuggestion[] = matched.map((tag) => ({
      id: `tag-${tag}`,
      label: `#${tag}`,
      replacement: `#${tag}`,
    }));

    // Offer "create new" when no exact match
    if (
      filter.length > 0 &&
      !existingTags.some((t) => t.toLowerCase() === filter)
    ) {
      suggestions.push({
        id: 'tag-new',
        label: `#${filter}`,
        hint: 'New tag',
        replacement: `#${filter}`,
      });
    }

    if (suggestions.length === 0) return null;
    return { type: 'tag', tokenStart: start, filter, suggestions };
  }

  // ── !priority ─────────────────────────────────────────────────────────────
  if (token.startsWith('!')) {
    const filter = token.slice(1).toLowerCase();
    const suggestions = PRIORITY_SUGGESTIONS.filter((p) =>
      p.replacement.slice(1).toLowerCase().includes(filter),
    );
    if (suggestions.length === 0) return null;
    return { type: 'priority', tokenStart: start, filter, suggestions };
  }

  // ── @zettel ───────────────────────────────────────────────────────────────
  if (token.startsWith('@')) {
    const filter = token.slice(1).toLowerCase();
    const suggestions = ZETTEL_SUGGESTIONS.filter(() =>
      'zettel'.includes(filter),
    );
    if (suggestions.length === 0) return null;
    return { type: 'zettel', tokenStart: start, filter, suggestions };
  }

  return null;
}
