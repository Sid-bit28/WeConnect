import { useState, useRef, useEffect } from 'react';
import { ChannelSidebar } from './components/ChannelSidebar';
import { ChatArea } from './components/ChatArea';
import { VideoGrid } from './components/VideoGrid';
import { UserList } from './components/UserList';
import { FriendsView } from './components/FriendsView';
import { AuthScreen } from './components/AuthScreen';
import { useSocket } from './hooks/useSocket';
import { useWebRTC } from './hooks/useWebRTC';
import { useAuth } from './hooks/useAuth';
import type { Channel, Message, AuthUser } from './types';
import { Compass, Plus, Radio, User, Video, Loader2 } from 'lucide-react';

const DEFAULT_CHANNELS: Channel[] = [
  { id: 'general', name: 'general', type: 'text', topic: 'General discussion and hangout' },
  { id: 'random', name: 'random', type: 'text', topic: 'Off-topic banter and memes' },
  { id: 'dev-chat', name: 'dev-chat', type: 'text', topic: 'Architecture, bugs, code reviews and tech discussions' },
  { id: 'voice-lounge', name: 'Voice Lounge', type: 'voice', topic: 'Drop-in audio and video lounge' },
  { id: 'gaming', name: 'Gaming', type: 'voice', topic: 'Low latency voice chat for gaming' },
];

interface AuthenticatedAppProps {
  user: AuthUser;
  token: string;
  onLogout: () => void;
}

function AuthenticatedApp({ user, token, onLogout }: AuthenticatedAppProps) {
  const activeUsername = user.username;

  // Active channel & view mode
  const [activeChannelId, setActiveChannelId] = useState<string>('general');
  const [isFriendsViewActive, setIsFriendsViewActive] = useState<boolean>(false);
  const [showUserList, setShowUserList] = useState<boolean>(true);
  const [isCallViewActive, setIsCallViewActive] = useState<boolean>(false);

  // Ref to route incoming socket messages to WebRTC handler
  const handleSignalRef = useRef<((msg: Message) => Promise<void>) | null>(null);

  // WebSocket hook connects strictly with authenticated username
  const { status, messages, users, error: socketError, send, sendSignal, connect } = useSocket(
    activeChannelId,
    activeUsername,
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
    username: activeUsername,
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
      setIsFriendsViewActive(false);
    } else {
      setIsCallViewActive(false);
    }
  }, [webrtc.isInCall]);

  const handleSendMessage = (content: string) => {
    send('chat', content);
  };

  const handleChannelSelect = (channelId: string) => {
    const targetChannel = DEFAULT_CHANNELS.find((c) => c.id === channelId);
    setActiveChannelId(channelId);
    setIsFriendsViewActive(false);

    // If clicking a voice channel and not yet in call, join call automatically
    if (targetChannel?.type === 'voice' && !webrtc.isInCall) {
      webrtc.joinCall();
    }
  };

  const handleSelectFriends = () => {
    setIsFriendsViewActive(true);
  };

  const handleLogout = () => {
    // Leave any active call before logging out
    if (webrtc.isInCall) {
      webrtc.leaveCall();
    }
    onLogout();
  };

  return (
    <div className="flex h-screen w-screen bg-discord-darkest text-discord-text overflow-hidden font-sans select-none">
      {/* 1. Leftmost Server Rail (Classic Discord Style) */}
      <div className="w-[72px] bg-discord-darkest flex flex-col items-center py-3 space-y-2 border-r border-black/20 flex-shrink-0 z-20">
        {/* WeConnect App Icon */}
        <button
          type="button"
          onClick={() => setIsFriendsViewActive(false)}
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
          onClick={() => setIsFriendsViewActive(false)}
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

        {/* User Profile Badge in Rail */}
        <div
          className="w-12 h-12 rounded-[24px] bg-discord-darker flex items-center justify-center text-discord-muted"
          title={`Signed in as ${activeUsername}`}
        >
          <User className="w-5 h-5" />
        </div>
      </div>

      {/* 2. Channel & Friends Sidebar */}
      <ChannelSidebar
        channels={DEFAULT_CHANNELS}
        activeChannel={activeChannelId}
        onSelectChannel={handleChannelSelect}
        username={activeUsername}
        serverName="WeConnect"
        connectionStatus={status}
        isInCall={webrtc.isInCall}
        activeVoiceChannelName={activeChannel.name}
        onLeaveCall={webrtc.leaveCall}
        isFriendsActive={isFriendsViewActive}
        onSelectFriends={handleSelectFriends}
        onLogout={handleLogout}
      />

      {/* 3. Center Area: FriendsView, VideoGrid, or ChatArea */}
      <div className="flex-1 flex flex-col h-full min-w-0 relative">
        {/* If in call and not viewing video grid, show Top In-Call Banner */}
        {webrtc.isInCall && !isCallViewActive && (
          <div className="bg-discord-online/20 border-b border-discord-online/30 px-4 py-2 flex items-center justify-between text-xs font-semibold text-discord-online z-20">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-discord-online animate-pulse" />
              <span>You are currently in a voice/video call in #{activeChannel.name}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsFriendsViewActive(false);
                setIsCallViewActive(true);
              }}
              className="bg-discord-online text-white px-3 py-1 rounded hover:bg-discord-online/90 flex items-center space-x-1.5 transition-colors cursor-pointer"
            >
              <Video className="w-3.5 h-3.5" />
              <span>Expand Video Grid</span>
            </button>
          </div>
        )}

        {isFriendsViewActive ? (
          <FriendsView
            token={token}
            currentUsername={activeUsername}
            onOpenChat={(channelId) => {
              setActiveChannelId(channelId);
              setIsFriendsViewActive(false);
            }}
          />
        ) : isCallViewActive ? (
          <VideoGrid
            localStream={webrtc.localStream}
            localScreenStream={webrtc.localScreenStream}
            peers={webrtc.peers}
            currentUsername={activeUsername}
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
            currentUsername={activeUsername}
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

      {/* 4. Right User List (Shown during Chat) */}
      {!isFriendsViewActive && showUserList && (
        <UserList
          users={users.length > 0 ? users : [activeUsername]}
          currentUsername={activeUsername}
        />
      )}
    </div>
  );
}

export function App() {
  const {
    user,
    token,
    isLoading,
    login,
    register,
    logout,
    error: authError,
    setError: setAuthError,
  } = useAuth();

  // 1. Initial Session Validation Loading Screen
  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-discord-darkest text-discord-text select-none">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-16 h-16 bg-discord-blurple rounded-2xl flex items-center justify-center shadow-lg animate-pulse">
            <Radio className="w-9 h-9 text-white" />
          </div>
          <div className="flex items-center space-x-2 text-sm font-semibold text-discord-heading">
            <Loader2 className="w-4 h-4 animate-spin text-discord-blurple" />
            <span>Loading WeConnect...</span>
          </div>
        </div>
      </div>
    );
  }

  // 2. Auth-First Gate: Unauthenticated users MUST log in or register first
  if (!user || !token) {
    return (
      <AuthScreen
        onLogin={login}
        onRegister={register}
        error={authError}
        onClearError={() => setAuthError(null)}
      />
    );
  }

  // 3. Authenticated Application: WebSocket and WebRTC only initialize with verified user
  return (
    <AuthenticatedApp
      user={user}
      token={token}
      onLogout={logout}
    />
  );
}

export default App;
