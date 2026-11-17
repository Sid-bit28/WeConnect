import React, { useState, useRef, useEffect } from 'react';
import {
  Hash,
  Volume2,
  Video,
  Users,
  ArrowUp,
  AlertCircle,
  RefreshCw,
  AtSign,
  Loader2,
} from 'lucide-react';
import clsx from 'clsx';
import type { Message, ConnectionStatus } from '../types';

interface ChatAreaProps {
  channelName: string;
  channelType?: 'text' | 'voice';
  channelTopic?: string;
  isDm?: boolean;
  isLoadingHistory?: boolean;
  messages: Message[];
  currentUsername: string;
  connectionStatus: ConnectionStatus;
  errorMessage?: string | null;
  isInCall?: boolean;
  isCallViewActive?: boolean;
  memberCount?: number;
  onSendMessage: (content: string) => void;
  onReconnect?: () => void;
  onToggleUserList?: () => void;
  onToggleCallView?: () => void;
  onJoinCall?: () => void;
  showUserList?: boolean;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export const ChatArea: React.FC<ChatAreaProps> = ({
  channelName,
  channelType = 'text',
  channelTopic,
  isDm = false,
  isLoadingHistory = false,
  messages,
  currentUsername,
  connectionStatus,
  errorMessage,
  isInCall = false,
  isCallViewActive = false,
  memberCount = 1,
  onSendMessage,
  onReconnect,
  onToggleUserList,
  onToggleCallView,
  onJoinCall,
  showUserList = true,
}) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInputText('');
  };

  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getAvatarStyle = (name: string) => {
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
  };

  return (
    <div className="flex-1 flex flex-col bg-canvas h-full min-w-0">
      {/* Refined Minimal Channel Header */}
      <header className="h-14 border-b border-white/[0.07] px-6 flex items-center justify-between bg-canvas/80 backdrop-blur-md z-10 flex-shrink-0">
        <div className="flex items-center space-x-2.5 min-w-0">
          {isDm ? (
            <AtSign className="w-4 h-4 text-accent flex-shrink-0" />
          ) : channelType === 'voice' ? (
            <Volume2 className="w-4 h-4 text-text-muted flex-shrink-0" />
          ) : (
            <Hash className="w-4 h-4 text-text-muted flex-shrink-0" />
          )}
          <h2 className="font-semibold text-sm text-text-primary tracking-tight truncate">
            {channelName}
          </h2>
          {(isDm || channelTopic) && (
            <>
              <span className="text-white/10 hidden sm:inline">/</span>
              <span className="text-xs text-text-muted truncate max-w-md hidden sm:inline">
                {isDm ? 'Direct Message' : channelTopic}
              </span>
            </>
          )}
        </div>

        {/* Purposeful Actions Only */}
        <div className="flex items-center space-x-2.5 flex-shrink-0">
          {isInCall ? (
            <button
              type="button"
              onClick={onToggleCallView}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-all',
                isCallViewActive
                  ? 'bg-accent text-white hover:bg-accent-hover'
                  : 'bg-online/15 text-online border border-online/25 hover:bg-online/25'
              )}
            >
              <Video className="w-3.5 h-3.5" />
              <span>{isCallViewActive ? 'Back to Chat' : 'Call Stage'}</span>
            </button>
          ) : (
            onJoinCall && (
              <button
                type="button"
                onClick={onJoinCall}
                className="px-3 py-1.5 rounded-lg bg-surface hover:bg-card border border-white/[0.08] text-text-primary text-xs font-medium flex items-center space-x-1.5 transition-all"
              >
                <Video className="w-3.5 h-3.5 text-online" />
                <span>Join Call</span>
              </button>
            )
          )}

          {onToggleUserList && (
            <button
              type="button"
              onClick={onToggleUserList}
              className={clsx(
                'px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center space-x-1.5 transition-all',
                showUserList
                  ? 'bg-card border-white/[0.1] text-text-primary'
                  : 'bg-transparent border-transparent text-text-muted hover:text-text-primary hover:bg-surface'
              )}
              title="Toggle Member List"
            >
              <Users className="w-3.5 h-3.5" />
              <span>{memberCount}</span>
            </button>
          )}
        </div>
      </header>

      {/* Connection Status Banner */}
      {connectionStatus !== 'connected' && (
        <div
          className={clsx(
            'px-6 py-2 flex items-center justify-between text-xs font-medium border-b z-10',
            connectionStatus === 'connecting'
              ? 'bg-warning-muted text-warning border-warning/20'
              : 'bg-danger-muted text-danger border-danger/20'
          )}
        >
          <div className="flex items-center space-x-2">
            {connectionStatus === 'connecting' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            )}
            <span>
              {connectionStatus === 'connecting'
                ? 'Connecting to server...'
                : errorMessage || 'Disconnected from server.'}
            </span>
          </div>

          {onReconnect && connectionStatus !== 'connecting' && (
            <button
              onClick={onReconnect}
              type="button"
              className="px-2.5 py-1 rounded-md bg-danger hover:bg-danger-hover text-white text-xs font-medium transition-colors"
            >
              Reconnect
            </button>
          )}
        </div>
      )}

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {isLoadingHistory && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center select-none">
            <Loader2 className="w-5 h-5 animate-spin text-accent mb-2" />
            <span className="text-xs text-text-muted">Loading messages...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto select-none">
            <div className="w-12 h-12 rounded-2xl bg-surface border border-white/[0.07] flex items-center justify-center mb-4">
              {isDm ? (
                <AtSign className="w-5 h-5 text-accent" />
              ) : channelType === 'voice' ? (
                <Volume2 className="w-5 h-5 text-text-muted" />
              ) : (
                <Hash className="w-5 h-5 text-text-muted" />
              )}
            </div>
            <h3 className="text-base font-semibold text-text-primary mb-1">
              {isDm
                ? `@${channelName}`
                : `Welcome to ${channelType === 'voice' ? '' : '#'}${channelName}`}
            </h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              {isDm
                ? `This is the start of your private conversation with @${channelName}. Send a message or start a 1-on-1 call.`
                : 'This is the start of the conversation. Send a message below or launch a live call.'}
            </p>
          </div>
        ) : (
          <div className="space-y-1 max-w-4xl">
            {messages.map((msg, index) => {
              const isSystem =
                msg.type === 'join' ||
                msg.type === 'leave' ||
                msg.type === 'error' ||
                msg.type === 'call-join' ||
                msg.type === 'call-leave';

              if (isSystem) {
                return (
                  <div
                    key={`${msg.timestamp || index}-${msg.sender}`}
                    className="flex items-center space-x-2 py-1.5 px-2 text-[11px] text-text-muted select-none"
                  >
                    <span
                      className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', {
                        'bg-online': msg.type === 'join' || msg.type === 'call-join',
                        'bg-text-muted': msg.type === 'leave' || msg.type === 'call-leave',
                        'bg-danger': msg.type === 'error',
                      })}
                    />
                    <span>
                      {msg.type === 'call-join'
                        ? `${msg.sender} joined the live call`
                        : msg.type === 'call-leave'
                        ? `${msg.sender} left the call`
                        : msg.content}
                    </span>
                    <span className="text-[10px] opacity-60">
                      {formatTimestamp(msg.timestamp)}
                    </span>
                  </div>
                );
              }

              // Check if consecutive message from the same sender within 5 minutes
              const prevMsg = index > 0 ? messages[index - 1] : null;
              const prevIsNormal =
                prevMsg &&
                prevMsg.type !== 'join' &&
                prevMsg.type !== 'leave' &&
                prevMsg.type !== 'error' &&
                prevMsg.type !== 'call-join' &&
                prevMsg.type !== 'call-leave';

              const isGrouped =
                prevIsNormal &&
                prevMsg.sender === msg.sender &&
                msg.timestamp &&
                prevMsg.timestamp &&
                msg.timestamp - prevMsg.timestamp <= GROUP_WINDOW_MS;

              const isSelf = msg.sender === currentUsername;

              if (isGrouped) {
                return (
                  <div
                    key={`${msg.timestamp || index}-${msg.sender}`}
                    className="flex items-baseline pl-[44px] pr-3 py-0.5 -mx-2 rounded-lg hover:bg-surface/60 transition-colors group relative"
                  >
                    <span className="absolute left-2 text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity select-none w-8 text-right">
                      {formatTimestamp(msg.timestamp)}
                    </span>
                    <div className="text-sm text-text-primary/90 break-words whitespace-pre-wrap leading-relaxed">
                      {msg.content}
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={`${msg.timestamp || index}-${msg.sender}`}
                  className="flex items-start space-x-3 pt-3 pb-0.5 px-2 -mx-2 rounded-lg hover:bg-surface/60 transition-colors group"
                >
                  {/* Minimal Avatar */}
                  <div
                    className={clsx(
                      'w-8 h-8 rounded-full border flex items-center justify-center font-semibold text-xs flex-shrink-0 select-none mt-0.5',
                      getAvatarStyle(msg.sender)
                    )}
                  >
                    {msg.sender.charAt(0).toUpperCase()}
                  </div>

                  {/* Message Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline space-x-2">
                      <span
                        className={clsx('font-semibold text-xs', {
                          'text-accent': isSelf,
                          'text-text-primary': !isSelf,
                        })}
                      >
                        {msg.sender}
                      </span>
                      <span className="text-[10px] text-text-muted select-none">
                        {formatTimestamp(msg.timestamp)}
                      </span>
                    </div>

                    <div className="text-sm text-text-primary/90 break-words mt-0.5 whitespace-pre-wrap leading-relaxed">
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating Rounded Input Bar */}
      <div className="px-6 pb-5 pt-2 flex-shrink-0">
        <div className="max-w-4xl bg-surface border border-white/[0.08] focus-within:border-accent/60 rounded-xl px-4 py-2 flex items-center space-x-3 transition-colors shadow-sm">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isDm
                ? `Message @${channelName}...`
                : `Message ${channelType === 'voice' ? '' : '#'}${channelName}...`
            }
            disabled={connectionStatus !== 'connected'}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-50"
          />

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!inputText.trim() || connectionStatus !== 'connected'}
            className={clsx(
              'w-7 h-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0',
              inputText.trim() && connectionStatus === 'connected'
                ? 'bg-accent text-white hover:bg-accent-hover cursor-pointer shadow-sm'
                : 'bg-card text-text-muted opacity-40 cursor-not-allowed'
            )}
            title="Send"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
