import { useState, useEffect, useRef, useCallback } from 'react';
import type { Message, MessageType, ConnectionStatus } from '../types';

interface UseSocketOptions {
  serverUrl?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export function useSocket(
  room: string,
  username: string,
  options: UseSocketOptions = {}
) {
  const {
    serverUrl = 'ws://localhost:8080/ws',
    reconnectInterval = 3000,
    maxReconnectAttempts = 5,
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmountedRef = useRef<boolean>(false);

  // Clear messages & users when room changes
  useEffect(() => {
    setMessages([]);
    setUsers([]);
    setError(null);
  }, [room]);

  const connect = useCallback(() => {
    if (!username.trim() || !room.trim()) {
      setStatus('disconnected');
      return;
    }

    // Clean up existing socket if any
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus('connecting');
    setError(null);

    try {
      const urlWithParams = `${serverUrl}?room=${encodeURIComponent(room)}&user=${encodeURIComponent(username)}`;
      const ws = new WebSocket(urlWithParams);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmountedRef.current) return;
        setStatus('connected');
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        if (isUnmountedRef.current) return;
        try {
          const msg: Message = JSON.parse(event.data);

          switch (msg.type) {
            case 'chat':
              setMessages((prev) => [...prev, msg]);
              break;

            case 'users':
              if (Array.isArray(msg.data)) {
                setUsers(msg.data);
              } else if (Array.isArray(msg.content)) {
                setUsers(msg.content);
              }
              break;

            case 'join':
              setMessages((prev) => [
                ...prev,
                {
                  ...msg,
                  content: msg.content || `${msg.sender} joined the channel.`,
                  timestamp: msg.timestamp || Date.now(),
                },
              ]);
              setUsers((prev) =>
                prev.includes(msg.sender) ? prev : [...prev, msg.sender]
              );
              break;

            case 'leave':
              setMessages((prev) => [
                ...prev,
                {
                  ...msg,
                  content: msg.content || `${msg.sender} left the channel.`,
                  timestamp: msg.timestamp || Date.now(),
                },
              ]);
              setUsers((prev) => prev.filter((user) => user !== msg.sender));
              break;

            case 'error':
              setError(msg.content || 'An unknown error occurred.');
              setMessages((prev) => [...prev, msg]);
              break;

            case 'signal':
              // Handled by consumers if WebRTC is attached
              break;

            default:
              if (msg.content) {
                setMessages((prev) => [...prev, msg]);
              }
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err, event.data);
        }
      };

      ws.onerror = (evt) => {
        if (isUnmountedRef.current) return;
        console.warn('WebSocket error encountered:', evt);
        setStatus('error');
        setError('Connection error occurred.');
      };

      ws.onclose = (event) => {
        if (isUnmountedRef.current) return;
        setStatus('disconnected');

        // Auto-reconnect if not closed cleanly
        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current += 1;
          const delay = reconnectInterval * Math.min(reconnectAttemptsRef.current, 3);
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`);
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!isUnmountedRef.current) {
              connect();
            }
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setError('Max reconnection attempts reached. Click retry to connect.');
        }
      };
    } catch (err: any) {
      if (!isUnmountedRef.current) {
        setStatus('error');
        setError(err?.message || 'Failed to initialize WebSocket');
      }
    }
  }, [room, username, serverUrl, reconnectInterval, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttemptsRef.current = maxReconnectAttempts;
    if (wsRef.current) {
      wsRef.current.close(1000, 'User initiated disconnect');
      wsRef.current = null;
    }
    setStatus('disconnected');
  }, [maxReconnectAttempts]);

  const send = useCallback(
    (type: MessageType, content?: string, data?: any): boolean => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.warn('WebSocket not open. Unable to send message.');
        setError('Cannot send message: Not connected to server.');
        return false;
      }

      const message: Message = {
        type,
        room,
        sender: username,
        content,
        data,
        timestamp: Date.now(),
      };

      try {
        wsRef.current.send(JSON.stringify(message));
        return true;
      } catch (err: any) {
        console.error('Failed to send WebSocket message:', err);
        setError('Failed to send message: ' + (err?.message || 'unknown error'));
        return false;
      }
    },
    [room, username]
  );

  useEffect(() => {
    isUnmountedRef.current = false;
    connect();

    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close(1000, 'Component unmounted');
        wsRef.current = null;
      }
    };
  }, [connect]);

  return {
    status,
    messages,
    users,
    error,
    send,
    connect,
    disconnect,
  };
}
