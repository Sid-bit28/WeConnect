import React, { useState, useRef, useEffect } from 'react';
import {
  Hash,
  Volume2,
  Video,
  Users,
  ArrowUp,
  AlertCircle,
  RefreshCw,
  AtSign,
  Loader2,
  Paperclip,
  Smile,
  FileText,
  Download,
  X,
  Upload,
  Reply,
  Pencil,
  Trash2,
  Search,
  CornerUpLeft,
  Lock,
  UserPlus,
  Check,
} from 'lucide-react';
import clsx from 'clsx';
import type {
  Message,
  MessageData,
  ConnectionStatus,
  Attachment,
  StickerData,
  GifData,
  ReplyToData,
  UserProfile,
  Friend,
} from '../types';
import { getApiBaseUrl } from '../utils/api';
import { MarkdownContent } from '../utils/markdown';
import { getStickerById, getStickerSvgDataUri } from '../utils/stickers';
import { ImageLightbox } from './ImageLightbox';
import { ExpressionPicker } from './ExpressionPicker';
import { UserAvatar } from './UserAvatar';

interface ChatAreaProps {
  roomId: string;
  channelName: string;
  channelType?: 'text' | 'voice';
  channelTopic?: string;
  token: string;
  isDm?: boolean;
  isPrivate?: boolean;
  isChannelCreator?: boolean;
  channelMembers?: string[];
  friends?: Friend[];
  profiles?: Record<string, UserProfile>;
  onInviteMember?: (username: string) => Promise<string | null>;
  isLoadingHistory?: boolean;
  messages: Message[];
  currentUsername: string;
  connectionStatus: ConnectionStatus;
  errorMessage?: string | null;
  isInCall?: boolean;
  isCallViewActive?: boolean;
  memberCount?: number;
  typingUsers?: string[];
  onSendMessage: (content: string, data?: MessageData) => void;
  onTyping?: (isTyping: boolean) => void;
  onReconnect?: () => void;
  onToggleUserList?: () => void;
  onToggleCallView?: () => void;
  onJoinCall?: () => void;
  showUserList?: boolean;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const TYPING_THROTTLE_MS = 1500;
const TYPING_IDLE_MS = 2500;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '👀'];

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFileExtensionLabel(name: string, mimeType: string): string {
  const parts = name.split('.');
  if (parts.length > 1) {
    return parts[parts.length - 1].slice(0, 6).toUpperCase();
  }
  const mimePart = mimeType.split('/')[1];
  return (mimePart || 'FILE').slice(0, 6).toUpperCase();
}

function resolveMediaUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  return `${getApiBaseUrl()}${url}`;
}

