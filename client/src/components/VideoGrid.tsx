import React, { useRef, useEffect } from 'react';
import clsx from 'clsx';
import { MicOff, VideoOff, ScreenShare, MessageSquare } from 'lucide-react';
import type { PeerStream } from '../types';
import { CallControls } from './CallControls';
import { useActiveSpeaker } from '../hooks/useActiveSpeaker';

interface VideoTileProps {
  stream: MediaStream | null;
  username: string;
  isLocal?: boolean;
  isAudioMuted?: boolean;
  isVideoOff?: boolean;
  isScreenSharing?: boolean;
  isScreen?: boolean;
  isSpeaking?: boolean;
  className?: string;
  objectFit?: 'cover' | 'contain';
}

const VideoTile: React.FC<VideoTileProps> = ({
  stream,
  username,
  isLocal = false,
  isAudioMuted = false,
  isVideoOff = false,
  isScreenSharing = false,
  isScreen = false,
  isSpeaking = false,
  className,
  objectFit = 'cover',
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const hasVideoTrack = stream && stream.getVideoTracks().length > 0 && !isVideoOff;

  const getAvatarStyle = (name: string) => {
    const styles = [
      'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
      'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      'bg-amber-500/15 text-amber-300 border-amber-500/30',
      'bg-rose-500/15 text-rose-300 border-rose-500/30',
      'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
      'bg-violet-500/15 text-violet-300 border-violet-500/30',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return styles[Math.abs(hash) % styles.length];
  };

  return (
    <div
      className={clsx(
        'relative bg-surface rounded-xl overflow-hidden aspect-video flex items-center justify-center border shadow-xl group transition-all duration-150',
        isSpeaking && !isScreen
          ? 'border-online ring-2 ring-online/70 shadow-[0_0_24px_rgba(16,185,129,0.2)]'
          : 'border-white/[0.08]',
        className
      )}
    >
      {/* Video Element */}
      {hasVideoTrack ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={clsx(
            'w-full h-full',
            objectFit === 'contain' ? 'object-contain bg-black' : 'object-cover',
            isLocal && !isScreen && 'scale-x-[-1]' // Mirror local webcam only, never screen
          )}
        />
      ) : (
        /* Refined Avatar Fallback */
        <div className="flex flex-col items-center justify-center select-none">
          <div
            className={clsx(
              'w-16 h-16 sm:w-20 sm:h-20 rounded-full border flex items-center justify-center text-xl sm:text-2xl font-semibold shadow-sm transition-all',
              getAvatarStyle(username),
              isSpeaking && !isAudioMuted && 'ring-2 ring-online ring-offset-2 ring-offset-surface'
            )}
          >
            {username.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      {/* Screen Sharing Badge */}
      {(isScreen || isScreenSharing) && (
        <div className="absolute top-3 left-3 bg-canvas/85 backdrop-blur-md border border-online/30 text-online text-[11px] px-2.5 py-1 rounded-lg flex items-center space-x-1.5 shadow z-10">
          <ScreenShare className="w-3 h-3" />
          <span className="font-medium">{isLocal ? 'Your Screen' : 'Live Screen'}</span>
        </div>
      )}

      {/* Bottom Status Overlay */}
      <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between pointer-events-none z-10">
        <div
          className={clsx(
            'bg-canvas/75 backdrop-blur-md border px-2.5 py-1 rounded-lg text-[11px] font-medium text-text-primary truncate max-w-[80%] flex items-center space-x-1.5',
            isSpeaking && !isScreen ? 'border-online/50' : 'border-white/[0.07]'
          )}
        >
          {isSpeaking && !isScreen && (
            <span className="w-1.5 h-1.5 rounded-full bg-online flex-shrink-0" />
          )}
          <span className="truncate">{username}</span>
          {isLocal && <span className="text-text-muted text-[10px]">(You)</span>}
        </div>

        {!isScreen && (
          <div className="flex items-center space-x-1">
            {isVideoOff && (
              <div className="bg-danger/90 p-1 rounded-md text-white" title="Camera Off">
                <VideoOff className="w-3 h-3" />
              </div>
            )}
            {isAudioMuted && (
              <div className="bg-danger/90 p-1 rounded-md text-white" title="Muted">
                <MicOff className="w-3 h-3" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface VideoGridProps {
  channelName?: string;
  localStream: MediaStream | null;
  localScreenStream?: MediaStream | null;
  peers: PeerStream[];
  currentUsername: string;
  isAudioMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  error?: string | null;
  audioDevices?: MediaDeviceInfo[];
  videoDevices?: MediaDeviceInfo[];
  selectedAudioDeviceId?: string;
  selectedVideoDeviceId?: string;
  onSwitchAudioDevice?: (deviceId: string) => void;
  onSwitchVideoDevice?: (deviceId: string) => void;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onLeaveCall: () => void;
  onBackToChat?: () => void;
}

export const VideoGrid: React.FC<VideoGridProps> = ({
  channelName = 'Call',
  localStream,
  localScreenStream,
  peers,
  currentUsername,
  isAudioMuted,
  isVideoOff,
  isScreenSharing,
  error,
  audioDevices,
  videoDevices,
  selectedAudioDeviceId,
  selectedVideoDeviceId,
  onSwitchAudioDevice,
  onSwitchVideoDevice,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onLeaveCall,
  onBackToChat,
}) => {
  const speakingUsers = useActiveSpeaker(localStream, currentUsername, isAudioMuted, peers);

  const webcamPeers = peers.filter((p) => !p.isScreen);
  const screenPeers = peers.filter((p) => p.isScreen);

  const activeScreen = localScreenStream
    ? {
        stream: localScreenStream,
        isLocal: true,
        username: `${currentUsername}'s Screen`,
        isScreen: true,
      }
    : screenPeers.length > 0
    ? {
        stream: screenPeers[0].stream,
        isLocal: false,
        username: screenPeers[0].username || `${screenPeers[0].peerId}'s Screen`,
        isScreen: true,
      }
    : null;

  const totalParticipants = webcamPeers.length + 1;

  const getGridClass = () => {
    if (totalParticipants === 1) return 'grid-cols-1 max-w-2xl';
    if (totalParticipants === 2) return 'grid-cols-1 md:grid-cols-2 max-w-5xl';
    if (totalParticipants <= 4) return 'grid-cols-2 max-w-5xl';
    return 'grid-cols-2 lg:grid-cols-3 max-w-6xl';
  };

  const localIsSpeaking = speakingUsers.has(currentUsername);

  return (
    <div className="flex-1 flex flex-col bg-canvas h-full relative overflow-hidden select-none">
      {/* Minimal Call Stage Header */}
      <header className="h-14 px-6 border-b border-white/[0.07] flex items-center justify-between bg-canvas/80 backdrop-blur-md z-10 flex-shrink-0">
        <div className="flex items-center space-x-2.5">
          <span className="w-2 h-2 rounded-full bg-online animate-pulse" />
          <span className="text-sm font-semibold text-text-primary">{channelName}</span>
          <span className="text-xs text-text-muted">
            {totalParticipants} {totalParticipants === 1 ? 'participant' : 'participants'}
          </span>
        </div>

        {onBackToChat && (
          <button
            type="button"
            onClick={onBackToChat}
            className="px-3 py-1.5 rounded-lg bg-surface hover:bg-card border border-white/[0.08] text-xs font-medium text-text-primary flex items-center space-x-1.5 transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5 text-text-secondary" />
            <span>Open Chat</span>
          </button>
        )}
      </header>

      {/* Error / Warning Banner */}
      {error && (
        <div className="bg-warning-muted border-b border-warning/20 text-warning text-xs px-4 py-2 text-center font-medium">
          {error}
        </div>
      )}

      {/* Stage or Balanced Grid */}
      <div className="flex-1 p-4 md:p-6 overflow-y-auto flex flex-col items-center justify-center min-h-0">
        {activeScreen ? (
          <div className="w-full h-full flex flex-col items-center justify-between gap-4 max-w-6xl">
            {/* Prominent Central Stage Screen Share */}
            <div className="flex-1 w-full flex items-center justify-center min-h-0">
              <div className="w-full h-full max-h-[65vh] aspect-video">
                <VideoTile
                  stream={activeScreen.stream}
                  username={activeScreen.username}
                  isLocal={activeScreen.isLocal}
                  isScreen={true}
                  objectFit="contain"
                  className="w-full h-full bg-black"
                />
              </div>
            </div>

            {/* Bottom Participant Webcam Strip */}
            <div className="w-full flex items-center justify-center gap-3 overflow-x-auto py-1 px-2 flex-shrink-0">
              <div className="w-40 sm:w-48 aspect-video flex-shrink-0">
                <VideoTile
                  stream={localStream}
                  username={currentUsername}
                  isLocal={true}
                  isAudioMuted={isAudioMuted}
                  isVideoOff={isVideoOff}
                  isSpeaking={localIsSpeaking}
                />
              </div>

              {webcamPeers.map((peer) => {
                const peerLabel = peer.username || peer.peerId;
                return (
                  <div key={peer.peerId} className="w-40 sm:w-48 aspect-video flex-shrink-0">
                    <VideoTile
                      stream={peer.stream}
                      username={peerLabel}
                      isAudioMuted={peer.isAudioMuted}
                      isVideoOff={peer.isVideoOff}
                      isSpeaking={speakingUsers.has(peerLabel)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className={clsx('grid gap-4 w-full justify-center', getGridClass())}>
            <VideoTile
              stream={localStream}
              username={currentUsername}
              isLocal={true}
              isAudioMuted={isAudioMuted}
              isVideoOff={isVideoOff}
              isSpeaking={localIsSpeaking}
            />

            {webcamPeers.map((peer) => {
              const peerLabel = peer.username || peer.peerId;
              return (
                <VideoTile
                  key={peer.peerId}
                  stream={peer.stream}
                  username={peerLabel}
                  isAudioMuted={peer.isAudioMuted}
                  isVideoOff={peer.isVideoOff}
                  isSpeaking={speakingUsers.has(peerLabel)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Compact Floating Control Dock */}
      <div className="pb-6 pt-2 flex justify-center z-20 flex-shrink-0">
        <CallControls
          isAudioMuted={isAudioMuted}
          isVideoOff={isVideoOff}
          isScreenSharing={isScreenSharing}
          audioDevices={audioDevices}
          videoDevices={videoDevices}
          selectedAudioDeviceId={selectedAudioDeviceId}
          selectedVideoDeviceId={selectedVideoDeviceId}
          onSwitchAudioDevice={onSwitchAudioDevice}
          onSwitchVideoDevice={onSwitchVideoDevice}
          onToggleAudio={onToggleAudio}
          onToggleVideo={onToggleVideo}
          onToggleScreenShare={onToggleScreenShare}
          onLeaveCall={onLeaveCall}
        />
      </div>
    </div>
  );
};
