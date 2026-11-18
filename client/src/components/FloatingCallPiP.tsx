import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Maximize2, Mic, MicOff, Video, VideoOff, PhoneOff } from 'lucide-react';
import clsx from 'clsx';
import type { PeerStream } from '../types';

interface HiddenRemoteAudioProps {
  stream: MediaStream;
}

const HiddenRemoteAudio: React.FC<HiddenRemoteAudioProps> = ({ stream }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
    }
  }, [stream]);

  return <audio ref={audioRef} autoPlay playsInline className="hidden" />;
};

interface FloatingCallPiPProps {
  channelName: string;
  localStream: MediaStream | null;
  localScreenStream?: MediaStream | null;
  peers: PeerStream[];
  currentUsername: string;
  isAudioMuted: boolean;
  isVideoOff: boolean;
  onExpand: () => void;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onLeaveCall: () => void;
}

const VIEWPORT_INSET = 12;

export const FloatingCallPiP: React.FC<FloatingCallPiPProps> = ({
  channelName,
  localStream,
  localScreenStream,
  peers,
  currentUsername,
  isAudioMuted,
  isVideoOff,
  onExpand,
  onToggleAudio,
  onToggleVideo,
  onLeaveCall,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const draggingRef = useRef<boolean>(false);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Position in viewport coordinates (top-left of card), initialized bottom-right
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    if (typeof window === 'undefined') return { x: 16, y: 16 };
    const defaultW = window.innerWidth < 640 ? 256 : 288;
    const defaultH = Math.round((defaultW * 9) / 16);
    return {
      x: Math.max(VIEWPORT_INSET, window.innerWidth - defaultW - 16),
      y: Math.max(VIEWPORT_INSET, window.innerHeight - defaultH - 84),
    };
  });

  const clampPosition = useCallback((x: number, y: number) => {
    if (typeof window === 'undefined') return { x, y };
    const rect = cardRef.current?.getBoundingClientRect();
    const width = rect?.width || (window.innerWidth < 640 ? 256 : 288);
    const height = rect?.height || Math.round((width * 9) / 16);
    const maxX = Math.max(VIEWPORT_INSET, window.innerWidth - width - VIEWPORT_INSET);
    const maxY = Math.max(VIEWPORT_INSET, window.innerHeight - height - VIEWPORT_INSET);
    return {
      x: Math.min(Math.max(VIEWPORT_INSET, x), maxX),
      y: Math.min(Math.max(VIEWPORT_INSET, y), maxY),
    };
  }, []);

  // Keep PiP clamped inside viewport on window resize / mobile orientation change
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => clampPosition(prev.x, prev.y));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampPosition]);

  // Stream selection priority:
  // 1) Remote shared screen
  // 2) Remote peer camera
  // 3) Local shared screen
  // 4) Local camera
  const remoteScreen = peers.find((p) => p.isScreen);
  const remoteCam = peers.find((p) => !p.isScreen);

  const featured = remoteScreen
    ? {
        id: remoteScreen.peerId,
        stream: remoteScreen.stream,
        label: remoteScreen.username || `${remoteScreen.peerId}'s Screen`,
        isLocal: false,
        isScreen: true,
        isVideoOff: false,
      }
    : remoteCam
    ? {
        id: remoteCam.peerId,
        stream: remoteCam.stream,
        label: remoteCam.username || remoteCam.peerId,
        isLocal: false,
        isScreen: false,
        isVideoOff: Boolean(remoteCam.isVideoOff),
      }
    : localScreenStream
    ? {
        id: '__local_screen__',
        stream: localScreenStream,
        label: 'Your Screen',
        isLocal: true,
        isScreen: true,
        isVideoOff: false,
      }
    : {
        id: '__local_cam__',
        stream: localStream,
        label: currentUsername,
        isLocal: true,
        isScreen: false,
        isVideoOff,
      };

  // All OTHER remote streams need hidden <audio> elements so audio never drops while minimized
  const backgroundRemoteAudioPeers = peers.filter(
    (p) => p.peerId !== featured.id && Boolean(p.stream)
  );

  const hasVisibleVideo = Boolean(
    featured.stream &&
      featured.stream.getVideoTracks().length > 0 &&
      !featured.isVideoOff
  );

  const bindVideoRef = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node;
      if (node) {
        node.muted = featured.isLocal;
        if (featured.stream && node.srcObject !== featured.stream) {
          node.srcObject = featured.stream;
        }
        if (hasVisibleVideo) {
          node.play().catch(() => {});
        }
      }
    },
    [featured.stream, featured.isLocal, hasVisibleVideo]
  );

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = featured.isLocal;
      if (featured.stream && videoRef.current.srcObject !== featured.stream) {
        videoRef.current.srcObject = featured.stream;
      }
      if (hasVisibleVideo) {
        videoRef.current.play().catch(() => {});
      }
    }
  }, [featured.stream, featured.isLocal, hasVisibleVideo]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Ignore drag start when clicking interactive buttons
    if ((e.target as HTMLElement).closest('button')) return;
    draggingRef.current = true;
    dragOffsetRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const next = clampPosition(
      e.clientX - dragOffsetRef.current.x,
      e.clientY - dragOffsetRef.current.y
    );
    setPosition(next);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <>
      {/* Hidden audio sinks for non-featured remote peers (and featured remote peer if video track absent) */}
      {backgroundRemoteAudioPeers.map((peer) => (
        <HiddenRemoteAudio key={`pip-audio-${peer.peerId}`} stream={peer.stream} />
      ))}
      {!featured.isLocal && !hasVisibleVideo && featured.stream && (
        <HiddenRemoteAudio stream={featured.stream} />
      )}

      {/* Draggable Floating Mini-Player */}
      <div
        ref={cardRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        }}
        className="fixed top-0 left-0 z-40 w-64 sm:w-72 aspect-video rounded-xl border border-white/10 shadow-2xl bg-canvas overflow-hidden select-none touch-none cursor-grab active:cursor-grabbing group"
      >
        {/* Video Element (Kept in DOM so stream & decoder pipeline are never dropped on toggle) */}
        <video
          ref={bindVideoRef}
          autoPlay
          playsInline
          muted={featured.isLocal}
          className={clsx(
            'w-full h-full pointer-events-none',
            featured.isScreen ? 'object-contain bg-black' : 'object-cover',
            featured.isLocal && !featured.isScreen && 'scale-x-[-1]',
            !hasVisibleVideo && 'hidden'
          )}
        />
        {!hasVisibleVideo && (
          <div className="w-full h-full bg-surface flex flex-col items-center justify-center pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center text-base font-semibold text-accent uppercase">
              {(featured.label || 'C').charAt(0)}
            </div>
            <span className="mt-1.5 text-[11px] text-text-secondary truncate max-w-[80%]">
              {featured.label}
            </span>
          </div>
        )}

        {/* Top Overlay: Live Dot + Room Name + Expand */}
        <div className="absolute inset-x-0 top-0 p-2 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between">
          <div className="flex items-center space-x-1.5 min-w-0 pr-2">
            <span className="w-1.5 h-1.5 rounded-full bg-online animate-pulse flex-shrink-0" />
            <span className="text-[11px] font-medium text-white truncate">{channelName}</span>
          </div>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onExpand}
            className="p-1.5 rounded-lg bg-canvas/80 hover:bg-accent text-text-primary hover:text-white border border-white/10 transition-colors cursor-pointer flex-shrink-0"
            title="Expand Call Stage"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Bottom Overlay: Compact Controls */}
        <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent flex items-center justify-center space-x-2">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onToggleAudio}
            className={clsx(
              'w-8 h-8 rounded-lg flex items-center justify-center border transition-colors cursor-pointer',
              isAudioMuted
                ? 'bg-danger border-danger text-white'
                : 'bg-canvas/80 border-white/10 text-text-primary hover:bg-card'
            )}
            title={isAudioMuted ? 'Unmute Mic' : 'Mute Mic'}
          >
            {isAudioMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onToggleVideo}
            className={clsx(
              'w-8 h-8 rounded-lg flex items-center justify-center border transition-colors cursor-pointer',
              isVideoOff
                ? 'bg-danger border-danger text-white'
                : 'bg-canvas/80 border-white/10 text-text-primary hover:bg-card'
            )}
            title={isVideoOff ? 'Turn Camera On' : 'Turn Camera Off'}
          >
            {isVideoOff ? <VideoOff className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onLeaveCall}
            className="w-8 h-8 rounded-lg bg-danger hover:bg-danger-hover flex items-center justify-center text-white transition-colors cursor-pointer shadow"
            title="Leave Call"
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </>
  );
};
