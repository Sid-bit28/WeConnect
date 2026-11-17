import React, { useState, useRef, useEffect } from 'react';
import { Upload, Trash2, Check, Loader2, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import type { UserProfile, UserStatus } from '../types';
import { getApiBaseUrl } from '../utils/api';
import { UserAvatar } from './UserAvatar';

interface ProfilePopoverProps {
  isOpen: boolean;
  token: string;
  profile: UserProfile;
  onClose: () => void;
  onProfileUpdated: (profile: UserProfile) => void;
}

const STATUS_OPTIONS: Array<{
  value: UserStatus;
  label: string;
  hint: string;
  dotClass: string;
}> = [
  { value: 'online', label: 'Online', hint: 'Active and available', dotClass: 'bg-online' },
  { value: 'away', label: 'Away', hint: 'Stepped away', dotClass: 'bg-warning' },
  {
    value: 'dnd',
    label: 'Do Not Disturb',
    hint: 'Mutes DM notifications',
    dotClass: 'bg-danger',
  },
];

const MAX_AVATAR_BYTES = 10 * 1024 * 1024; // 10MB

export const ProfilePopover: React.FC<ProfilePopoverProps> = ({
  isOpen,
  token,
  profile,
  onClose,
  onProfileUpdated,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentStatus: UserStatus = profile.status || 'online';

  const saveProfile = async (patch: { avatarUrl?: string; status?: UserStatus }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || data.message || 'Failed to update profile.');
        return;
      }
      const updated: UserProfile = data.profile || {
        username: profile.username,
        avatarUrl: patch.avatarUrl !== undefined ? patch.avatarUrl : profile.avatarUrl,
        status: patch.status !== undefined ? patch.status : currentStatus,
      };
      onProfileUpdated(updated);
    } catch (err: any) {
      setError(err?.message || 'Network error while updating profile.');
    } finally {
      setBusy(false);
    }
  };

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError('Avatar image exceeds 10MB limit.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const uploadRes = await fetch(`${getApiBaseUrl()}/api/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });
      const uploadData = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok || !uploadData.url) {
        setError(uploadData.error || 'Failed to upload avatar image.');
        setBusy(false);
        return;
      }
      if (!uploadData.isImage) {
        setError('Uploaded file was not recognized as an image.');
        setBusy(false);
        return;
      }

      await saveProfile({ avatarUrl: uploadData.url });
    } catch (err: any) {
      setError(err?.message || 'Network error during avatar upload.');
      setBusy(false);
    }
  };

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-16 left-3 right-3 z-40 bg-surface/95 backdrop-blur-xl border border-white/[0.1] rounded-2xl shadow-2xl p-4 space-y-4 select-none"
    >
      {/* Profile Preview + Avatar Actions */}
      <div className="flex items-center space-x-3">
        <UserAvatar
          username={profile.username}
          avatarUrl={profile.avatarUrl}
          status={currentStatus}
          showStatus={true}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-text-primary truncate">
            {profile.username}
          </div>
          <div className="flex items-center space-x-1.5 mt-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarFile}
              className="hidden"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="px-2 py-1 rounded-lg bg-card hover:bg-white/10 border border-white/[0.08] text-[11px] font-medium text-text-primary flex items-center space-x-1 transition-colors disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Upload className="w-3 h-3" />
              )}
              <span>Avatar</span>
            </button>

            {profile.avatarUrl && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveProfile({ avatarUrl: '' })}
                className="p-1 rounded-lg bg-card hover:bg-danger-muted text-text-muted hover:text-danger border border-white/[0.06] transition-colors disabled:opacity-50"
                title="Remove avatar"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-danger-muted border border-danger/25 rounded-lg px-2.5 py-1.5 text-[11px] text-danger flex items-start space-x-1.5">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span className="leading-snug">{error}</span>
        </div>
      )}

      <div className="h-[1px] bg-white/[0.06]" />

      {/* Presence Status Picker */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1.5 px-1">
          Status
        </div>
        <div className="space-y-0.5">
          {STATUS_OPTIONS.map((opt) => {
            const isSelected = currentStatus === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={busy}
                onClick={() => void saveProfile({ status: opt.value })}
                className={clsx(
                  'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors disabled:opacity-50',
                  isSelected
                    ? 'bg-card text-text-primary'
                    : 'text-text-secondary hover:bg-card/50 hover:text-text-primary'
                )}
              >
                <div className="flex items-center space-x-2.5 min-w-0">
                  <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', opt.dotClass)} />
                  <div className="truncate">
                    <div className="text-xs font-medium leading-tight">{opt.label}</div>
                    <div className="text-[10px] text-text-muted">{opt.hint}</div>
                  </div>
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
