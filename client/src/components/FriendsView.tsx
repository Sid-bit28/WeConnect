import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  UserPlus,
  Check,
  X,
  MessageSquare,
  UserX,
  Search,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Menu,
} from 'lucide-react';
import clsx from 'clsx';
import type { Friend, FriendRequest, UserProfile } from '../types';
import { getApiBaseUrl } from '../utils/api';
import { getDmRoomId } from '../utils/dm';
import { UserAvatar } from './UserAvatar';

interface FriendsViewProps {
  token: string | null;
  currentUsername: string;
  profiles?: Record<string, UserProfile>;
  refreshTrigger?: number;
  onFriendsChanged?: () => void;
  onOpenChat?: (channelId: string) => void;
  onOpenMobileMenu?: () => void;
}

type TabType = 'online' | 'all' | 'pending' | 'add';

export const FriendsView: React.FC<FriendsViewProps> = ({
  token,
  currentUsername,
  profiles = {},
  refreshTrigger = 0,
  onFriendsChanged,
  onOpenChat,
  onOpenMobileMenu,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('online');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [addFriendInput, setAddFriendInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchFriends = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/friends`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setFriends(data);
          setIncoming([]);
          setOutgoing([]);
        } else {
          setFriends(data.friends || []);
          const normIncoming: FriendRequest[] = (data.incoming || []).map((item: any) =>
            typeof item === 'string' ? { username: item } : item
          );
          const normOutgoing: FriendRequest[] = (data.outgoing || []).map((item: any) =>
            typeof item === 'string' ? { username: item } : item
          );
          setIncoming(normIncoming);
          setOutgoing(normOutgoing);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch friends list:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchFriends();
  }, [fetchFriends, refreshTrigger]);

  const handleSendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage(null);
    setErrorMessage(null);

    const target = addFriendInput.trim();
    if (!target) return;
    if (target.toLowerCase() === currentUsername.toLowerCase()) {
      setErrorMessage('You cannot send a friend request to yourself.');
      return;
    }

    if (!token) return;

    setActionLoading('add');
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetUsername: target }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSuccessMessage(`Friend request sent to ${target}.`);
        setAddFriendInput('');
        fetchFriends();
      } else {
        setErrorMessage(data.error || data.message || `Could not send request to ${target}.`);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Network error occurred');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAccept = async (fromUsername: string) => {
    if (!token) return;
    setActionLoading(`accept-${fromUsername}`);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/friends/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ fromUsername }),
      });
      if (res.ok) {
        fetchFriends();
        onFriendsChanged?.();
      }
    } catch (err) {
      console.warn('Failed to accept request:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (fromUsername: string) => {
    if (!token) return;
    setActionLoading(`reject-${fromUsername}`);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/friends/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ fromUsername }),
      });
      if (res.ok) {
        fetchFriends();
        onFriendsChanged?.();
      }
    } catch (err) {
      console.warn('Failed to reject request:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveFriend = async (friendUsername: string) => {
    if (!token) return;
    if (!confirm(`Remove ${friendUsername} from your friends?`)) return;
    setActionLoading(`remove-${friendUsername}`);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/friends/remove`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ friendUsername }),
      });
      if (res.ok) {
        fetchFriends();
        onFriendsChanged?.();
      }
    } catch (err) {
      console.warn('Failed to remove friend:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const filteredFriends = friends.filter((f) => {
    const matchesSearch = f.username.toLowerCase().includes(searchQuery.toLowerCase());
    if (activeTab === 'online') return matchesSearch && f.isOnline;
    return matchesSearch;
  });

  const onlineCount = friends.filter((f) => f.isOnline).length;
  const pendingCount = incoming.length + outgoing.length;

  return (
    <div className="flex-1 flex flex-col bg-canvas h-full min-w-0 select-none">
      {/* Minimalist Top Bar */}
      <header className="h-14 border-b border-white/[0.07] px-3 sm:px-6 flex items-center bg-canvas/80 backdrop-blur-md z-10 flex-shrink-0 gap-2 sm:gap-4">
        <div className="flex items-center space-x-2 text-text-primary font-semibold text-sm flex-shrink-0">
          {onOpenMobileMenu && (
            <button
              type="button"
              onClick={onOpenMobileMenu}
              className="p-1.5 -ml-1 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface md:hidden flex-shrink-0"
              title="Open Channels"
            >
              <Menu className="w-4 h-4" />
            </button>
          )}
          <Users className="w-4 h-4 text-text-muted hidden sm:block" />
          <span className="hidden sm:inline">Friends</span>
        </div>

        <div className="h-4 w-[1px] bg-white/[0.08] hidden sm:block flex-shrink-0" />

        <div className="flex items-center space-x-1.5 text-xs font-medium overflow-x-auto whitespace-nowrap py-1 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setActiveTab('online')}
            className={clsx(
              'px-2.5 py-1.5 rounded-lg transition-colors',
              activeTab === 'online'
                ? 'bg-card text-text-primary border border-white/[0.08]'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface border border-transparent'
            )}
          >
            Online {onlineCount > 0 && <span className="ml-1 text-text-muted">{onlineCount}</span>}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={clsx(
              'px-2.5 py-1.5 rounded-lg transition-colors',
              activeTab === 'all'
                ? 'bg-card text-text-primary border border-white/[0.08]'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface border border-transparent'
            )}
          >
            All {friends.length > 0 && <span className="ml-1 text-text-muted">{friends.length}</span>}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={clsx(
              'px-2.5 py-1.5 rounded-lg transition-colors flex items-center',
              activeTab === 'pending'
                ? 'bg-card text-text-primary border border-white/[0.08]'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface border border-transparent'
            )}
          >
            <span>Pending</span>
            {pendingCount > 0 && (
              <span className="ml-1.5 bg-danger text-white text-[10px] px-1.5 py-0.2 rounded-full font-semibold">
                {pendingCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('add')}
            className={clsx(
              'px-3 py-1.5 rounded-lg transition-colors font-medium ml-2',
              activeTab === 'add'
                ? 'bg-accent text-white shadow-sm'
                : 'text-accent bg-accent-muted hover:bg-accent hover:text-white'
            )}
          >
            Add Friend
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'add' ? (
          <div className="max-w-xl">
            <h3 className="text-sm font-semibold text-text-primary mb-1">Add Friend</h3>
            <p className="text-xs text-text-secondary mb-4">
              Send a friend request using their exact WeConnect username.
            </p>

            <form
              onSubmit={handleSendRequest}
              className="bg-surface border border-white/[0.08] focus-within:border-accent/60 rounded-xl p-2 flex items-center space-x-2 transition-colors"
            >
              <input
                type="text"
                value={addFriendInput}
                onChange={(e) => setAddFriendInput(e.target.value)}
                placeholder="Enter username..."
                className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted focus:outline-none px-2.5"
              />
              <button
                type="submit"
                disabled={!addFriendInput.trim() || actionLoading === 'add'}
                className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-medium px-3.5 py-1.5 rounded-lg transition-colors flex items-center space-x-1.5"
              >
                {actionLoading === 'add' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Send Request</span>
                  </>
                )}
              </button>
            </form>

            {successMessage && (
              <div className="mt-3 text-xs text-online flex items-center space-x-1.5 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{successMessage}</span>
              </div>
            )}

            {errorMessage && (
              <div className="mt-3 text-xs text-danger flex items-center space-x-1.5 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>
        ) : activeTab === 'pending' ? (
          <div className="max-w-2xl space-y-6">
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">
                Incoming — {incoming.length}
              </h4>
              {incoming.length === 0 ? (
                <p className="text-xs text-text-muted">No incoming requests.</p>
              ) : (
                <div className="space-y-1.5">
                  {incoming.map((req) => (
                    <div
                      key={req.username}
                      className="flex items-center justify-between p-3 rounded-xl bg-surface/60 hover:bg-surface border border-white/[0.06] transition-colors"
                    >
                      <div className="flex items-center space-x-3">
                        <UserAvatar
                          username={req.username}
                          avatarUrl={profiles[req.username.toLowerCase()]?.avatarUrl}
                          size="md"
                        />
                        <div>
                          <div className="text-xs font-semibold text-text-primary">{req.username}</div>
                          <div className="text-[11px] text-text-muted">Incoming request</div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1.5">
                        <button
                          type="button"
                          onClick={() => handleAccept(req.username)}
                          disabled={actionLoading === `accept-${req.username}`}
                          className="p-2 rounded-lg bg-online/10 hover:bg-online text-online hover:text-white transition-colors"
                          title="Accept"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(req.username)}
                          disabled={actionLoading === `reject-${req.username}`}
                          className="p-2 rounded-lg bg-danger-muted hover:bg-danger text-danger hover:text-white transition-colors"
                          title="Decline"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">
                Outgoing — {outgoing.length}
              </h4>
              {outgoing.length === 0 ? (
                <p className="text-xs text-text-muted">No outgoing requests.</p>
              ) : (
                <div className="space-y-1.5">
                  {outgoing.map((req) => (
                    <div
                      key={req.username}
                      className="flex items-center justify-between p-3 rounded-xl bg-surface/60 hover:bg-surface border border-white/[0.06] transition-colors"
                    >
                      <div className="flex items-center space-x-3">
                        <UserAvatar
                          username={req.username}
                          avatarUrl={profiles[req.username.toLowerCase()]?.avatarUrl}
                          size="md"
                        />
                        <div>
                          <div className="text-xs font-semibold text-text-primary">{req.username}</div>
                          <div className="text-[11px] text-text-muted">Pending acceptance</div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleReject(req.username)}
                        disabled={actionLoading === `reject-${req.username}`}
                        className="p-2 rounded-lg bg-card hover:bg-danger text-text-muted hover:text-white transition-colors"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl">
            {/* Search Filter */}
            <div className="relative mb-5">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search friends..."
                className="w-full bg-surface text-text-primary pl-9 pr-3 py-2 rounded-xl text-xs placeholder:text-text-muted focus:outline-none border border-white/[0.07] focus:border-accent/50 transition-colors"
              />
              <Search className="w-3.5 h-3.5 text-text-muted absolute left-3 top-2.5" />
            </div>

            <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">
              {activeTab === 'online'
                ? `Online — ${filteredFriends.length}`
                : `All Friends — ${filteredFriends.length}`}
            </h4>

            {loading ? (
              <div className="py-10 text-center text-text-muted text-xs flex items-center justify-center space-x-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading...</span>
              </div>
            ) : filteredFriends.length === 0 ? (
              <div className="text-center py-14 select-none">
                <p className="text-sm font-medium text-text-primary mb-1">
                  {activeTab === 'online' ? 'No friends online' : 'No friends yet'}
                </p>
                <p className="text-xs text-text-muted">
                  Switch to Add Friend to connect with someone.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredFriends.map((friend) => {
                  const friendProfile = profiles[friend.username.toLowerCase()];
                  const presenceStatus = friend.isOnline
                    ? friendProfile?.status || friend.status || 'online'
                    : 'offline';
                  const statusLabel = !friend.isOnline
                    ? 'Offline'
                    : presenceStatus === 'dnd'
                    ? 'Do Not Disturb'
                    : presenceStatus === 'away'
                    ? 'Away'
                    : 'Online';

                  return (
                  <div
                    key={friend.username}
                    className="flex items-center justify-between p-3 rounded-xl bg-surface/60 hover:bg-surface border border-white/[0.06] transition-colors group"
                  >
                    <div className="flex items-center space-x-3 truncate">
                      <UserAvatar
                        username={friend.username}
                        avatarUrl={friendProfile?.avatarUrl || friend.avatarUrl}
                        status={presenceStatus}
                        showStatus={true}
                        size="md"
                      />

                      <div className="truncate leading-tight">
                        <div className="text-xs font-semibold text-text-primary truncate">
                          {friend.username}
                        </div>
                        <div className="text-[11px] text-text-muted">{statusLabel}</div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1.5">
                      {onOpenChat && (
                        <button
                          type="button"
                          onClick={() => onOpenChat(getDmRoomId(currentUsername, friend.username))}
                          className="p-2 rounded-lg bg-card hover:bg-accent text-text-secondary hover:text-white transition-colors"
                          title={`Message ${friend.username}`}
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveFriend(friend.username)}
                        disabled={actionLoading === `remove-${friend.username}`}
                        className="p-2 rounded-lg bg-card hover:bg-danger text-text-secondary hover:text-white transition-colors"
                        title="Remove Friend"
                      >
                        <UserX className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
