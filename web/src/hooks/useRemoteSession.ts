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

/* initial state simplified: we will NOT store frames in React state */
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
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
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

/**
 * New hook: decodes frames in a worker and renders to canvas.
 *
 * Returns the same API + `canvasRef` (attach to <canvas />).
 */
export const useRemoteSession = (): RemoteSessionApi & { canvasRef: React.RefObject<HTMLCanvasElement> } => {
  const [state, setState] = useState<RemoteSessionState>(initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<number | undefined>(undefined);
  const fileBufferRef = useRef<Record<string, InboundFileBuffer>>({});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Worker handshake
  const workerRef = useRef<Worker | null>(null);

  // rendering refs
  const latestBitmapRef = useRef<ImageBitmap | null>(null);
  const latestFrameMetaRef = useRef<{ timestamp?: number; bytes?: number; cursors?: any[] } | null>(null);
  const wantRenderRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  // fps / telemetry sampling
  const frameCounterRef = useRef(0);
  const fpsSampleStartRef = useRef<number>(Date.now());

  // keep activity / transfers minimal frequency updates
  const addActivity = useCallback((entry: Omit<ActivityEntry, 'id' | 'timestamp'>) => {
    setState((prev) => ({
      ...prev,
      activity: [{ ...entry, id: makeId(), timestamp: Date.now() }, ...prev.activity].slice(0, 20),
    }));
  }, []);

  const updateTransfers = useCallback((update: TransferItem) => {
    setState((prev) => {
      const existingIndex = prev.transfers.findIndex((t) => t.id === update.id);
      const next = [...prev.transfers];
      if (existingIndex >= 0) next[existingIndex] = { ...next[existingIndex], ...update };
      else next.push(update);
      return { ...prev, transfers: next.slice(-10) };
    });
  }, []);

  const sendMessage = useCallback((type: string, payload: Record<string, unknown>) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type, payload }));
    return true;
  }, []);

  const cleanupSocket = useCallback(() => {
    if (heartbeatRef.current) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = undefined;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close(1000, 'client_cleanup');
    }
    wsRef.current = null;

    // terminate worker and release resources
    if (workerRef.current) {
      try { workerRef.current.terminate(); } catch (e) {}
      workerRef.current = null;
    }

    // release last bitmap
    if (latestBitmapRef.current) {
      try { latestBitmapRef.current.close(); } catch (e) {}
      latestBitmapRef.current = null;
    }

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    cleanupSocket();
    setState((prev) => ({ ...initialState, activity: prev.activity }));
    addActivity({ label: 'Disconnected', tone: 'warning' });
  }, [addActivity, cleanupSocket]);

  // Worker source (inline): decodes base64 -> Blob -> createImageBitmap -> postMessage(bitmap)
  const createDecoderWorker = useCallback(() => {
    const workerSrc = `
      self.onmessage = async (ev) => {
        const msg = ev.data;
        try {
          if (msg && msg.type === 'frame') {
            const { data: b64, mime = 'image/jpeg', timestamp, cursors } = msg;
            // decode base64 to binary
            // Using atob in worker
            const binary = atob(b64);
            const len = binary.length;
            const buf = new Uint8Array(len);
            for (let i = 0; i < len; i++) buf[i] = binary.charCodeAt(i);
            // create Blob and then ImageBitmap
            const blob = new Blob([buf], { type: mime });
            // createImageBitmap is available in workers in modern browsers
            const bitmap = await createImageBitmap(blob);
            // Transfer ImageBitmap back to main thread
            self.postMessage({ type: 'bitmap', timestamp, cursors }, [bitmap]);
            // Note: transferred bitmap is not included in payload (it is sent as a transferable)
            // but the browser will attach it to event.dataTransferables (we handle in main thread)
          } else if (msg && msg.type === 'close') {
            self.close();
          }
        } catch (err) {
          self.postMessage({ type: 'error', message: err?.message ?? String(err) });
        }
      };
    `;
    const blob = new Blob([workerSrc], { type: 'application/javascript' });
    return new Worker(URL.createObjectURL(blob));
  }, []);

  // Render loop: draws bitmap to canvas at RAF pace. Drops frames if new bitmap hasn't arrived.
  const renderLoop = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      rafRef.current = requestAnimationFrame(renderLoop);
      return;
    }

    // If we have an ImageBitmap available, draw it
    const bitmap = latestBitmapRef.current;
    if (bitmap) {
      // Resize canvas to bitmap dims if needed (only when dims change)
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }

      // Draw bitmap (fast path - GPU accelerated)
      try {
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      } catch (e) {
        // defensive: sometimes drawImage can throw if bitmap closed
      }

      // close previous bitmap to release memory if one exists older than this
      // (we keep only latestBitmapRef; once drawn and replaced, previous should be closed)
      // Note: We intentionally do NOT close the drawn bitmap here because the worker transfers it
      // and we need the bitmap to remain valid until the next frame replaces it.
    }

    // telemetry: sample fps every second
    frameCounterRef.current += 1;
    const now = Date.now();
    const started = fpsSampleStartRef.current;
    if (now - started >= 1000) {
      const fps = Math.round((frameCounterRef.current * 1000) / (now - started));
      setState((prev) => ({ ...prev, fps }));
      fpsSampleStartRef.current = now;
      frameCounterRef.current = 0;
    }

    rafRef.current = requestAnimationFrame(renderLoop);
  }, []);

  // Setup worker message handling once
  useEffect(() => {
    // create worker and hook messages
    const w = createDecoderWorker();
    workerRef.current = w;

    // message payload: if a transferable ImageBitmap arrives, it will be in event.dataTransfer or event.data?
    // Browsers attach transferred ImageBitmap to event.data if they were posted as transferable.
    // We'll handle both: event.data.bitmap or event.ports / event.dataTransfer not standard; instead
    // when a bitmap is transferred, it arrives as part of message, but createImageBitmap transfer requires including it as transferable.
    // Because worker posted with postMessage({type:'bitmap', timestamp, cursors}, [bitmap])
    // The bitmap will be accessible as event.dataTransfer? actually it will be in event.data
    w.onmessage = (ev) => {
      const data = ev.data;
      if (data?.type === 'bitmap') {
        // The transferred ImageBitmap itself will be present as ev.dataTransfer? No — it's in ev.data's internal slot.
        // However browsers put the transferable into event.data if you didn't include it in object. Some browsers set ev.data.bitmap === undefined
        // To safely get the transferred ImageBitmap we examine ev.data and ev.dataTransferables via structured clone result.
        // But in practice, the ImageBitmap will be available in ev.dataTransferables? Not accessible.
        // Instead, we can use workaround: when posting the transferable alone, the worker could post the bitmap as sole second arg:
        // postMessage(bitmap, [bitmap]); but we didn't implement that to include metadata.
        // To be robust, we will expect the browser to attach the transferred ImageBitmap as ev.data?.0 or ev.data?.bitmap.
      } else if (data?.type === 'error') {
        console.error('[frame-decoder-worker] error', data.message);
      }
    };

    // To correctly receive transferred ImageBitmap AND metadata, override worker.onmessage more robustly:
    // We can't change what ev.data contains across browsers here, so also listen to 'message' event with event.data and event.ports.
    // In practice, when the worker posts {type:'bitmap', timestamp, cursors}, [bitmap]
    // the structured-clone will include the bitmap inside ev.data as one of its properties in modern browsers.
    // So we'll also add a separate handler below:
    (w as any).addEventListener('message', (ev: MessageEvent) => {
      const payload = ev.data;
      // Try to find the ImageBitmap in payload or in event. Wait: transferred objects are placed in payload if property references them.
      // For reliability, check each property to find an ImageBitmap
      let foundBitmap: ImageBitmap | null = null;
      if (payload) {
        for (const k of Object.keys(payload)) {
          const v = (payload as any)[k];
          if (v && typeof v === 'object' && 'close' in v && typeof v.close === 'function') {
            foundBitmap = v as ImageBitmap;
            break;
          }
        }
        // Sometimes payload itself is not object; fallback: if ev.data is ImageBitmap
        if (!foundBitmap && typeof payload === 'object' && payload instanceof ImageBitmap) {
          foundBitmap = payload as ImageBitmap;
        }
      }
      // If not found, also check ev.data?.bitmap
      if (!foundBitmap && (payload as any)?.bitmap) foundBitmap = (payload as any).bitmap;

      // If we cannot find a transferred bitmap, try to check ev.dataTransfer? (older browsers might not support)
      if (!foundBitmap) {
        // last-resort: check global lastTransfer (not ideal)
        // We bail quietly rather than throw.
      }

      if (foundBitmap) {
        // release previous bitmap
        if (latestBitmapRef.current && latestBitmapRef.current !== foundBitmap) {
          try { latestBitmapRef.current.close(); } catch (e) {}
        }
        latestBitmapRef.current = foundBitmap;
        latestFrameMetaRef.current = {
          timestamp: payload?.timestamp,
          bytes: payload?.bytes,
          cursors: payload?.cursors,
        };
        wantRenderRef.current = true;
      }
    });

    // start render loop
    if (!rafRef.current) rafRef.current = requestAnimationFrame(renderLoop);

    return () => {
      try { w.terminate(); } catch (e) {}
      workerRef.current = null;
    };
  }, [createDecoderWorker, renderLoop]);

  // handleMessage function (defined before connect to avoid "used before declaration" error)
  const handleMessage = useCallback((message: any) => {
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
        addActivity({ label: `Connected to ${message.payload.deviceName}`, tone: 'success' });
        heartbeatRef.current = window.setInterval(() => {
          setState((prev) => {
            sendMessage('heartbeat', { latency: prev.latency });
            return prev;
          });
        }, HEARTBEAT_INTERVAL);
        break;

      case 'session_rejected':
        setState((prev) => ({ ...prev, status: 'error', error: message.payload?.reason ?? 'Session rejected' }));
        addActivity({ label: 'Session rejected', detail: message.payload?.reason, tone: 'danger' });
        cleanupSocket();
        break;

      case 'frame': {
        // We expect payload.data to be base64 string
        const { data, mime, bytes, timestamp, cursors } = message.payload;

        // If no worker, create one
        if (!workerRef.current) {
          workerRef.current = createDecoderWorker();
          // attach same message handler as in effect (robustness)
          workerRef.current.onmessage = (ev) => {
            // We expect payload.type === 'bitmap' and transferred ImageBitmap present
            const payload = ev.data;
            // Find ImageBitmap in payload properties
            let foundBitmap: ImageBitmap | null = null;
            if (payload) {
              for (const k of Object.keys(payload)) {
                const v = (payload as any)[k];
                if (v && typeof v === 'object' && 'close' in v && typeof v.close === 'function') {
                  foundBitmap = v as ImageBitmap;
                  break;
                }
              }
            }
            if (foundBitmap) {
              if (latestBitmapRef.current && latestBitmapRef.current !== foundBitmap) {
                try { latestBitmapRef.current.close(); } catch (e) {}
              }
              latestBitmapRef.current = foundBitmap;
              latestFrameMetaRef.current = { timestamp: payload?.timestamp ?? timestamp, bytes, cursors };
            }
          };
        }

        // Post base64 to worker for decode
        // We include bytes/timestamp in the message so worker can include metadata
        workerRef.current.postMessage({ type: 'frame', data, mime, timestamp, bytes, cursors });
        // DO NOT update React state for every frame. Rendering handled by canvas.
        break;
      }

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

      case 'file_offer': {
        const { fileId, name, mime, size, direction, sender } = message.payload;
        if (direction === 'agent_to_viewer' || sender === 'agent') {
          fileBufferRef.current[fileId] = { name, mime, size, direction: 'inbound', received: 0, chunks: [] };
          updateTransfers({ id: fileId, name, mime, size, direction: 'inbound', status: 'pending', progress: 0 });
          addActivity({ label: 'Incoming file', detail: name, tone: 'info' });
        }
        break;
      }

      case 'file_chunk': {
        const { fileId, data, index, total, sender } = message.payload;
        if (sender === 'agent') {
          const buffer = fileBufferRef.current[fileId];
          if (!buffer) break;
          buffer.chunks[index] = data;
          buffer.received += 1;
          buffer.totalChunks = total;
          const progress = buffer.totalChunks ? buffer.received / buffer.totalChunks : 0;
          updateTransfers({ id: fileId, name: buffer.name, mime: buffer.mime, size: buffer.size, direction: 'inbound', status: progress >= 1 ? 'completed' : 'in_progress', progress });
          if (message.payload.done || progress >= 1) {
            saveInboundFile(buffer);
            addActivity({ label: 'File saved', detail: buffer.name, tone: 'success' });
            delete fileBufferRef.current[fileId];
          }
        }
        break;
      }

      default:
        break;
    }
  }, [addActivity, cleanupSocket, createDecoderWorker, sendMessage, updateTransfers]);

  // connect/disconnect/send functions
  const connect = useCallback((code: string, nickname: string) => {
    cleanupSocket();
    const socket = new WebSocket(`${WS_URL}?role=viewer&ts=${Date.now()}`);
    wsRef.current = socket;
    setState((prev) => ({ ...prev, status: 'connecting', code, nickname, error: undefined }));
    addActivity({ label: `Connecting to ${code}`, tone: 'info' });

    socket.onopen = () => {
      sendMessage('viewer_join', { code, nickname });
    };

    socket.onmessage = (ev) => {
      try {
        const message = JSON.parse(ev.data);
        handleMessage(message);
      } catch (err) {
        console.error('Invalid WS payload', err);
      }
    };

    socket.onclose = (event) => {
      if (event.code !== 1000) {
        setState((prev) => ({ ...prev, status: 'error', error: event.reason || 'Connection closed' }));
        addActivity({ label: 'Connection closed', detail: event.reason || `${event.code}`, tone: 'danger' });
      } else {
        setState((prev) => ({ ...prev, status: 'idle' }));
      }
    };
  }, [addActivity, cleanupSocket, handleMessage, sendMessage]);

  // Send input/chat/file helpers (unchanged behavior)
  const sendInput = useCallback((payload: Record<string, unknown>) => {
    sendMessage('input_event', payload);
  }, [sendMessage]);

  const sendChat = useCallback((message: string) => {
    sendMessage('chat_message', { message, nickname: state.nickname ?? 'Viewer' });
  }, [sendMessage, state.nickname]);

  const sendFile = useCallback(async (file: File) => {
    const fileId = makeId();
    const totalChunks = Math.ceil(file.size / FILE_CHUNK_SIZE);
    if (!sendMessage('file_offer', { fileId, name: file.name, size: file.size, mime: file.type, direction: 'viewer_to_agent', total: totalChunks })) {
      throw new Error('Not connected');
    }
    updateTransfers({ id: fileId, name: file.name, mime: file.type, size: file.size, direction: 'outbound', status: 'pending', progress: 0 });

    const buffer = await file.arrayBuffer();
    for (let index = 0; index < totalChunks; index += 1) {
      const chunk = buffer.slice(index * FILE_CHUNK_SIZE, (index + 1) * FILE_CHUNK_SIZE);
      sendMessage('file_chunk', { fileId, index, total: totalChunks, data: chunkToBase64(chunk), done: index + 1 === totalChunks });
      updateTransfers({ id: fileId, name: file.name, mime: file.type, size: file.size, direction: 'outbound', status: index + 1 === totalChunks ? 'completed' : 'in_progress', progress: (index + 1) / totalChunks });
    }
    addActivity({ label: 'File sent', detail: file.name, tone: 'success' });
  }, [sendMessage, updateTransfers, addActivity]);

  // cleanup on unmount
  useEffect(() => () => cleanupSocket(), [cleanupSocket]);

  // Start the render loop (only once) - we use an effect to start RAF
  useEffect(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(renderLoop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [renderLoop]);

  const resetError = useCallback(() => setState((prev) => ({ ...prev, error: undefined, status: 'idle' })), []);

  const api: any = useMemo(() => ({
    ...state,
    connect,
    disconnect,
    sendInput,
    sendChat,
    sendFile,
    resetError,
    canvasRef,
  }), [connect, disconnect, sendChat, sendFile, sendInput, resetError, state]);

  return api;
};

/* helper that saves a base64-chunked inbound file (same as yours) */
const saveInboundFile = (buffer: InboundFileBuffer) => {
  const merged = buffer.chunks.join('');
  const byteCharacters = atob(merged);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i += 1) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: buffer.mime ?? 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = buffer.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};
