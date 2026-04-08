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
  const normalized = rawPath
    .replace(/^\/?root\/#file:/i, '')
    .replace(/^\/+/, '');
  return `https://yougile.com/${normalized}`;
}

export function normalizeChatHtml(html: string): string {
  // First resolve all user-data URLs
  let result = html.replace(
    /\b(src|href)="((?:\/?root\/#file:)?\/?user-data\/[^"]+)"/gi,
    (_match, attr: string, path: string) => `${attr}="${resolveYougileFileUrl(path)}"`
  );
  // Convert <a> tags that point to image files into <img> tags
  result = result.replace(
    /<a\b[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

// ── Checklist helpers ──────────────────────────────────────────────────────

export function cloneChecklists(checklists: YougileChecklist[] | undefined): YougileChecklist[] {
  return checklists ? structuredClone(checklists) : [];
}
