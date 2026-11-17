import { useState, useRef, useCallback, useEffect } from 'react';
import type { Message, MessageType, PeerStream } from '../types';

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

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
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<PeerStream[]>([]);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [isVideoOff, setIsVideoOff] = useState<boolean>(false);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const screenPeerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const candidateQueue = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const screenCandidateQueue = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const remoteWebcamMap = useRef<Map<string, MediaStream>>(new Map());
  const remoteScreenMap = useRef<Map<string, MediaStream>>(new Map());
  const isInCallRef = useRef<boolean>(false);
  const iceServersRef = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);

  // Fetch dynamic ICE configuration (STUN/TURN) from server on mount
  useEffect(() => {
    let isCancelled = false;
    const fetchIceConfig = async () => {
      try {
        const url =
          typeof window !== 'undefined' && (window.location.port === '8080' || window.location.port === '')
            ? '/api/config/ice'
            : 'http://localhost:8080/api/config/ice';

        const res = await fetch(url).catch(() => fetch('/api/config/ice'));
        if (res.ok) {
          const data = await res.json();
          const servers = Array.isArray(data) ? data : data.iceServers;
          if (!isCancelled && Array.isArray(servers) && servers.length > 0) {
            iceServersRef.current = servers;
          }
        }
      } catch {
        // Silently keep DEFAULT_ICE_SERVERS fallback
      }
    };

    fetchIceConfig();
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    isInCallRef.current = isInCall;
  }, [isInCall]);

  const updatePeersState = useCallback(() => {
    const list: PeerStream[] = [];
    // Add remote webcams
    remoteWebcamMap.current.forEach((stream, peerId) => {
      list.push({
        peerId,
        username: peerId,
        stream,
        isScreen: false,
      });
    });
    // Add remote screens
    remoteScreenMap.current.forEach((stream, peerId) => {
      list.push({
        peerId: `${peerId}-screen`,
        username: `${peerId}'s Screen`,
        stream,
        isScreen: true,
      });
    });
    setPeers(list);
  }, []);

  const closePeer = useCallback((peerId: string) => {
    // Close webcam connection
    const pc = peerConnections.current.get(peerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      peerConnections.current.delete(peerId);
    }
    candidateQueue.current.delete(peerId);
    remoteWebcamMap.current.delete(peerId);

    // Close screen connection if any
    const screenPc = screenPeerConnections.current.get(peerId);
    if (screenPc) {
      screenPc.onicecandidate = null;
      screenPc.ontrack = null;
      screenPc.onconnectionstatechange = null;
      screenPc.close();
      screenPeerConnections.current.delete(peerId);
    }
    screenCandidateQueue.current.delete(peerId);
    remoteScreenMap.current.delete(peerId);

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

  const drainScreenCandidates = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queued = screenCandidateQueue.current.get(peerId) || [];
    for (const candidateInit of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
      } catch (err) {
        console.warn('Error applying queued screen ICE candidate:', err);
      }
    }
    screenCandidateQueue.current.delete(peerId);
  }, []);

  const createPeerConnection = useCallback((peerId: string): RTCPeerConnection => {
    const existing = peerConnections.current.get(peerId);
    if (existing && existing.connectionState !== 'closed') {
      return existing;
    }

    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
    });

    // Add local tracks (webcam + mic)
    const currentStream = localStreamRef.current;
    if (currentStream) {
      currentStream.getTracks().forEach((track) => {
        pc.addTrack(track, currentStream);
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
      remoteWebcamMap.current.set(peerId, stream);
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
    screenPeerConnections.current.forEach((_, peerId) => {
      sendSignal(peerId, 'screen-leave');
    });
    send('call-leave', undefined, { sender: username });

    // Stop local webcam tracks
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

    screenPeerConnections.current.forEach((pc) => {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    });
    screenPeerConnections.current.clear();
    screenCandidateQueue.current.clear();

    remoteWebcamMap.current.clear();
    remoteScreenMap.current.clear();

    setPeers([]);
    setLocalStream(null);
    setLocalScreenStream(null);
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

  // Stop screen sharing helper
  const stopScreenShare = useCallback(() => {
    screenPeerConnections.current.forEach((_, peerId) => {
      sendSignal(peerId, 'screen-leave');
    });

    if (screenTrackRef.current) {
      screenTrackRef.current.onended = null;
      screenTrackRef.current.stop();
      screenTrackRef.current = null;
    }

    screenPeerConnections.current.forEach((pc) => {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
    });
    screenPeerConnections.current.clear();
    screenCandidateQueue.current.clear();

    setLocalScreenStream(null);
    setIsScreenSharing(false);
  }, [sendSignal]);

  // Toggle Screen Share
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
        setLocalScreenStream(screenStream);
        setIsScreenSharing(true);

        screenTrack.onended = () => {
          stopScreenShare();
        };

        // Create a screen peer connection for each currently connected peer
        const connectedPeers = Array.from(peerConnections.current.keys());
        for (const peerId of connectedPeers) {
          try {
            const screenPc = new RTCPeerConnection({
              iceServers: iceServersRef.current,
            });
            screenPeerConnections.current.set(peerId, screenPc);

            screenPc.addTrack(screenTrack, screenStream);

            screenPc.onicecandidate = (event) => {
              if (event.candidate) {
                sendSignal(peerId, 'screen-candidate', event.candidate.toJSON());
              }
            };

            const offer = await screenPc.createOffer();
            await screenPc.setLocalDescription(offer);
            sendSignal(peerId, 'screen-offer', offer);
          } catch (err) {
            console.error(`Failed to initiate screen sharing to ${peerId}:`, err);
          }
        }
      } catch (err: any) {
        if (err.name !== 'NotAllowedError') {
          setError(`Screen sharing error: ${err.message || 'Unknown error'}`);
        }
      }
    } else {
      stopScreenShare();
    }
  }, [isScreenSharing, sendSignal, stopScreenShare]);

  // Handle incoming signaling messages
  const handleSignal = useCallback(async (msg: Message) => {
    // Call-join broadcast from room
    if (msg.type === 'call-join') {
      if (msg.sender && msg.sender !== username && isInCallRef.current) {
        // Send webcam offer to the newly joined peer
        try {
          const pc = createPeerConnection(msg.sender);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal(msg.sender, 'offer', offer);

          // If currently sharing screen, also send screen offer to the new peer!
          if (screenTrackRef.current && localScreenStream) {
            const screenPc = new RTCPeerConnection({
              iceServers: iceServersRef.current,
            });
            screenPeerConnections.current.set(msg.sender, screenPc);
            screenPc.addTrack(screenTrackRef.current, localScreenStream);
            screenPc.onicecandidate = (event) => {
              if (event.candidate) {
                sendSignal(msg.sender, 'screen-candidate', event.candidate.toJSON());
              }
            };
            const screenOffer = await screenPc.createOffer();
            await screenPc.setLocalDescription(screenOffer);
            sendSignal(msg.sender, 'screen-offer', screenOffer);
          }
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

              // If currently sharing screen, also send screen offer
              if (screenTrackRef.current && localScreenStream) {
                const screenPc = new RTCPeerConnection({
                  iceServers: iceServersRef.current,
                });
                screenPeerConnections.current.set(peerId, screenPc);
                screenPc.addTrack(screenTrackRef.current, localScreenStream);
                screenPc.onicecandidate = (event) => {
                  if (event.candidate) {
                    sendSignal(peerId, 'screen-candidate', event.candidate.toJSON());
                  }
                };
                const screenOffer = await screenPc.createOffer();
                await screenPc.setLocalDescription(screenOffer);
                sendSignal(peerId, 'screen-offer', screenOffer);
              }
            } catch (err) {
              console.error('Failed to create offer on join-call signal:', err);
            }
          }
          break;
        }

        case 'offer': {
          if (!isInCallRef.current) return;
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
            const queued = candidateQueue.current.get(peerId) || [];
            queued.push(payload);
            candidateQueue.current.set(peerId, queued);
          }
          break;
        }

        case 'screen-offer': {
          if (!isInCallRef.current) return;
          try {
            const screenPc = new RTCPeerConnection({
              iceServers: iceServersRef.current,
            });
            screenPeerConnections.current.set(peerId, screenPc);

            screenPc.onicecandidate = (event) => {
              if (event.candidate) {
                sendSignal(peerId, 'screen-candidate', event.candidate.toJSON());
              }
            };

            screenPc.ontrack = (event) => {
              const stream = event.streams[0] || new MediaStream([event.track]);
              remoteScreenMap.current.set(peerId, stream);
              updatePeersState();
            };

            await screenPc.setRemoteDescription(new RTCSessionDescription(payload));
            await drainScreenCandidates(peerId, screenPc);

            const answer = await screenPc.createAnswer();
            await screenPc.setLocalDescription(answer);
            sendSignal(peerId, 'screen-answer', answer);
          } catch (err) {
            console.error('Failed to handle incoming screen-offer:', err);
          }
          break;
        }

        case 'screen-answer': {
          const screenPc = screenPeerConnections.current.get(peerId);
          if (screenPc) {
            try {
              await screenPc.setRemoteDescription(new RTCSessionDescription(payload));
              await drainScreenCandidates(peerId, screenPc);
            } catch (err) {
              console.error('Failed to handle incoming screen-answer:', err);
            }
          }
          break;
        }

        case 'screen-candidate': {
          if (!payload) return;
          const screenPc = screenPeerConnections.current.get(peerId);
          if (screenPc && screenPc.remoteDescription && screenPc.remoteDescription.type) {
            try {
              await screenPc.addIceCandidate(new RTCIceCandidate(payload));
            } catch (err) {
              console.warn('Failed to add screen candidate directly:', err);
            }
          } else {
            const queued = screenCandidateQueue.current.get(peerId) || [];
            queued.push(payload);
            screenCandidateQueue.current.set(peerId, queued);
          }
          break;
        }

        case 'screen-leave': {
          const screenPc = screenPeerConnections.current.get(peerId);
          if (screenPc) {
            screenPc.onicecandidate = null;
            screenPc.ontrack = null;
            screenPc.close();
            screenPeerConnections.current.delete(peerId);
          }
          screenCandidateQueue.current.delete(peerId);
          remoteScreenMap.current.delete(peerId);
          updatePeersState();
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
  }, [
    closePeer,
    createPeerConnection,
    drainCandidates,
    drainScreenCandidates,
    localScreenStream,
    sendSignal,
    updatePeersState,
    username,
  ]);

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

  // Clean up if room unmounts or changes
  useEffect(() => {
    return () => {
      leaveCall();
    };
  }, [room, leaveCall]);

  return {
    isInCall,
    localStream,
    localScreenStream,
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
