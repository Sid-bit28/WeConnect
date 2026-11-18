import React, { useState, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import type { LinkPreview } from '../types';
import { getApiBaseUrl } from '../utils/api';

const previewCache = new Map<string, LinkPreview | null>();
const inflightRequests = new Map<string, Promise<LinkPreview | null>>();

export function extractFirstUrl(content?: string): string | null {
  if (!content) return null;
  // Ignore URLs inside fenced code blocks
  const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, ' ');
  const match = withoutCodeBlocks.match(/https?:\/\/[^\s<>]+/);
  if (!match) return null;
  const raw = match[0];
  const trailing = raw.match(/[.,!?;:)\]]+$/);
  return trailing ? raw.slice(0, -trailing[0].length) : raw;
}

function getHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function fetchLinkPreview(url: string, token: string): Promise<LinkPreview | null> {
  if (previewCache.has(url)) {
    return previewCache.get(url) ?? null;
  }
  const existing = inflightRequests.get(url);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/link-preview?url=${encodeURIComponent(url)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!res.ok) {
        previewCache.set(url, null);
        return null;
      }
      const data = (await res.json()) as LinkPreview;
      if (!data || (!data.title && !data.description)) {
        previewCache.set(url, null);
        return null;
      }
      previewCache.set(url, data);
      return data;
    } catch {
      previewCache.set(url, null);
      return null;
    } finally {
      inflightRequests.delete(url);
    }
  })();

  inflightRequests.set(url, promise);
  return promise;
}

interface LinkPreviewCardProps {
  url: string;
  token: string;
}

export const LinkPreviewCard: React.FC<LinkPreviewCardProps> = ({ url, token }) => {
  const [preview, setPreview] = useState<LinkPreview | null>(() =>
    previewCache.has(url) ? previewCache.get(url) ?? null : null
  );
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
    if (previewCache.has(url)) {
      setPreview(previewCache.get(url) ?? null);
      return;
    }

    let cancelled = false;
    void fetchLinkPreview(url, token).then((result) => {
      if (!cancelled) {
        setPreview(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [url, token]);

  if (!preview || (!preview.title && !preview.description)) {
    return null;
  }

  const siteLabel = preview.siteName || getHostname(preview.url || url);
  const showImage = Boolean(preview.image && !imgFailed);

  return (
    <a
      href={preview.url || url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1.5 flex items-stretch rounded-xl overflow-hidden bg-surface/90 hover:bg-surface border border-white/[0.08] hover:border-accent/40 max-w-md transition-colors group"
    >
      <div className="flex-1 min-w-0 p-3 flex flex-col justify-center">
        {siteLabel && (
          <div className="flex items-center space-x-1 text-[10px] text-text-muted uppercase tracking-wider font-medium mb-0.5">
            <span className="truncate">{siteLabel}</span>
            <ExternalLink className="w-2.5 h-2.5 flex-shrink-0 opacity-60 group-hover:opacity-100" />
          </div>
        )}
        {preview.title && (
          <div className="text-xs font-semibold text-text-primary group-hover:text-indigo-300 transition-colors line-clamp-1">
            {preview.title}
          </div>
        )}
        {preview.description && (
          <p className="text-[11px] text-text-secondary line-clamp-2 mt-0.5 leading-snug">
            {preview.description}
          </p>
        )}
      </div>

      {showImage && preview.image && (
        <div className="w-24 sm:w-28 flex-shrink-0 bg-canvas border-l border-white/[0.06]">
          <img
            src={preview.image}
            alt={preview.title || siteLabel}
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover"
          />
        </div>
      )}
    </a>
  );
};
