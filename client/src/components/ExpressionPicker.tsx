import React, { useState, useEffect, useRef } from 'react';
import { Search, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import type { StickerData, GifData } from '../types';
import { EMOJI_CATEGORIES, STICKERS, getStickerSvgDataUri } from '../utils/stickers';
import { getApiBaseUrl } from '../utils/api';

type PickerTab = 'emoji' | 'stickers' | 'gifs';

interface ExpressionPickerProps {
  isOpen: boolean;
  token: string;
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
  onSelectSticker: (sticker: StickerData) => void;
  onSelectGif: (gif: GifData) => void;
}

export const ExpressionPicker: React.FC<ExpressionPickerProps> = ({
  isOpen,
  token,
  onClose,
  onSelectEmoji,
  onSelectSticker,
  onSelectGif,
}) => {
  const [activeTab, setActiveTab] = useState<PickerTab>('emoji');
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GifData[]>([]);
  const [loadingGifs, setLoadingGifs] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on click outside or Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Fetch GIFs when GIFs tab is active or query changes (debounced)
  useEffect(() => {
    if (!isOpen || activeTab !== 'gifs') return;

    let isCancelled = false;
    const timer = setTimeout(async () => {
      setLoadingGifs(true);
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/api/gifs?q=${encodeURIComponent(query.trim())}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        if (res.ok && !isCancelled) {
          const data = await res.json();
          const rawList = Array.isArray(data) ? data : data.gifs || data.results || [];
          const normalized: GifData[] = rawList
            .filter((g: any) => g && g.url)
            .map((g: any) => ({
              url: g.url,
              title: g.title || 'GIF',
            }));
          setGifs(normalized);
        }
      } catch {
        if (!isCancelled) setGifs([]);
      } finally {
        if (!isCancelled) setLoadingGifs(false);
      }
    }, 200);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, activeTab, query, token]);

  if (!isOpen) return null;

  const trimmedQuery = query.trim().toLowerCase();

  const filteredStickers = trimmedQuery
    ? STICKERS.filter(
        (s) =>
          s.label.toLowerCase().includes(trimmedQuery) ||
          s.category.toLowerCase().includes(trimmedQuery) ||
          s.caption.toLowerCase().includes(trimmedQuery)
      )
    : STICKERS;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full right-0 mb-2 w-[min(320px,calc(100vw-2rem))] sm:w-96 bg-surface border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden z-30 flex flex-col select-none"
    >
      {/* Tabs */}
      <div className="flex items-center px-3 pt-2.5 pb-2 border-b border-white/[0.06] space-x-1">
        {(['emoji', 'stickers', 'gifs'] as PickerTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
              setActiveTab(tab);
              setQuery('');
            }}
            className={clsx(
              'px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors',
              activeTab === tab
                ? 'bg-card text-text-primary border border-white/[0.08]'
                : 'text-text-muted hover:text-text-primary border border-transparent'
            )}
          >
            {tab === 'gifs' ? 'GIFs' : tab}
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div className="px-3 py-2 border-b border-white/[0.05]">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              activeTab === 'emoji'
                ? 'Search emoji...'
                : activeTab === 'stickers'
                ? 'Search stickers...'
                : 'Search GIFs...'
            }
            className="w-full bg-input text-text-primary pl-8 pr-3 py-1.5 rounded-lg text-xs placeholder:text-text-muted focus:outline-none border border-white/[0.07] focus:border-accent/50"
          />
          <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 top-2" />
        </div>
      </div>

      {/* Content Area */}
      <div className="h-64 overflow-y-auto p-3">
        {activeTab === 'emoji' ? (
          <div className="space-y-3">
            {EMOJI_CATEGORIES.map((category) => {
              const items = trimmedQuery
                ? category.emojis.filter((e) => e.keywords.includes(trimmedQuery))
                : category.emojis;
              if (items.length === 0) return null;
              return (
                <div key={category.name}>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1.5">
                    {category.name}
                  </div>
                  <div className="grid grid-cols-6 gap-1">
                    {items.map((item) => (
                      <button
                        key={item.char}
                        type="button"
                        onClick={() => onSelectEmoji(item.char)}
                        className="h-9 rounded-lg hover:bg-card flex items-center justify-center text-lg transition-transform active:scale-90"
                        title={item.keywords}
                      >
                        {item.char}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : activeTab === 'stickers' ? (
          filteredStickers.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-text-muted">
              No matching stickers
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {filteredStickers.map((sticker) => (
                <button
                  key={sticker.id}
                  type="button"
                  onClick={() => {
                    onSelectSticker({
                      id: sticker.id,
                      label: sticker.label,
                      category: sticker.category,
                    });
                    onClose();
                  }}
                  className="p-1.5 rounded-xl bg-canvas/60 hover:bg-card border border-white/[0.05] hover:border-accent/40 transition-all flex flex-col items-center group"
                  title={sticker.label}
                >
                  <img
                    src={getStickerSvgDataUri(sticker)}
                    alt={sticker.label}
                    className="w-20 h-20 object-contain group-hover:scale-105 transition-transform"
                  />
                </button>
              ))}
            </div>
          )
        ) : loadingGifs ? (
          <div className="h-full flex items-center justify-center text-xs text-text-muted space-x-2">
            <Loader2 className="w-4 h-4 animate-spin text-accent" />
            <span>Loading GIFs...</span>
          </div>
        ) : gifs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-text-muted">
            No GIFs found
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {gifs.map((gif, idx) => (
              <button
                key={`${gif.url}-${idx}`}
                type="button"
                onClick={() => {
                  onSelectGif(gif);
                  onClose();
                }}
                className="relative aspect-video rounded-lg overflow-hidden bg-canvas border border-white/[0.07] hover:border-accent/50 group transition-all"
                title={gif.title}
              >
                <img
                  src={gif.url}
                  alt={gif.title}
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1 text-[10px] text-white truncate opacity-0 group-hover:opacity-100 transition-opacity">
                  {gif.title}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
