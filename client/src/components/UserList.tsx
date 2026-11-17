import React from 'react';
import clsx from 'clsx';

interface UserListProps {
  users: string[];
  currentUsername: string;
}

export const UserList: React.FC<UserListProps> = ({ users, currentUsername }) => {
  // Sort users so current user is at top, followed alphabetically
  const sortedUsers = [...new Set(users)].sort((a, b) => {
    if (a === currentUsername) return -1;
    if (b === currentUsername) return 1;
    return a.localeCompare(b);
  });

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
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  };

  return (
    <div className="w-60 bg-discord-darker flex flex-col h-full select-none border-l border-discord-darkest/40 flex-shrink-0">
      <div className="px-4 py-3 flex-1 overflow-y-auto">
        <h4 className="text-[11px] font-bold tracking-wider text-discord-muted uppercase mb-2">
          Online — {sortedUsers.length}
        </h4>

        <div className="space-y-0.5">
          {sortedUsers.map((user) => {
            const isSelf = user === currentUsername;
            return (
              <div
                key={user}
                className="flex items-center px-2 py-1.5 rounded-md hover:bg-discord-hover/60 cursor-pointer group transition-colors"
              >
                {/* Avatar with Status Dot */}
                <div className="relative mr-3 flex-shrink-0">
                  <div
                    className={clsx(
                      'w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm',
                      getAvatarColor(user)
                    )}
                  >
                    {user.charAt(0).toUpperCase()}
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-discord-online border-2 border-discord-darker" />
                </div>

                {/* User Info */}
                <div className="truncate flex-1 min-w-0">
                  <div className="flex items-center space-x-1">
                    <span
                      className={clsx(
                        'text-sm font-medium truncate group-hover:text-discord-heading transition-colors',
                        isSelf ? 'text-discord-heading font-semibold' : 'text-discord-text'
                      )}
                    >
                      {user}
                    </span>
                    {isSelf && (
                      <span className="bg-discord-blurple/20 text-discord-blurple text-[9px] font-bold px-1 py-0.2 rounded uppercase tracking-wider">
                        You
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-discord-muted truncate">Active in room</p>
                </div>
              </div>
            );
          })}

          {sortedUsers.length === 0 && (
            <div className="text-xs text-discord-muted py-4 text-center">
              No users online in this channel
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
