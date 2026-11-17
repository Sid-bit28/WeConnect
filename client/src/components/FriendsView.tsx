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
} from 'lucide-react';
import clsx from 'clsx';
import type { Friend, FriendRequest } from '../types';
import { getApiBaseUrl } from '../utils/api';

interface FriendsViewProps {
  token: string | null;
  currentUsername: string;
  onOpenChat?: (channelId: string) => void;
  onOpenAuth?: () => void;
}

type TabType = 'online' | 'all' | 'pending' | 'add';

export const FriendsView: React.FC<FriendsViewProps> = ({
  token,
  currentUsername,
  onOpenChat,
  onOpenAuth,
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
        // Handle various backend response formats gracefully
        if (Array.isArray(data)) {
          setFriends(data);
          setIncoming([]);
          setOutgoing([]);
        } else {
          setFriends(data.friends || []);
          // Normalize incoming format (string[] or object[])
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
  }, [fetchFriends]);

  const handleSendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage(null);
    setErrorMessage(null);

    const target = addFriendInput.trim();
    if (!target) return;
    if (target.toLowerCase() === currentUsername.toLowerCase()) {
      setErrorMessage("You cannot add yourself as a friend.");
      return;
    }

    if (!token) {
      if (onOpenAuth) onOpenAuth();
      return;
    }

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
        setSuccessMessage(`Success! Your friend request to ${target} was sent.`);
        setAddFriendInput('');
        fetchFriends();
      } else {
        setErrorMessage(data.error || data.message || `Failed to send friend request to ${target}.`);
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
      }
    } catch (err) {
      console.warn('Failed to reject request:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveFriend = async (friendUsername: string) => {
    if (!token) return;
    if (!confirm(`Are you sure you want to remove ${friendUsername} from your friends?`)) {
      return;
    }
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
      }
    } catch (err) {
      console.warn('Failed to remove friend:', err);
    } finally {
      setActionLoading(null);
    }
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

  const filteredFriends = friends.filter((f) => {
    const matchesSearch = f.username.toLowerCase().includes(searchQuery.toLowerCase());
    if (activeTab === 'online') {
      return matchesSearch && f.isOnline;
    }
    return matchesSearch;
  });

  const onlineCount = friends.filter((f) => f.isOnline).length;
  const pendingCount = incoming.length + outgoing.length;

  return (
    <div className="flex-1 flex flex-col bg-discord-dark h-full min-w-0 select-none">
      {/* Top Header & Sub-Tabs Navigation */}
      <div className="h-12 border-b border-discord-darkest px-6 flex items-center shadow-sm bg-discord-dark z-10 flex-shrink-0">
        <div className="flex items-center space-x-2 mr-6 text-discord-heading font-semibold text-sm">
          <Users className="w-5 h-5 text-discord-muted" />
          <span>Friends</span>
        </div>

        <div className="h-4 w-[1px] bg-white/10 mr-4" />

        <div className="flex items-center space-x-2 text-sm font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('online')}
            className={clsx(
              'px-2.5 py-1 rounded transition-colors',
              activeTab === 'online'
                ? 'bg-discord-active text-discord-heading font-semibold'
                : 'text-discord-muted hover:bg-discord-hover hover:text-discord-text'
            )}
          >
            Online {onlineCount > 0 && `(${onlineCount})`}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={clsx(
              'px-2.5 py-1 rounded transition-colors',
              activeTab === 'all'
                ? 'bg-discord-active text-discord-heading font-semibold'
                : 'text-discord-muted hover:bg-discord-hover hover:text-discord-text'
            )}
          >
            All {friends.length > 0 && `(${friends.length})`}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={clsx(
              'px-2.5 py-1 rounded transition-colors relative',
              activeTab === 'pending'
                ? 'bg-discord-active text-discord-heading font-semibold'
                : 'text-discord-muted hover:bg-discord-hover hover:text-discord-text'
            )}
          >
            Pending
            {pendingCount > 0 && (
              <span className="ml-1.5 bg-discord-danger text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                {pendingCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('add')}
            className={clsx(
              'px-2.5 py-1 rounded transition-colors font-semibold',
              activeTab === 'add'
                ? 'bg-discord-online text-white'
                : 'text-discord-online hover:bg-discord-online/10'
            )}
          >
            Add Friend
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* ADD FRIEND TAB */}
        {activeTab === 'add' ? (
          <div className="max-w-2xl">
            <h2 className="text-base font-bold text-discord-heading uppercase tracking-wide mb-2">
              Add Friend
            </h2>
            <p className="text-xs text-discord-muted mb-4">
              You can add friends with their WeConnect username.
            </p>

            <form
              onSubmit={handleSendRequest}
              className="bg-discord-darkest rounded-lg p-3 flex items-center border border-black/30 focus-within:border-discord-blurple transition-all shadow-inner"
            >
              <input
                type="text"
                value={addFriendInput}
                onChange={(e) => setAddFriendInput(e.target.value)}
                placeholder="Enter a Username"
                className="flex-1 bg-transparent text-sm text-discord-heading placeholder-discord-muted focus:outline-none px-2"
              />
              <button
                type="submit"
                disabled={!addFriendInput.trim() || actionLoading === 'add'}
                className="bg-discord-blurple hover:bg-discord-blurple-hover disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded transition-colors flex items-center space-x-1.5"
              >
                {actionLoading === 'add' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Send Friend Request</span>
                  </>
                )}
              </button>
            </form>

            {successMessage && (
              <div className="mt-3 text-xs text-discord-online flex items-center space-x-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                <span>{successMessage}</span>
              </div>
            )}

            {errorMessage && (
              <div className="mt-3 text-xs text-discord-danger flex items-center space-x-1.5 font-medium">
                <AlertCircle className="w-4 h-4" />
                <span>{errorMessage}</span>
              </div>
            )}

            {!token && (
              <div className="mt-6 p-4 bg-discord-blurple/10 border border-discord-blurple/30 rounded-lg text-xs text-discord-text flex items-center justify-between">
                <span>Please log in to your account to send and manage friend requests.</span>
                {onOpenAuth && (
                  <button
                    type="button"
                    onClick={onOpenAuth}
                    className="bg-discord-blurple hover:bg-discord-blurple-hover text-white px-3 py-1.5 rounded font-semibold transition-colors"
                  >
                    Log In
                  </button>
                )}
              </div>
            )}
          </div>
        ) : activeTab === 'pending' ? (
          /* PENDING TAB */
          <div className="max-w-3xl space-y-6">
            {/* Incoming Requests */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-discord-muted mb-3">
                Incoming Friend Requests — {incoming.length}
              </h3>
              {incoming.length === 0 ? (
                <div className="text-xs text-discord-muted py-2">
                  There are no pending incoming friend requests.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {incoming.map((req) => (
                    <div
                      key={req.username}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-discord-hover/40 transition-colors border-t border-white/5"
                    >
                      <div className="flex items-center space-x-3">
                        <div
                          className={clsx(
                            'w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shadow',
                            getAvatarColor(req.username)
                          )}
                        >
                          {req.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-sm text-discord-heading">
                            {req.username}
                          </div>
                          <div className="text-xs text-discord-muted">Incoming Friend Request</div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => handleAccept(req.username)}
                          disabled={actionLoading === `accept-${req.username}`}
                          className="w-9 h-9 rounded-full bg-discord-darkest hover:bg-discord-online text-discord-text hover:text-white flex items-center justify-center transition-colors shadow"
                          title="Accept"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(req.username)}
                          disabled={actionLoading === `reject-${req.username}`}
                          className="w-9 h-9 rounded-full bg-discord-darkest hover:bg-discord-danger text-discord-text hover:text-white flex items-center justify-center transition-colors shadow"
                          title="Decline"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Outgoing Requests */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-discord-muted mb-3">
                Outgoing Friend Requests — {outgoing.length}
              </h3>
              {outgoing.length === 0 ? (
                <div className="text-xs text-discord-muted py-2">
                  There are no pending outgoing friend requests.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {outgoing.map((req) => (
                    <div
                      key={req.username}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-discord-hover/40 transition-colors border-t border-white/5"
                    >
                      <div className="flex items-center space-x-3">
                        <div
                          className={clsx(
                            'w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shadow',
                            getAvatarColor(req.username)
                          )}
                        >
                          {req.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-sm text-discord-heading">
                            {req.username}
                          </div>
                          <div className="text-xs text-discord-muted">Outgoing Friend Request</div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleReject(req.username)}
                        disabled={actionLoading === `reject-${req.username}`}
                        className="w-9 h-9 rounded-full bg-discord-darkest hover:bg-discord-danger text-discord-muted hover:text-white flex items-center justify-center transition-colors shadow"
                        title="Cancel Request"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ONLINE & ALL TABS */
          <div className="max-w-3xl">
            {/* Search Input */}
            <div className="relative mb-5">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search"
                className="w-full bg-discord-darkest text-discord-heading pl-9 pr-4 py-2 rounded text-sm placeholder-discord-muted focus:outline-none border border-black/20"
              />
              <Search className="w-4 h-4 text-discord-muted absolute left-3 top-2.5" />
            </div>

            <h3 className="text-xs font-bold uppercase tracking-wider text-discord-muted mb-3">
              {activeTab === 'online' ? `Online — ${filteredFriends.length}` : `All Friends — ${filteredFriends.length}`}
            </h3>

            {loading ? (
              <div className="py-8 text-center text-discord-muted text-xs flex items-center justify-center space-x-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading friends...</span>
              </div>
            ) : filteredFriends.length === 0 ? (
              <div className="text-center py-12 select-none">
                <div className="w-16 h-16 rounded-full bg-discord-darker flex items-center justify-center mx-auto mb-3">
                  <Users className="w-8 h-8 text-discord-muted" />
                </div>
                <p className="text-sm font-semibold text-discord-heading mb-1">
                  {activeTab === 'online'
                    ? 'No friends are currently online.'
                    : 'No friends found.'}
                </p>
                <p className="text-xs text-discord-muted max-w-sm mx-auto">
                  {friends.length === 0
                    ? 'Click on the "Add Friend" tab above to send friend requests.'
                    : 'Try searching with a different term.'}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {filteredFriends.map((friend) => (
                  <div
                    key={friend.username}
                    className="flex items-center justify-between p-2.5 rounded-lg hover:bg-discord-hover/60 transition-colors group border-t border-white/5"
                  >
                    {/* User Profile */}
                    <div className="flex items-center space-x-3 truncate">
                      <div className="relative flex-shrink-0">
                        <div
                          className={clsx(
                            'w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shadow',
                            getAvatarColor(friend.username)
                          )}
                        >
                          {friend.username.charAt(0).toUpperCase()}
                        </div>
                        <span
                          className={clsx(
                            'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-discord-dark',
                            friend.isOnline ? 'bg-discord-online' : 'bg-discord-muted'
                          )}
                        />
                      </div>

                      <div className="truncate text-left leading-tight">
                        <div className="font-semibold text-sm text-discord-heading truncate">
                          {friend.username}
                        </div>
                        <div className="text-xs text-discord-muted truncate">
                          {friend.isOnline ? 'Online' : 'Offline'}
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center space-x-2">
                      {onOpenChat && (
                        <button
                          type="button"
                          onClick={() => onOpenChat('general')}
                          className="w-9 h-9 rounded-full bg-discord-darkest hover:bg-discord-hover text-discord-muted hover:text-white flex items-center justify-center transition-colors"
                          title="Message in #general"
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveFriend(friend.username)}
                        disabled={actionLoading === `remove-${friend.username}`}
                        className="w-9 h-9 rounded-full bg-discord-darkest hover:bg-discord-danger text-discord-muted hover:text-white flex items-center justify-center transition-colors"
                        title="Remove Friend"
                      >
                        <UserX className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
