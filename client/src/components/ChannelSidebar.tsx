import React from 'react';
import { Hash, Volume2, Users, LogOut, PhoneOff, Plus, Trash2, AlertCircle, X } from 'lucide-react';
import clsx from 'clsx';
import type { Channel, Friend } from '../types';
import { getDmRoomId, isDmRoom } from '../utils/dm';

interface ChannelSidebarProps {
  channels: Channel[];
  friends?: Friend[];
  unreadCounts?: Record<string, number>;
  activeChannel: string;
  onSelectChannel: (channelId: string) => void;
  onOpenCreateChannel?: (defaultType: 'text' | 'voice') => void;
  onDeleteChannel?: (channelId: string) => void;
  channelError?: string | null;
  onDismissChannelError?: () => void;
  username: string;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  isInCall?: boolean;
  activeVoiceChannelName?: string;
  onLeaveCall?: () => void;
  isFriendsActive?: boolean;
  onSelectFriends?: () => void;
  onLogout: () => void;
}

export const ChannelSidebar: React.FC<ChannelSidebarProps> = ({
  channels,
  friends = [],
  unreadCounts = {},
  activeChannel,
  onSelectChannel,
  onOpenCreateChannel,
  onDeleteChannel,
  channelError,
  onDismissChannelError,
  username,
  connectionStatus,
  isInCall = false,
  activeVoiceChannelName = 'Voice Lounge',
  onLeaveCall,
  isFriendsActive = false,
  onSelectFriends,
  onLogout,
}) => {
  const textChannels = channels.filter((c) => c.type !== 'voice');
  const voiceChannels = channels.filter((c) => c.type === 'voice');

  const formatUnread = (count?: number) => {
    if (!count || count <= 0) return null;
    return count > 99 ? '99+' : String(count);
  };

  // Total unread across all DM rooms for the Friends nav badge
  const totalUnreadDms = Object.entries(unreadCounts).reduce(
    (sum, [roomId, count]) => (isDmRoom(roomId) ? sum + count : sum),
    0
  );
  const totalUnreadDmLabel = formatUnread(totalUnreadDms);

  // Strictly creator-only deletion: never system defaults, never rooms created by others
  const canDeleteChannel = (ch: Channel): boolean => {
    if (!onDeleteChannel) return false;
    if (ch.id === 'random' || ch.id === 'voice-lounge') return false;
    if (!ch.createdBy) return false;
    const creator = ch.createdBy.trim().toLowerCase();
    if (creator === 'system') return false;
    return creator === username.trim().toLowerCase();
  };

  return (
    <aside className="w-60 bg-surface border-r border-white/[0.07] flex flex-col h-full select-none flex-shrink-0">
      {/* Brand Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-white/[0.06] flex-shrink-0">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-accent/15 border border-accent/25 flex items-center justify-center flex-shrink-0">
            <span className="text-accent font-bold text-xs">W</span>
          </div>
          <span className="font-semibold text-sm text-text-primary tracking-tight truncate">
            WeConnect
          </span>
        </div>

        {/* Minimal Live Status Indicator */}
        <span
          className={clsx('w-2 h-2 rounded-full flex-shrink-0 transition-colors', {
            'bg-online shadow-[0_0_8px_rgba(16,185,129,0.5)]': connectionStatus === 'connected',
            'bg-warning animate-pulse': connectionStatus === 'connecting',
            'bg-danger': connectionStatus === 'error' || connectionStatus === 'disconnected',
          })}
          title={`Connection: ${connectionStatus}`}
        />
      </div>

      {/* Inline Channel Error Banner */}
      {channelError && (
        <div className="mx-3 mt-3 px-2.5 py-2 rounded-lg bg-danger-muted border border-danger/25 text-[11px] text-danger flex items-start justify-between space-x-1.5">
          <div className="flex items-start space-x-1.5 min-w-0">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span className="leading-snug break-words">{channelError}</span>
          </div>
          {onDismissChannelError && (
            <button
              type="button"
              onClick={onDismissChannelError}
              className="p-0.5 rounded hover:bg-danger/20 flex-shrink-0"
              title="Dismiss"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Navigation Sections */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {/* Friends Button */}
        {onSelectFriends && (
          <div>
            <button
              type="button"
              onClick={onSelectFriends}
              className={clsx(
                'w-full flex items-center px-2.5 py-2 rounded-lg text-xs font-medium transition-all duration-150',
                isFriendsActive
                  ? 'bg-card text-text-primary border border-white/[0.08] shadow-sm'
                  : 'text-text-secondary hover:bg-card/50 hover:text-text-primary border border-transparent'
              )}
            >
              <Users
                className={clsx('w-4 h-4 mr-2.5 flex-shrink-0', {
                  'text-accent': isFriendsActive,
                  'text-text-muted': !isFriendsActive,
                })}
              />
              <span className="flex-1 text-left">Friends</span>
              {totalUnreadDmLabel && (
                <span className="px-1.5 py-0.2 rounded-full bg-accent text-white text-[10px] font-semibold leading-tight">
                  {totalUnreadDmLabel}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Group Chats Section */}
        <div>
          <div className="px-2.5 mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              Group Chats
            </span>
            {onOpenCreateChannel && (
              <button
                type="button"
                onClick={() => onOpenCreateChannel('text')}
                className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-card transition-colors"
                title="Create Group Chat"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="space-y-0.5">
            {textChannels.map((channel) => {
              const isActive = !isFriendsActive && activeChannel === channel.id;
              const unreadLabel = formatUnread(unreadCounts[channel.id]);
              const showDelete = canDeleteChannel(channel);
              return (
                <div
                  key={channel.id}
                  className={clsx(
                    'w-full flex items-center rounded-lg text-xs font-medium transition-all duration-150 group',
                    isActive
                      ? 'bg-card text-text-primary shadow-sm border border-white/[0.06]'
                      : unreadLabel
                      ? 'text-text-primary hover:bg-card/40 border border-transparent'
                      : 'text-text-secondary hover:bg-card/40 hover:text-text-primary border border-transparent'
                  )}
                >
                  <button
                    onClick={() => onSelectChannel(channel.id)}
                    type="button"
                    className="flex-1 flex items-center px-2.5 py-1.5 min-w-0 text-left"
                  >
                    <Hash
                      className={clsx('w-3.5 h-3.5 mr-2 flex-shrink-0 transition-colors', {
                        'text-accent': isActive,
                        'text-text-muted group-hover:text-text-secondary': !isActive,
                      })}
                    />
                    <span className="truncate flex-1">{channel.name}</span>
                  </button>

                  {unreadLabel && (
                    <span className="mr-1.5 px-1.5 py-0.2 rounded-full bg-accent text-white text-[10px] font-semibold leading-tight flex-shrink-0">
                      {unreadLabel}
                    </span>
                  )}

                  {showDelete && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteChannel?.(channel.id);
                      }}
                      className="mr-1.5 p-1 rounded text-text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      title={`Delete #${channel.name}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Voice Groups Section */}
        <div>
          <div className="px-2.5 mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              Voice Groups
            </span>
            {onOpenCreateChannel && (
              <button
                type="button"
                onClick={() => onOpenCreateChannel('voice')}
                className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-card transition-colors"
                title="Create Voice Group"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="space-y-0.5">
            {voiceChannels.map((channel) => {
              const isActive = !isFriendsActive && activeChannel === channel.id;
              const unreadLabel = formatUnread(unreadCounts[channel.id]);
              const showDelete = canDeleteChannel(channel);
              return (
                <div
                  key={channel.id}
                  className={clsx(
                    'w-full flex items-center rounded-lg text-xs font-medium transition-all duration-150 group',
                    isActive
                      ? 'bg-card text-text-primary shadow-sm border border-white/[0.06]'
                      : 'text-text-secondary hover:bg-card/40 hover:text-text-primary border border-transparent'
                  )}
                >
                  <button
                    onClick={() => onSelectChannel(channel.id)}
                    type="button"
                    className="flex-1 flex items-center px-2.5 py-1.5 min-w-0 text-left"
                  >
                    <Volume2
                      className={clsx('w-3.5 h-3.5 mr-2 flex-shrink-0 transition-colors', {
                        'text-online': isInCall && isActive,
                        'text-accent': isActive && !isInCall,
                        'text-text-muted group-hover:text-text-secondary': !isActive,
                      })}
                    />
                    <span className="truncate flex-1">{channel.name}</span>
                  </button>

                  {isInCall && isActive && (
                    <span className="mr-1.5 text-[10px] font-medium text-online bg-online/10 px-1.5 py-0.5 rounded-full flex-shrink-0">
                      Live
                    </span>
                  )}

                  {!isInCall && unreadLabel && (
                    <span className="mr-1.5 px-1.5 py-0.2 rounded-full bg-accent text-white text-[10px] font-semibold leading-tight flex-shrink-0">
                      {unreadLabel}
                    </span>
                  )}

                  {showDelete && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteChannel?.(channel.id);
                      }}
                      className="mr-1.5 p-1 rounded text-text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      title={`Delete ${channel.name}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Direct Messages Section */}
        <div>
          <div className="px-2.5 mb-2 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
            Direct Messages
          </div>
          {friends.length === 0 ? (
            <div className="px-2.5 py-1 text-[11px] text-text-muted/70">
              No friends yet
            </div>
          ) : (
            <div className="space-y-0.5">
              {friends.map((friend) => {
                const dmRoomId = getDmRoomId(username, friend.username);
                const isActive = !isFriendsActive && activeChannel === dmRoomId;
                const unreadLabel = formatUnread(unreadCounts[dmRoomId]);
                return (
                  <button
                    key={friend.username}
                    onClick={() => onSelectChannel(dmRoomId)}
                    type="button"
                    className={clsx(
                      'w-full flex items-center px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 group',
                      isActive
                        ? 'bg-card text-text-primary shadow-sm border border-white/[0.06]'
                        : unreadLabel
                        ? 'text-text-primary hover:bg-card/40 border border-transparent'
                        : 'text-text-secondary hover:bg-card/40 hover:text-text-primary border border-transparent'
                    )}
                  >
                    <div className="relative mr-2.5 flex-shrink-0">
                      <div className="w-5 h-5 rounded-full bg-surface-elevated border border-white/[0.08] flex items-center justify-center text-[10px] font-semibold text-text-primary uppercase">
                        {friend.username.charAt(0)}
                      </div>
                      <span
                        className={clsx(
                          'absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-surface',
                          friend.isOnline ? 'bg-online' : 'bg-text-muted/60'
                        )}
                      />
                    </div>
                    <span className="truncate flex-1 text-left">{friend.username}</span>
                    {isInCall && isActive ? (
                      <span className="text-[10px] font-medium text-online bg-online/10 px-1.5 py-0.5 rounded-full">
                        Live
                      </span>
                    ) : unreadLabel ? (
                      <span className="px-1.5 py-0.2 rounded-full bg-accent text-white text-[10px] font-semibold leading-tight">
                        {unreadLabel}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      {/* Active Call Dock */}
      {isInCall && (
        <div className="mx-3 mb-3 p-2.5 rounded-xl bg-canvas border border-online/25 flex items-center justify-between">
          <div className="min-w-0 pr-2">
            <div className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-online animate-pulse flex-shrink-0" />
              <span className="text-[11px] font-semibold text-online">Connected</span>
            </div>
            <div className="text-[11px] text-text-secondary truncate mt-0.5">
              {activeVoiceChannelName}
            </div>
          </div>
          {onLeaveCall && (
            <button
              type="button"
              onClick={onLeaveCall}
              className="p-1.5 rounded-lg bg-danger/10 hover:bg-danger text-danger hover:text-white transition-colors flex-shrink-0"
              title="Disconnect Call"
            >
              <PhoneOff className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Minimal User Footer */}
      <div className="h-14 px-3 border-t border-white/[0.06] flex items-center justify-between bg-canvas/30 flex-shrink-0">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="relative flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center text-xs font-semibold text-accent uppercase">
              {username.charAt(0)}
            </div>
            <span
              className={clsx(
                'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface',
                connectionStatus === 'connected' ? 'bg-online' : 'bg-text-muted'
              )}
            />
          </div>
          <div className="truncate leading-tight">
            <div className="text-xs font-medium text-text-primary truncate">{username}</div>
            <div className="text-[10px] text-text-muted capitalize">
              {connectionStatus === 'connected' ? 'Online' : connectionStatus}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger-muted transition-colors flex-shrink-0"
          title="Sign Out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};
