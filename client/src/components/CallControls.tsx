import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  SlidersHorizontal,
  Check,
} from 'lucide-react';
import clsx from 'clsx';

interface CallControlsProps {
  isAudioMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
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
}

export const CallControls: React.FC<CallControlsProps> = ({
  isAudioMuted,
  isVideoOff,
  isScreenSharing,
  audioDevices = [],
  videoDevices = [],
  selectedAudioDeviceId = '',
  selectedVideoDeviceId = '',
  onSwitchAudioDevice,
  onSwitchVideoDevice,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onLeaveCall,
}) => {
  const [isDevicesOpen, setIsDevicesOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isDevicesOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsDevicesOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsDevicesOpen(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDevicesOpen]);

  const hasDeviceSwitcher = Boolean(onSwitchAudioDevice || onSwitchVideoDevice);

  return (
    <div className="relative" ref={popoverRef}>
      {/* Upward Obsidian Device Switcher Popover */}
      {isDevicesOpen && hasDeviceSwitcher && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-72 bg-surface/95 backdrop-blur-xl border border-white/[0.1] rounded-2xl shadow-2xl p-3.5 space-y-3.5 z-30 select-none">
          {/* Microphone Selector */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1.5 px-1">
              Microphone
            </div>
            {audioDevices.length === 0 ? (
              <div className="text-[11px] text-text-muted px-2 py-1">No microphones detected</div>
            ) : (
              <div className="space-y-0.5 max-h-32 overflow-y-auto">
                {audioDevices.map((dev, idx) => {
                  const isSelected = dev.deviceId === selectedAudioDeviceId;
                  return (
                    <button
                      key={dev.deviceId || `mic-${idx}`}
                      type="button"
                      onClick={() => {
                        onSwitchAudioDevice?.(dev.deviceId);
                        setIsDevicesOpen(false);
                      }}
                      className={clsx(
                        'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors',
                        isSelected
                          ? 'bg-card text-text-primary font-medium'
                          : 'text-text-secondary hover:bg-card/50 hover:text-text-primary'
                      )}
                    >
                      <span className="truncate pr-2">
                        {dev.label || `Microphone ${idx + 1}`}
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-online flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="h-[1px] bg-white/[0.06]" />

          {/* Camera Selector */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1.5 px-1">
              Camera
            </div>
            {videoDevices.length === 0 ? (
              <div className="text-[11px] text-text-muted px-2 py-1">No cameras detected</div>
            ) : (
              <div className="space-y-0.5 max-h-32 overflow-y-auto">
                {videoDevices.map((dev, idx) => {
                  const isSelected = dev.deviceId === selectedVideoDeviceId;
                  return (
                    <button
                      key={dev.deviceId || `cam-${idx}`}
                      type="button"
                      onClick={() => {
                        onSwitchVideoDevice?.(dev.deviceId);
                        setIsDevicesOpen(false);
                      }}
                      className={clsx(
                        'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors',
                        isSelected
                          ? 'bg-card text-text-primary font-medium'
                          : 'text-text-secondary hover:bg-card/50 hover:text-text-primary'
                      )}
                    >
                      <span className="truncate pr-2">{dev.label || `Camera ${idx + 1}`}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-online flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Dock */}
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

        {/* Devices Popover Trigger */}
        {hasDeviceSwitcher && (
          <button
            type="button"
            onClick={() => setIsDevicesOpen((prev) => !prev)}
            className={clsx(
              'w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 relative group border',
              isDevicesOpen
                ? 'bg-accent/20 border-accent/50 text-accent'
                : 'bg-card border-white/[0.06] text-text-primary hover:bg-white/10'
            )}
            title="Audio & Video Devices"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="absolute -top-9 px-2 py-1 bg-canvas border border-white/[0.08] text-[10px] text-text-primary rounded-md font-medium opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg">
              Devices
            </span>
          </button>
        )}

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
    </div>
  );
};