function getReplyPreview(msg: Message): string {
  const trimmed = (msg.content || '').trim();
  if (trimmed) {
    return trimmed.length > 80 ? `${trimmed.slice(0, 80)}...` : trimmed;
  }
  const data = (msg.data || {}) as MessageData;
  if (data.attachment) {
    return data.attachment.isImage ? 'Image attachment' : `File: ${data.attachment.name}`;
  }
  if (data.sticker) return `Sticker: ${data.sticker.label}`;
  if (data.gif) return `GIF: ${data.gif.title || 'Animation'}`;
  return 'Message';
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  roomId,
  channelName,
  channelType = 'text',
  channelTopic,
  token,
  isDm = false,
  isPrivate = false,
  isChannelCreator = false,
  channelMembers = [],
  friends = [],
  profiles = {},
  onInviteMember,
  isLoadingHistory = false,
  messages,
  currentUsername,
  connectionStatus,
  errorMessage,
  isInCall = false,
  isCallViewActive = false,
  memberCount = 1,
  typingUsers = [],
  onSendMessage,
  onTyping,
  onReconnect,
  onToggleUserList,
  onToggleCallView,
  onJoinCall,
  showUserList = true,
}) => {
  const [inputText, setInputText] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<Attachment | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);

  // Reply, Edit, Highlight, Search & Invite states
  const [replyingTo, setReplyingTo] = useState<ReplyToData | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [invitingUser, setInvitingUser] = useState<string | null>(null);
  const [invitedFeedback, setInvitedFeedback] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const invitePopoverRef = useRef<HTMLDivElement | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef<number>(0);
  const lastTypingEmitRef = useRef<number>(0);
  const typingIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCurrentlyTypingRef = useRef<boolean>(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Close invite popover on click-outside or Escape
  useEffect(() => {
    if (!isInviteOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsInviteOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (invitePopoverRef.current && !invitePopoverRef.current.contains(e.target as Node)) {
        setIsInviteOpen(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isInviteOpen]);

  // Reset per-room interactive states when switching rooms
  useEffect(() => {
    setUploadError(null);
    setReplyingTo(null);
    setEditingMessageId(null);
    setEditDraft('');
    setIsSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setIsInviteOpen(false);
    setInviteError(null);
    setInvitedFeedback(null);
    return () => {
      if (typingIdleTimeoutRef.current) {
        clearTimeout(typingIdleTimeoutRef.current);
        typingIdleTimeoutRef.current = null;
      }
      if (isCurrentlyTypingRef.current && onTyping) {
        isCurrentlyTypingRef.current = false;
        onTyping(false);
      }
    };
  }, [roomId, onTyping]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  // Debounced message search
  useEffect(() => {
    if (!isSearchOpen) return;
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    let isCancelled = false;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/api/messages/search?room=${encodeURIComponent(roomId)}&q=${encodeURIComponent(trimmed)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            signal: controller.signal,
          }
        );
        if (res.ok && !isCancelled) {
          const data = await res.json();
          setSearchResults(Array.isArray(data?.messages) ? data.messages : []);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError' && !isCancelled) {
          setSearchResults([]);
        }
      } finally {
        if (!isCancelled) setIsSearching(false);
      }
    }, 250);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [isSearchOpen, searchQuery, roomId, token]);

  const scrollToMessage = (msgId: string) => {
    const el = messageRefs.current.get(msgId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMsgId(msgId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedMsgId((prev) => (prev === msgId ? null : prev));
    }, 1600);
  };

  const stopTypingSignal = () => {
    if (typingIdleTimeoutRef.current) {
      clearTimeout(typingIdleTimeoutRef.current);
      typingIdleTimeoutRef.current = null;
    }
    if (isCurrentlyTypingRef.current && onTyping) {
      isCurrentlyTypingRef.current = false;
      lastTypingEmitRef.current = 0;
      onTyping(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputText(value);

    if (!onTyping || connectionStatus !== 'connected') return;

    if (!value.trim()) {
      stopTypingSignal();
      return;
    }

    const now = Date.now();
    if (!isCurrentlyTypingRef.current || now - lastTypingEmitRef.current >= TYPING_THROTTLE_MS) {
      isCurrentlyTypingRef.current = true;
      lastTypingEmitRef.current = now;
      onTyping(true);
    }

    if (typingIdleTimeoutRef.current) {
      clearTimeout(typingIdleTimeoutRef.current);
    }
    typingIdleTimeoutRef.current = setTimeout(() => {
      stopTypingSignal();
    }, TYPING_IDLE_MS);
  };

  const uploadFile = async (file: File) => {
    setUploadError(null);

    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError('File exceeds the 10MB upload limit.');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${getApiBaseUrl()}/api/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadError(data.error || data.message || `Upload failed (${res.status}).`);
        return;
      }

      const attachment: Attachment = {
        url: data.url,
        name: data.name || file.name,
        size: typeof data.size === 'number' ? data.size : file.size,
        mimeType: data.mimeType || file.type || 'application/octet-stream',
        isImage: Boolean(data.isImage),
      };

      setPendingAttachment(attachment);
      inputRef.current?.focus();
    } catch (err: any) {
      setUploadError(err?.message || 'Network error while uploading file.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void uploadFile(file);
    }
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void uploadFile(file);
          return;
        }
      }
    }
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      dragDepthRef.current += 1;
      setIsDragging(true);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    if (connectionStatus !== 'connected') return;

    const file = e.dataTransfer.files?.[0];
    if (file) {
      void uploadFile(file);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape' && replyingTo) {
      setReplyingTo(null);
    }
  };

  const handleSubmit = () => {
    const trimmed = inputText.trim();
    if (!trimmed && !pendingAttachment) return;
    if (connectionStatus !== 'connected') return;

    stopTypingSignal();
    const data: MessageData = {};
    if (pendingAttachment) data.attachment = pendingAttachment;
    if (replyingTo) data.replyTo = replyingTo;

    onSendMessage(trimmed, Object.keys(data).length > 0 ? data : undefined);
    setInputText('');
    setPendingAttachment(null);
    setReplyingTo(null);
    setUploadError(null);
  };

  const handleSelectEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
    inputRef.current?.focus();
  };

  const handleSelectSticker = (sticker: StickerData) => {
    if (connectionStatus !== 'connected') return;
    stopTypingSignal();
    const data: MessageData = { sticker };
    if (replyingTo) data.replyTo = replyingTo;
    onSendMessage('', data);
    setReplyingTo(null);
  };

  const handleSelectGif = (gif: GifData) => {
    if (connectionStatus !== 'connected') return;
    stopTypingSignal();
    const data: MessageData = { gif };
    if (replyingTo) data.replyTo = replyingTo;
    onSendMessage('', data);
    setReplyingTo(null);
  };

  const handleToggleReaction = async (msgId: string, emoji: string) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/messages/react`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: msgId, room: roomId, emoji }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setUploadError(data.error || 'Failed to update reaction.');
      }
    } catch {
      setUploadError('Network error while updating reaction.');
    }
  };

  const handleStartEdit = (msg: Message) => {
    if (!msg.id) return;
    setEditingMessageId(msg.id);
    setEditDraft(msg.content || '');
    setUploadError(null);
  };

  const handleSaveEdit = async (msgId: string) => {
    const trimmed = editDraft.trim();
    if (!trimmed) {
      setUploadError('Message content cannot be empty.');
      return;
    }

    setIsSavingEdit(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/messages`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: msgId, room: roomId, content: trimmed }),
      });
      if (res.ok) {
        setEditingMessageId(null);
        setEditDraft('');
      } else {
        const data = await res.json().catch(() => ({}));
        setUploadError(data.error || 'Failed to edit message.');
      }
    } catch {
      setUploadError('Network error while editing message.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/messages?id=${encodeURIComponent(msgId)}&room=${encodeURIComponent(roomId)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setUploadError(data.error || 'Failed to delete message.');
      }
    } catch {
      setUploadError('Network error while deleting message.');
    }
  };

  const formatTypingText = (users: string[]) => {
    if (users.length === 0) return '';
    if (users.length === 1) return `${users[0]} is typing...`;
    if (users.length === 2) return `${users[0]} and ${users[1]} are typing...`;
    return `${users[0]}, ${users[1]} and ${users.length - 2} other${users.length - 2 > 1 ? 's' : ''} are typing...`;
  };

  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const invitableFriends = friends.filter(
    (f) => !channelMembers.some((m) => m.toLowerCase() === f.username.toLowerCase())
  );

  const handleInviteFriend = async (targetUsername: string) => {
    if (!onInviteMember) return;
    setInvitingUser(targetUsername);
    setInviteError(null);
    setInvitedFeedback(null);
    const err = await onInviteMember(targetUsername);
    setInvitingUser(null);
    if (err) {
      setInviteError(err);
    } else {
      setInvitedFeedback(`Invited ${targetUsername}`);
    }
  };

  const renderHoverActions = (msg: Message, isAuthor: boolean) => {
    if (!msg.id || editingMessageId === msg.id) return null;
    const msgId = msg.id;

    return (
      <div className="absolute -top-3 right-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-20 flex items-center space-x-0.5 bg-surface/95 backdrop-blur-md border border-white/[0.1] rounded-lg px-1 py-0.5 shadow-lg">
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => void handleToggleReaction(msgId, emoji)}
            className="w-6 h-6 rounded-md hover:bg-card flex items-center justify-center text-xs transition-transform active:scale-90"
            title={`React ${emoji}`}
          >
            {emoji}
          </button>
        ))}

        <div className="w-[1px] h-3.5 bg-white/[0.08] mx-0.5" />

        <button
          type="button"
          onClick={() => {
            setReplyingTo({
              id: msgId,
              sender: msg.sender,
              content: getReplyPreview(msg),
            });
            inputRef.current?.focus();
          }}
          className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-card transition-colors"
          title="Reply"
        >
          <Reply className="w-3.5 h-3.5" />
        </button>

        {isAuthor && (
          <>
            {msg.content !== undefined && msg.content !== '' && (
              <button
                type="button"
                onClick={() => handleStartEdit(msg)}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-card transition-colors"
                title="Edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleDeleteMessage(msgId)}
              className="p-1 rounded-md text-text-muted hover:text-danger hover:bg-danger-muted transition-colors"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    );
  };

  const renderMessageRichBody = (msg: Message, showInlineEditedTag: boolean) => {
    const data = (msg.data || {}) as MessageData;
    const attachments: Attachment[] = [];
    if (data.attachment) attachments.push(data.attachment);
    if (Array.isArray(data.attachments)) attachments.push(...data.attachments);

    const stickerDef = data.sticker?.id ? getStickerById(data.sticker.id) : undefined;
    const gif = data.gif;
    const reactions = data.reactions || {};
    const reactionEntries = Object.entries(reactions).filter(
      ([, userList]) => Array.isArray(userList) && userList.length > 0
    );
    const isEditing = Boolean(msg.id && editingMessageId === msg.id);

    return (
      <div className="space-y-1.5 mt-0.5">
        {/* Quoted Reply Header */}
        {data.replyTo && (
          <button
            type="button"
            onClick={() => data.replyTo?.id && scrollToMessage(data.replyTo.id)}
            className="flex items-center space-x-1.5 text-[11px] text-text-muted hover:text-text-secondary bg-surface/60 border-l-2 border-accent/60 pl-2 pr-2.5 py-0.5 rounded-r-md max-w-full transition-colors text-left"
          >
            <CornerUpLeft className="w-3 h-3 text-accent flex-shrink-0" />
            <span className="font-semibold text-text-secondary flex-shrink-0">
              @{data.replyTo.sender}
            </span>
            <span className="truncate opacity-80">{data.replyTo.content}</span>
          </button>
        )}

        {/* Inline Edit Input OR Markdown Text */}
        {isEditing && msg.id ? (
          <div className="space-y-1.5 max-w-xl pt-0.5">
            <input
              type="text"
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              disabled={isSavingEdit}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSaveEdit(msg.id!);
                } else if (e.key === 'Escape') {
                  setEditingMessageId(null);
                  setEditDraft('');
                }
              }}
              className="w-full bg-input text-text-primary px-3 py-1.5 rounded-lg border border-accent/60 focus:outline-none text-sm"
            />
            <div className="flex items-center space-x-2 text-[10px] text-text-muted">
              <span>Press Enter to save, Esc to cancel</span>
              <span>·</span>
              <button
                type="button"
                disabled={isSavingEdit}
                onClick={() => void handleSaveEdit(msg.id!)}
                className="text-accent hover:underline font-medium"
              >
                {isSavingEdit ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                disabled={isSavingEdit}
                onClick={() => {
                  setEditingMessageId(null);
                  setEditDraft('');
                }}
                className="text-text-secondary hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          msg.content && (
            <div className="text-sm text-text-primary/90 break-words leading-relaxed">
              <MarkdownContent content={msg.content} />
              {showInlineEditedTag && data.edited && (
                <span className="ml-1.5 text-[10px] text-text-muted select-none">(edited)</span>
              )}
            </div>
          )
        )}

        {/* Vector Sticker */}
        {stickerDef && (
          <div className="pt-0.5">
            <img
              src={getStickerSvgDataUri(stickerDef)}
              alt={stickerDef.label}
              title={stickerDef.label}
              className="w-28 h-28 object-contain select-none"
            />
          </div>
        )}

        {/* GIF */}
        {gif?.url && (
          <div className="pt-0.5">
            <button
              type="button"
              onClick={() => setLightboxImage({ src: gif.url, alt: gif.title || 'GIF' })}
              className="block rounded-xl overflow-hidden border border-white/[0.08] hover:border-accent/40 transition-colors bg-surface max-w-xs cursor-zoom-in"
            >
              <img
                src={gif.url}
                alt={gif.title || 'GIF'}
                loading="lazy"
                className="max-h-60 w-auto object-contain"
              />
            </button>
          </div>
        )}

        {/* File & Image Attachments */}
        {attachments.map((att, idx) => {
          const resolvedUrl = resolveMediaUrl(att.url);
          if (att.isImage) {
            return (
              <div key={`${att.url}-${idx}`} className="pt-0.5">
                <button
                  type="button"
                  onClick={() => setLightboxImage({ src: resolvedUrl, alt: att.name })}
                  className="block rounded-xl overflow-hidden border border-white/[0.08] hover:border-accent/40 transition-colors bg-surface max-w-sm cursor-zoom-in"
                >
                  <img
                    src={resolvedUrl}
                    alt={att.name}
                    loading="lazy"
                    className="max-h-72 w-auto object-contain"
                  />
                </button>
              </div>
            );
          }

          return (
            <div
              key={`${att.url}-${idx}`}
              className="flex items-center justify-between space-x-3 p-3 rounded-xl bg-surface border border-white/[0.08] max-w-sm"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-accent-muted border border-accent/20 flex items-center justify-center flex-shrink-0 text-accent">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-text-primary truncate" title={att.name}>
                    {att.name}
                  </div>
                  <div className="flex items-center space-x-1.5 text-[10px] text-text-muted mt-0.5">
                    <span className="px-1.5 py-0.2 rounded bg-card border border-white/[0.06] font-mono text-text-secondary">
                      {getFileExtensionLabel(att.name, att.mimeType)}
                    </span>
                    <span>{formatFileSize(att.size)}</span>
                  </div>
                </div>
              </div>

              <a
                href={resolvedUrl}
                download={att.name}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-lg bg-card hover:bg-accent text-text-secondary hover:text-white transition-colors flex-shrink-0"
                title={`Download ${att.name}`}
              >
                <Download className="w-3.5 h-3.5" />
              </a>
            </div>
          );
        })}

        {/* Reaction Pills */}
        {reactionEntries.length > 0 && msg.id && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {reactionEntries.map(([emoji, reactors]) => {
              const reactedByMe = reactors.some(
                (u) => u.toLowerCase() === currentUsername.toLowerCase()
              );
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => void handleToggleReaction(msg.id!, emoji)}
                  className={clsx(
                    'inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] border transition-colors select-none',
                    reactedByMe
                      ? 'bg-accent-muted border-accent/45 text-indigo-200'
                      : 'bg-surface border-white/[0.08] text-text-secondary hover:border-white/[0.16]'
                  )}
                  title={reactors.join(', ')}
                >
                  <span>{emoji}</span>
                  <span className="font-medium text-[10px]">{reactors.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const canSend =
    connectionStatus === 'connected' &&
    !isUploading &&
    (Boolean(inputText.trim()) || Boolean(pendingAttachment));

  return (
    <div
      className="flex-1 flex flex-col bg-canvas h-full min-w-0 relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & Drop Upload Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-40 bg-canvas/85 backdrop-blur-sm border-2 border-dashed border-accent/70 m-3 rounded-2xl flex flex-col items-center justify-center pointer-events-none select-none">
          <div className="w-12 h-12 rounded-2xl bg-accent/15 border border-accent/30 flex items-center justify-center mb-3 text-accent">
            <Upload className="w-5 h-5" />
          </div>
          <div className="text-sm font-semibold text-text-primary">Drop file to upload</div>
          <div className="text-xs text-text-muted mt-1">
            Images, PDFs, and documents up to 10MB
          </div>
        </div>
      )}

      {/* Refined Minimal Channel Header */}
      <header className="h-14 border-b border-white/[0.07] px-6 flex items-center justify-between bg-canvas/80 backdrop-blur-md z-20 flex-shrink-0">
        <div className="flex items-center space-x-2.5 min-w-0">
          {isDm ? (
            <AtSign className="w-4 h-4 text-accent flex-shrink-0" />
          ) : isPrivate ? (
            <Lock className="w-4 h-4 text-accent flex-shrink-0" />
          ) : channelType === 'voice' ? (
            <Volume2 className="w-4 h-4 text-text-muted flex-shrink-0" />
          ) : (
            <Hash className="w-4 h-4 text-text-muted flex-shrink-0" />
          )}
          <h2 className="font-semibold text-sm text-text-primary tracking-tight truncate">
            {channelName}
          </h2>
          {isPrivate && !isDm && (
            <span className="text-[10px] font-medium text-accent bg-accent-muted px-1.5 py-0.5 rounded-md flex-shrink-0">
              Private
            </span>
          )}
          {(isDm || channelTopic) && (
            <>
              <span className="text-white/10 hidden sm:inline">/</span>
              <span className="text-xs text-text-muted truncate max-w-md hidden sm:inline">
                {isDm ? 'Direct Message' : channelTopic}
              </span>
            </>
          )}
        </div>

        {/* Purposeful Actions Only */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          {/* Creator-Only Private Group Invite Button */}
          {isPrivate && isChannelCreator && onInviteMember && (
            <div className="relative" ref={invitePopoverRef}>
              <button
                type="button"
                onClick={() => {
                  setIsInviteOpen((prev) => !prev);
                  setInviteError(null);
                  setInvitedFeedback(null);
                }}
                className={clsx(
                  'px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center space-x-1.5 transition-all',
                  isInviteOpen
                    ? 'bg-card border-accent/50 text-accent'
                    : 'bg-surface hover:bg-card border-white/[0.08] text-text-primary'
                )}
                title="Invite friends to this private group"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Invite</span>
              </button>

              {isInviteOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-surface/95 backdrop-blur-xl border border-white/[0.1] rounded-2xl shadow-2xl p-3 z-30 select-none">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-2 px-1">
                    Invite Friends
                  </div>

                  {inviteError && (
                    <div className="mb-2 px-2 py-1.5 rounded-lg bg-danger-muted border border-danger/25 text-[11px] text-danger">
                      {inviteError}
                    </div>
                  )}

                  {invitedFeedback && (
                    <div className="mb-2 px-2 py-1.5 rounded-lg bg-online/10 border border-online/25 text-[11px] text-online flex items-center space-x-1.5">
                      <Check className="w-3 h-3" />
                      <span>{invitedFeedback}</span>
                    </div>
                  )}

                  {invitableFriends.length === 0 ? (
                    <div className="text-xs text-text-muted px-1 py-2">
                      All of your friends are already in this group.
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {invitableFriends.map((friend) => {
                        const fp = profiles[friend.username.toLowerCase()];
                        const isBusy = invitingUser === friend.username;
                        return (
                          <div
                            key={friend.username}
                            className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-card/60 transition-colors"
                          >
                            <div className="flex items-center space-x-2 min-w-0">
                              <UserAvatar
                                username={friend.username}
                                avatarUrl={fp?.avatarUrl || friend.avatarUrl}
                                size="xs"
                              />
                              <span className="text-xs text-text-primary truncate">
                                {friend.username}
                              </span>
                            </div>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleInviteFriend(friend.username)}
                              className="px-2 py-1 rounded-md bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-[10px] font-medium transition-colors flex-shrink-0"
                            >
                              {isBusy ? '...' : 'Invite'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Search Toggle */}
          <button
            type="button"
            onClick={() => {
              setIsSearchOpen((prev) => !prev);
              setSearchQuery('');
              setSearchResults([]);
            }}
            className={clsx(
              'p-1.5 rounded-lg border text-xs transition-all',
              isSearchOpen
                ? 'bg-card border-accent/40 text-accent'
                : 'bg-transparent border-transparent text-text-muted hover:text-text-primary hover:bg-surface'
            )}
            title="Search messages"
          >
            <Search className="w-4 h-4" />
          </button>

          {isInCall ? (
            <button
              type="button"
              onClick={onToggleCallView}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-all',
                isCallViewActive
                  ? 'bg-accent text-white hover:bg-accent-hover'
                  : 'bg-online/15 text-online border border-online/25 hover:bg-online/25'
              )}
            >
              <Video className="w-3.5 h-3.5" />
              <span>{isCallViewActive ? 'Back to Chat' : 'Call Stage'}</span>
            </button>
          ) : (
            onJoinCall && (
              <button
                type="button"
                onClick={onJoinCall}
                className="px-3 py-1.5 rounded-lg bg-surface hover:bg-card border border-white/[0.08] text-text-primary text-xs font-medium flex items-center space-x-1.5 transition-all"
              >
                <Video className="w-3.5 h-3.5 text-online" />
                <span>Join Call</span>
              </button>
            )
          )}

          {onToggleUserList && (
            <button
              type="button"
              onClick={onToggleUserList}
              className={clsx(
                'px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center space-x-1.5 transition-all',
                showUserList
                  ? 'bg-card border-white/[0.1] text-text-primary'
                  : 'bg-transparent border-transparent text-text-muted hover:text-text-primary hover:bg-surface'
              )}
              title="Toggle Member List"
            >
              <Users className="w-3.5 h-3.5" />
              <span>{memberCount}</span>
            </button>
          )}
        </div>
      </header>

      {/* Inline Search Panel */}
      {isSearchOpen && (
        <div className="border-b border-white/[0.07] bg-surface/90 backdrop-blur-md px-6 py-3 z-10 flex-shrink-0">
          <div className="max-w-4xl">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-text-muted absolute left-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsSearchOpen(false);
                    setSearchQuery('');
                    setSearchResults([]);
                  }
                }}
                autoFocus
                placeholder={`Search messages in ${isDm ? `@${channelName}` : `#${channelName}`}...`}
                className="w-full bg-input text-text-primary pl-9 pr-9 py-1.5 rounded-lg border border-white/[0.08] focus:border-accent/60 focus:outline-none text-xs placeholder:text-text-muted"
              />
              <button
                type="button"
                onClick={() => {
                  setIsSearchOpen(false);
                  setSearchQuery('');
                  setSearchResults([]);
                }}
                className="absolute right-2.5 p-0.5 rounded text-text-muted hover:text-text-primary"
                title="Close search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {searchQuery.trim() && (
              <div className="mt-2.5 max-h-48 overflow-y-auto space-y-1">
                {isSearching ? (
                  <div className="flex items-center space-x-2 text-xs text-text-muted py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                    <span>Searching...</span>
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="text-xs text-text-muted py-2">
                    No messages matched &ldquo;{searchQuery.trim()}&rdquo;.
                  </div>
                ) : (
                  searchResults.map((res, idx) => (
                    <button
                      key={res.id || `sr-${idx}`}
                      type="button"
                      onClick={() => {
                        if (res.id) scrollToMessage(res.id);
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg bg-canvas/70 hover:bg-card border border-white/[0.05] transition-colors flex flex-col"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-text-primary">{res.sender}</span>
                        <span className="text-[10px] text-text-muted">
                          {formatTimestamp(res.timestamp)}
                        </span>
                      </div>
                      <div className="text-xs text-text-secondary truncate mt-0.5">
                        {res.content}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Connection Status Banner */}
      {connectionStatus !== 'connected' && (
        <div
          className={clsx(
            'px-6 py-2 flex items-center justify-between text-xs font-medium border-b z-10',
            connectionStatus === 'connecting'
              ? 'bg-warning-muted text-warning border-warning/20'
              : 'bg-danger-muted text-danger border-danger/20'
          )}
        >
          <div className="flex items-center space-x-2">
            {connectionStatus === 'connecting' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            )}
            <span>
              {connectionStatus === 'connecting'
                ? 'Connecting to server...'
                : errorMessage || 'Disconnected from server.'}
            </span>
          </div>

          {onReconnect && connectionStatus !== 'connecting' && (
            <button
              onClick={onReconnect}
              type="button"
              className="px-2.5 py-1 rounded-md bg-danger hover:bg-danger-hover text-white text-xs font-medium transition-colors"
            >
              Reconnect
            </button>
          )}
        </div>
      )}

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {isLoadingHistory && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center select-none">
            <Loader2 className="w-5 h-5 animate-spin text-accent mb-2" />
            <span className="text-xs text-text-muted">Loading messages...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto select-none">
            <div className="w-12 h-12 rounded-2xl bg-surface border border-white/[0.07] flex items-center justify-center mb-4">
              {isDm ? (
                <AtSign className="w-5 h-5 text-accent" />
              ) : channelType === 'voice' ? (
                <Volume2 className="w-5 h-5 text-text-muted" />
              ) : (
                <Hash className="w-5 h-5 text-text-muted" />
              )}
            </div>
            <h3 className="text-base font-semibold text-text-primary mb-1">
              {isDm
                ? `@${channelName}`
                : `Welcome to ${channelType === 'voice' ? '' : '#'}${channelName}`}
            </h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              {isDm
                ? `This is the start of your private conversation with @${channelName}. Send a message, drop a file, or start a 1-on-1 call.`
                : 'This is the start of the conversation. Send a message, paste an image, or launch a live call.'}
            </p>
          </div>
        ) : (
          <div className="space-y-1 max-w-4xl">
            {messages.map((msg, index) => {
              const isSystem =
                msg.type === 'join' ||
                msg.type === 'leave' ||
                msg.type === 'error' ||
                msg.type === 'call-join' ||
                msg.type === 'call-leave';

              const msgKey = msg.id || `${msg.timestamp || index}-${msg.sender}-${index}`;

              if (isSystem) {
                return (
                  <div
                    key={msgKey}
                    className="flex items-center space-x-2 py-1.5 px-2 text-[11px] text-text-muted select-none"
                  >
                    <span
                      className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', {
                        'bg-online': msg.type === 'join' || msg.type === 'call-join',
                        'bg-text-muted': msg.type === 'leave' || msg.type === 'call-leave',
                        'bg-danger': msg.type === 'error',
                      })}
                    />
                    <span>
                      {msg.type === 'call-join'
                        ? `${msg.sender} joined the live call`
                        : msg.type === 'call-leave'
                        ? `${msg.sender} left the call`
                        : msg.content}
                    </span>
                    <span className="text-[10px] opacity-60">
                      {formatTimestamp(msg.timestamp)}
                    </span>
                  </div>
                );
              }

              const prevMsg = index > 0 ? messages[index - 1] : null;
              const prevIsNormal =
                prevMsg &&
                prevMsg.type !== 'join' &&
                prevMsg.type !== 'leave' &&
                prevMsg.type !== 'error' &&
                prevMsg.type !== 'call-join' &&
                prevMsg.type !== 'call-leave';

              const hasReply = Boolean((msg.data as MessageData | undefined)?.replyTo);

              const isGrouped =
                !hasReply &&
                prevIsNormal &&
                prevMsg.sender === msg.sender &&
                msg.timestamp &&
                prevMsg.timestamp &&
                msg.timestamp - prevMsg.timestamp <= GROUP_WINDOW_MS;

              const isSelf = msg.sender.toLowerCase() === currentUsername.toLowerCase();
              const isHighlighted = Boolean(msg.id && highlightedMsgId === msg.id);
              const isEdited = Boolean((msg.data as MessageData | undefined)?.edited);

              const attachRef = (el: HTMLDivElement | null) => {
                if (!msg.id) return;
                if (el) messageRefs.current.set(msg.id, el);
                else messageRefs.current.delete(msg.id);
              };

              if (isGrouped) {
                return (
                  <div
                    key={msgKey}
                    ref={attachRef}
                    className={clsx(
                      'flex items-baseline pl-[44px] pr-3 py-0.5 -mx-2 rounded-lg transition-colors group relative',
                      isHighlighted
                        ? 'bg-accent/15 ring-1 ring-accent/40'
                        : 'hover:bg-surface/60'
                    )}
                  >
                    {renderHoverActions(msg, isSelf)}
                    <span className="absolute left-2 top-1 text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity select-none w-8 text-right">
                      {formatTimestamp(msg.timestamp)}
                    </span>
                    <div className="flex-1 min-w-0">{renderMessageRichBody(msg, true)}</div>
                  </div>
                );
              }

              return (
                <div
                  key={msgKey}
                  ref={attachRef}
                  className={clsx(
                    'flex items-start space-x-3 pt-3 pb-0.5 px-2 -mx-2 rounded-lg transition-colors group relative',
                    isHighlighted
                      ? 'bg-accent/15 ring-1 ring-accent/40'
                      : 'hover:bg-surface/60'
                  )}
                >
                  {renderHoverActions(msg, isSelf)}

                  {/* User Avatar */}
                  <UserAvatar
                    username={msg.sender}
                    avatarUrl={profiles[msg.sender.toLowerCase()]?.avatarUrl}
                    size="md"
                    className="mt-0.5"
                  />

                  {/* Message Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline space-x-2">
                      <span
                        className={clsx('font-semibold text-xs', {
                          'text-accent': isSelf,
                          'text-text-primary': !isSelf,
                        })}
                      >
                        {msg.sender}
                      </span>
                      <span className="text-[10px] text-text-muted select-none">
                        {formatTimestamp(msg.timestamp)}
                      </span>
                      {isEdited && (
                        <span className="text-[10px] text-text-muted select-none">(edited)</span>
                      )}
                    </div>

                    {renderMessageRichBody(msg, false)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer Area: Errors + Reply Banner + Pending Attachment + Typing Indicator + Input */}
      <div className="px-6 pb-5 pt-1 flex-shrink-0">
        <div className="max-w-4xl relative">
          {/* Error Banner */}
          {uploadError && (
            <div className="mb-2 px-3 py-2 rounded-xl bg-danger-muted border border-danger/25 text-xs text-danger flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{uploadError}</span>
              </div>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                className="p-0.5 rounded hover:bg-danger/20"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Replying-To Banner */}
          {replyingTo && (
            <div className="mb-2 px-3 py-1.5 rounded-xl bg-surface border border-white/[0.08] flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2 min-w-0">
                <Reply className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                <span className="text-text-muted flex-shrink-0">Replying to</span>
                <span className="font-semibold text-text-primary flex-shrink-0">
                  @{replyingTo.sender}
                </span>
                <span className="text-text-muted truncate">{replyingTo.content}</span>
              </div>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-card flex-shrink-0"
                title="Cancel reply"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Pending Attachment Chip */}
          {(pendingAttachment || isUploading) && (
            <div className="mb-2 flex items-center">
              {isUploading ? (
                <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-surface border border-white/[0.08] text-xs text-text-secondary">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                  <span>Uploading file...</span>
                </div>
              ) : (
                pendingAttachment && (
                  <div className="inline-flex items-center space-x-2.5 px-2.5 py-1.5 rounded-xl bg-surface border border-accent/35 text-xs text-text-primary max-w-xs">
                    {pendingAttachment.isImage ? (
                      <img
                        src={resolveMediaUrl(pendingAttachment.url)}
                        alt={pendingAttachment.name}
                        className="w-7 h-7 rounded-md object-cover border border-white/[0.08] flex-shrink-0"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-md bg-accent-muted flex items-center justify-center text-accent flex-shrink-0">
                        <FileText className="w-3.5 h-3.5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-medium text-[11px]">
                        {pendingAttachment.name}
                      </div>
                      <div className="text-[10px] text-text-muted">
                        {formatFileSize(pendingAttachment.size)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingAttachment(null)}
                      className="p-1 rounded-md text-text-muted hover:text-danger hover:bg-danger-muted transition-colors flex-shrink-0"
                      title="Remove attachment"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              )}
            </div>
          )}

          {/* Subtle Typing Indicator */}
          <div className="h-5 px-1 flex items-center">
            {typingUsers.length > 0 && (
              <div className="flex items-center space-x-2 text-[11px] text-text-secondary select-none">
                <span className="flex space-x-0.5">
                  <span className="w-1 h-1 rounded-full bg-accent animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1 h-1 rounded-full bg-accent animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1 h-1 rounded-full bg-accent animate-bounce" />
                </span>
                <span className="font-medium">{formatTypingText(typingUsers)}</span>
              </div>
            )}
          </div>

          {/* Expression Picker Popover (Emoji / Stickers / GIFs) */}
          <ExpressionPicker
            isOpen={isPickerOpen}
            token={token}
            onClose={() => setIsPickerOpen(false)}
            onSelectEmoji={handleSelectEmoji}
            onSelectSticker={handleSelectSticker}
            onSelectGif={handleSelectGif}
          />

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileInputChange}
            className="hidden"
          />

          {/* Floating Rounded Input Bar */}
          <div className="bg-surface border border-white/[0.08] focus-within:border-accent/60 rounded-xl px-3 py-2 flex items-center space-x-2 transition-colors shadow-sm">
            {/* Upload Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={connectionStatus !== 'connected' || isUploading}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-card disabled:opacity-40 transition-colors flex-shrink-0"
              title="Upload image or document (max 10MB)"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                isDm
                  ? `Message @${channelName}...`
                  : `Message ${channelType === 'voice' ? '' : '#'}${channelName}...`
              }
              disabled={connectionStatus !== 'connected'}
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-50 px-1"
            />

            {/* Emoji / Stickers / GIFs Trigger */}
            <button
              type="button"
              onClick={() => setIsPickerOpen((prev) => !prev)}
              disabled={connectionStatus !== 'connected'}
              className={clsx(
                'p-1.5 rounded-lg transition-colors flex-shrink-0 disabled:opacity-40',
                isPickerOpen
                  ? 'bg-card text-accent'
                  : 'text-text-muted hover:text-text-primary hover:bg-card'
              )}
              title="Emoji, Stickers & GIFs"
            >
              <Smile className="w-4 h-4" />
            </button>

            {/* Send Button */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSend}
              className={clsx(
                'w-7 h-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0',
                canSend
                  ? 'bg-accent text-white hover:bg-accent-hover cursor-pointer shadow-sm'
                  : 'bg-card text-text-muted opacity-40 cursor-not-allowed'
              )}
              title="Send"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Image Lightbox Modal */}
      <ImageLightbox
        src={lightboxImage?.src || null}
        alt={lightboxImage?.alt}
        onClose={() => setLightboxImage(null)}
      />
    </div>
  );
};
