// ── Image Preview Overlay — full-screen image viewer ──────────────────────
//
// Extracted from YougileTaskEditor.tsx (Phase 4).
// ──────────────────────────────────────────────────────────────────────────────

interface ImagePreviewOverlayProps {
  src: string | null;
  onClose: () => void;
}

export function ImagePreviewOverlay({ src, onClose }: ImagePreviewOverlayProps) {
  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-zoom-out"
      onClick={onClose}
    >
      <img
        src={src}
        alt="Preview"
        className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        className="absolute top-4 right-4 text-white/70 hover:text-white text-3xl font-light"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
