export type MessageType = "chat" | "join" | "leave" | "users" | "signal" | "error" | "call-join" | "call-leave";

export interface Message {
  type: MessageType;
  room: string;
  sender: string;
  content?: string;
  data?: any;
  timestamp?: number;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export interface Channel {
  id: string;
  name: string;
  type?: 'text' | 'voice';
  topic?: string;
  unreadCount?: number;
}

export interface SignalData {
  target: string;
  signalType: 'offer' | 'answer' | 'candidate' | 'join-call' | 'leave-call';
  payload?: any;
}

export interface PeerStream {
  peerId: string;
  stream: MediaStream;
  isAudioMuted?: boolean;
  isVideoOff?: boolean;
}
