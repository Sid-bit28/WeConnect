import React, { useState, useEffect } from 'react';
import { X, Hash, Volume2, AlertCircle, Loader2 } from 'lucide-react';
import clsx from 'clsx';

interface CreateChannelModalProps {
  isOpen: boolean;
  defaultType?: 'text' | 'voice';
  onClose: () => void;
  onCreate: (payload: { name: string; type: 'text' | 'voice'; topic: string }) => Promise<string | null>;
}

export const CreateChannelModal: React.FC<CreateChannelModalProps> = ({
  isOpen,
  defaultType = 'text',
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('');
  const [type, setType] = useState<'text' | 'voice'>(defaultType);
  const [topic, setTopic] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setType(defaultType);
      setTopic('');
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen, defaultType]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 32) {
      setError('Channel name must be between 2 and 32 characters.');
      return;
    }

    setSubmitting(true);
    const errMsg = await onCreate({
      name: trimmedName,
      type,
      topic: topic.trim(),
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
                <Hash className={clsx('w-3.5 h-3.5', type === 'text' ? 'text-accent' : 'text-text-muted')} />
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
                <Volume2 className={clsx('w-3.5 h-3.5', type === 'voice' ? 'text-accent' : 'text-text-muted')} />
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
              placeholder="What is this channel about?"
              className="w-full bg-input text-text-primary px-3 py-2 rounded-lg border border-white/[0.08] focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none text-xs transition-colors placeholder:text-text-muted/60"
            />
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
