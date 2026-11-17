import type { StickerData } from '../types';

export interface StickerDefinition extends StickerData {
  bg: string;
  accent: string;
  glyph: string;
  caption: string;
}

export const STICKERS: StickerDefinition[] = [
  {
    id: 'wave',
    label: 'Wave',
    category: 'Greetings',
    bg: '#1E293B',
    accent: '#38BDF8',
    glyph: '👋',
    caption: 'HEY!',
  },
  {
    id: 'gg',
    label: 'GG',
    category: 'Gaming',
    bg: '#1E1B4B',
    accent: '#818CF8',
    glyph: '🏆',
    caption: 'GG',
  },
  {
    id: 'fire',
    label: 'Fire',
    category: 'Reactions',
    bg: '#2A1215',
    accent: '#FB923C',
    glyph: '🔥',
    caption: 'LIT',
  },
  {
    id: 'mind-blown',
    label: 'Mind Blown',
    category: 'Reactions',
    bg: '#2E1065',
    accent: '#C084FC',
    glyph: '🤯',
    caption: 'WHOA',
  },
  {
    id: 'heart',
    label: 'Heart',
    category: 'Reactions',
    bg: '#3B0764',
    accent: '#F472B6',
    glyph: '💜',
    caption: 'LOVE',
  },
  {
    id: 'coffee',
    label: 'Coffee',
    category: 'Vibes',
    bg: '#291D16',
    accent: '#FBBF24',
    glyph: '☕',
    caption: 'BRB',
  },
  {
    id: 'party',
    label: 'Party',
    category: 'Celebration',
    bg: '#064E3B',
    accent: '#34D399',
    glyph: '🎉',
    caption: 'WOO!',
  },
  {
    id: 'thumbs-up',
    label: 'Thumbs Up',
    category: 'Reactions',
    bg: '#0F2942',
    accent: '#60A5FA',
    glyph: '👍',
    caption: 'NICE',
  },
  {
    id: 'rocket',
    label: 'Rocket',
    category: 'Celebration',
    bg: '#172554',
    accent: '#6366F1',
    glyph: '🚀',
    caption: 'SHIP IT',
  },
  {
    id: 'laugh',
    label: 'Laugh',
    category: 'Reactions',
    bg: '#3F2E0B',
    accent: '#FACC15',
    glyph: '😂',
    caption: 'LMAO',
  },
  {
    id: 'sparkle',
    label: 'Clean',
    category: 'Vibes',
    bg: '#042F2E',
    accent: '#2DD4BF',
    glyph: '✨',
    caption: 'CLEAN',
  },
  {
    id: 'chill',
    label: 'Chill',
    category: 'Vibes',
    bg: '#1E1B2E',
    accent: '#A78BFA',
    glyph: '🎧',
    caption: 'CHILL',
  },
];

export function getStickerById(id: string): StickerDefinition | undefined {
  return STICKERS.find((s) => s.id === id);
}

/**
 * Generates a crisp self-contained SVG data URI for any sticker definition.
 */
export function getStickerSvgDataUri(sticker: StickerDefinition): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
    <defs>
      <linearGradient id="g-${sticker.id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${sticker.bg}" />
        <stop offset="100%" stop-color="#090B10" />
      </linearGradient>
    </defs>
    <rect x="4" y="4" width="112" height="112" rx="24" fill="url(#g-${sticker.id})" stroke="${sticker.accent}" stroke-opacity="0.45" stroke-width="2" />
    <circle cx="60" cy="48" r="28" fill="${sticker.accent}" fill-opacity="0.14" />
    <text x="60" y="61" text-anchor="middle" font-size="38" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif">${sticker.glyph}</text>
    <rect x="22" y="84" width="76" height="20" rx="10" fill="${sticker.accent}" fill-opacity="0.18" />
    <text x="60" y="98" text-anchor="middle" font-size="11" font-weight="700" letter-spacing="1.2" fill="${sticker.accent}" font-family="Inter, -apple-system, sans-serif">${sticker.caption}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export interface EmojiCategory {
  name: string;
  emojis: Array<{ char: string; keywords: string }>;
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    name: 'Smileys',
    emojis: [
      { char: '😀', keywords: 'grin happy smile' },
      { char: '😂', keywords: 'laugh lol joy tears' },
      { char: '🥹', keywords: 'happy tear emotional' },
      { char: '😊', keywords: 'blush warm smile' },
      { char: '😎', keywords: 'cool sunglasses' },
      { char: '🤔', keywords: 'thinking hmm' },
      { char: '😮', keywords: 'wow surprised' },
      { char: '🤯', keywords: 'mind blown shocked' },
      { char: '😭', keywords: 'cry sad sob' },
      { char: '😅', keywords: 'sweat nervous laugh' },
      { char: '🥳', keywords: 'party celebrate' },
      { char: '😴', keywords: 'sleep tired' },
    ],
  },
  {
    name: 'Gestures',
    emojis: [
      { char: '👍', keywords: 'thumbs up yes good ok' },
      { char: '👎', keywords: 'thumbs down no bad' },
      { char: '👏', keywords: 'clap applause bravo' },
      { char: '🙌', keywords: 'hands celebrate praise' },
      { char: '👋', keywords: 'wave hello hi bye' },
      { char: '🤝', keywords: 'handshake deal agree' },
      { char: '🙏', keywords: 'please thanks pray' },
      { char: '✌️', keywords: 'peace victory' },
      { char: '💪', keywords: 'strong flex muscle' },
      { char: '🫡', keywords: 'salute respect' },
    ],
  },
  {
    name: 'Objects & Symbols',
    emojis: [
      { char: '🔥', keywords: 'fire lit hot' },
      { char: '✨', keywords: 'sparkles clean magic' },
      { char: '🚀', keywords: 'rocket launch ship' },
      { char: '🎉', keywords: 'party confetti' },
      { char: '❤️', keywords: 'heart love red' },
      { char: '💜', keywords: 'purple heart love' },
      { char: '⚡', keywords: 'fast lightning zap' },
      { char: '☕', keywords: 'coffee break' },
      { char: '💻', keywords: 'code laptop dev' },
      { char: '🎧', keywords: 'music headphones call' },
      { char: '✅', keywords: 'check done green' },
      { char: '👀', keywords: 'eyes looking' },
    ],
  },
];
