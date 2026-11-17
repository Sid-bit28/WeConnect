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
    <div className="flex items-center justify-center space-x-3 bg-discord-darkest/90 backdrop-blur-md px-6 py-3 rounded-2xl shadow-2xl border border-white/5 select-none">
      {/* Microphone Toggle */}
      <button
        type="button"
        onClick={onToggleAudio}
        className={clsx(
          'w-12 h-12 rounded-full flex items-center justify-center transition-all duration-150 relative group',
          isAudioMuted
            ? 'bg-discord-danger hover:bg-discord-danger/90 text-white'
            : 'bg-discord-darker hover:bg-discord-hover text-discord-text hover:text-white'
        )}
        title={isAudioMuted ? 'Unmute Microphone' : 'Mute Microphone'}
      >
        {isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        <span className="absolute -top-9 px-2 py-1 bg-black/90 text-[11px] text-white rounded font-medium opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
          {isAudioMuted ? 'Unmute' : 'Mute'}
        </span>
      </button>

      {/* Camera Toggle */}
      <button
        type="button"
        onClick={onToggleVideo}
        className={clsx(
          'w-12 h-12 rounded-full flex items-center justify-center transition-all duration-150 relative group',
          isVideoOff
            ? 'bg-discord-danger hover:bg-discord-danger/90 text-white'
            : 'bg-discord-darker hover:bg-discord-hover text-discord-text hover:text-white'
        )}
        title={isVideoOff ? 'Turn On Camera' : 'Turn Off Camera'}
      >
        {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
        <span className="absolute -top-9 px-2 py-1 bg-black/90 text-[11px] text-white rounded font-medium opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
          {isVideoOff ? 'Start Video' : 'Stop Video'}
        </span>
      </button>

      {/* Screen Sharing Toggle */}
      <button
        type="button"
        onClick={onToggleScreenShare}
        className={clsx(
          'w-12 h-12 rounded-full flex items-center justify-center transition-all duration-150 relative group',
          isScreenSharing
            ? 'bg-discord-online hover:bg-discord-online/90 text-white'
            : 'bg-discord-darker hover:bg-discord-hover text-discord-text hover:text-white'
        )}
        title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
      >
        {isScreenSharing ? (
          <MonitorOff className="w-5 h-5" />
        ) : (
          <Monitor className="w-5 h-5" />
        )}
        <span className="absolute -top-9 px-2 py-1 bg-black/90 text-[11px] text-white rounded font-medium opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
          {isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
        </span>
      </button>

      {/* End Call Button */}
      <button
        type="button"
        onClick={onLeaveCall}
        className="w-12 h-12 rounded-full bg-discord-danger hover:bg-discord-danger/90 flex items-center justify-center text-white transition-all duration-150 relative group shadow-lg"
        title="Leave Voice/Video Call"
      >
        <PhoneOff className="w-5 h-5" />
        <span className="absolute -top-9 px-2 py-1 bg-black/90 text-[11px] text-white rounded font-medium opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
          Disconnect
        </span>
      </button>
    </div>
  );
};
