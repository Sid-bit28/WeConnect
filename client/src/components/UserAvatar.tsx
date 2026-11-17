import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import type { UserStatus } from '../types';
import { getApiBaseUrl } from '../utils/api';

interface UserAvatarProps {
  username: string;
  avatarUrl?: string;
  status?: UserStatus | 'offline';
  showStatus?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  ringSurfaceClass?: string;
  className?: string;
}

function resolveAvatarUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  return `${getApiBaseUrl()}${url}`;
}

function getAvatarTone(name: string): string {
  const styles = [
    'bg-indigo-500/15 text-indigo-300 border-indigo-500/25',
    'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    'bg-amber-500/15 text-amber-300 border-amber-500/25',
    'bg-rose-500/15 text-rose-300 border-rose-500/25',
    'bg-cyan-500/15 text-cyan-300 border-cyan-500/25',
    'bg-violet-500/15 text-violet-300 border-violet-500/25',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return styles[Math.abs(hash) % styles.length];
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  username,
  avatarUrl,
  status = 'online',
  showStatus = false,
  size = 'md',
  ringSurfaceClass = 'border-surface',
  className,
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [avatarUrl]);

  const resolvedUrl = resolveAvatarUrl(avatarUrl);
  const showImage = Boolean(resolvedUrl && !imgFailed);

  const sizeClass = {
    xs: 'w-5 h-5 text-[10px]',
    sm: 'w-7 h-7 text-[11px]',
    md: 'w-8 h-8 text-xs',
    lg: 'w-12 h-12 text-base',
  }[size];

  const dotSizeClass = {
    xs: 'w-2 h-2 border',
    sm: 'w-2.5 h-2.5 border-2',
    md: 'w-2.5 h-2.5 border-2',
    lg: 'w-3 h-3 border-2',
  }[size];

  const statusColorClass = {
    online: 'bg-online',
    away: 'bg-warning',
    dnd: 'bg-danger',
    offline: 'bg-text-muted/60',
  }[status];

  return (
    <div className={clsx('relative inline-flex flex-shrink-0 select-none', className)}>
      {showImage ? (
        <img
          src={resolvedUrl}
          alt={username}
          onError={() => setImgFailed(true)}
          className={clsx(
            'rounded-full object-cover border border-white/[0.1] bg-card',
            sizeClass
          )}
        />
      ) : (
        <div
          className={clsx(
            'rounded-full border flex items-center justify-center font-semibold uppercase',
            sizeClass,
            getAvatarTone(username)
          )}
        >
          {(username || 'U').charAt(0)}
        </div>
      )}

      {showStatus && (
        <span
          className={clsx(
            'absolute -bottom-0.5 -right-0.5 rounded-full',
            dotSizeClass,
            ringSurfaceClass,
            statusColorClass
          )}
          title={
            status === 'dnd'
              ? 'Do Not Disturb'
              : status.charAt(0).toUpperCase() + status.slice(1)
          }
        />
      )}
    </div>
  );
};
