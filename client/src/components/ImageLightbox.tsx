import React, { useEffect } from 'react';
import { X, Download } from 'lucide-react';

interface ImageLightboxProps {
  src: string | null;
  alt?: string;
  onClose: () => void;
}

export const ImageLightbox: React.FC<ImageLightboxProps> = ({ src, alt, onClose }) => {
  useEffect(() => {
    if (!src) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-6 select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Top Bar */}
      <div className="fixed top-4 right-5 flex items-center space-x-2 z-10">
        <a
          href={src}
          download={alt || 'image'}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-xl bg-surface/90 hover:bg-card border border-white/[0.1] text-text-secondary hover:text-text-primary transition-colors"
          title="Download"
        >
          <Download className="w-4 h-4" />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-xl bg-surface/90 hover:bg-card border border-white/[0.1] text-text-secondary hover:text-text-primary transition-colors"
          title="Close (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Image */}
      <img
        src={src}
        alt={alt || 'Preview'}
        className="max-w-[92vw] max-h-[84vh] object-contain rounded-xl border border-white/[0.08] shadow-2xl bg-canvas"
      />

      {alt && (
        <div className="mt-3 text-xs text-text-secondary bg-surface/80 px-3 py-1 rounded-lg border border-white/[0.06] max-w-md truncate">
          {alt}
        </div>
      )}
    </div>
  );
};
