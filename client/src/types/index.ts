export type MessageType =
  | "chat"
  | "join"
  | "leave"
  | "users"
  | "signal"
  | "error"
  | "call-join"
  | "call-leave"
  | "friend_update";

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
  signalType:
    | 'offer'
    | 'answer'
    | 'candidate'
    | 'join-call'
    | 'leave-call'
    | 'screen-offer'
    | 'screen-answer'
    | 'screen-candidate'
    | 'screen-leave';
  payload?: any;
}

export interface PeerStream {
  peerId: string;
  username?: string;
  stream: MediaStream;
  isAudioMuted?: boolean;
  isVideoOff?: boolean;
  isScreen?: boolean;
}

export interface AuthUser {
  username: string;
}

export interface Friend {
  username: string;
  isOnline?: boolean;
}

export interface FriendRequest {
  username: string;
  createdAt?: number;
}

export interface FriendsData {
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}
