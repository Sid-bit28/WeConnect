import React, { useRef, useEffect } from 'react';
import clsx from 'clsx';
import { MicOff, VideoOff, ScreenShare } from 'lucide-react';
import type { PeerStream } from '../types';
import { CallControls } from './CallControls';

interface VideoTileProps {
  stream: MediaStream | null;
  username: string;
  isLocal?: boolean;
  isAudioMuted?: boolean;
  isVideoOff?: boolean;
  isScreenSharing?: boolean;
}

const VideoTile: React.FC<VideoTileProps> = ({
  stream,
  username,
  isLocal = false,
  isAudioMuted = false,
  isVideoOff = false,
  isScreenSharing = false,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const hasVideoTrack = stream && stream.getVideoTracks().length > 0 && !isVideoOff;

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

  return (
    <div className="relative bg-discord-darkest rounded-xl overflow-hidden aspect-video flex items-center justify-center border border-white/5 shadow-md group">
      {/* Video Element */}
      {hasVideoTrack ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={clsx(
            'w-full h-full object-cover',
            isLocal && !isScreenSharing && 'scale-x-[-1]' // Mirror local webcam
          )}
        />
      ) : (
        /* Discord Avatar fallback when video is off */
        <div className="flex flex-col items-center justify-center select-none">
          <div
            className={clsx(
              'w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg transition-transform',
              getAvatarColor(username),
              !isAudioMuted && 'ring-4 ring-discord-online/50'
            )}
          >
            {username.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      {/* Screen Sharing Badge */}
      {isScreenSharing && (
        <div className="absolute top-3 left-3 bg-discord-online/90 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-md flex items-center space-x-1.5 shadow">
          <ScreenShare className="w-3.5 h-3.5" />
          <span className="font-medium">Screen Sharing</span>
        </div>
      )}

      {/* Bottom Status Overlay */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
        {/* Username Tag */}
        <div className="bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded text-xs font-semibold text-white truncate max-w-[80%] flex items-center space-x-1">
          <span className="truncate">{username}</span>
          {isLocal && <span className="text-discord-muted text-[10px]">(You)</span>}
        </div>

        {/* Muted / Video Off Icons */}
        <div className="flex items-center space-x-1">
          {isVideoOff && (
            <div className="bg-discord-danger/80 p-1 rounded text-white" title="Camera Off">
              <VideoOff className="w-3.5 h-3.5" />
            </div>
          )}
          {isAudioMuted && (
            <div className="bg-discord-danger/80 p-1 rounded text-white" title="Muted">
              <MicOff className="w-3.5 h-3.5" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface VideoGridProps {
  localStream: MediaStream | null;
  peers: PeerStream[];
  currentUsername: string;
  isAudioMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  error?: string | null;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onLeaveCall: () => void;
}

export const VideoGrid: React.FC<VideoGridProps> = ({
  localStream,
  peers,
  currentUsername,
  isAudioMuted,
  isVideoOff,
  isScreenSharing,
  error,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onLeaveCall,
}) => {
  const totalParticipants = peers.length + 1;

  const getGridClass = () => {
    if (totalParticipants === 1) return 'grid-cols-1 max-w-2xl';
    if (totalParticipants === 2) return 'grid-cols-1 md:grid-cols-2 max-w-5xl';
    if (totalParticipants <= 4) return 'grid-cols-2 max-w-5xl';
    return 'grid-cols-2 lg:grid-cols-3 max-w-6xl';
  };

  return (
    <div className="flex-1 flex flex-col bg-discord-dark h-full relative overflow-hidden">
      {/* Error / Warning Alert */}
      {error && (
        <div className="bg-discord-warning/20 border-b border-discord-warning/30 text-discord-warning text-xs px-4 py-2 text-center font-medium">
          {error}
        </div>
      )}

      {/* Grid Content */}
      <div className="flex-1 p-4 md:p-6 overflow-y-auto flex items-center justify-center">
        <div className={clsx('grid gap-4 w-full justify-center', getGridClass())}>
          {/* Local User Tile */}
          <VideoTile
            stream={localStream}
            username={currentUsername}
            isLocal={true}
            isAudioMuted={isAudioMuted}
            isVideoOff={isVideoOff}
            isScreenSharing={isScreenSharing}
          />

          {/* Remote Peer Tiles */}
          {peers.map((peer) => (
            <VideoTile
              key={peer.peerId}
              stream={peer.stream}
              username={peer.peerId}
              isAudioMuted={peer.isAudioMuted}
              isVideoOff={peer.isVideoOff}
            />
          ))}
        </div>
      </div>

      {/* Floating Call Controls Dock */}
      <div className="pb-6 pt-2 flex justify-center z-20">
        <CallControls
          isAudioMuted={isAudioMuted}
          isVideoOff={isVideoOff}
          isScreenSharing={isScreenSharing}
          onToggleAudio={onToggleAudio}
          onToggleVideo={onToggleVideo}
          onToggleScreenShare={onToggleScreenShare}
          onLeaveCall={onLeaveCall}
        />
      </div>
    </div>
  );
};
