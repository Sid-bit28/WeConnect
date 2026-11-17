import { useState, useRef, useCallback, useEffect } from 'react';
import type { Message, MessageType, PeerStream } from '../types';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ],
};

interface UseWebRTCOptions {
  room: string;
  username: string;
  send: (type: MessageType, content?: string, data?: any) => boolean;
  sendSignal: (target: string, signalType: string, payload?: any) => boolean;
  roomUsers: string[];
}

export function useWebRTC({
  room,
  username,
  send,
  sendSignal,
  roomUsers,
}: UseWebRTCOptions) {
  const [isInCall, setIsInCall] = useState<boolean>(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<PeerStream[]>([]);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [isVideoOff, setIsVideoOff] = useState<boolean>(false);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const candidateQueue = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const remoteStreamsMap = useRef<Map<string, MediaStream>>(new Map());
  const isInCallRef = useRef<boolean>(false);

  useEffect(() => {
    isInCallRef.current = isInCall;
  }, [isInCall]);

  const updatePeersState = useCallback(() => {
    const list: PeerStream[] = [];
    remoteStreamsMap.current.forEach((stream, peerId) => {
      list.push({
        peerId,
        stream,
      });
    });
    setPeers(list);
  }, []);

  const closePeer = useCallback((peerId: string) => {
    const pc = peerConnections.current.get(peerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      peerConnections.current.delete(peerId);
    }
    candidateQueue.current.delete(peerId);
    remoteStreamsMap.current.delete(peerId);
    updatePeersState();
  }, [updatePeersState]);

  const drainCandidates = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queued = candidateQueue.current.get(peerId) || [];
    for (const candidateInit of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
      } catch (err) {
        console.warn('Error applying queued ICE candidate:', err);
      }
    }
    candidateQueue.current.delete(peerId);
  }, []);

  const createPeerConnection = useCallback((peerId: string): RTCPeerConnection => {
    const existing = peerConnections.current.get(peerId);
    if (existing && existing.connectionState !== 'closed') {
      return existing;
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);

    // Add local tracks to peer connection
    const currentStream = localStreamRef.current;
    if (currentStream) {
      currentStream.getTracks().forEach((track) => {
        // If sharing screen and track is video, use screen track
        if (screenTrackRef.current && track.kind === 'video') {
          pc.addTrack(screenTrackRef.current, currentStream);
        } else {
          pc.addTrack(track, currentStream);
        }
      });
    }

    // ICE Candidate handler
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(peerId, 'candidate', event.candidate.toJSON());
      }
    };

    // Remote Track handler
    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      remoteStreamsMap.current.set(peerId, stream);
      updatePeersState();
    };

    // Connection state monitor
    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === 'disconnected' ||
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        closePeer(peerId);
      }
    };

    peerConnections.current.set(peerId, pc);
    return pc;
  }, [closePeer, sendSignal, updatePeersState]);

  // Clean up and leave call
  const leaveCall = useCallback(() => {
    // Notify peers that we are leaving
    peerConnections.current.forEach((_, peerId) => {
      sendSignal(peerId, 'leave-call');
    });
    send('call-leave', undefined, { sender: username });

    // Stop local media tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    // Stop screen share track
    if (screenTrackRef.current) {
      screenTrackRef.current.stop();
      screenTrackRef.current = null;
    }

    // Close all peer connections
    peerConnections.current.forEach((pc) => {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    });
    peerConnections.current.clear();
    candidateQueue.current.clear();
    remoteStreamsMap.current.clear();

    setPeers([]);
    setLocalStream(null);
    setIsInCall(false);
    setIsScreenSharing(false);
    setIsAudioMuted(false);
    setIsVideoOff(false);
    setError(null);
  }, [send, sendSignal, username]);

  // Start call
  const joinCall = useCallback(async () => {
    setError(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Media devices are not accessible in this browser environment. WebRTC requires HTTPS or localhost.');
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
    } catch (err: any) {
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        // Fallback to audio only if camera is unavailable
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: true,
          });
          setError('Camera not found. Joined with microphone only.');
        } catch (audioErr: any) {
          setError('No camera or microphone found on your device.');
          return;
        }
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Camera/Microphone permission denied. Please allow access in browser site settings.');
        return;
      } else {
        setError(`Failed to access media devices: ${err?.message || 'Unknown error'}`);
        return;
      }
    }

    localStreamRef.current = stream;
    setLocalStream(stream);
    setIsInCall(true);

    // Broadcast join-call to all existing users in the room
    roomUsers.forEach((peer) => {
      if (peer && peer !== username) {
        sendSignal(peer, 'join-call');
      }
    });

    send('call-join', undefined, { sender: username });
  }, [roomUsers, send, sendSignal, username]);

  // Handle incoming signaling messages
  const handleSignal = useCallback(async (msg: Message) => {
    // Call-join broadcast from room
    if (msg.type === 'call-join') {
      if (msg.sender && msg.sender !== username && isInCallRef.current) {
        // Send an offer to the newly joined peer
        try {
          const pc = createPeerConnection(msg.sender);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal(msg.sender, 'offer', offer);
        } catch (err) {
          console.error('Failed to create offer for new caller:', err);
        }
      }
      return;
    }

    // Call-leave broadcast
    if (msg.type === 'call-leave') {
      if (msg.sender) {
        closePeer(msg.sender);
      }
      return;
    }

    // 1-to-1 WebRTC Signaling
    if (msg.type === 'signal' && msg.data) {
      const { target, signalType, payload } = msg.data;
      if (target !== username) return; // Not meant for this user

      const peerId = msg.sender;
      if (!peerId) return;

      switch (signalType) {
        case 'join-call': {
          if (isInCallRef.current) {
            try {
              const pc = createPeerConnection(peerId);
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              sendSignal(peerId, 'offer', offer);
            } catch (err) {
              console.error('Failed to create offer on join-call signal:', err);
            }
          }
          break;
        }

        case 'offer': {
          if (!isInCallRef.current) {
            // Optional: Auto-ignore or prompt. We only process if currently participating in call
            return;
          }
          try {
            const pc = createPeerConnection(peerId);
            await pc.setRemoteDescription(new RTCSessionDescription(payload));
            await drainCandidates(peerId, pc);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignal(peerId, 'answer', answer);
          } catch (err) {
            console.error('Failed to handle incoming offer:', err);
          }
          break;
        }

        case 'answer': {
          const pc = peerConnections.current.get(peerId);
          if (pc) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(payload));
              await drainCandidates(peerId, pc);
            } catch (err) {
              console.error('Failed to handle incoming answer:', err);
            }
          }
          break;
        }

        case 'candidate': {
          if (!payload) return;
          const pc = peerConnections.current.get(peerId);
          if (pc && pc.remoteDescription && pc.remoteDescription.type) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(payload));
            } catch (err) {
              console.warn('Failed to add candidate directly:', err);
            }
          } else {
            // Buffer candidate until remote description is set
            const queued = candidateQueue.current.get(peerId) || [];
            queued.push(payload);
            candidateQueue.current.set(peerId, queued);
          }
          break;
        }

        case 'leave-call': {
          closePeer(peerId);
          break;
        }

        default:
          break;
      }
    }
  }, [closePeer, createPeerConnection, drainCandidates, sendSignal, username]);

  // Audio Toggle
  const toggleAudio = useCallback(() => {
    if (!localStreamRef.current) return;
    const audioTracks = localStreamRef.current.getAudioTracks();
    if (audioTracks.length === 0) return;

    const nextMuted = !isAudioMuted;
    audioTracks.forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsAudioMuted(nextMuted);
  }, [isAudioMuted]);

  // Video Toggle
  const toggleVideo = useCallback(() => {
    if (!localStreamRef.current) return;
    const videoTracks = localStreamRef.current.getVideoTracks();
    if (videoTracks.length === 0) return;

    const nextOff = !isVideoOff;
    videoTracks.forEach((track) => {
      track.enabled = !nextOff;
    });
    setIsVideoOff(nextOff);
  }, [isVideoOff]);

  // Screen Share Toggle
  const toggleScreenShare = useCallback(async () => {
    if (!isInCallRef.current) return;

    if (!isScreenSharing) {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        setError('Screen sharing is not supported in this browser.');
        return;
      }

      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });
        const screenTrack = screenStream.getVideoTracks()[0];
        screenTrackRef.current = screenTrack;

        // Replace track on all active peer connections
        peerConnections.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
          if (sender) {
            sender.replaceTrack(screenTrack);
          }
        });

        screenTrack.onended = () => {
          // Revert when user stops sharing via browser UI
          if (screenTrackRef.current) {
            screenTrackRef.current.stop();
            screenTrackRef.current = null;
          }
          const camTrack = localStreamRef.current?.getVideoTracks()[0] || null;
          peerConnections.current.forEach((pc) => {
            const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
            if (sender && camTrack) {
              sender.replaceTrack(camTrack);
            }
          });
          setIsScreenSharing(false);
        };

        setIsScreenSharing(true);
      } catch (err: any) {
        if (err.name !== 'NotAllowedError') {
          setError(`Screen sharing error: ${err.message || 'Unknown error'}`);
        }
      }
    } else {
      // Revert to camera
      if (screenTrackRef.current) {
        screenTrackRef.current.stop();
        screenTrackRef.current = null;
      }
      const camTrack = localStreamRef.current?.getVideoTracks()[0] || null;
      peerConnections.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender && camTrack) {
          sender.replaceTrack(camTrack);
        }
      });
      setIsScreenSharing(false);
    }
  }, [isScreenSharing]);

  // Clean up if room unmounts or changes
  useEffect(() => {
    return () => {
      leaveCall();
    };
  }, [room, leaveCall]);

  return {
    isInCall,
    localStream,
    peers,
    isAudioMuted,
    isVideoOff,
    isScreenSharing,
    error,
    joinCall,
    leaveCall,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    handleSignal,
  };
}
