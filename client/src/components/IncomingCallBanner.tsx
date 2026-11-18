import React from 'react';
import { Phone, PhoneOff } from 'lucide-react';

export interface IncomingCall {
  room: string;
  sender: string;
  timestamp: number;
}

interface IncomingCallBannerProps {
  call: IncomingCall | null;
  onAccept: () => void;
  onDecline: () => void;
}

export const IncomingCallBanner: React.FC<IncomingCallBannerProps> = ({
  call,
  onAccept,
  onDecline,
}) => {
  if (!call) return null;

  return (
    <div className="fixed top-3 sm:top-4 left-1/2 -translate-x-1/2 z-50 select-none w-[min(420px,calc(100vw-1.5rem))] sm:w-auto">
      <div className="flex items-center justify-between space-x-3 sm:space-x-4 px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl bg-surface/95 backdrop-blur-xl border border-online/35 shadow-2xl">
        {/* Pulsing Caller Avatar */}
        <div className="relative flex-shrink-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-online/15 border border-online/40 flex items-center justify-center text-sm font-semibold text-online uppercase">
            {call.sender.charAt(0)}
          </div>
          <span className="absolute inset-0 rounded-full ring-2 ring-online/50 animate-ping pointer-events-none" />
        </div>

        {/* Caller Label */}
        <div className="min-w-0 flex-1 pr-1 sm:pr-2">
          <div className="text-xs font-semibold text-text-primary truncate">
            @{call.sender} is calling...
          </div>
          <div className="text-[11px] text-online font-medium mt-0.5 truncate">
            Direct Call
          </div>
        </div>

        {/* Accept / Decline Actions */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 flex-shrink-0">
          <button
            type="button"
            onClick={onAccept}
            className="px-2.5 sm:px-3.5 py-2 rounded-xl bg-online hover:bg-online/90 text-canvas text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-sm cursor-pointer"
            title="Accept Call"
          >
            <Phone className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Accept</span>
          </button>

          <button
            type="button"
            onClick={onDecline}
            className="px-2.5 sm:px-3 py-2 rounded-xl bg-danger-muted hover:bg-danger text-danger hover:text-white border border-danger/25 text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
            title="Decline Call"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Decline</span>
          </button>
        </div>
      </div>
    </div>
  );
};
