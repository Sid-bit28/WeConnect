export type MessageType =
  | "chat"
  | "join"
  | "leave"
  | "users"
  | "signal"
  | "error"
  | "call-join"
  | "call-leave"
  | "friend_update"
  | "typing"
  | "unread"
  | "channel_update"
  | "message_update"
  | "message_delete"
  | "incoming_call"
  | "call_ended"
  | "call_declined"
  | "call-decline"
  | "profile_update"
  | "read_receipt";

export type UserStatus = 'online' | 'away' | 'dnd';

export interface UserProfile {
  username: string;
  avatarUrl?: string;
  status?: UserStatus;
}

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

export interface Attachment {
  url: string;
  name: string;
  size: number;
  mimeType: string;
  isImage: boolean;
}

export interface StickerData {
  id: string;
  label: string;
  category: string;
}

export interface GifData {
  url: string;
  title: string;
}

export interface ReplyToData {
  id: string;
  sender: string;
  content: string;
}

export interface MessageData {
  attachment?: Attachment;
  attachments?: Attachment[];
  sticker?: StickerData;
  gif?: GifData;
  replyTo?: ReplyToData;
  reactions?: Record<string, string[]>;
  edited?: boolean;
  pinned?: boolean;
  pinnedBy?: string;
  [key: string]: any;
}

export interface Message {
  id?: string;
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
  createdBy?: string;
  createdAt?: number;
  isPrivate?: boolean;
  members?: string[];
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
    | 'media-state'
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
  avatarUrl?: string;
  status?: UserStatus;
}

export interface Friend {
  username: string;
  isOnline?: boolean;
  avatarUrl?: string;
  status?: UserStatus;
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
