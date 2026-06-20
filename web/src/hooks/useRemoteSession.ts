// File: src/hooks/useRemoteSession.ts
/* eslint-disable react-hooks/immutability, react-hooks/exhaustive-deps */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import type {
  ActivityEntry,
  ChatSender,
  RemoteCursor,
  RemoteFrameMetadata,
  RemoteSessionApi,
  RemoteSessionState,
  TransferItem,
} from '../types/remote';

const HEARTBEAT_INTERVAL = 8000;
const PEER_PREFIX = 'solstice-';
const FILE_CHUNK_SIZE = 64 * 1024;
const META_THROTTLE_MS = 250;

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

type CanvasSource = ImageBitmap | HTMLImageElement | HTMLVideoElement;
type WorkerFrameMeta = {
  timestamp?: number;
  bytes?: number;
  cursors?: RemoteCursor[];
};
type FrameMessagePayload = {
  data: string;
  mime?: string;
  bytes?: number;
  timestamp?: number;
  cursors?: RemoteCursor[];
};
type ServerMessage = {
  type: string;
  payload?: Record<string, unknown>;
};
type DecoderMessage =
  | {
      type: 'bitmap';
      bitmap?: ImageBitmap;
      width: number;
      height: number;
      timestamp?: number;
      cursors?: RemoteCursor[];
      bytes?: number;
    }
  | {
      type: 'frame_raw';
      b64: string;
      mime?: string;
      timestamp?: number;
      cursors?: RemoteCursor[];
      bytes?: number;
    }
  | {
      type: 'error';
      message?: string;
    };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Robustly decode base64->ImageBitmap on main thread as a fallback.
 */
async function decodeOnMainThread(b64: string, mime = 'image/jpeg'): Promise<CanvasSource> {
  if (typeof createImageBitmap === 'function') {
    const byteStr = atob(b64);
    const len = byteStr.length;
    const buf = new Uint8Array(len);
    for (let i = 0; i < len; i++) buf[i] = byteStr.charCodeAt(i);
    const blob = new Blob([buf], { type: mime });
    return await createImageBitmap(blob);
  }
  // Last-resort fallback with <img> (no worker/GPU decode)
  const img = new Image();
  img.decoding = 'async';
  img.src = `data:${mime};base64,${b64}`;
  await img.decode().catch(
    () =>
      new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = (e) => rej(e);
      }),
  );
  return img;
}

/**
 * Build a tiny worker that decodes frames and posts transferable ImageBitmaps.
 */
function buildDecoderWorker(): Worker {
  const workerSrc = `
    self.onmessage = async (ev) => {
      const msg = ev.data;
      if (!msg) return;
      if (msg.type === 'frame') {
        const { data: b64, mime = 'image/jpeg', timestamp, cursors, bytes } = msg;
        try {
          if (typeof self.createImageBitmap !== 'function') {
            self.postMessage({ type: 'frame_raw', b64, mime, timestamp, cursors, bytes });
            return;
          }
          const bin = atob(b64);
          const len = bin.length;
          const u8 = new Uint8Array(len);
          for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
          const bitmap = await createImageBitmap(new Blob([u8], { type: mime }));
          self.postMessage({
            type: 'bitmap',
            bitmap,
            width: bitmap.width,
            height: bitmap.height,
            timestamp, cursors, bytes
          }, [bitmap]);
        } catch (err) {
          self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
        }
      } else if (msg.type === 'close') {
        self.close();
      }
    };
  `;
  const blob = new Blob([workerSrc], { type: 'application/javascript' });
  return new Worker(URL.createObjectURL(blob));
}

/**
 * Decodes frames in a worker and renders to a <canvas>. Fast & low-GC.
 */
