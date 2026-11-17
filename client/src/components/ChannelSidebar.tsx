import React from 'react';
import {
  Hash,
  Volume2,
  Mic,
  Headphones,
  Settings,
  ChevronDown,
  Plus,
  PhoneOff,
  Signal,
  Users,
  LogOut,
} from 'lucide-react';
import clsx from 'clsx';
import type { Channel } from '../types';

interface ChannelSidebarProps {
  channels: Channel[];
  activeChannel: string;
  onSelectChannel: (channelId: string) => void;
  username: string;
  serverName?: string;
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
  activeChannel,
  onSelectChannel,
  username,
  serverName = 'WeConnect',
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

  return (
    <div className="w-60 bg-discord-darker flex flex-col h-full select-none border-r border-discord-darkest/40 flex-shrink-0">
      {/* Server Header */}
      <div className="h-12 border-b border-discord-darkest px-4 flex items-center justify-between font-bold text-discord-heading shadow-sm hover:bg-discord-hover/50 cursor-pointer transition-colors">
        <div className="flex items-center space-x-2 truncate">
          <span className="truncate">{serverName}</span>
          <span
            className={clsx('w-2 h-2 rounded-full inline-block flex-shrink-0', {
              'bg-discord-online': connectionStatus === 'connected',
              'bg-discord-warning': connectionStatus === 'connecting',
              'bg-discord-danger': connectionStatus === 'error' || connectionStatus === 'disconnected',
            })}
            title={`Status: ${connectionStatus}`}
          />
        </div>
        <ChevronDown className="w-4 h-4 text-discord-muted" />
      </div>

      {/* Channels & Friends Navigation List */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {/* Top Direct Messages / Friends Button */}
        {onSelectFriends && (
          <div>
            <button
              type="button"
              onClick={onSelectFriends}
              className={clsx(
                'w-full flex items-center px-3 py-2 rounded-md text-sm font-medium transition-all group relative text-left',
                isFriendsActive
                  ? 'bg-discord-active text-discord-heading shadow-sm'
                  : 'text-discord-muted hover:bg-discord-hover hover:text-discord-text'
              )}
            >
              {isFriendsActive && (
                <span className="absolute -left-2 w-1 h-5 bg-white rounded-r-full" />
              )}
              <Users
                className={clsx('w-4 h-4 mr-2.5 flex-shrink-0', {
                  'text-discord-heading': isFriendsActive,
                  'text-discord-muted group-hover:text-discord-text': !isFriendsActive,
                })}
              />
              <span className="truncate flex-1 font-semibold">Friends</span>
            </button>
            <div className="h-[1px] bg-white/5 my-2 mx-1" />
          </div>
        )}

        {/* Text Channels Section */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1 text-[11px] font-bold tracking-wider text-discord-muted uppercase">
            <span>Text Channels</span>
            <button
              className="text-discord-muted hover:text-discord-heading transition-colors"
              title="Add Channel"
              type="button"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-0.5">
            {textChannels.map((channel) => {
              const isActive = !isFriendsActive && activeChannel === channel.id;
              return (
                <button
                  key={channel.id}
                  onClick={() => onSelectChannel(channel.id)}
                  type="button"
                  className={clsx(
                    'w-full flex items-center px-2 py-1.5 rounded-md text-sm font-medium transition-all group relative text-left',
                    isActive
                      ? 'bg-discord-active text-discord-heading'
                      : 'text-discord-muted hover:bg-discord-hover hover:text-discord-text'
                  )}
                >
                  {/* Left pill indicator for active channel */}
                  {isActive && (
                    <span className="absolute -left-2 w-1 h-5 bg-white rounded-r-full" />
                  )}
                  <Hash
                    className={clsx('w-4 h-4 mr-2 flex-shrink-0', {
                      'text-discord-heading': isActive,
                      'text-discord-muted group-hover:text-discord-text': !isActive,
                    })}
                  />
                  <span className="truncate flex-1">{channel.name}</span>
                  {channel.unreadCount ? (
                    <span className="bg-discord-danger text-white text-xs px-1.5 py-0.5 rounded-full font-bold ml-1">
                      {channel.unreadCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Voice Channels Section */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1 text-[11px] font-bold tracking-wider text-discord-muted uppercase">
            <span>Voice Channels</span>
          </div>
          <div className="space-y-0.5">
            {voiceChannels.map((channel) => {
              const isActive = !isFriendsActive && activeChannel === channel.id;
              return (
                <button
                  key={channel.id}
                  onClick={() => onSelectChannel(channel.id)}
                  type="button"
                  className={clsx(
                    'w-full flex items-center px-2 py-1.5 rounded-md text-sm font-medium transition-all group relative text-left',
                    isActive
                      ? 'bg-discord-active text-discord-heading'
                      : 'text-discord-muted hover:bg-discord-hover hover:text-discord-text'
                  )}
                >
                  {isActive && (
                    <span className="absolute -left-2 w-1 h-5 bg-white rounded-r-full" />
                  )}
                  <Volume2
                    className={clsx('w-4 h-4 mr-2 flex-shrink-0', {
                      'text-discord-online animate-pulse': isInCall && isActive,
                      'text-discord-heading': isActive && !isInCall,
                      'text-discord-muted group-hover:text-discord-text': !isActive,
                    })}
                  />
                  <span className="truncate flex-1">{channel.name}</span>
                  {isInCall && isActive && (
                    <span className="text-[10px] text-discord-online font-bold uppercase tracking-wider">
                      Live
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Voice Connected Banner (When in Call) */}
      {isInCall && (
        <div className="bg-discord-darkest/90 border-t border-discord-darkest px-3 py-2 flex items-center justify-between select-none">
          <div className="flex items-center space-x-2 text-discord-online min-w-0">
            <Signal className="w-4 h-4 flex-shrink-0" />
            <div className="truncate leading-tight">
              <div className="text-discord-online font-bold text-[11px] tracking-wide">
                Voice Connected
              </div>
              <div className="text-discord-muted text-[10px] truncate max-w-[130px]">
                {activeVoiceChannelName} / WebRTC
              </div>
            </div>
          </div>
          {onLeaveCall && (
            <button
              type="button"
              onClick={onLeaveCall}
              className="p-1 hover:bg-discord-danger/20 rounded text-discord-muted hover:text-discord-danger transition-colors flex-shrink-0"
              title="Disconnect Call"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* User Status Bar at the bottom */}
      <div className="h-14 bg-discord-darkest/70 px-2 flex items-center justify-between border-t border-discord-darkest/40">
        <div className="flex items-center space-x-2 overflow-hidden flex-1 mr-1">
          <div className="relative flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-discord-blurple flex items-center justify-center font-semibold text-white text-sm uppercase">
              {username.charAt(0) || 'U'}
            </div>
            <span
              className={clsx(
                'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-discord-darkest',
                {
                  'bg-discord-online': connectionStatus === 'connected',
                  'bg-discord-warning': connectionStatus === 'connecting',
                  'bg-discord-danger': connectionStatus === 'error' || connectionStatus === 'disconnected',
                }
              )}
            />
          </div>
          <div className="truncate text-left leading-tight">
            <div className="text-sm font-semibold text-discord-heading truncate">{username}</div>
            <div className="text-[11px] text-discord-muted truncate capitalize">
              {connectionStatus === 'connected' ? 'Online' : connectionStatus}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-0.5 text-discord-muted">
          <button
            type="button"
            className="p-1.5 hover:bg-discord-hover hover:text-discord-text rounded transition-colors"
            title="Mute"
          >
            <Mic className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="p-1.5 hover:bg-discord-hover hover:text-discord-text rounded transition-colors"
            title="Deafen"
          >
            <Headphones className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="p-1.5 hover:bg-discord-hover hover:text-discord-text rounded transition-colors"
            title="User Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Logout Button */}
          <button
            type="button"
            onClick={onLogout}
            className="p-1.5 hover:bg-discord-danger/20 hover:text-discord-danger rounded transition-colors"
            title="Log Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
