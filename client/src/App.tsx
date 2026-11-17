import { useState, useRef, useEffect, useCallback } from 'react';
import { ChannelSidebar } from './components/ChannelSidebar';
import { ChatArea } from './components/ChatArea';
import { VideoGrid } from './components/VideoGrid';
import { UserList } from './components/UserList';
import { FriendsView } from './components/FriendsView';
import { AuthScreen } from './components/AuthScreen';
import { CreateChannelModal } from './components/CreateChannelModal';
import { NotificationToast, type NotificationItem } from './components/NotificationToast';
import { IncomingCallBanner, type IncomingCall } from './components/IncomingCallBanner';
import { useSocket } from './hooks/useSocket';
import { useWebRTC } from './hooks/useWebRTC';
import { useAuth } from './hooks/useAuth';
import type { Channel, Message, MessageData, AuthUser, Friend } from './types';
import { getApiBaseUrl } from './utils/api';
import { isDmRoom, getDmPeerUsername } from './utils/dm';
import { playNotificationChime, startRingtone } from './utils/sound';
import { Video, Loader2 } from 'lucide-react';

const DEFAULT_CHANNELS: Channel[] = [
  { id: 'random', name: 'Random', type: 'text', topic: 'Open group chat', createdBy: 'system' },
  { id: 'voice-lounge', name: 'Voice Lounge', type: 'voice', topic: 'Drop-in voice and video group', createdBy: 'system' },
];

interface AuthenticatedAppProps {
  user: AuthUser;
  token: string;
  onLogout: () => void;
}

