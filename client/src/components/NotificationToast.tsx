import React from 'react';
import { X } from 'lucide-react';

export interface NotificationItem {
  id: string;
  room: string;
  sender: string;
  preview: string;
  timestamp: number;
}

interface NotificationToastProps {
  notifications: NotificationItem[];
  onOpenRoom: (roomId: string, notificationId: string) => void;
  onDismiss: (notificationId: string) => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({
  notifications,
  onOpenRoom,
  onDismiss,
}) => {
  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col space-y-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none select-none">
      {notifications.map((item) => (
        <div
          key={item.id}
          onClick={() => onOpenRoom(item.room, item.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpenRoom(item.room, item.id);
            }
          }}
          className="pointer-events-auto group flex items-start space-x-3 p-3.5 rounded-xl bg-surface/95 backdrop-blur-xl border border-white/[0.1] hover:border-accent/50 shadow-2xl transition-all cursor-pointer"
        >
          {/* Sender Initial Avatar */}
          <div className="w-8 h-8 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center text-xs font-semibold text-accent uppercase flex-shrink-0 mt-0.5">
            {item.sender.charAt(0)}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between space-x-2">
              <span className="text-xs font-semibold text-text-primary truncate">
                {item.sender}
              </span>
              <span className="text-[10px] text-accent font-medium flex-shrink-0">
                Direct Message
              </span>
            </div>
            <p className="text-xs text-text-secondary line-clamp-2 mt-0.5 break-words leading-snug">
              {item.preview || 'Sent you a message'}
            </p>
          </div>

          {/* Dismiss Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(item.id);
            }}
            className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-card transition-colors flex-shrink-0"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
