// ── Image Preview Overlay — full-screen image viewer ──────────────────────
//
// Extracted from YougileTaskEditor.tsx (Phase 4).
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { ExternalLink } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface ImagePreviewOverlayProps {
  src: string | null;
  onClose: () => void;
}

export function ImagePreviewOverlay({ src, onClose }: ImagePreviewOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const wasFullscreen = useRef(false);

  // Enter/exit native fullscreen when overlay opens/closes
  useEffect(() => {
    if (!src) return;
    const win = getCurrentWindow();
    win.setFullscreen(true).then(() => { wasFullscreen.current = true; }).catch(() => {});
    return () => {
      if (wasFullscreen.current) {
        wasFullscreen.current = false;
        win.setFullscreen(false).catch(() => {});
      }
    };
  }, [src]);

  useEffect(() => {
    if (src) {
      overlayRef.current?.focus();
    }
  }, [src]);

  if (!src) return null;

  // Derive the full-resolution URL by stripping preview suffix
  const fullResUrl = src.replace(/-\d+-preview@\d+x\d+/i, '');

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      tabIndex={-1}
    >
      {/* Image — fills viewport while preserving aspect ratio */}
      <img
        src={src}
        alt="Preview"
        className="max-h-screen max-w-screen h-full w-full object-contain p-4"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
        <span className="font-mono text-[10px] text-white/50">Preview</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void invoke('open_url', { url: fullResUrl });
            }}
            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            title="Open original in browser"
          >
            <ExternalLink className="h-3 w-3" />
            <span>Open original</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <span className="text-lg leading-none">×</span>
          </button>
        </div>
      </div>

      {/* Close hint */}
      <div className="absolute inset-x-0 bottom-4 text-center">
        <span className="inline-block rounded bg-black/40 px-2 py-1 font-mono text-[9px] text-white/30">
          Click anywhere or press Esc to close
        </span>
      </div>
    </div>
  );
}
