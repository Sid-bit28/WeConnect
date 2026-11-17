import React from 'react';
import clsx from 'clsx';
import type { UserProfile } from '../types';
import { UserAvatar } from './UserAvatar';

interface UserListProps {
  users: string[];
  currentUsername: string;
  profiles?: Record<string, UserProfile>;
}

export const UserList: React.FC<UserListProps> = ({
  users,
  currentUsername,
  profiles = {},
}) => {
  const sortedUsers = [...new Set(users)].sort((a, b) => {
    if (a === currentUsername) return -1;
    if (b === currentUsername) return 1;
    return a.localeCompare(b);
  });

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
          const profile = profiles[user.toLowerCase()];
          const userStatus = profile?.status || 'online';
          return (
            <div
              key={user}
              className="flex items-center px-2 py-1.5 rounded-lg hover:bg-card/50 transition-colors"
            >
              <UserAvatar
                username={user}
                avatarUrl={profile?.avatarUrl}
                status={userStatus}
                showStatus={true}
                size="sm"
                className="mr-2.5"
              />

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
          <div className="text-xs text-text-muted py-6 text-center">No active members</div>
        )}
      </div>
    </aside>
  );
};
