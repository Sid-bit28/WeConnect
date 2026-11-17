import { useState, useRef, useEffect, useCallback } from 'react';
import { ChannelSidebar } from './components/ChannelSidebar';
import { ChatArea } from './components/ChatArea';
import { VideoGrid } from './components/VideoGrid';
import { UserList } from './components/UserList';
import { FriendsView } from './components/FriendsView';
import { AuthScreen } from './components/AuthScreen';
import { useSocket } from './hooks/useSocket';
import { useWebRTC } from './hooks/useWebRTC';
import { useAuth } from './hooks/useAuth';
import type { Channel, Message, AuthUser, Friend } from './types';
import { getApiBaseUrl } from './utils/api';
import { isDmRoom, getDmPeerUsername } from './utils/dm';
import { Video, Loader2 } from 'lucide-react';

const DEFAULT_CHANNELS: Channel[] = [
  { id: 'general', name: 'general', type: 'text', topic: 'General workspace discussion' },
  { id: 'random', name: 'random', type: 'text', topic: 'Casual talk and off-topic' },
  { id: 'dev-chat', name: 'dev-chat', type: 'text', topic: 'Engineering, architecture, and releases' },
  { id: 'voice-lounge', name: 'Voice Lounge', type: 'voice', topic: 'Drop-in voice and video room' },
  { id: 'gaming', name: 'Gaming Room', type: 'voice', topic: 'Low-latency voice room' },
];

interface AuthenticatedAppProps {
  user: AuthUser;
  token: string;
  onLogout: () => void;
}

