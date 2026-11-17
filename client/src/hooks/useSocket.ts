import { useState, useEffect, useRef, useCallback } from 'react';
import type { Message, MessageType, ConnectionStatus } from '../types';
import { getApiBaseUrl, getWsBaseUrl } from '../utils/api';

interface UseSocketOptions {
  token?: string | null;
  serverUrl?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  onMessage?: (msg: Message) => void;
}

function getMessageKey(msg: Message): string {
  return `${msg.type}|${msg.sender}|${msg.timestamp || 0}|${msg.content || ''}`;
}

export function useSocket(
  room: string,
  username: string,
  options: UseSocketOptions = {}
) {
  const {
    token,
    serverUrl = getWsBaseUrl(),
    reconnectInterval = 3000,
    maxReconnectAttempts = 5,
    onMessage,
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [users, setUsers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmountedRef = useRef<boolean>(false);
  const onMessageRef = useRef<((msg: Message) => void) | undefined>(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  // Clear state and fetch persisted chat history whenever room changes
  useEffect(() => {
    setMessages([]);
    setUsers([]);
    setError(null);

    if (!room.trim() || !token) {
      setIsLoadingHistory(false);
      return;
    }

    const controller = new AbortController();
    let isCancelled = false;

    const loadHistory = async () => {
      setIsLoadingHistory(true);
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/api/messages?room=${encodeURIComponent(room)}&limit=50`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            signal: controller.signal,
          }
        );

        if (isCancelled) return;

        if (!res.ok) {
          if (res.status === 403) {
            setError('You do not have permission to view this conversation.');
          } else if (res.status !== 404) {
            console.warn(`Failed to load message history (${res.status})`);
          }
          return;
        }

        const data = await res.json();
        const history: Message[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.messages)
          ? data.messages
          : [];

        if (!isCancelled && history.length > 0) {
          setMessages((prev) => {
            const seen = new Set<string>();
            const merged: Message[] = [];

            for (const m of history) {
              const key = getMessageKey(m);
              if (!seen.has(key)) {
                seen.add(key);
                merged.push(m);
              }
            }
            for (const m of prev) {
              const key = getMessageKey(m);
              if (!seen.has(key)) {
                seen.add(key);
                merged.push(m);
              }
            }

            return merged;
          });
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.warn('Error fetching chat history:', err);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingHistory(false);
        }
      }
    };

    loadHistory();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [room, token]);

  const connect = useCallback(() => {
    if (!username.trim() || !room.trim()) {
      setStatus('disconnected');
      return;
    }

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus('connecting');
    setError(null);

    try {
      const params = new URLSearchParams({
        room,
        user: username,
      });
      if (token) {
        params.set('token', token);
      }

      const urlWithParams = `${serverUrl}?${params.toString()}`;
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

          if (onMessageRef.current) {
            onMessageRef.current(msg);
          }

          switch (msg.type) {
            case 'chat':
              setMessages((prev) => {
                const key = getMessageKey(msg);
                if (prev.some((m) => getMessageKey(m) === key)) {
                  return prev;
                }
                return [...prev, msg];
              });
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
            case 'call-join':
            case 'call-leave':
            case 'friend_update':
              // Handled via onMessage callback
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

        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current += 1;
          const delay = reconnectInterval * Math.min(reconnectAttemptsRef.current, 3);
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!isUnmountedRef.current) {
              connect();
            }
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setError('Max reconnection attempts reached. Click reconnect to try again.');
        }
      };
    } catch (err: any) {
      if (!isUnmountedRef.current) {
        setStatus('error');
        setError(err?.message || 'Failed to initialize WebSocket');
      }
    }
  }, [room, username, token, serverUrl, reconnectInterval, maxReconnectAttempts]);

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

  const sendSignal = useCallback(
    (target: string, signalType: string, payload?: any): boolean => {
      return send('signal', undefined, { target, signalType, payload });
    },
    [send]
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
    isLoadingHistory,
    users,
    error,
    send,
    sendSignal,
    connect,
    disconnect,
  };
}
