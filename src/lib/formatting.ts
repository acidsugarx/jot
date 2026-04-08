/** Tokenize input string into colored segments for syntax highlighting */
export interface Token {
  text: string;
  color: string | null; // null = default text color
}

export function tokenize(input: string): Token[] {
  if (!input) return [];

  const tokens: Token[] = [];
  // Match #tags, !priority, @zettel
  const regex = /(#\w+|!(?:low|medium|high|urgent)\b|@zettel\b)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      tokens.push({ text: input.slice(lastIndex, match.index), color: null });
    }

    const token = match[0];
    let color: string;

    if (token.startsWith('#')) {
      color = 'rgb(34 211 238)'; // cyan-400
    } else if (token.startsWith('@')) {
      color = 'rgb(167 139 250)'; // violet-400
    } else if (token.startsWith('!')) {
      const level = token.slice(1).toLowerCase();
      if (level === 'urgent') color = 'rgb(248 113 113)'; // red-400
      else if (level === 'high') color = 'rgb(251 146 60)'; // orange-400
      else if (level === 'medium') color = 'rgb(250 204 21)'; // yellow-400
      else color = 'rgb(96 165 250)'; // blue-400
    } else {
      color = 'rgb(34 211 238)';
    }

    tokens.push({ text: token, color });
    lastIndex = regex.lastIndex;
  }

  // Remaining text
  if (lastIndex < input.length) {
    tokens.push({ text: input.slice(lastIndex), color: null });
  }

  return tokens;
}

export function toDateInputValue(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayDateInput(): string {
  return toDateInputValue(new Date().toISOString());
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
