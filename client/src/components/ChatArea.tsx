import React, { useState, useRef, useEffect } from 'react';
import {
  Hash,
  Send,
  AlertCircle,
  RefreshCw,
  PlusCircle,
  Smile,
  Users,
  Bell,
  Pin,
  Video,
  Volume2,
} from 'lucide-react';
import clsx from 'clsx';
import type { Message, ConnectionStatus } from '../types';

interface ChatAreaProps {
  channelName: string;
  channelType?: 'text' | 'voice';
  channelTopic?: string;
  messages: Message[];
  currentUsername: string;
  connectionStatus: ConnectionStatus;
  errorMessage?: string | null;
  isInCall?: boolean;
  isCallViewActive?: boolean;
  onSendMessage: (content: string) => void;
  onReconnect?: () => void;
  onToggleUserList?: () => void;
  onToggleCallView?: () => void;
  onJoinCall?: () => void;
  showUserList?: boolean;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  channelName,
  channelType = 'text',
  channelTopic = 'Welcome to the channel! Keep conversations friendly and constructive.',
  messages,
  currentUsername,
  connectionStatus,
  errorMessage,
  isInCall = false,
  isCallViewActive = false,
  onSendMessage,
  onReconnect,
  onToggleUserList,
  onToggleCallView,
  onJoinCall,
  showUserList = true,
}) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom when messages update
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
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getAvatarColor = (name: string) => {
    const colors = [
      'bg-indigo-600',
      'bg-emerald-600',
      'bg-amber-600',
      'bg-rose-600',
      'bg-cyan-600',
      'bg-purple-600',
      'bg-blue-600',
      'bg-teal-600',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="flex-1 flex flex-col bg-discord-dark h-full min-w-0">
      {/* Channel Header */}
      <div className="h-12 border-b border-discord-darkest px-4 flex items-center justify-between shadow-sm bg-discord-dark z-10 flex-shrink-0">
        <div className="flex items-center space-x-2 truncate">
          {channelType === 'voice' ? (
            <Volume2 className="w-5 h-5 text-discord-muted flex-shrink-0" />
          ) : (
            <Hash className="w-5 h-5 text-discord-muted flex-shrink-0" />
          )}
          <h3 className="font-bold text-discord-heading text-sm truncate">{channelName}</h3>
          <span className="text-discord-muted text-xs">|</span>
          <span className="text-discord-muted text-xs truncate max-w-md hidden sm:inline">
            {channelTopic}
          </span>
        </div>

        <div className="flex items-center space-x-3 text-discord-muted">
          {/* Join Call or Toggle Video View Button */}
          {isInCall ? (
            <button
              type="button"
              onClick={onToggleCallView}
              className={clsx(
                'px-2.5 py-1 rounded text-xs font-semibold flex items-center space-x-1.5 transition-colors',
                isCallViewActive
                  ? 'bg-discord-blurple text-white hover:bg-discord-blurple-hover'
                  : 'bg-discord-online/20 text-discord-online hover:bg-discord-online/30'
              )}
              title={isCallViewActive ? 'Switch to Chat View' : 'Switch to Video Grid'}
            >
              <Video className="w-3.5 h-3.5" />
              <span>{isCallViewActive ? 'Chat View' : 'Call Grid'}</span>
            </button>
          ) : (
            onJoinCall && (
              <button
                type="button"
                onClick={onJoinCall}
                className="bg-discord-darker hover:bg-discord-hover text-discord-text hover:text-white px-2.5 py-1 rounded text-xs font-medium flex items-center space-x-1.5 transition-colors border border-white/5"
                title="Start Video Call"
              >
                <Video className="w-3.5 h-3.5 text-discord-online" />
                <span>Join Call</span>
              </button>
            )
          )}

          <button
            type="button"
            className="hover:text-discord-text transition-colors p-1"
            title="Notification Settings"
          >
            <Bell className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="hover:text-discord-text transition-colors p-1"
            title="Pinned Messages"
          >
            <Pin className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onToggleUserList}
            className={clsx(
              'p-1 transition-colors rounded',
              showUserList ? 'text-discord-heading' : 'hover:text-discord-text'
            )}
            title="Member List"
          >
            <Users className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Connection Status Banner (if not connected) */}
      {connectionStatus !== 'connected' && (
        <div
          className={clsx(
            'px-4 py-2 flex items-center justify-between text-xs font-medium z-10 transition-colors',
            connectionStatus === 'connecting'
              ? 'bg-discord-warning/20 text-discord-warning border-b border-discord-warning/30'
              : 'bg-discord-danger/20 text-discord-danger border-b border-discord-danger/30'
          )}
        >
          <div className="flex items-center space-x-2">
            {connectionStatus === 'connecting' ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
            )}
            <span>
              {connectionStatus === 'connecting'
                ? 'Connecting to WebSocket server...'
                : errorMessage || 'Disconnected from server.'}
            </span>
          </div>

          {onReconnect && connectionStatus !== 'connecting' && (
            <button
              onClick={onReconnect}
              type="button"
              className="bg-discord-danger hover:bg-discord-danger/80 text-white px-2.5 py-1 rounded text-xs font-semibold flex items-center space-x-1 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          )}
        </div>
      )}

      {/* Messages List Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12 select-none">
            <div className="w-16 h-16 rounded-full bg-discord-darker flex items-center justify-center mb-3">
              {channelType === 'voice' ? (
                <Volume2 className="w-8 h-8 text-discord-muted" />
              ) : (
                <Hash className="w-8 h-8 text-discord-muted" />
              )}
            </div>
            <h2 className="text-2xl font-bold text-discord-heading mb-1">
              Welcome to {channelType === 'voice' ? '' : '#'}{channelName}!
            </h2>
            <p className="text-discord-muted text-sm max-w-sm">
              This is the beginning of the {channelName} channel. Start typing a message below or join a voice/video call above.
            </p>
          </div>
        ) : (
          messages.map((msg, index) => {
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
                  className="flex items-center space-x-2 text-xs py-1 px-2 rounded font-medium text-discord-muted italic"
                >
                  <span
                    className={clsx('w-1.5 h-1.5 rounded-full', {
                      'bg-discord-online': msg.type === 'join' || msg.type === 'call-join',
                      'bg-discord-muted': msg.type === 'leave' || msg.type === 'call-leave',
                      'bg-discord-danger': msg.type === 'error',
                    })}
                  />
                  <span>
                    {msg.type === 'call-join'
                      ? `${msg.sender} started or joined a video call.`
                      : msg.type === 'call-leave'
                      ? `${msg.sender} left the call.`
                      : msg.content}
                  </span>
                  <span className="text-[10px] text-discord-muted/60 not-italic">
                    {formatTimestamp(msg.timestamp)}
                  </span>
                </div>
              );
            }

            const isSelf = msg.sender === currentUsername;

            return (
              <div
                key={`${msg.timestamp || index}-${msg.sender}`}
                className="flex items-start space-x-3 group hover:bg-black/10 -mx-4 px-4 py-1 rounded transition-colors"
              >
                {/* Avatar */}
                <div
                  className={clsx(
                    'w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 select-none shadow-sm',
                    getAvatarColor(msg.sender)
                  )}
                >
                  {msg.sender.charAt(0).toUpperCase()}
                </div>

                {/* Message Body */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline space-x-2">
                    <span
                      className={clsx('font-semibold text-sm hover:underline cursor-pointer', {
                        'text-discord-blurple': isSelf,
                        'text-discord-heading': !isSelf,
                      })}
                    >
                      {msg.sender}
                    </span>
                    {isSelf && (
                      <span className="bg-discord-blurple/20 text-discord-blurple text-[10px] font-bold px-1.5 py-0.2 rounded uppercase tracking-wider">
                        You
                      </span>
                    )}
                    <span className="text-[11px] text-discord-muted select-none">
                      {formatTimestamp(msg.timestamp)}
                    </span>
                  </div>

                  <div className="text-discord-text text-sm break-words mt-0.5 whitespace-pre-wrap leading-relaxed">
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input Container */}
      <div className="px-4 pb-6 pt-1 flex-shrink-0">
        <div className="bg-discord-input rounded-lg px-4 py-2.5 flex items-center shadow-inner focus-within:ring-1 focus-within:ring-discord-blurple transition-all">
          <button
            type="button"
            className="text-discord-muted hover:text-discord-text transition-colors mr-3"
            title="Add File"
          >
            <PlusCircle className="w-5 h-5" />
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${channelType === 'voice' ? '' : '#'}${channelName}`}
            disabled={connectionStatus !== 'connected'}
            className="flex-1 bg-transparent text-sm text-discord-heading placeholder-discord-muted focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />

          <div className="flex items-center space-x-2 ml-2">
            <button
              type="button"
              className="text-discord-muted hover:text-discord-text transition-colors p-1"
              title="Add Emoji"
            >
              <Smile className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!inputText.trim() || connectionStatus !== 'connected'}
              className={clsx(
                'p-1.5 rounded-md transition-all',
                inputText.trim() && connectionStatus === 'connected'
                  ? 'bg-discord-blurple text-white hover:bg-discord-blurple-hover cursor-pointer'
                  : 'text-discord-muted opacity-40 cursor-not-allowed'
              )}
              title="Send Message"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
