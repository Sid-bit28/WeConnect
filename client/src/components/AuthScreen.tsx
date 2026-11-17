import React, { useState } from 'react';
import { Radio, AlertCircle, Loader2 } from 'lucide-react';

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
    <div className="flex h-screen w-screen items-center justify-center bg-discord-darkest text-discord-text p-4 select-none relative overflow-hidden font-sans">
      {/* Background ambient lighting */}
      <div className="absolute w-[500px] h-[500px] bg-discord-blurple/10 rounded-full blur-3xl pointer-events-none -top-24 -left-24" />
      <div className="absolute w-[400px] h-[400px] bg-discord-online/5 rounded-full blur-3xl pointer-events-none -bottom-20 -right-20" />

      {/* Main Auth Card */}
      <div className="relative w-full max-w-md bg-discord-darker rounded-xl shadow-2xl border border-white/5 overflow-hidden p-8 sm:p-10 z-10">
        {/* Branding & Header */}
        <div className="text-center mb-7">
          <div className="w-16 h-16 bg-discord-blurple rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg ring-4 ring-discord-blurple/20">
            <Radio className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-discord-heading tracking-tight">
            {isRegister ? 'Create an account' : 'Welcome back!'}
          </h1>
          <p className="text-sm text-discord-muted mt-1.5">
            {isRegister
              ? 'Join WeConnect to start chatting, calling, and sharing.'
              : "We're excited to see you again! Please log in to continue."}
          </p>
        </div>

        {/* Error Alert */}
        {displayError && (
          <div className="mb-5 bg-discord-danger/15 border border-discord-danger/30 rounded-lg p-3 flex items-start space-x-2.5 text-xs text-discord-danger font-medium leading-relaxed">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{displayError}</span>
          </div>
        )}

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold tracking-wider uppercase text-discord-muted mb-1.5">
              Username <span className="text-discord-danger">*</span>
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
              autoFocus
              className="w-full bg-discord-darkest text-discord-heading px-3.5 py-2.5 rounded-md border border-black/50 focus:border-discord-blurple focus:ring-1 focus:ring-discord-blurple focus:outline-none text-sm transition-all"
              placeholder="Enter your username"
            />
          </div>

          <div>
            <label className="block text-xs font-bold tracking-wider uppercase text-discord-muted mb-1.5">
              Password <span className="text-discord-danger">*</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className="w-full bg-discord-darkest text-discord-heading px-3.5 py-2.5 rounded-md border border-black/50 focus:border-discord-blurple focus:ring-1 focus:ring-discord-blurple focus:outline-none text-sm transition-all"
              placeholder="Enter your password"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-discord-blurple hover:bg-discord-blurple-hover disabled:opacity-50 text-white font-semibold py-2.5 rounded-md transition-all text-sm flex items-center justify-center space-x-2 shadow-md mt-6 cursor-pointer"
          >
            {submitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <span>{isRegister ? 'Register' : 'Log In'}</span>
            )}
          </button>
        </form>

        {/* Toggle Login / Register */}
        <div className="mt-6 text-xs text-discord-muted text-center pt-2 border-t border-white/5">
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
                className="text-discord-blurple hover:underline font-semibold ml-1 cursor-pointer"
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
                className="text-discord-blurple hover:underline font-semibold ml-1 cursor-pointer"
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