export const useRemoteSession = (): RemoteSessionApi => {
  const [state, setState] = useState<RemoteSessionState>(initialState);
  const peerRef = useRef<Peer | null>(null);
  const connectionRef = useRef<DataConnection | null>(null);
  const controlConnectionRef = useRef<DataConnection | null>(null);
  const mediaPeerRef = useRef<RTCPeerConnection | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const mediaActiveRef = useRef(false);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const mediaStatsTimerRef = useRef<number | undefined>(undefined);
  const heartbeatRef = useRef<number | undefined>(undefined);
  const fileBufferRef = useRef<Record<string, InboundFileBuffer>>({});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const decoderBusyRef = useRef(false);
  const pendingFrameRef = useRef<FrameMessagePayload | null>(null);

  const latestFrameRef = useRef<CanvasSource | null>(null);
  const latestMetaRef = useRef<WorkerFrameMeta | null>(null);
  const metaLastPushedRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);

  const [frameMetadata, setFrameMetadata] = useState<RemoteFrameMetadata | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  // fps sampling
  const frameCounterRef = useRef(0);
  const fpsSampleStartRef = useRef<number>(0);

  const addActivity = useCallback((entry: Omit<ActivityEntry, 'id' | 'timestamp'>) => {
    setState((prev) => ({
      ...prev,
      activity: [{ ...entry, id: makeId(), timestamp: Date.now() }, ...prev.activity].slice(0, 20),
    }));
  }, []);

  const updateTransfers = useCallback((update: TransferItem) => {
    setState((prev) => {
      const i = prev.transfers.findIndex((t) => t.id === update.id);
      const next = [...prev.transfers];
      if (i >= 0) next[i] = { ...next[i], ...update };
      else next.push(update);
      return { ...prev, transfers: next.slice(-10) };
    });
  }, []);

  const sendMessage = useCallback((type: string, payload: Record<string, unknown>) => {
    const preferred = type === 'input_event' ? controlConnectionRef.current : connectionRef.current;
    const connection = preferred?.open ? preferred : connectionRef.current;
    if (!connection?.open) return false;
    connection.send({ type, payload });
    return true;
  }, []);

  const closeBitmapIfAny = (src: CanvasSource | null) => {
    if (src && 'close' in src && typeof (src as ImageBitmap).close === 'function') {
      try {
        (src as ImageBitmap).close();
      } catch {
        // ImageBitmap.close can throw if the bitmap is already detached.
      }
    }
  };

  function postFramePayload(frame: FrameMessagePayload) {
    if (typeof frame.data !== 'string') return;
    if (decoderBusyRef.current) {
      pendingFrameRef.current = frame;
      return;
    }

    decoderBusyRef.current = true;
    ensureWorker().postMessage({
      type: 'frame',
      data: frame.data,
      mime: frame.mime,
      timestamp: frame.timestamp,
      bytes: frame.bytes,
      cursors: frame.cursors,
    });
  }

  function flushDecoderQueue() {
    decoderBusyRef.current = false;
    const pending = pendingFrameRef.current;
    pendingFrameRef.current = null;
    if (pending) {
      postFramePayload(pending);
    }
  }

  const installWorkerHandlers = useCallback((worker: Worker) => {
    worker.onmessage = async (ev: MessageEvent<DecoderMessage>) => {
      const payload = ev.data;
      if (!payload) return;

      if (payload.type === 'bitmap') {
        const bitmap = payload.bitmap;
        if (bitmap) {
          closeBitmapIfAny(latestFrameRef.current);
          latestFrameRef.current = bitmap;
          latestMetaRef.current = {
            timestamp: payload.timestamp,
            bytes: payload.bytes,
            cursors: payload.cursors,
          };
        }
        flushDecoderQueue();
        return;
      }

      if (payload.type === 'frame_raw') {
        try {
          const decoded = await decodeOnMainThread(payload.b64, payload.mime);
          closeBitmapIfAny(latestFrameRef.current);
          latestFrameRef.current = decoded;
          latestMetaRef.current = {
            timestamp: payload.timestamp,
            bytes: payload.bytes,
            cursors: payload.cursors,
          };
        } catch (error) {
          addActivity({
            label: 'Decoder fallback failed',
            detail: error instanceof Error ? error.message : String(error),
            tone: 'danger',
          });
        }
        flushDecoderQueue();
        return;
      }

      if (payload.type === 'error') {
        addActivity({
          label: 'Decoder error',
          detail: String(payload.message || 'unknown'),
          tone: 'danger',
        });
        flushDecoderQueue();
      }
    };
  }, [addActivity]);

  const ensureWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = buildDecoderWorker();
      installWorkerHandlers(worker);
      workerRef.current = worker;
    }
    return workerRef.current;
  }, [installWorkerHandlers]);

  const cleanupSocket = useCallback(() => {
    if (heartbeatRef.current) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = undefined;
    }
    connectionRef.current?.close();
    connectionRef.current = null;
    controlConnectionRef.current?.close();
    controlConnectionRef.current = null;
    mediaPeerRef.current?.close();
    mediaPeerRef.current = null;
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current = null;
    mediaActiveRef.current = false;
    pendingIceRef.current = [];
    if (mediaStatsTimerRef.current) window.clearInterval(mediaStatsTimerRef.current);
    mediaStatsTimerRef.current = undefined;
    setMediaStream(null);
    peerRef.current?.destroy();
    peerRef.current = null;

    if (workerRef.current) {
      try {
        workerRef.current.terminate();
      } catch {
        // Worker termination is best effort during reconnect cleanup.
      }
      workerRef.current = null;
    }

    closeBitmapIfAny(latestFrameRef.current);
    latestFrameRef.current = null;
    latestMetaRef.current = null;
    decoderBusyRef.current = false;
    pendingFrameRef.current = null;
    metaLastPushedRef.current = 0;
    lastVideoTimeRef.current = -1;
    ctxRef.current = null;

    // Keep the canvas render loop alive across reconnects. Incoming frames are
    // written to refs and drawn by RAF; stopping RAF here leaves a connected
    // session with frames queued but nothing painting them.
  }, []);

  const disconnect = useCallback(() => {
    cleanupSocket();
    setState((prev) => ({ ...initialState, activity: prev.activity }));
    addActivity({ label: 'Disconnected', tone: 'warning' });
  }, [addActivity, cleanupSocket]);

  const renderLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      rafRef.current = requestAnimationFrame(() => renderLoop());
      return;
    }

    let ctx = ctxRef.current;
    if (!ctx) {
      const contextAttributes: CanvasRenderingContext2DSettings = {
        alpha: false,
        desynchronized: true,
      };
      ctx =
        canvas.getContext('2d', contextAttributes) || canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        ctx.globalCompositeOperation = 'copy';
        ctxRef.current = ctx;
      }
    }

    if (!ctx) {
      rafRef.current = requestAnimationFrame(() => renderLoop());
      return;
    }

    const frame = latestFrameRef.current;
    const isVideo = frame instanceof HTMLVideoElement;
    const isNewVideoFrame =
      !isVideo ||
      (frame.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        frame.currentTime !== lastVideoTimeRef.current);
    if (frame && isNewVideoFrame) {
      const width = isVideo
        ? frame.videoWidth
        : frame.width ?? (frame as HTMLImageElement).naturalWidth ?? canvas.width;
      const height = isVideo
        ? frame.videoHeight
        : frame.height ?? (frame as HTMLImageElement).naturalHeight ?? canvas.height;
      if (!width || !height) {
        rafRef.current = requestAnimationFrame(() => renderLoop());
        return;
      }
      if (width && height && (canvas.width !== width || canvas.height !== height)) {
        canvas.width = width;
        canvas.height = height;
      }
      try {
        ctx.drawImage(frame as CanvasImageSource, 0, 0, canvas.width, canvas.height);
      } catch {
        // A dropped or detached frame should not stop the render loop.
      }
      if (isVideo) {
        lastVideoTimeRef.current = frame.currentTime;
      } else {
        closeBitmapIfAny(frame);
        latestFrameRef.current = null;
      }

      // fps
      frameCounterRef.current += 1;
      const t = Date.now();
      const started = fpsSampleStartRef.current || t;
      fpsSampleStartRef.current = started;
      if (t - started >= 1000) {
        const fps = Math.round((frameCounterRef.current * 1000) / (t - started));
        setState((prev) => (prev.fps === fps ? prev : { ...prev, fps }));
        fpsSampleStartRef.current = t;
        frameCounterRef.current = 0;
      }

      // throttle metadata into React
      const last = metaLastPushedRef.current;
      const n = now();
      if (last === 0 || n - last >= META_THROTTLE_MS) {
        const meta = latestMetaRef.current || {};
        setFrameMetadata({ width, height, cursors: meta.cursors ?? [] });
        metaLastPushedRef.current = n;
      }
    }

    rafRef.current = requestAnimationFrame(() => renderLoop());
  }, []);

  // Init worker once
  useEffect(() => {
    const w = ensureWorker();

    if (!rafRef.current) rafRef.current = requestAnimationFrame(renderLoop);

    return () => {
      try {
        w.terminate();
      } catch {
        // Worker termination is best effort on unmount.
      }
      workerRef.current = null;
    };
  }, [ensureWorker, renderLoop]);

  const acceptRtcOffer = useCallback(async (sdp: string) => {
    mediaPeerRef.current?.close();
    const mediaPeer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    mediaPeerRef.current = mediaPeer;
    mediaPeer.onicecandidate = (event) => {
      if (event.candidate) {
        sendMessage('rtc_ice', { candidate: event.candidate.toJSON() });
      }
    };
    mediaPeer.ontrack = async (event) => {
      (event.receiver as RTCRtpReceiver & { playoutDelayHint?: number }).playoutDelayHint = 0.08;
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      remoteStreamRef.current = stream;
      mediaActiveRef.current = true;
      setMediaStream(stream);
      workerRef.current?.terminate();
      workerRef.current = null;
      decoderBusyRef.current = false;
      pendingFrameRef.current = null;
      closeBitmapIfAny(latestFrameRef.current);
      latestFrameRef.current = null;
      sendMessage('media_ready', {});

      let previousFrames = 0;
      let previousPacketsLost = 0;
      let previousPacketsReceived = 0;
      let previousFramesDropped = 0;
      let previousTime = performance.now();
      if (mediaStatsTimerRef.current) window.clearInterval(mediaStatsTimerRef.current);
      mediaStatsTimerRef.current = window.setInterval(async () => {
        const reports = await mediaPeer.getStats();
        const inbound = [...reports.values()].find(
          (report) => report.type === 'inbound-rtp' && report.kind === 'video',
        );
        if (!inbound) return;
        const currentTime = performance.now();
        const frames = Number(inbound.framesDecoded ?? previousFrames);
        const measuredFps = Math.round(
          Number(inbound.framesPerSecond) ||
            ((frames - previousFrames) * 1000) / Math.max(1, currentTime - previousTime),
        );
        previousFrames = frames;
        previousTime = currentTime;
        const width = Number(inbound.frameWidth || event.track.getSettings().width || 0);
        const height = Number(inbound.frameHeight || event.track.getSettings().height || 0);
        const packetsLost = Number(inbound.packetsLost || 0);
        const packetsReceived = Number(inbound.packetsReceived || 0);
        const lostDelta = Math.max(0, packetsLost - previousPacketsLost);
        const receivedDelta = Math.max(0, packetsReceived - previousPacketsReceived);
        previousPacketsLost = packetsLost;
        previousPacketsReceived = packetsReceived;
        const lossRate = lostDelta / Math.max(1, lostDelta + receivedDelta);
        const framesDropped = Number(inbound.framesDropped || 0);
        const droppedDelta = Math.max(0, framesDropped - previousFramesDropped);
        previousFramesDropped = framesDropped;
        const candidatePair = [...reports.values()].find(
          (report) =>
            report.type === 'candidate-pair' &&
            report.state === 'succeeded' &&
            (report.nominated || report.selected),
        );
        const rttMs = Number(candidatePair?.currentRoundTripTime || 0) * 1000;
        setState((previous) =>
          previous.fps === measuredFps && previous.latency === Math.round(rttMs)
            ? previous
            : { ...previous, fps: measuredFps, latency: Math.round(rttMs) },
        );
        if (width && height) setFrameMetadata({ width, height, cursors: [] });
        sendMessage('quality_report', {
          fps: measuredFps,
          lossRate,
          jitter: Number(inbound.jitter || 0),
          framesDropped,
          droppedDelta,
          width,
          height,
          rttMs,
        });
      }, 1000);
    };
    mediaPeer.onconnectionstatechange = () => {
      if (mediaPeer.connectionState === 'failed' || mediaPeer.connectionState === 'closed') {
        mediaActiveRef.current = false;
        setMediaStream(null);
        sendMessage('media_unavailable', {});
      }
    };
    await mediaPeer.setRemoteDescription({ type: 'offer', sdp });
    const queued = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const candidate of queued) await mediaPeer.addIceCandidate(candidate);
    const answer = await mediaPeer.createAnswer();
    await mediaPeer.setLocalDescription(answer);
    sendMessage('rtc_answer', { sdp: answer.sdp ?? '' });
  }, [sendMessage]);

  const addRtcIceCandidate = useCallback((candidate: RTCIceCandidateInit) => {
    const mediaPeer = mediaPeerRef.current;
    if (mediaPeer?.remoteDescription) {
      void mediaPeer.addIceCandidate(candidate);
    } else {
      pendingIceRef.current.push(candidate);
    }
  }, []);

  const handleMessage = useCallback((message: ServerMessage) => {
    const payload = message.payload ?? {};
    switch (message.type) {
      case 'session_accept':
        setState((prev) => ({
          ...prev,
          status: 'connected',
          deviceName: String(payload.deviceName ?? ''),
          os: String(payload.os ?? ''),
          region: String(payload.region ?? ''),
          viewers: typeof payload.viewers === 'number' ? payload.viewers : 1,
          error: undefined,
        }));
        addActivity({ label: `Connected to ${String(payload.deviceName ?? 'host')}`, tone: 'success' });
        heartbeatRef.current = window.setInterval(() => {
          setState((prev) => {
            sendMessage('heartbeat', { latency: prev.latency });
            return prev;
          });
        }, HEARTBEAT_INTERVAL);
        break;

      case 'session_rejected':
        setState((prev) => ({ ...prev, status: 'error', error: String(payload.reason ?? 'Session rejected') }));
        addActivity({ label: 'Session rejected', detail: String(payload.reason ?? ''), tone: 'danger' });
        cleanupSocket();
        break;

      case 'frame': {
        if (mediaActiveRef.current) break;
        const frame = payload as FrameMessagePayload;
        if (typeof frame.data !== 'string') break;
        postFramePayload(frame);
        break;
      }

      case 'rtc_offer':
        if (payload.sdp) void acceptRtcOffer(String(payload.sdp));
        break;

      case 'rtc_ice':
        if (payload.candidate) addRtcIceCandidate(payload.candidate as RTCIceCandidateInit);
        break;

      case 'stream_profile':
        addActivity({
          label: `Stream ${String(payload.name || 'adjusted')}`,
          detail: `${Math.round(Number(payload.width || 0))}p target · ${Math.round(Number(payload.fps || 0))} fps`,
          tone: 'info',
        });
        break;

      case 'chat_message':
        {
          const sender: ChatSender =
            payload.sender === 'agent' || payload.sender === 'system' ? payload.sender : 'viewer';
        setState((prev) => ({
          ...prev,
          chat: [
            ...prev.chat,
            {
              id: makeId(),
              sender,
              nickname: String(payload.nickname ?? payload.sender ?? 'Viewer'),
              message: String(payload.message ?? ''),
              timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
            },
          ].slice(-100),
        }));
        break;
        }

      case 'file_offer': {
        const { fileId, name, mime, size, direction, sender } = payload;
        if (direction === 'agent_to_viewer' || sender === 'agent') {
          const id = String(fileId);
          const fileName = String(name ?? 'download');
          const fileSize = typeof size === 'number' ? size : 0;
          const fileMime = typeof mime === 'string' ? mime : undefined;
          fileBufferRef.current[id] = { name: fileName, mime: fileMime, size: fileSize, direction: 'inbound', received: 0, chunks: [] };
          updateTransfers({ id, name: fileName, mime: fileMime, size: fileSize, direction: 'inbound', status: 'pending', progress: 0 });
          addActivity({ label: 'Incoming file', detail: fileName, tone: 'info' });
        }
        break;
      }

      case 'file_chunk': {
        const { fileId, data, index, total, sender } = payload;
        if (sender === 'agent') {
          const id = String(fileId);
          const buffer = fileBufferRef.current[id];
          if (!buffer) break;
          if (typeof index !== 'number' || typeof data !== 'string') break;
          buffer.chunks[index] = data;
          buffer.received += 1;
          buffer.totalChunks = typeof total === 'number' ? total : undefined;
          const progress = buffer.totalChunks ? buffer.received / buffer.totalChunks : 0;
          updateTransfers({ id, name: buffer.name, mime: buffer.mime, size: buffer.size, direction: 'inbound', status: progress >= 1 ? 'completed' : 'in_progress', progress });
          if (payload.done || progress >= 1) {
            saveInboundFile(buffer);
            addActivity({ label: 'File saved', detail: buffer.name, tone: 'success' });
            delete fileBufferRef.current[id];
          }
        }
        break;
      }

      default:
        break;
    }
  }, [acceptRtcOffer, addActivity, addRtcIceCandidate, cleanupSocket, sendMessage, updateTransfers]);

  const connect = useCallback((code: string, nickname: string) => {
    cleanupSocket();
    setState((prev) => ({ ...prev, status: 'connecting', code, nickname, error: undefined }));
    addActivity({ label: `Connecting to ${code}`, tone: 'info' });

    const peer = new Peer({ debug: 1 });
    peerRef.current = peer;

    peer.on('open', () => {
      const connection = peer.connect(`${PEER_PREFIX}${code.toLowerCase()}`, {
        reliable: true,
        serialization: 'binary',
        metadata: { nickname, channel: 'session' },
      });
      connectionRef.current = connection;
      controlConnectionRef.current = peer.connect(`${PEER_PREFIX}${code.toLowerCase()}`, {
        reliable: true,
        serialization: 'binary',
        metadata: { nickname, channel: 'control' },
      });
      connection.on('open', () => {
        connection.send({ type: 'viewer_join', payload: { code, nickname } });
      });
      connection.on('data', (raw) => handleMessage(raw as ServerMessage));
      connection.on('close', () => {
        setState((prev) => ({ ...prev, status: 'error', error: 'Host disconnected' }));
      });
      connection.on('error', (error) => {
        setState((prev) => ({ ...prev, status: 'error', error: error.message }));
      });
    });

    peer.on('error', (error) => {
      const message =
        error.type === 'peer-unavailable'
          ? 'Session code not found. Confirm the host is still sharing.'
          : error.message;
      setState((prev) => ({ ...prev, status: 'error', error: message }));
      addActivity({ label: 'Connection failed', detail: message, tone: 'danger' });
    });
  }, [addActivity, cleanupSocket, handleMessage, sendMessage]);

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

  useEffect(() => () => cleanupSocket(), [cleanupSocket]);

  useEffect(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(renderLoop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [renderLoop]);

  const resetError = useCallback(() => setState((prev) => ({ ...prev, error: undefined, status: 'idle' })), []);

  const api = useMemo<RemoteSessionApi>(() => ({
    ...state,
    connect,
    disconnect,
    sendInput,
    sendChat,
    sendFile,
    resetError,
    canvasRef,
    mediaStream,
    frameMetadata, // throttled
  }), [connect, disconnect, sendChat, sendFile, sendInput, resetError, state, mediaStream, frameMetadata]);

  return api;
};

const saveInboundFile = (buffer: InboundFileBuffer) => {
  const merged = buffer.chunks.join('');
  const byteCharacters = atob(merged);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i += 1) byteNumbers[i] = byteCharacters.charCodeAt(i);
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: buffer.mime ?? 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = buffer.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

