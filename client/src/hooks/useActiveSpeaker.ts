import { useState, useEffect, useRef } from 'react';
import type { PeerStream } from '../types';

const SAMPLE_INTERVAL_MS = 120;
const RMS_THRESHOLD = 0.025;

interface TrackedSource {
  id: string;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buffer: Uint8Array<ArrayBuffer>;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

export function useActiveSpeaker(
  localStream: MediaStream | null,
  localUsername: string,
  isAudioMuted: boolean,
  peers: PeerStream[]
): Set<string> {
  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(() => new Set());
  const isMutedRef = useRef<boolean>(isAudioMuted);

  useEffect(() => {
    isMutedRef.current = isAudioMuted;
  }, [isAudioMuted]);

  // Stable key for remote non-screen streams so we only rebuild nodes when streams change
  const cameraPeers = peers.filter((p) => !p.isScreen);
  const peersKey = cameraPeers.map((p) => `${p.peerId}:${p.stream.id}`).join('|');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const entries: Array<{ id: string; stream: MediaStream }> = [];
    if (localStream && localStream.getAudioTracks().length > 0) {
      entries.push({ id: localUsername, stream: localStream });
    }
    for (const p of cameraPeers) {
      if (p.stream && p.stream.getAudioTracks().length > 0) {
        entries.push({ id: p.username || p.peerId, stream: p.stream });
      }
    }

    if (entries.length === 0) {
      setSpeakingUsers((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

    let ctx: AudioContext | null = null;
    const tracked: TrackedSource[] = [];

    try {
      ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }

      for (const entry of entries) {
        try {
          const source = ctx.createMediaStreamSource(entry.stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.4;
          source.connect(analyser);

          tracked.push({
            id: entry.id,
            source,
            analyser,
            buffer: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
          });
        } catch {
          // Skip stream if browser rejects MediaStreamAudioSourceNode
        }
      }
    } catch {
      return;
    }

    if (tracked.length === 0) {
      void ctx?.close().catch(() => {});
      return;
    }

    const intervalId = setInterval(() => {
      const nextSpeaking = new Set<string>();

      for (const item of tracked) {
        // Respect local mute state immediately
        if (item.id === localUsername && isMutedRef.current) {
          continue;
        }

        item.analyser.getByteTimeDomainData(item.buffer);
        let sumSquares = 0;
        for (let i = 0; i < item.buffer.length; i++) {
          const normalized = (item.buffer[i] - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / item.buffer.length);
        if (rms >= RMS_THRESHOLD) {
          nextSpeaking.add(item.id);
        }
      }

      setSpeakingUsers((prev) => (setsEqual(prev, nextSpeaking) ? prev : nextSpeaking));
    }, SAMPLE_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      for (const item of tracked) {
        try {
          item.source.disconnect();
          item.analyser.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      }
      if (ctx) {
        void ctx.close().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStream, localUsername, peersKey]);

  return speakingUsers;
}
