import React, { useState, useEffect } from 'react';
import { X, Hash, Volume2, Lock, Check, AlertCircle, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import type { Friend, UserProfile } from '../types';
import { UserAvatar } from './UserAvatar';

interface CreateChannelModalProps {
  isOpen: boolean;
  defaultType?: 'text' | 'voice';
  friends?: Friend[];
  profiles?: Record<string, UserProfile>;
  onClose: () => void;
  onCreate: (payload: {
    name: string;
    type: 'text' | 'voice';
    topic: string;
    isPrivate: boolean;
    members: string[];
  }) => Promise<string | null>;
}

export const CreateChannelModal: React.FC<CreateChannelModalProps> = ({
  isOpen,
  defaultType = 'text',
  friends = [],
  profiles = {},
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('');
  const [type, setType] = useState<'text' | 'voice'>(defaultType);
  const [topic, setTopic] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setType(defaultType);
      setTopic('');
      setIsPrivate(false);
      setSelectedMembers([]);
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen, defaultType]);

  if (!isOpen) return null;

  const toggleMember = (username: string) => {
    setSelectedMembers((prev) =>
      prev.includes(username) ? prev.filter((u) => u !== username) : [...prev, username]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 32) {
      setError('Group name must be between 2 and 32 characters.');
      return;
    }

    setSubmitting(true);
    const errMsg = await onCreate({
      name: trimmedName,
      type,
      topic: topic.trim(),
      isPrivate,
      members: isPrivate ? selectedMembers : [],
    });
    setSubmitting(false);

    if (errMsg) {
      setError(errMsg);
    } else {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-sm bg-surface border border-white/[0.08] rounded-2xl shadow-2xl p-6 text-text-primary">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {type === 'voice' ? 'Create Voice Group' : 'Create Group Chat'}
            </h3>
            <p className="text-[11px] text-text-muted mt-0.5">
              Only you as the creator can delete this group later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-card transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-4 bg-danger-muted border border-danger/20 rounded-lg p-2.5 flex items-start space-x-2 text-xs text-danger font-medium">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type Selector */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1.5">
              Group Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setType('text')}
                disabled={submitting}
                className={clsx(
                  'flex items-center space-x-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all',
                  type === 'text'
                    ? 'bg-card border-accent/60 text-text-primary shadow-sm'
                    : 'bg-canvas/50 border-white/[0.06] text-text-secondary hover:text-text-primary'
                )}
              >
                <Hash
                  className={clsx('w-3.5 h-3.5', type === 'text' ? 'text-accent' : 'text-text-muted')}
                />
                <span>Group Chat</span>
              </button>
              <button
                type="button"
                onClick={() => setType('voice')}
                disabled={submitting}
                className={clsx(
                  'flex items-center space-x-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all',
                  type === 'voice'
                    ? 'bg-card border-accent/60 text-text-primary shadow-sm'
                    : 'bg-canvas/50 border-white/[0.06] text-text-secondary hover:text-text-primary'
                )}
              >
                <Volume2
                  className={clsx('w-3.5 h-3.5', type === 'voice' ? 'text-accent' : 'text-text-muted')}
                />
                <span>Voice Group</span>
              </button>
            </div>
          </div>

          {/* Group Name */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1.5">
              Group Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              autoFocus
              maxLength={32}
              placeholder={type === 'text' ? 'e.g. design-reviews' : 'e.g. Standup Room'}
              className="w-full bg-input text-text-primary px-3 py-2 rounded-lg border border-white/[0.08] focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none text-xs transition-colors placeholder:text-text-muted/60"
            />
          </div>

          {/* Optional Topic */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1.5">
              Topic <span className="normal-case font-normal text-text-muted/70">(optional)</span>
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={submitting}
              maxLength={120}
              placeholder="What is this group about?"
              className="w-full bg-input text-text-primary px-3 py-2 rounded-lg border border-white/[0.08] focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none text-xs transition-colors placeholder:text-text-muted/60"
            />
          </div>

          {/* Private Group Toggle */}
          <div className="rounded-xl bg-canvas/60 border border-white/[0.06] p-3">
            <button
              type="button"
              onClick={() => setIsPrivate((prev) => !prev)}
              disabled={submitting}
              className="w-full flex items-center justify-between text-left"
            >
              <div className="flex items-center space-x-2.5">
                <Lock
                  className={clsx(
                    'w-4 h-4 flex-shrink-0 transition-colors',
                    isPrivate ? 'text-accent' : 'text-text-muted'
                  )}
                />
                <div>
                  <div className="text-xs font-medium text-text-primary">Private Group</div>
                  <div className="text-[10px] text-text-muted">
                    Only invited members can view or join
                  </div>
                </div>
              </div>

              <span
                className={clsx(
                  'w-9 h-5 rounded-full transition-colors p-0.5 flex items-center flex-shrink-0',
                  isPrivate ? 'bg-accent justify-end' : 'bg-card justify-start border border-white/[0.08]'
                )}
              >
                <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
              </span>
            </button>

            {/* Invite Friends Checkboxes when Private is Enabled */}
            {isPrivate && (
              <div className="mt-3 pt-3 border-t border-white/[0.06]">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-2">
                  Invite Friends ({selectedMembers.length})
                </div>
                {friends.length === 0 ? (
                  <div className="text-[11px] text-text-muted">
                    No friends to invite yet. You can invite them later.
                  </div>
                ) : (
                  <div className="space-y-1 max-h-32 overflow-y-auto pr-0.5">
                    {friends.map((friend) => {
                      const checked = selectedMembers.includes(friend.username);
                      const profile = profiles[friend.username.toLowerCase()];
                      return (
                        <button
                          key={friend.username}
                          type="button"
                          onClick={() => toggleMember(friend.username)}
                          className={clsx(
                            'w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors',
                            checked
                              ? 'bg-accent-muted text-text-primary'
                              : 'hover:bg-card/60 text-text-secondary'
                          )}
                        >
                          <div className="flex items-center space-x-2 truncate">
                            <UserAvatar
                              username={friend.username}
                              avatarUrl={profile?.avatarUrl || friend.avatarUrl}
                              size="xs"
                            />
                            <span className="truncate">{friend.username}</span>
                          </div>
                          <span
                            className={clsx(
                              'w-4 h-4 rounded flex items-center justify-center border flex-shrink-0',
                              checked
                                ? 'bg-accent border-accent text-white'
                                : 'border-white/[0.15] bg-canvas'
                            )}
                          >
                            {checked && <Check className="w-3 h-3" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-card transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="px-4 py-1.5 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-medium transition-colors flex items-center space-x-1.5 shadow-sm"
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <span>Create</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
