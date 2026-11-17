import React, { useState } from 'react';
import { Radio, AlertCircle, Loader2, X } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onLogin: (username: string, password: string) => Promise<boolean>;
  onRegister: (username: string, password: string) => Promise<boolean>;
  error?: string | null;
  onClearError?: () => void;
  allowClose?: boolean;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onLogin,
  onRegister,
  error,
  onClearError,
  allowClose = true,
}) => {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (onClearError) onClearError();

    const trimmedUser = username.trim();
    if (!trimmedUser) {
      setLocalError('Username is required.');
      return;
    }
    if (trimmedUser.length < 3) {
      setLocalError('Username must be at least 3 characters.');
      return;
    }
    if (!password) {
      setLocalError('Password is required.');
      return;
    }
    if (password.length < 4) {
      setLocalError('Password must be at least 4 characters.');
      return;
    }

    setSubmitting(true);
    let success = false;
    if (isRegister) {
      success = await onRegister(trimmedUser, password);
    } else {
      success = await onLogin(trimmedUser, password);
    }
    setSubmitting(false);

    if (success && onClose) {
      onClose();
    }
  };

  const displayError = localError || error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md bg-discord-darker rounded-lg shadow-2xl border border-white/5 overflow-hidden p-8 text-discord-text">
        {/* Close Button if dismissible */}
        {allowClose && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 text-discord-muted hover:text-white transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Logo / Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-discord-blurple rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg">
            <Radio className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-discord-heading">
            {isRegister ? 'Create an account' : 'Welcome back!'}
          </h2>
          <p className="text-sm text-discord-muted mt-1">
            {isRegister
              ? 'Join WeConnect to chat, voice call, and make friends.'
              : "We're so excited to see you again!"}
          </p>
        </div>

        {/* Error Banner */}
        {displayError && (
          <div className="mb-4 bg-discord-danger/15 border border-discord-danger/30 rounded-md p-3 flex items-start space-x-2 text-xs text-discord-danger font-medium">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{displayError}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold tracking-wide uppercase text-discord-muted mb-1.5">
              Username <span className="text-discord-danger">*</span>
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
              autoFocus
              className="w-full bg-discord-darkest text-discord-heading px-3 py-2.5 rounded border border-black/40 focus:border-discord-blurple focus:outline-none text-sm transition-colors"
              placeholder="e.g. shadow_ninja"
            />
          </div>

          <div>
            <label className="block text-xs font-bold tracking-wide uppercase text-discord-muted mb-1.5">
              Password <span className="text-discord-danger">*</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className="w-full bg-discord-darkest text-discord-heading px-3 py-2.5 rounded border border-black/40 focus:border-discord-blurple focus:outline-none text-sm transition-colors"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-discord-blurple hover:bg-discord-blurple-hover disabled:opacity-50 text-white font-semibold py-2.5 rounded transition-all text-sm flex items-center justify-center space-x-2 shadow-md mt-6"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <span>{isRegister ? 'Register' : 'Log In'}</span>
            )}
          </button>
        </form>

        {/* Switch Login / Register Mode */}
        <div className="mt-5 text-xs text-discord-muted text-center">
          {isRegister ? (
            <span>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setIsRegister(false);
                  setLocalError(null);
                  if (onClearError) onClearError();
                }}
                className="text-discord-blurple hover:underline font-medium"
              >
                Log In
              </button>
            </span>
          ) : (
            <span>
              Need an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setIsRegister(true);
                  setLocalError(null);
                  if (onClearError) onClearError();
                }}
                className="text-discord-blurple hover:underline font-medium"
              >
                Register
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
