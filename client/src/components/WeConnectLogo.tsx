import React from 'react';
import clsx from 'clsx';

interface WeConnectLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
  textClassName?: string;
  glowing?: boolean;
}

export const WeConnectLogo: React.FC<WeConnectLogoProps> = ({
  size = 'md',
  showText = false,
  className,
  textClassName,
  glowing = true,
}) => {
  const sizeMap = {
    xs: { box: 'w-6 h-6 rounded-md', svg: 16 },
    sm: { box: 'w-7 h-7 rounded-lg', svg: 18 },
    md: { box: 'w-8 h-8 rounded-xl', svg: 22 },
    lg: { box: 'w-11 h-11 rounded-xl', svg: 28 },
    xl: { box: 'w-14 h-14 rounded-2xl', svg: 36 },
  }[size];

  return (
    <div className={clsx('inline-flex items-center space-x-2.5 select-none', className)}>
      {/* Icon Mark Frame */}
      <div
        className={clsx(
          sizeMap.box,
          'bg-gradient-to-b from-white/[0.08] to-white/[0.02] border border-white/[0.1] shadow-lg flex items-center justify-center flex-shrink-0 relative overflow-hidden backdrop-blur-sm group transition-all duration-200',
          glowing && 'hover:border-accent/40 hover:shadow-[0_0_16px_rgba(99,102,241,0.25)]'
        )}
      >
        {/* Subtle Ambient Radial Highlight */}
        <div className="absolute inset-0 bg-radial from-accent/20 via-transparent to-transparent opacity-60 pointer-events-none" />

        {/* Scalable SVG Emblem */}
        <svg
          width={sizeMap.svg}
          height={sizeMap.svg}
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative z-10"
        >
          <defs>
            <linearGradient id="weconnect-logo-grad" x1="8" y1="12" x2="40" y2="36" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#818CF8" />
              <stop offset="50%" stopColor="#6366F1" />
              <stop offset="100%" stopColor="#06B6D4" />
            </linearGradient>
          </defs>

          {/* Ambient Glow Ribbon */}
          <path
            d="M10 15L17.2 33.2C17.7 34.5 19.3 35.1 20.6 34.5C21.1 34.2 21.5 33.8 21.8 33.2L24 27.5L26.2 33.2C26.7 34.5 28.3 35.1 29.6 34.5C30.1 34.2 30.5 33.8 30.8 33.2L38 15"
            stroke="url(#weconnect-logo-grad)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.25"
          />

          {/* Main Geometric W Ribbon */}
          <path
            d="M10 15L17.2 33.2C17.7 34.5 19.3 35.1 20.6 34.5C21.1 34.2 21.5 33.8 21.8 33.2L24 27.5L26.2 33.2C26.7 34.5 28.3 35.1 29.6 34.5C30.1 34.2 30.5 33.8 30.8 33.2L38 15"
            stroke="url(#weconnect-logo-grad)"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Interconnected Network Nodes */}
          <circle cx="10" cy="15" r="2.8" fill="#818CF8" />
          <circle cx="38" cy="15" r="2.8" fill="#06B6D4" />
          <circle cx="24" cy="21" r="2.4" fill="#10B981" />
          <circle cx="24" cy="21" r="5" stroke="#10B981" strokeWidth="1" strokeOpacity="0.6" strokeDasharray="2 2" />
        </svg>
      </div>

      {/* Wordmark */}
      {showText && (
        <span
          className={clsx(
            'font-semibold text-text-primary tracking-tight truncate',
            size === 'lg' || size === 'xl' ? 'text-xl' : 'text-sm',
            textClassName
          )}
        >
          WeConnect
        </span>
      )}
    </div>
  );
};
