import { useMemo, useRef } from 'react';

interface HighlightedInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  className?: string;
}

export function HighlightedInput({
  value,
  onChange,
  onKeyDown,
  placeholder = '',
  className = '',
}: HighlightedInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const highlightedHTML = useMemo(() => {
    if (!value) {
      return `<span class="text-mist/26">${placeholder}</span>`;
    }

    // Escape HTML entities before applying highlight regexes
    let html = value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // Highlight tags (#tag)
    html = html.replace(/(^|\s)(#[\w-]+)/g, '$1<span class="text-cyan/80 font-mono">$2</span>');

    // Highlight priority (!low, !medium, !high, !urgent)
    html = html.replace(
      /(^|\s)(!(?:low|medium|high|urgent))/gi,
      '$1<span class="text-orange-400/90 font-mono">$2</span>'
    );

    // Highlight @zettel
    html = html.replace(
      /(^|\s)(@zettel)/gi,
      '$1<span class="text-purple-400/90 font-mono">$2</span>'
    );

    // Highlight dates/times (today, tomorrow, at 10am, etc.)
    html = html.replace(
      /(^|\s)(today|tomorrow)(\s|$)/gi,
      '$1<span class="text-yellow-400/90 font-mono">$2</span>$3'
    );
    html = html.replace(
      /(at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/gi,
      '<span class="text-yellow-400/90 font-mono">$1</span>'
    );

    return html;
  }, [value, placeholder]);

  return (
    <div className="relative">
      {/* Highlighted text layer (behind input) */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words [word-spacing:var(--highlighted-word-spacing,0)]"
        style={{
          wordSpacing: 'var(--highlighted-word-spacing, 0)',
        }}
        dangerouslySetInnerHTML={{ __html: highlightedHTML }}
      />
      {/* Actual input (transparent text, caret visible) */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder=""
        className={`relative z-10 w-full border-0 bg-transparent text-[30px] font-medium tracking-tight text-transparent caret-mist outline-none [&::-webkit-caps-lock-indicator]:hidden ${className}`}
        style={{
          WebkitTextFillColor: 'transparent',
        }}
      />
    </div>
  );
}
