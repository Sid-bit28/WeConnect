import React from 'react';
import clsx from 'clsx';

interface UserListProps {
  users: string[];
  currentUsername: string;
}

export const UserList: React.FC<UserListProps> = ({ users, currentUsername }) => {
  const sortedUsers = [...new Set(users)].sort((a, b) => {
    if (a === currentUsername) return -1;
    if (b === currentUsername) return 1;
    return a.localeCompare(b);
  });

  const getAvatarStyle = (name: string) => {
    const styles = [
      'bg-indigo-500/15 text-indigo-300 border-indigo-500/25',
      'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
      'bg-amber-500/15 text-amber-300 border-amber-500/25',
      'bg-rose-500/15 text-rose-300 border-rose-500/25',
      'bg-cyan-500/15 text-cyan-300 border-cyan-500/25',
      'bg-violet-500/15 text-violet-300 border-violet-500/25',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return styles[Math.abs(hash) % styles.length];
  };

  return (
    <aside className="w-56 bg-surface border-l border-white/[0.07] flex flex-col h-full select-none flex-shrink-0">
      <div className="h-14 px-4 border-b border-white/[0.06] flex items-center flex-shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
          Members — {sortedUsers.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {sortedUsers.map((user) => {
          const isSelf = user === currentUsername;
          return (
            <div
              key={user}
              className="flex items-center px-2 py-1.5 rounded-lg hover:bg-card/50 transition-colors"
            >
              <div className="relative mr-2.5 flex-shrink-0">
                <div
                  className={clsx(
                    'w-7 h-7 rounded-full border flex items-center justify-center text-[11px] font-semibold',
                    getAvatarStyle(user)
                  )}
                >
                  {user.charAt(0).toUpperCase()}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-online border-2 border-surface" />
              </div>

              <div className="truncate flex-1 min-w-0">
                <div className="flex items-center space-x-1.5">
                  <span
                    className={clsx(
                      'text-xs truncate',
                      isSelf
                        ? 'text-text-primary font-semibold'
                        : 'text-text-secondary font-medium'
                    )}
                  >
                    {user}
                  </span>
                  {isSelf && (
                    <span className="text-[9px] font-medium text-accent bg-accent-muted px-1.5 py-0.2 rounded-full">
                      you
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {sortedUsers.length === 0 && (
          <div className="text-xs text-text-muted py-6 text-center">
            No active members
          </div>
        )}
      </div>
    </aside>
  );
};
