import React from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  PhoneOff,
} from 'lucide-react';
import clsx from 'clsx';

interface CallControlsProps {
  isAudioMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onLeaveCall: () => void;
}

export const CallControls: React.FC<CallControlsProps> = ({
  isAudioMuted,
  isVideoOff,
  isScreenSharing,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onLeaveCall,
}) => {
  return (
    <div className="flex items-center justify-center space-x-2.5 bg-surface/90 backdrop-blur-xl px-4 py-2.5 rounded-2xl shadow-2xl border border-white/[0.08] select-none">
      {/* Microphone Toggle */}
      <button
        type="button"
        onClick={onToggleAudio}
        className={clsx(
          'w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 relative group border',
          isAudioMuted
            ? 'bg-danger border-danger text-white hover:bg-danger-hover'
            : 'bg-card border-white/[0.06] text-text-primary hover:bg-white/10'
        )}
        title={isAudioMuted ? 'Unmute' : 'Mute'}
      >
        {isAudioMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        <span className="absolute -top-9 px-2 py-1 bg-canvas border border-white/[0.08] text-[10px] text-text-primary rounded-md font-medium opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg">
          {isAudioMuted ? 'Unmute' : 'Mute'}
        </span>
      </button>

      {/* Camera Toggle */}
      <button
        type="button"
        onClick={onToggleVideo}
        className={clsx(
          'w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 relative group border',
          isVideoOff
            ? 'bg-danger border-danger text-white hover:bg-danger-hover'
            : 'bg-card border-white/[0.06] text-text-primary hover:bg-white/10'
        )}
        title={isVideoOff ? 'Start Camera' : 'Stop Camera'}
      >
        {isVideoOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
        <span className="absolute -top-9 px-2 py-1 bg-canvas border border-white/[0.08] text-[10px] text-text-primary rounded-md font-medium opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg">
          {isVideoOff ? 'Start Video' : 'Stop Video'}
        </span>
      </button>

      {/* Screen Share Toggle */}
      <button
        type="button"
        onClick={onToggleScreenShare}
        className={clsx(
          'w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 relative group border',
          isScreenSharing
            ? 'bg-online border-online text-white hover:bg-online/90'
            : 'bg-card border-white/[0.06] text-text-primary hover:bg-white/10'
        )}
        title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
      >
        {isScreenSharing ? (
          <MonitorOff className="w-4 h-4" />
        ) : (
          <Monitor className="w-4 h-4" />
        )}
        <span className="absolute -top-9 px-2 py-1 bg-canvas border border-white/[0.08] text-[10px] text-text-primary rounded-md font-medium opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg">
          {isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
        </span>
      </button>

      <div className="w-[1px] h-5 bg-white/[0.08] mx-1" />

      {/* Disconnect */}
      <button
        type="button"
        onClick={onLeaveCall}
        className="w-10 h-10 rounded-xl bg-danger hover:bg-danger-hover flex items-center justify-center text-white transition-all duration-150 relative group shadow-sm"
        title="End Call"
      >
        <PhoneOff className="w-4 h-4" />
        <span className="absolute -top-9 px-2 py-1 bg-canvas border border-white/[0.08] text-[10px] text-text-primary rounded-md font-medium opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg">
          Leave Call
        </span>
      </button>
    </div>
  );
};