function AuthenticatedApp({ user, token, onLogout }: AuthenticatedAppProps) {
  const activeUsername = user.username;

  const [activeChannelId, setActiveChannelId] = useState<string>('general');
  const [isFriendsViewActive, setIsFriendsViewActive] = useState<boolean>(false);
  const [showUserList, setShowUserList] = useState<boolean>(true);
  const [isCallViewActive, setIsCallViewActive] = useState<boolean>(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsRefreshTrigger, setFriendsRefreshTrigger] = useState<number>(0);

  const handleSignalRef = useRef<((msg: Message) => Promise<void>) | null>(null);

  const fetchFriendsList = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/friends`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        const list: Friend[] = Array.isArray(data) ? data : data.friends || [];
        setFriends(list);
      }
    } catch (err) {
      console.warn('Failed to refresh sidebar friends list:', err);
    }
  }, [token]);

  useEffect(() => {
    fetchFriendsList();
  }, [fetchFriendsList]);

  const {
    status,
    messages,
    isLoadingHistory,
    users,
    error: socketError,
    send,
    sendSignal,
    connect,
  } = useSocket(activeChannelId, activeUsername, {
    token,
    onMessage: (msg) => {
      if (msg.type === 'friend_update') {
        fetchFriendsList();
        setFriendsRefreshTrigger((prev) => prev + 1);
      }
      if (handleSignalRef.current) {
        handleSignalRef.current(msg);
      }
    },
  });

  const webrtc = useWebRTC({
    room: activeChannelId,
    username: activeUsername,
    send,
    sendSignal,
    roomUsers: users,
  });

  useEffect(() => {
    handleSignalRef.current = webrtc.handleSignal;
  }, [webrtc.handleSignal]);

  // Resolve active channel vs Direct Message room metadata
  const activeIsDm = isDmRoom(activeChannelId);
  const dmPeerRaw = activeIsDm ? getDmPeerUsername(activeChannelId, activeUsername) : null;
  const matchedFriend = dmPeerRaw
    ? friends.find((f) => f.username.toLowerCase() === dmPeerRaw.toLowerCase())
    : undefined;
  const activeChannel =
    DEFAULT_CHANNELS.find((c) => c.id === activeChannelId) || DEFAULT_CHANNELS[0];

  const activeDisplayName = activeIsDm
    ? matchedFriend?.username || dmPeerRaw || 'Direct Message'
    : activeChannel.name;
  const activeCallLabel = activeIsDm ? `@${activeDisplayName}` : activeDisplayName;

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

    if (targetChannel?.type === 'voice' && !webrtc.isInCall) {
      webrtc.joinCall();
    }
  };

  const handleSelectFriends = () => {
    setIsFriendsViewActive(true);
  };

  const handleLogout = () => {
    if (webrtc.isInCall) {
      webrtc.leaveCall();
    }
    onLogout();
  };

  const onlineUsers = users.length > 0 ? users : [activeUsername];

  return (
    <div className="flex h-screen w-screen bg-canvas text-text-primary overflow-hidden font-sans">
      {/* Left Navigation Sidebar */}
      <ChannelSidebar
        channels={DEFAULT_CHANNELS}
        friends={friends}
        activeChannel={activeChannelId}
        onSelectChannel={handleChannelSelect}
        username={activeUsername}
        connectionStatus={status}
        isInCall={webrtc.isInCall}
        activeVoiceChannelName={activeCallLabel}
        onLeaveCall={webrtc.leaveCall}
        isFriendsActive={isFriendsViewActive}
        onSelectFriends={handleSelectFriends}
        onLogout={handleLogout}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full min-w-0 relative bg-canvas">
        {/* Compact In-Call Banner when browsing Chat or Friends */}
        {webrtc.isInCall && !isCallViewActive && (
          <div className="bg-online/10 border-b border-online/20 px-6 py-2 flex items-center justify-between text-xs font-medium text-online z-20 flex-shrink-0">
            <div className="flex items-center space-x-2">
              <span className="w-1.5 h-1.5 rounded-full bg-online animate-pulse" />
              <span>Active call in {activeCallLabel}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsFriendsViewActive(false);
                setIsCallViewActive(true);
              }}
              className="bg-online hover:bg-online/90 text-canvas px-3 py-1 rounded-lg font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
            >
              <Video className="w-3.5 h-3.5" />
              <span>Return to Call</span>
            </button>
          </div>
        )}

        {isFriendsViewActive ? (
          <FriendsView
            token={token}
            currentUsername={activeUsername}
            refreshTrigger={friendsRefreshTrigger}
            onFriendsChanged={fetchFriendsList}
            onOpenChat={(roomId) => {
              setActiveChannelId(roomId);
              setIsFriendsViewActive(false);
            }}
          />
        ) : isCallViewActive ? (
          <VideoGrid
            channelName={activeCallLabel}
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
            onBackToChat={() => setIsCallViewActive(false)}
          />
        ) : (
          <ChatArea
            channelName={activeDisplayName}
            channelType={activeIsDm ? 'text' : activeChannel.type}
            channelTopic={activeIsDm ? undefined : activeChannel.topic}
            isDm={activeIsDm}
            isLoadingHistory={isLoadingHistory}
            messages={messages}
            currentUsername={activeUsername}
            connectionStatus={status}
            errorMessage={socketError}
            isInCall={webrtc.isInCall}
            isCallViewActive={isCallViewActive}
            memberCount={onlineUsers.length}
            onSendMessage={handleSendMessage}
            onReconnect={connect}
            onToggleUserList={() => setShowUserList((prev) => !prev)}
            onToggleCallView={() => setIsCallViewActive((prev) => !prev)}
            onJoinCall={webrtc.joinCall}
            showUserList={showUserList}
          />
        )}
      </main>

      {/* Right Member Panel (Toggleable during Chat) */}
      {!isFriendsViewActive && !isCallViewActive && showUserList && (
        <UserList users={onlineUsers} currentUsername={activeUsername} />
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

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-canvas text-text-primary select-none">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/25 flex items-center justify-center">
            <span className="text-accent font-bold text-base">W</span>
          </div>
          <div className="flex items-center space-x-2 text-xs font-medium text-text-secondary">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
            <span>Loading WeConnect...</span>
          </div>
        </div>
      </div>
    );
  }

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

  return <AuthenticatedApp user={user} token={token} onLogout={logout} />;
}

export default App;
