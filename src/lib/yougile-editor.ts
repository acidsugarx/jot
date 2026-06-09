/**
 * Pure helper functions for the Yougile task editor.
 * No React dependencies — safe to import from any component or hook.
 */

import type { YougileChecklist } from '@/types/yougile';

// ── Date conversion ────────────────────────────────────────────────────────

export function unixMsToDateInput(ms: number | null | undefined): string {
  if (!ms) return '';
  try {
    const d = new Date(ms);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return '';
  }
}

export function dateInputToUnixMs(value: string): number | undefined {
  if (!value) return undefined;
  try {
    return new Date(value + 'T00:00:00').getTime();
  } catch {
    return undefined;
  }
}

// ── HTML / chat helpers ────────────────────────────────────────────────────

export function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(text);
}

const CHAT_IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|heic|heif|avif)(?:$|[?#])/i;

function resolveYougileFileUrl(rawPath: string): string {
  // Already a full URL — return as-is
  if (/^https?:\/\//i.test(rawPath)) return rawPath;
  // Relative path under user-data: strip leading root/#file: prefix, then prepend host
  const normalized = rawPath
    .replace(/^\/?root\/#file:/i, '')
    .replace(/^\/+/, '');
  const url = `https://yougile.com/${normalized}`;
  // Decode percent-encoded characters (e.g. %3F → ?, %5B → [, %5D → ])
  // so downstream isImageAttachmentUrl and img src get clean URLs
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

export function normalizeChatHtml(html: string): string {
  // First resolve all user-data URLs
  let result = html.replace(
    /\b(src|href)="((?:\/?root\/#file:)?\/?user-data\/[^"]+)"/gi,
    (_match, attr: string, path: string) => `${attr}="${resolveYougileFileUrl(path)}"`
  );
  // Convert <a> tags wrapping images: unwrap so inner <img> survives
  // Yougile sends: <a href="...full.png"><img src="...preview.png"></a>
  // We want: just <img src="...preview.png">
  result = result.replace(
    /<a\b[^>]*href="([^"]+)"[^>]*>((?:\s*<img[^>]*>\s*)+)<\/a>/gi,
    (_match, _href: string, innerContent: string) => innerContent
  );
  // Also handle plain <a> links to image files (no inner <img>)
  result = result.replace(
    /<a\b[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi,
    (_match, href: string, _label: string) => {
      if (CHAT_IMAGE_EXT_RE.test(href)) {
        return `<img src="${href}" alt="" style="max-width:100%;max-height:12rem;border-radius:4px;cursor:pointer" />`;
      }
      return _match;
    }
  );
  return result;
}

export interface ChatAttachment {
  url: string;
  fileName: string;
}

export function fileNameFromAttachmentUrl(url: string): string {
  const base = url.split('?')[0]?.split('#')[0] ?? url;
  const parts = base.split('/');
  const raw = parts[parts.length - 1] || base;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function extractYougileAttachment(text: string): ChatAttachment | null {
  const match = text.match(/\/(?:root\/#file:)?\/?(user-data\/[a-f0-9-]+\/[^\s]+)/i);
  if (!match?.[1]) return null;
  const url = resolveYougileFileUrl(match[1]);
  return {
    url,
    fileName: fileNameFromAttachmentUrl(url),
  };
}

export function isImageAttachmentUrl(url: string): boolean {
  return CHAT_IMAGE_EXT_RE.test(url);
}

export function getAttachmentName(attachment: File | string): string {
  if (typeof attachment !== 'string') {
    return attachment.name;
  }
  const parts = attachment.split(/[\\/]/);
  return parts[parts.length - 1] || attachment;
}

// ── Sticker helpers ────────────────────────────────────────────────────────

export function extractStickerValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    for (const key of ['title', 'name', 'value', 'id']) {
      const nested = candidate[key];
      if (typeof nested === 'string' && nested.trim()) {
        return nested;
      }
    }
  }
  return undefined;
}

export function normalizeStickerMap(stickers: Record<string, unknown> | undefined): Record<string, string> {
  if (!stickers) return {};

  return Object.entries(stickers).reduce<Record<string, string>>((acc, [key, value]) => {
    const parsed = extractStickerValue(value);
    if (parsed) {
      acc[key] = parsed;
    }
    return acc;
  }, {});
}

export function formatStickerValue(value: unknown, fallback: string): string {
  const parsed = extractStickerValue(value);
  if (parsed) {
    return parsed;
  }
  try {
    return value && typeof value === 'object' ? JSON.stringify(value) : fallback;
  } catch {
    return fallback;
  }
}

// ── Linkify helpers ───────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s<>'"`{}()\[\]\\]+/gi;

/**
 * Convert URLs and image URLs in plain text into clickable <a>/<img> markup.
 * Image URLs become inline <img> tags; other URLs become <a> tags that open
 * in the system browser (via IPC).
 */
export function linkifyText(text: string): string {
  if (looksLikeHtml(text)) return text;

  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    // Text before this URL
    if (match.index > lastIndex) {
      result += escapeHtml(text.slice(lastIndex, match.index));
    }

    const url = match[0];
    if (CHAT_IMAGE_EXT_RE.test(url)) {
      // Image URL → <img> tag (clickable for preview)
      result += `<img src="${escapeHtml(url)}" alt="" style="max-width:100%;max-height:12rem;border-radius:4px;cursor:pointer;display:block;margin:4px 0" />`;
    } else {
      // Regular URL → clickable <a>
      result += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="text-cyan-400 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-300">${escapeHtml(url)}</a>`;
    }

    lastIndex = match.index + url.length;
  }

  // Remaining text after last URL
  if (lastIndex < text.length) {
    result += escapeHtml(text.slice(lastIndex));
  }

  return result || escapeHtml(text);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Checklist helpers ──────────────────────────────────────────────────────

export function cloneChecklists(checklists: YougileChecklist[] | undefined): YougileChecklist[] {
  return checklists ? structuredClone(checklists) : [];
}
