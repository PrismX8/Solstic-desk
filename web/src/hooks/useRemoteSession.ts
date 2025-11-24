import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActivityEntry,
  RemoteSessionApi,
  RemoteSessionState,
  TransferItem,
} from '../types/remote';

const WS_URL =
  import.meta.env.VITE_WS_URL?.replace(/\/$/, '') ?? 'wss://railways.up.railway.app/ws';

const HEARTBEAT_INTERVAL = 8000;
const FILE_CHUNK_SIZE = 64 * 1024;

const initialState: RemoteSessionState = {
  status: 'idle',
  viewers: 0,
  fps: 0,
  chat: [],
  activity: [],
  transfers: [],
};

const makeId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const chunkToBase64 = (buffer: ArrayBuffer): string => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

type InboundFileBuffer = {
  name: string;
  mime?: string;
  size: number;
  direction: 'inbound' | 'outbound';
  totalChunks?: number;
  received: number;
  chunks: string[];
};

export const useRemoteSession = (): RemoteSessionApi => {
  const [state, setState] = useState<RemoteSessionState>(initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<number | undefined>(undefined);
  const fileBufferRef = useRef<Record<string, InboundFileBuffer>>({});
  const lastFrameTs = useRef<number>(0);
  const frameThrottleRef = useRef<number>(0);
  const pendingFrameRef = useRef<any>(null);
  const rafRef = useRef<number | undefined>(undefined);

  const updateFrameFromPending = useCallback(() => {
    if (!pendingFrameRef.current) return;
    
    const { data, mime, width, height, bytes, timestamp, cursors } = pendingFrameRef.current;
    const src = `data:${mime};base64,${data}`;
    const now = Date.now();
    const delta = lastFrameTs.current
      ? now - lastFrameTs.current
      : undefined;
    lastFrameTs.current = now;
    
    setState((prev) => {
      const fps = delta ? Math.round(1000 / delta) : prev.fps;
      return {
        ...prev,
        frame: {
          src,
          width,
          height,
          bytes,
          timestamp: timestamp ?? now,
          cursors: cursors || [],
        },
        fps,
        latency: timestamp ? now - timestamp : prev.latency,
      };
    });
    
    pendingFrameRef.current = null;
  }, []);

  const cleanupSocket = useCallback(() => {
    if (heartbeatRef.current) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = undefined;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close(1000, 'client_cleanup');
    }
    wsRef.current = null;
    pendingFrameRef.current = null;
  }, []);

  const addActivity = useCallback(
    (entry: Omit<ActivityEntry, 'id' | 'timestamp'>) => {
      setState((prev) => ({
        ...prev,
        activity: [
          { ...entry, id: makeId(), timestamp: Date.now() },
          ...prev.activity,
        ].slice(0, 20),
      }));
    },
    [],
  );

  const updateTransfers = useCallback(
    (update: TransferItem) => {
      setState((prev) => {
        const existingIndex = prev.transfers.findIndex(
          (item) => item.id === update.id,
        );
        const next = [...prev.transfers];
        if (existingIndex >= 0) {
          next[existingIndex] = { ...next[existingIndex], ...update };
        } else {
          next.push(update);
        }
        return { ...prev, transfers: next.slice(-10) };
      });
    },
    [],
  );

  const sendMessage = useCallback(
    (type: string, payload: Record<string, unknown>) => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      socket.send(JSON.stringify({ type, payload }));
      return true;
    },
    [],
  );

  const disconnect = useCallback(() => {
    cleanupSocket();
    setState((prev) => ({
      ...initialState,
      activity: prev.activity,
    }));
    addActivity({ label: 'Disconnected', tone: 'warning' });
  }, [addActivity, cleanupSocket]);

  const connect = useCallback(
    (code: string, nickname: string) => {
      cleanupSocket();
      const socket = new WebSocket(`${WS_URL}?role=viewer&ts=${Date.now()}`);
      wsRef.current = socket;
      setState((prev) => ({
        ...prev,
        status: 'connecting',
        code,
        nickname,
        error: undefined,
      }));
      addActivity({ label: `Connecting to ${code}`, tone: 'info' });

      socket.onopen = () => {
        sendMessage('viewer_join', { code, nickname });
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (error) {
          console.error('Invalid WS payload', error);
        }
      };

      socket.onclose = (event) => {
        if (event.code !== 1000) {
          setState((prev) => ({
            ...prev,
            status: 'error',
            error: event.reason || 'Connection closed',
          }));
          addActivity({
            label: 'Connection closed',
            detail: event.reason || `${event.code}`,
            tone: 'danger',
          });
        } else {
          setState((prev) => ({ ...prev, status: 'idle' }));
        }
      };
    },
    [addActivity, cleanupSocket, sendMessage],
  );

  const handleMessage = useCallback(
    (message: any) => {
      switch (message.type) {
        case 'session_accept':
          setState((prev) => ({
            ...prev,
            status: 'connected',
            deviceName: message.payload.deviceName,
            os: message.payload.os,
            region: message.payload.region,
            viewers: message.payload.viewers ?? 1,
            error: undefined,
          }));
          addActivity({
            label: `Connected to ${message.payload.deviceName}`,
            tone: 'success',
          });
          heartbeatRef.current = window.setInterval(() => {
            setState((prev) => {
              sendMessage('heartbeat', { latency: prev.latency });
              return prev;
            });
          }, HEARTBEAT_INTERVAL);
          break;
        case 'session_rejected':
          setState((prev) => ({
            ...prev,
            status: 'error',
            error: message.payload?.reason ?? 'Session rejected',
          }));
          addActivity({
            label: 'Session rejected',
            detail: message.payload?.reason,
            tone: 'danger',
          });
          cleanupSocket();
          break;
        case 'frame':
          {
            const { data, mime, width, height, bytes, timestamp, cursors } =
              message.payload;
            
            // Throttle frame updates to max 60fps (16ms between frames)
            const now = Date.now();
            const timeSinceLastFrame = now - lastFrameTs.current;
            
            // Store pending frame
            pendingFrameRef.current = {
              data,
              mime,
              width,
              height,
              bytes,
              timestamp,
              cursors,
            };
            
            // If enough time has passed, update immediately
            if (timeSinceLastFrame >= 16 || lastFrameTs.current === 0) {
              updateFrameFromPending();
            } else {
              // Schedule update via requestAnimationFrame for smooth rendering
              if (!rafRef.current) {
                rafRef.current = requestAnimationFrame(() => {
                  rafRef.current = undefined;
                  updateFrameFromPending();
                });
              }
            }
          }
          break;
        case 'chat_message':
          setState((prev) => ({
            ...prev,
            chat: [
              ...prev.chat,
              {
                id: makeId(),
                sender: message.payload.sender,
                nickname: message.payload.nickname ?? message.payload.sender,
                message: message.payload.message,
                timestamp: message.payload.timestamp ?? Date.now(),
              },
            ].slice(-100),
          }));
          break;
        case 'file_offer':
          {
            const { fileId, name, mime, size, direction, sender } =
              message.payload;
            if (direction === 'agent_to_viewer' || sender === 'agent') {
              fileBufferRef.current[fileId] = {
                name,
                mime,
                size,
                direction: 'inbound',
                received: 0,
                chunks: [],
              };
              updateTransfers({
                id: fileId,
                name,
                mime,
                size,
                direction: 'inbound',
                status: 'pending',
                progress: 0,
              });
              addActivity({
                label: 'Incoming file',
                detail: name,
                tone: 'info',
              });
            }
          }
          break;
        case 'file_chunk':
          {
            const { fileId, data, index, total, sender } = message.payload;
            if (sender === 'agent') {
              const buffer = fileBufferRef.current[fileId];
              if (!buffer) break;
              buffer.chunks[index] = data;
              buffer.received += 1;
              buffer.totalChunks = total;
              const progress = buffer.totalChunks
                ? buffer.received / buffer.totalChunks
                : 0;
              updateTransfers({
                id: fileId,
                name: buffer.name,
                mime: buffer.mime,
                size: buffer.size,
                direction: 'inbound',
                status: progress >= 1 ? 'completed' : 'in_progress',
                progress,
              });
              if (message.payload.done || progress >= 1) {
                saveInboundFile(buffer);
                addActivity({
                  label: 'File saved',
                  detail: buffer.name,
                  tone: 'success',
                });
                delete fileBufferRef.current[fileId];
              }
            }
          }
          break;
        default:
          break;
      }
    },
    [addActivity, cleanupSocket, sendMessage, updateTransfers, updateFrameFromPending],
  );

  useEffect(() => () => cleanupSocket(), [cleanupSocket]);

  const sendInput = useCallback(
    (payload: Record<string, unknown>) => {
      sendMessage('input_event', payload);
    },
    [sendMessage],
  );

  const sendChat = useCallback(
    (message: string) => {
      sendMessage('chat_message', {
        message,
        nickname: state.nickname ?? 'Viewer',
      });
    },
    [sendMessage, state.nickname],
  );

  const sendFile = useCallback(
    async (file: File) => {
      const fileId = makeId();
      const totalChunks = Math.ceil(file.size / FILE_CHUNK_SIZE);
      if (
        !sendMessage('file_offer', {
          fileId,
          name: file.name,
          size: file.size,
          mime: file.type,
          direction: 'viewer_to_agent',
          total: totalChunks,
        })
      ) {
        throw new Error('Not connected');
      }
      updateTransfers({
        id: fileId,
        name: file.name,
        mime: file.type,
        size: file.size,
        direction: 'outbound',
        status: 'pending',
        progress: 0,
      });

      const buffer = await file.arrayBuffer();

      for (let index = 0; index < totalChunks; index += 1) {
        const chunk = buffer.slice(
          index * FILE_CHUNK_SIZE,
          (index + 1) * FILE_CHUNK_SIZE,
        );
        sendMessage('file_chunk', {
          fileId,
          index,
          total: totalChunks,
          data: chunkToBase64(chunk),
          done: index + 1 === totalChunks,
        });
        updateTransfers({
          id: fileId,
          name: file.name,
          mime: file.type,
          size: file.size,
          direction: 'outbound',
          status: index + 1 === totalChunks ? 'completed' : 'in_progress',
          progress: (index + 1) / totalChunks,
        });
      }
      addActivity({ label: 'File sent', detail: file.name, tone: 'success' });
    },
    [addActivity, sendMessage, updateTransfers],
  );

  const resetError = useCallback(() => {
    setState((prev) => ({ ...prev, error: undefined, status: 'idle' }));
  }, []);

  const api: RemoteSessionApi = useMemo(
    () => ({
      ...state,
      connect,
      disconnect,
      sendInput,
      sendChat,
      sendFile,
      resetError,
    }),
    [connect, disconnect, sendChat, sendFile, sendInput, resetError, state],
  );

  return api;
};

const saveInboundFile = (buffer: InboundFileBuffer) => {
  const merged = buffer.chunks.join('');
  const byteCharacters = atob(merged);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i += 1) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], {
    type: buffer.mime ?? 'application/octet-stream',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = buffer.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

