import { useState, useRef, useEffect } from 'react';
import { ChannelSidebar } from './components/ChannelSidebar';
import { ChatArea } from './components/ChatArea';
import { VideoGrid } from './components/VideoGrid';
import { UserList } from './components/UserList';
import { useSocket } from './hooks/useSocket';
import { useWebRTC } from './hooks/useWebRTC';
import type { Channel, Message } from './types';
import { Compass, Plus, Radio, User, Check, Video } from 'lucide-react';

const DEFAULT_CHANNELS: Channel[] = [
  { id: 'general', name: 'general', type: 'text', topic: 'General discussion and hangout' },
  { id: 'random', name: 'random', type: 'text', topic: 'Off-topic banter and memes' },
  { id: 'dev-chat', name: 'dev-chat', type: 'text', topic: 'Architecture, bugs, code reviews and tech discussions' },
  { id: 'voice-lounge', name: 'Voice Lounge', type: 'voice', topic: 'Drop-in audio and video lounge' },
  { id: 'gaming', name: 'Gaming', type: 'voice', topic: 'Low latency voice chat for gaming' },
];

export function App() {
  // Username management (persisted in localStorage)
  const [username, setUsername] = useState<string>(() => {
    const saved = localStorage.getItem('weconnect_username');
    if (saved && saved.trim()) return saved.trim();
    return `User${Math.floor(1000 + Math.random() * 9000)}`;
  });

  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [tempUsername, setTempUsername] = useState(username);

  // Active channel & view mode
  const [activeChannelId, setActiveChannelId] = useState<string>('general');
  const [showUserList, setShowUserList] = useState<boolean>(true);
  const [isCallViewActive, setIsCallViewActive] = useState<boolean>(false);

  // Ref to route incoming socket messages to WebRTC handler
  const handleSignalRef = useRef<((msg: Message) => Promise<void>) | null>(null);

  // WebSocket hook
  const { status, messages, users, error: socketError, send, sendSignal, connect } = useSocket(
    activeChannelId,
    username,
    {
      onMessage: (msg) => {
        if (handleSignalRef.current) {
          handleSignalRef.current(msg);
        }
      },
    }
  );

  // WebRTC hook
  const webrtc = useWebRTC({
    room: activeChannelId,
    username,
    send,
    sendSignal,
    roomUsers: users,
  });

  // Keep ref updated
  useEffect(() => {
    handleSignalRef.current = webrtc.handleSignal;
  }, [webrtc.handleSignal]);

  const activeChannel =
    DEFAULT_CHANNELS.find((c) => c.id === activeChannelId) || DEFAULT_CHANNELS[0];

  // Auto show video grid when entering call, and auto hide when leaving
  useEffect(() => {
    if (webrtc.isInCall) {
      setIsCallViewActive(true);
    } else {
      setIsCallViewActive(false);
    }
  }, [webrtc.isInCall]);

  const handleSendMessage = (content: string) => {
    send('chat', content);
  };

  const handleSaveUsername = () => {
    const trimmed = tempUsername.trim();
    if (trimmed && trimmed !== username) {
      setUsername(trimmed);
      localStorage.setItem('weconnect_username', trimmed);
    }
    setIsEditingUsername(false);
  };

  const handleChannelSelect = (channelId: string) => {
    const targetChannel = DEFAULT_CHANNELS.find((c) => c.id === channelId);
    setActiveChannelId(channelId);

    // If clicking a voice channel and not yet in call, join call automatically
    if (targetChannel?.type === 'voice' && !webrtc.isInCall) {
      webrtc.joinCall();
    }
  };

  return (
    <div className="flex h-screen w-screen bg-discord-darkest text-discord-text overflow-hidden font-sans select-none">
      {/* 1. Leftmost Server Rail (Classic Discord Style) */}
      <div className="w-[72px] bg-discord-darkest flex flex-col items-center py-3 space-y-2 border-r border-black/20 flex-shrink-0 z-20">
        {/* WeConnect App Icon */}
        <button
          type="button"
          className="w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-discord-blurple flex items-center justify-center text-white transition-all duration-200 group relative shadow-md"
          title="WeConnect Home"
        >
          <span className="absolute -left-3 w-2 h-10 bg-white rounded-r-full" />
          <Radio className="w-6 h-6 group-hover:scale-110 transition-transform" />
        </button>

        <div className="w-8 h-[2px] bg-discord-darker rounded my-1" />

        {/* Server 1 Icon */}
        <button
          type="button"
          className="w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-discord-darker hover:bg-discord-blurple flex items-center justify-center text-discord-text hover:text-white transition-all duration-200 group font-bold text-sm"
          title="Main Hub"
        >
          WC
        </button>

        {/* Add Server & Explore Buttons */}
        <button
          type="button"
          className="w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-discord-darker hover:bg-discord-online flex items-center justify-center text-discord-online hover:text-white transition-all duration-200 group"
          title="Add a Server"
        >
          <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-200" />
        </button>

        <button
          type="button"
          className="w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-discord-darker hover:bg-discord-blurple flex items-center justify-center text-discord-text hover:text-white transition-all duration-200 group"
          title="Explore Public Servers"
        >
          <Compass className="w-5 h-5 group-hover:scale-110 transition-transform" />
        </button>

        <div className="flex-1" />

        {/* Change Username Button */}
        <button
          type="button"
          onClick={() => {
            setTempUsername(username);
            setIsEditingUsername(true);
          }}
          className="w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-discord-darker hover:bg-discord-hover flex items-center justify-center text-discord-muted hover:text-white transition-all"
          title="Change Username"
        >
          <User className="w-5 h-5" />
        </button>
      </div>

      {/* 2. Channel Sidebar */}
      <ChannelSidebar
        channels={DEFAULT_CHANNELS}
        activeChannel={activeChannelId}
        onSelectChannel={handleChannelSelect}
        username={username}
        serverName="WeConnect"
        connectionStatus={status}
        isInCall={webrtc.isInCall}
        activeVoiceChannelName={activeChannel.name}
        onLeaveCall={webrtc.leaveCall}
      />

      {/* 3. Center Area: Either VideoGrid or ChatArea (or Pip toggle) */}
      <div className="flex-1 flex flex-col h-full min-w-0 relative">
        {/* If in call and currently viewing chat, show Top In-Call Pip Banner */}
        {webrtc.isInCall && !isCallViewActive && (
          <div className="bg-discord-online/20 border-b border-discord-online/30 px-4 py-2 flex items-center justify-between text-xs font-semibold text-discord-online z-20">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-discord-online animate-pulse" />
              <span>You are currently in a voice/video call in #{activeChannel.name}</span>
            </div>
            <button
              type="button"
              onClick={() => setIsCallViewActive(true)}
              className="bg-discord-online text-white px-3 py-1 rounded hover:bg-discord-online/90 flex items-center space-x-1.5 transition-colors"
            >
              <Video className="w-3.5 h-3.5" />
              <span>Expand Video Grid</span>
            </button>
          </div>
        )}

        {isCallViewActive ? (
          <VideoGrid
            localStream={webrtc.localStream}
            peers={webrtc.peers}
            currentUsername={username}
            isAudioMuted={webrtc.isAudioMuted}
            isVideoOff={webrtc.isVideoOff}
            isScreenSharing={webrtc.isScreenSharing}
            error={webrtc.error}
            onToggleAudio={webrtc.toggleAudio}
            onToggleVideo={webrtc.toggleVideo}
            onToggleScreenShare={webrtc.toggleScreenShare}
            onLeaveCall={webrtc.leaveCall}
          />
        ) : (
          <ChatArea
            channelName={activeChannel.name}
            channelType={activeChannel.type}
            channelTopic={activeChannel.topic}
            messages={messages}
            currentUsername={username}
            connectionStatus={status}
            errorMessage={socketError}
            isInCall={webrtc.isInCall}
            isCallViewActive={isCallViewActive}
            onSendMessage={handleSendMessage}
            onReconnect={connect}
            onToggleUserList={() => setShowUserList((prev) => !prev)}
            onToggleCallView={() => setIsCallViewActive((prev) => !prev)}
            onJoinCall={webrtc.joinCall}
            showUserList={showUserList}
          />
        )}
      </div>

      {/* 4. Right User List */}
      {showUserList && (
        <UserList
          users={users.length > 0 ? users : [username]}
          currentUsername={username}
        />
      )}

      {/* Username Change Modal */}
      {isEditingUsername && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-discord-darker border border-discord-darkest rounded-lg max-w-sm w-full p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-discord-heading mb-1">Change Display Name</h3>
            <p className="text-xs text-discord-muted mb-4">
              Enter your desired username for chat and presence.
            </p>

            <div className="mb-4">
              <label className="text-[11px] font-bold uppercase text-discord-muted block mb-1">
                Username
              </label>
              <input
                type="text"
                value={tempUsername}
                onChange={(e) => setTempUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveUsername();
                  if (e.key === 'Escape') setIsEditingUsername(false);
                }}
                autoFocus
                maxLength={24}
                className="w-full bg-discord-input text-discord-heading px-3 py-2 rounded text-sm focus:outline-none focus:ring-1 focus:ring-discord-blurple"
              />
            </div>

            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setIsEditingUsername(false)}
                className="px-4 py-1.5 text-xs font-semibold text-discord-text hover:underline"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveUsername}
                disabled={!tempUsername.trim()}
                className="bg-discord-blurple hover:bg-discord-blurple-hover disabled:opacity-50 text-white px-4 py-1.5 rounded text-xs font-semibold transition-colors flex items-center space-x-1"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