function AuthenticatedApp({ user, token, onLogout }: AuthenticatedAppProps) {
  const activeUsername = user.username;

  const [channels, setChannels] = useState<Channel[]>(DEFAULT_CHANNELS);
  const [activeChannelId, setActiveChannelId] = useState<string>('random');
  const [isFriendsViewActive, setIsFriendsViewActive] = useState<boolean>(false);
  const [showUserList, setShowUserList] = useState<boolean>(true);
  const [isCallViewActive, setIsCallViewActive] = useState<boolean>(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsRefreshTrigger, setFriendsRefreshTrigger] = useState<number>(0);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState<boolean>(false);
  const [createChannelType, setCreateChannelType] = useState<'text' | 'voice'>('text');
  const [channelError, setChannelError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);

  const handleSignalRef = useRef<((msg: Message) => Promise<void>) | null>(null);
  const leaveCallRef = useRef<(() => void) | null>(null);
  const isInCallRef = useRef<boolean>(false);
  const activeChannelIdRef = useRef<string>(activeChannelId);
  const isFriendsViewActiveRef = useRef<boolean>(isFriendsViewActive);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const notificationRequestedRef = useRef<boolean>(false);
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const ringtoneStopRef = useRef<(() => void) | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAutoJoinRoomRef = useRef<string | null>(null);

  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
  }, [activeChannelId]);

  useEffect(() => {
    isFriendsViewActiveRef.current = isFriendsViewActive;
  }, [isFriendsViewActive]);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  const clearIncomingCall = useCallback(() => {
    if (ringtoneStopRef.current) {
      ringtoneStopRef.current();
      ringtoneStopRef.current = null;
    }
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    setIncomingCall(null);
  }, []);

  // Clean up toast timers & ringtone on unmount
  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      if (ringtoneStopRef.current) {
        ringtoneStopRef.current();
        ringtoneStopRef.current = null;
      }
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
    };
  }, []);

  const requestNotificationPermissionOnce = useCallback(() => {
    if (notificationRequestedRef.current) return;
    notificationRequestedRef.current = true;
    try {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    } catch {
      // Ignore permission request errors
    }
  }, []);

  const dismissNotification = useCallback((id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearUnread = useCallback((roomId: string) => {
    setUnreadCounts((prev) => {
      if (!prev[roomId]) return prev;
      const next = { ...prev };
      delete next[roomId];
      return next;
    });
  }, []);

  const openRoomDirect = useCallback(
    (roomId: string) => {
      setActiveChannelId(roomId);
      setIsFriendsViewActive(false);
      clearUnread(roomId);
    },
    [clearUnread]
  );

  const pushDmNotification = useCallback(
    (room: string, sender: string, preview: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const item: NotificationItem = {
        id,
        room,
        sender,
        preview: preview || 'Sent you a message',
        timestamp: Date.now(),
      };

      setNotifications((prev) => [...prev.slice(-3), item]);
      playNotificationChime();

      const timer = setTimeout(() => {
        toastTimersRef.current.delete(id);
        setNotifications((prev) => prev.filter((n) => n.id !== id));
      }, 5000);
      toastTimersRef.current.set(id, timer);

      // Fire native desktop notification if tab is hidden and permission granted
      try {
        if (
          typeof document !== 'undefined' &&
          document.hidden &&
          typeof window !== 'undefined' &&
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          const desktopNotif = new Notification(`${sender} sent a message`, {
            body: item.preview,
            tag: room,
          });
          desktopNotif.onclick = () => {
            window.focus();
            openRoomDirect(room);
            dismissNotification(id);
            desktopNotif.close();
          };
        }
      } catch {
        // Ignore browser Notification API errors
      }
    },
    [dismissNotification, openRoomDirect]
  );

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/channels`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        const list: Channel[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.channels)
          ? data.channels
          : [];
        if (list.length > 0) {
          setChannels(list);
          // If the active room was deleted by its creator, leave any call and return to Random
          if (!isDmRoom(activeChannelIdRef.current)) {
            const stillExists = list.some((c) => c.id === activeChannelIdRef.current);
            if (!stillExists) {
              if (isInCallRef.current && leaveCallRef.current) {
                leaveCallRef.current();
              }
              setActiveChannelId('random');
            }
          }
        }
      }
    } catch (err) {
      console.warn('Failed to fetch channels, using defaults:', err);
    }
  }, [token]);

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
    fetchChannels();
    fetchFriendsList();
  }, [fetchChannels, fetchFriendsList]);

  const {
    status,
    messages,
    isLoadingHistory,
    users,
    typingUsers,
    error: socketError,
    send,
    sendTyping,
    sendSignal,
    connect,
  } = useSocket(activeChannelId, activeUsername, {
    token,
    onMessage: (msg) => {
      if (msg.type === 'friend_update') {
        fetchFriendsList();
        setFriendsRefreshTrigger((prev) => prev + 1);
      } else if (msg.type === 'channel_update') {
        fetchChannels();
      } else if (msg.type === 'unread' && msg.room) {
        const isViewingRoom =
          !isFriendsViewActiveRef.current && msg.room === activeChannelIdRef.current;
        if (!isViewingRoom) {
          setUnreadCounts((prev) => ({
            ...prev,
            [msg.room]: (prev[msg.room] || 0) + 1,
          }));
          if (isDmRoom(msg.room) && msg.sender) {
            pushDmNotification(msg.room, msg.sender, msg.content || 'Sent you a message');
          }
        }
      } else if (msg.type === 'incoming_call' && msg.room && msg.sender) {
        if (
          !isInCallRef.current &&
          msg.sender.toLowerCase() !== activeUsername.toLowerCase()
        ) {
          clearIncomingCall();
          setIncomingCall({
            room: msg.room,
            sender: msg.sender,
            timestamp: msg.timestamp || Date.now(),
          });
          ringtoneStopRef.current = startRingtone();
          ringTimeoutRef.current = setTimeout(() => {
            clearIncomingCall();
          }, 30000);
        }
      } else if (msg.type === 'call_ended') {
        if (
          incomingCallRef.current &&
          (!msg.room || incomingCallRef.current.room === msg.room)
        ) {
          clearIncomingCall();
        }
      } else if (msg.type === 'call_declined' && msg.room && msg.sender) {
        pushDmNotification(msg.room, msg.sender, 'Declined the call');
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
    leaveCallRef.current = webrtc.leaveCall;
    isInCallRef.current = webrtc.isInCall;
  }, [webrtc.handleSignal, webrtc.leaveCall, webrtc.isInCall]);

  // Resolve active channel vs Direct Message room metadata
  const activeIsDm = isDmRoom(activeChannelId);
  const dmPeerRaw = activeIsDm ? getDmPeerUsername(activeChannelId, activeUsername) : null;
  const matchedFriend = dmPeerRaw
    ? friends.find((f) => f.username.toLowerCase() === dmPeerRaw.toLowerCase())
    : undefined;
  const activeChannel =
    channels.find((c) => c.id === activeChannelId) || channels[0] || DEFAULT_CHANNELS[0];

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

  // Auto-join call once WebSocket connects to the accepted DM call room
  useEffect(() => {
    if (
      status === 'connected' &&
      pendingAutoJoinRoomRef.current &&
      activeChannelId === pendingAutoJoinRoomRef.current &&
      !webrtc.isInCall
    ) {
      pendingAutoJoinRoomRef.current = null;
      void webrtc.joinCall();
    }
  }, [status, activeChannelId, webrtc.isInCall, webrtc.joinCall]);

  const handleAcceptIncomingCall = () => {
    const call = incomingCallRef.current;
    if (!call) return;
    clearIncomingCall();
    setNotifications((prev) => prev.filter((n) => n.room !== call.room));

    if (activeChannelId === call.room && status === 'connected') {
      setIsFriendsViewActive(false);
      clearUnread(call.room);
      void webrtc.joinCall();
    } else {
      pendingAutoJoinRoomRef.current = call.room;
      setActiveChannelId(call.room);
      setIsFriendsViewActive(false);
      clearUnread(call.room);
    }
  };

  const handleDeclineIncomingCall = () => {
    const call = incomingCallRef.current;
    clearIncomingCall();
    if (call) {
      send('call-decline', undefined, { target: call.sender, room: call.room });
    }
  };

  const handleSendMessage = (content: string, data?: MessageData) => {
    requestNotificationPermissionOnce();
    send('chat', content, data);
  };

  const handleChannelSelect = (channelId: string) => {
    requestNotificationPermissionOnce();
    const targetChannel = channels.find((c) => c.id === channelId);
    setActiveChannelId(channelId);
    setIsFriendsViewActive(false);
    clearUnread(channelId);
    // Clear any existing toasts for this room
    setNotifications((prev) => prev.filter((n) => n.room !== channelId));

    if (targetChannel?.type === 'voice' && !webrtc.isInCall) {
      webrtc.joinCall();
    }
  };

  const handleCreateChannel = async (payload: {
    name: string;
    type: 'text' | 'voice';
    topic: string;
  }): Promise<string | null> => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/channels`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return data.error || data.message || 'Failed to create group.';
      }
      await fetchChannels();
      const createdId = data.channel?.id || data.id;
      if (createdId) {
        setActiveChannelId(createdId);
        setIsFriendsViewActive(false);
        clearUnread(createdId);
      }
      return null;
    } catch (err: any) {
      return err?.message || 'Network error while creating group.';
    }
  };

  const handleDeleteChannel = async (channelId: string) => {
    if (channelId === 'random' || channelId === 'voice-lounge') return;
    setChannelError(null);
    const ch = channels.find((c) => c.id === channelId);
    const label = ch ? ch.name : channelId;
    if (!confirm(`Delete "${label}"?`)) return;

    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/channels?id=${encodeURIComponent(channelId)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (res.ok) {
        if (activeChannelId === channelId) {
          if (webrtc.isInCall) {
            webrtc.leaveCall();
          }
          setActiveChannelId('random');
          clearUnread('random');
        }
        await fetchChannels();
      } else {
        const data = await res.json().catch(() => ({}));
        setChannelError(data.error || data.message || 'Failed to delete room.');
      }
    } catch (err: any) {
      setChannelError(err?.message || 'Network error while deleting room.');
    }
  };

  const handleSelectFriends = () => {
    requestNotificationPermissionOnce();
    setIsFriendsViewActive(true);
  };

  const handleLogout = () => {
    clearIncomingCall();
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
        channels={channels}
        friends={friends}
        unreadCounts={unreadCounts}
        activeChannel={activeChannelId}
        onSelectChannel={handleChannelSelect}
        onOpenCreateChannel={(type) => {
          setChannelError(null);
          setCreateChannelType(type);
          setIsCreateChannelOpen(true);
        }}
        onDeleteChannel={handleDeleteChannel}
        channelError={channelError}
        onDismissChannelError={() => setChannelError(null)}
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
              openRoomDirect(roomId);
              setNotifications((prev) => prev.filter((n) => n.room !== roomId));
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
            audioDevices={webrtc.audioDevices}
            videoDevices={webrtc.videoDevices}
            selectedAudioDeviceId={webrtc.selectedAudioDeviceId}
            selectedVideoDeviceId={webrtc.selectedVideoDeviceId}
            onSwitchAudioDevice={webrtc.switchAudioDevice}
            onSwitchVideoDevice={webrtc.switchVideoDevice}
            onToggleAudio={webrtc.toggleAudio}
            onToggleVideo={webrtc.toggleVideo}
            onToggleScreenShare={webrtc.toggleScreenShare}
            onLeaveCall={webrtc.leaveCall}
            onBackToChat={() => setIsCallViewActive(false)}
          />
        ) : (
          <ChatArea
            roomId={activeChannelId}
            channelName={activeDisplayName}
            channelType={activeIsDm ? 'text' : activeChannel.type}
            channelTopic={activeIsDm ? undefined : activeChannel.topic}
            token={token}
            isDm={activeIsDm}
            isLoadingHistory={isLoadingHistory}
            messages={messages}
            currentUsername={activeUsername}
            connectionStatus={status}
            errorMessage={socketError}
            isInCall={webrtc.isInCall}
            isCallViewActive={isCallViewActive}
            memberCount={onlineUsers.length}
            typingUsers={typingUsers}
            onSendMessage={handleSendMessage}
            onTyping={sendTyping}
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

      {/* Create Group Modal */}
      <CreateChannelModal
        isOpen={isCreateChannelOpen}
        defaultType={createChannelType}
        onClose={() => setIsCreateChannelOpen(false)}
        onCreate={handleCreateChannel}
      />

      {/* Incoming 1-on-1 DM Call Banner */}
      <IncomingCallBanner
        call={incomingCall}
        onAccept={handleAcceptIncomingCall}
        onDecline={handleDeclineIncomingCall}
      />

      {/* Friend DM Notification Toasts */}
      <NotificationToast
        notifications={notifications}
        onOpenRoom={(roomId, notifId) => {
          openRoomDirect(roomId);
          dismissNotification(notifId);
        }}
        onDismiss={dismissNotification}
      />
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
