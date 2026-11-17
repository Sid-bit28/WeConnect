export type MessageType = "chat" | "join" | "leave" | "users" | "signal" | "error";

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
  topic?: string;
  unreadCount?: number;
}
