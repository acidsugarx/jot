// ── Chat Panel — Yougile task discussion & file attachments ────────────────
//
// Extracted from YougileTaskEditor.tsx (Phase 4).
// ──────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  ZoomIn,
  Loader2,
  Send,
  Paperclip,
  ImageIcon,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openFileDialog, save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import { useYougileStore } from '@/store/use-yougile-store';
import { sanitizeHtml } from '@/lib/sanitize';
import { useRegisteredNormalKeyActions } from '@/lib/focus-actions';
import { ImagePreviewOverlay } from '@/components/editors';
import {
  looksLikeHtml,
  normalizeChatHtml,
  extractYougileAttachment,
  isImageAttachmentUrl,
  fileNameFromAttachmentUrl,
  getAttachmentName,
  linkifyText,
} from '@/lib/yougile-editor';
import type { YougileChatMessage } from '@/types/yougile';

// ══════════════════════════════════════════════════════════════════════════════

interface ChatMessageProps {
  msg: YougileChatMessage;
  onDownload: (url: string, fileName: string) => void;
  onPreviewImage: (url: string) => void;
}

function ChatMessage({ msg, onDownload, onPreviewImage }: ChatMessageProps) {
  const { users, companyUsers } = useYougileStore();

  const user = users.find((u) => u.id === msg.fromUserId)
    ?? companyUsers.find((u) => u.id === msg.fromUserId)
    ?? users.find((u) => u.email === msg.fromUserId)
    ?? companyUsers.find((u) => u.email === msg.fromUserId);
  const rawName = user?.realName;
  const realName = rawName && !rawName.includes('@') ? rawName : null;
  const name = realName
    || user?.email?.split('@')[0]
    || (msg.fromUserId.includes('@') ? msg.fromUserId.split('@')[0] : null)
    || msg.fromUserId.slice(0, 8);
  const time = new Date(msg.id).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  let html = msg.textHtml ?? '';
  if (html) {
    html = sanitizeHtml(normalizeChatHtml(html));
  }
  const hasHtml = html && looksLikeHtml(html);
  const attachment = !hasHtml ? extractYougileAttachment(msg.text) : null;
  const fileMarkerIndex = attachment
    ? msg.text.search(/\/(?:root\/#file:)?\/?user-data\//i)
    : -1;
  const fileLeadText = fileMarkerIndex > 0 ? msg.text.slice(0, fileMarkerIndex).trim() : '';
  const isImage = attachment ? isImageAttachmentUrl(attachment.url) : false;
  const linkified = !hasHtml && !attachment ? linkifyText(msg.text) : null;

  return (
    <div className="group">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] font-medium text-zinc-400">{name}</span>
        <span className="font-mono text-[9px] text-zinc-700">{time}</span>
      </div>
      {hasHtml ? (
        <div
          className="prose-jot prose-jot-yougile mt-0.5 text-xs leading-relaxed text-zinc-400 [&_img]:max-w-full [&_img]:max-h-48 [&_img]:rounded [&_img]:my-1 [&_img]:cursor-pointer"
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={(e) => {
            const img = (e.target as HTMLElement).closest('img');
            if (img?.src) { onPreviewImage(img.src); return; }
            const anchor = (e.target as HTMLElement).closest('a');
            if (anchor?.href) {
              e.preventDefault();
              const href = anchor.href;
              if (href.includes('yougile.com/user-data/') || href.includes('/root/#file:')) {
                void onDownload(href, fileNameFromAttachmentUrl(href));
              } else {
                void invoke('open_url', { url: href });
              }
            }
          }}
        />
      ) : attachment ? (
        <div className="mt-0.5">
          {fileLeadText && (
            <div className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
              {fileLeadText}
            </div>
          )}
          {isImage ? (
            <div className="group/img relative mt-1 inline-block">
              <img
                src={attachment.url}
                alt=""
                className="max-w-full max-h-48 rounded cursor-pointer"
                onClick={() => onPreviewImage(attachment.url)}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <button
                type="button"
                onClick={() => onPreviewImage(attachment.url)}
                className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover/img:opacity-100"
              >
                <ZoomIn className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void onDownload(attachment.url, attachment.fileName)}
              className="mt-1 inline-flex items-center font-mono text-xs text-cyan-400 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-300"
            >
              {attachment.fileName}
            </button>
          )}
        </div>
      ) : linkified ? (
        <div
          className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-zinc-400"
          onClick={(e) => {
            const img = (e.target as HTMLElement).closest('img');
            if (img?.src) { onPreviewImage(img.src); return; }
            const anchor = (e.target as HTMLElement).closest('a');
            if (anchor?.href) {
              e.preventDefault();
              void invoke('open_url', { url: anchor.href });
            }
          }}
          dangerouslySetInnerHTML={{ __html: linkified }}
        />
      ) : (
        <div className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
          {msg.text}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════

interface ChatPanelProps {
  taskId: string;
  show: boolean;
  onClose: () => void;
  onPreviewImage?: (url: string) => void;
}

export function ChatPanel({ taskId, show, onClose, onPreviewImage: onPreviewImageExternal }: ChatPanelProps) {
  const {
    chatMessages,
    chatLoading,
    sendChatMessage,
    sendChatWithAttachments,
    fetchChatMessages,
    fetchCompanyUsers,
  } = useYougileStore();

  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<Array<File | string>>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch chat when opening
  useEffect(() => {
    if (show) {
      void fetchChatMessages(taskId);
      void fetchCompanyUsers();
    }
  }, [show, taskId, fetchChatMessages, fetchCompanyUsers]);

  // Scroll to bottom when messages update
  useEffect(() => {
    if (show) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, show]);

  // Focus engine for the chat input
  useRegisteredNormalKeyActions(`chat-panel:${taskId}`, {
    onEscape: () => {
      if (chatInput) {
        setChatInput('');
      } else {
        onClose();
      }
    },
  });

  const handleSendMessage = useCallback(async () => {
    const text = chatInput.trim();
    if (!text && pendingFiles.length === 0) return;
    setChatSending(true);
    let ok: boolean | YougileChatMessage | null;
    if (pendingFiles.length > 0) {
      ok = await sendChatWithAttachments(taskId, text, pendingFiles);
    } else {
      ok = await sendChatMessage(taskId, text);
    }
    setChatSending(false);
    if (ok) {
      setChatInput('');
      setPendingFiles([]);
      void fetchChatMessages(taskId);
      requestAnimationFrame(() => chatInputRef.current?.focus());
    }
  }, [chatInput, pendingFiles, sendChatMessage, sendChatWithAttachments, fetchChatMessages, taskId]);

  const handlePreviewImage = useCallback((url: string) => {
    if (onPreviewImageExternal) {
      onPreviewImageExternal(url);
    } else {
      setPreviewImage(url);
    }
  }, [onPreviewImageExternal]);

  const handleDownloadFile = useCallback(async (url: string, fileName: string) => {
    try {
      const savePath = await saveFileDialog({
        title: 'Save file',
        defaultPath: fileName,
      });
      if (!savePath) return;
      await invoke('yougile_download_file', { url, savePath });
    } catch (e) {
      console.error('Download failed:', e);
    }
  }, []);

  const handlePasteImage = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      setPendingFiles((prev) => [...prev, ...imageFiles]);
    }
  }, []);

  const handlePickFiles = useCallback(async () => {
    try {
      const selected = await openFileDialog({
        multiple: true,
        title: 'Attach files',
      });
      if (selected == null) return;
      const next = Array.isArray(selected) ? selected : [selected];
      const paths = next.filter((path): path is string => typeof path === 'string');
      if (paths.length > 0) {
        setPendingFiles((prev) => [...prev, ...paths]);
      }
    } catch {
      fileInputRef.current?.click();
    }
  }, []);

  if (!show) return null;

  return (
    <div className="flex min-h-0 flex-col border-t border-zinc-800/40">
      {/* Local image preview (fallback when no external onPreviewImage) */}
      {previewImage && !onPreviewImageExternal && (
        <ImagePreviewOverlay
          src={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      )}
      {/* Messages list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {chatLoading && chatMessages.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
          </div>
        ) : chatMessages.length === 0 ? (
          <div className="py-6 text-center font-mono text-[10px] text-zinc-700">
            No messages yet
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {chatMessages.map((msg) => (
              <ChatMessage
                key={msg.id}
                msg={msg}
                onDownload={handleDownloadFile}
                onPreviewImage={handlePreviewImage}
              />
            ))}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-zinc-800/30 px-4 py-2">
        {/* Pending file previews */}
        {pendingFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pendingFiles.map((f, i) => (
              <div key={i} className="group relative flex items-center gap-1 rounded bg-zinc-800/60 px-2 py-1 text-[10px] text-zinc-400">
                <ImageIcon className="h-3 w-3 shrink-0" />
                <span className="max-w-[100px] truncate">{getAttachmentName(f)}</span>
                <button
                  type="button"
                  onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  className="ml-0.5 text-zinc-600 hover:text-zinc-300"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              setPendingFiles((prev) => [...prev, ...Array.from(files)]);
            }
            e.target.value = '';
          }}
        />
        <div className="flex items-end gap-2">
          <textarea
            ref={chatInputRef}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onPaste={handlePasteImage}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSendMessage();
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                setChatInput('');
                onClose();
              }
            }}
            rows={1}
            placeholder="Write a message…"
            className="min-h-[28px] flex-1 resize-none rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-zinc-700"
          />
          <button
            type="button"
            onClick={() => void handlePickFiles()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
            title="Attach file"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={chatSending || (!chatInput.trim() && pendingFiles.length === 0)}
            onClick={() => void handleSendMessage()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-cyan-500/10 text-cyan-400 transition-colors hover:bg-cyan-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {chatSending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
