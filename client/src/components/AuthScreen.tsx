import React, { useState } from 'react';
import { AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { WeConnectLogo } from './WeConnectLogo';

interface AuthScreenProps {
  onLogin: (username: string, password: string) => Promise<boolean>;
  onRegister: (username: string, password: string) => Promise<boolean>;
  error?: string | null;
  onClearError?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onLogin,
  onRegister,
  error,
  onClearError,
}) => {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    if (isRegister) {
      await onRegister(trimmedUser, password);
    } else {
      await onLogin(trimmedUser, password);
    }
    setSubmitting(false);
  };

  const displayError = localError || error;

  return (
    <div className="flex h-[100dvh] w-screen items-center justify-center bg-canvas text-text-primary p-4 select-none relative overflow-y-auto">
      {/* Subtle modern radial ambient background */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-accent/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Main Container */}
      <div className="relative w-full max-w-sm z-10">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <WeConnectLogo size="xl" className="mb-3.5" />
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">
            WeConnect
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            {isRegister
              ? 'Create a workspace account to begin'
              : 'Sign in to access channels and calls'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface border border-white/[0.08] rounded-2xl p-6 sm:p-7 shadow-2xl backdrop-blur-sm">
          {/* Tabs */}
          <div className="flex rounded-lg bg-canvas/80 p-0.5 border border-white/[0.04] mb-5">
            <button
              type="button"
              onClick={() => {
                setIsRegister(false);
                setLocalError(null);
                if (onClearError) onClearError();
              }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                !isRegister
                  ? 'bg-card text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setIsRegister(true);
                setLocalError(null);
                if (onClearError) onClearError();
              }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                isRegister
                  ? 'bg-card text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Register
            </button>
          </div>

          {/* Error Banner */}
          {displayError && (
            <div className="mb-4 bg-danger-muted border border-danger/20 rounded-lg p-2.5 flex items-start space-x-2 text-xs text-danger font-medium">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="leading-snug">{displayError}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wider text-text-secondary mb-1.5">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
                autoFocus
                className="w-full bg-input text-text-primary px-3 py-2 rounded-lg border border-white/[0.08] focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none text-xs transition-colors placeholder:text-text-muted/60"
                placeholder="Enter username"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wider text-text-secondary mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                className="w-full bg-input text-text-primary px-3 py-2 rounded-lg border border-white/[0.08] focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none text-xs transition-colors placeholder:text-text-muted/60"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-medium py-2 px-3 rounded-lg text-xs transition-all shadow-sm flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <span>{isRegister ? 'Create Account' : 'Continue'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
