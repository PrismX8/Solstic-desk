import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import type { HostState } from '../types/desktop';

const PEER_PREFIX = 'solstice-';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const initialState: HostState = {
  status: 'idle',
  viewers: 0,
};

const makeCode = () =>
  Array.from({ length: 6 }, () =>
    CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
  ).join('');

type PeerMessage = {
  type?: string;
  payload?: Record<string, unknown>;
};

const STREAM_PROFILES = [
  { name: 'Sharp', width: 1920, bitrate: 16_000_000, fps: 120 },
  { name: 'Balanced', width: 1920, bitrate: 12_000_000, fps: 90 },
  { name: 'Stable', width: 1600, bitrate: 8_000_000, fps: 60 },
  { name: 'Responsive', width: 1280, bitrate: 5_000_000, fps: 60 },
] as const;

type AdaptiveSender = {
  sender: RTCRtpSender;
  connection: DataConnection;
  sourceWidth: number;
  profileIndex: number;
  goodSamples: number;
  lastAdjustment: number;
};

export const useHostSession = () => {
  const hostApi = window.solsticeDesktop?.host;
  const captureAvailable = Boolean(navigator.mediaDevices?.getDisplayMedia);
  const [state, setState] = useState<HostState>(initialState);
  const peerRef = useRef<Peer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameTimerRef = useRef<number | undefined>(undefined);
  const captureBusyRef = useRef(false);
  const connectionsRef = useRef(new Map<string, DataConnection>());
  const mediaPeersRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const mediaReadyPeersRef = useRef(new Set<string>());
  const connectedAtRef = useRef(new Map<string, number>());
  const adaptiveSendersRef = useRef(new Map<string, AdaptiveSender>());
  const latestPointerSequenceRef = useRef(new Map<string, number>());

  const applyStreamProfile = useCallback(async (key: string, profileIndex: number) => {
    const adaptive = adaptiveSendersRef.current.get(key);
    if (!adaptive) return;
    const boundedIndex = Math.max(0, Math.min(STREAM_PROFILES.length - 1, profileIndex));
    const profile = STREAM_PROFILES[boundedIndex];
    const parameters = adaptive.sender.getParameters();
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    parameters.encodings[0].maxBitrate = profile.bitrate;
    parameters.encodings[0].maxFramerate = profile.fps;
    parameters.encodings[0].scaleResolutionDownBy = Math.max(1, adaptive.sourceWidth / profile.width);
    parameters.encodings[0].priority = 'high';
    parameters.encodings[0].networkPriority = 'high';
    (parameters as RTCRtpSendParameters & {
      degradationPreference?: 'maintain-resolution';
    }).degradationPreference = 'maintain-resolution';
    try {
      await adaptive.sender.setParameters(parameters);
      adaptive.profileIndex = boundedIndex;
      adaptive.lastAdjustment = Date.now();
      adaptive.connection.send({
        type: 'stream_profile',
        payload: { name: profile.name, bitrate: profile.bitrate, fps: profile.fps, width: profile.width },
      });
    } catch {
      // Browser congestion control remains active if a parameter is unsupported.
    }
  }, []);

  const handleQualityReport = useCallback((key: string, payload: Record<string, unknown>) => {
    const adaptive = adaptiveSendersRef.current.get(key);
    if (!adaptive) return;
    const fps = Number(payload.fps || 0);
    const lossRate = Number(payload.lossRate || 0);
    const rttMs = Number(payload.rttMs || 0);
    const now = Date.now();
    const severe = lossRate > 0.1 || rttMs > 650;
    const degraded = lossRate > 0.035 || rttMs > 350;
    const healthy = lossRate < 0.01 && (rttMs === 0 || rttMs < 220);

    setState((previous) => ({
      ...previous,
      fps: Math.round(fps),
      captureMs: Math.round(rttMs),
      droppedFrames: Math.round(lossRate * 100),
    }));

    if ((severe || degraded) && now - adaptive.lastAdjustment > 5000) {
      adaptive.goodSamples = 0;
      void applyStreamProfile(key, adaptive.profileIndex + 1);
      return;
    }
    if (healthy) adaptive.goodSamples += 1;
    else adaptive.goodSamples = 0;
    if (adaptive.goodSamples >= 15 && adaptive.profileIndex > 0 && now - adaptive.lastAdjustment > 15_000) {
      adaptive.goodSamples = 0;
      void applyStreamProfile(key, adaptive.profileIndex - 1);
    }
  }, [applyStreamProfile]);

  const captureFrame = useCallback(() => {
    const started = performance.now();
    const scheduleNext = () => {
      frameTimerRef.current = window.setTimeout(
        captureFrame,
        Math.max(0, 500 - (performance.now() - started)),
      );
    };

    const video = videoRef.current;
    const fallbackConnections = [...connectionsRef.current.values()].filter(
      (connection) =>
        !mediaReadyPeersRef.current.has(connection.peer) &&
        Date.now() - (connectedAtRef.current.get(connection.connectionId) ?? Date.now()) >= 5000,
    );
    if (
      captureBusyRef.current ||
      !video ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      fallbackConnections.length === 0
    ) {
      scheduleNext();
      return;
    }

    captureBusyRef.current = true;
    try {
      const scale = Math.min(1, 1280 / video.videoWidth);
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      const canvas = canvasRef.current ?? document.createElement('canvas');
      canvasRef.current = canvas;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return;
      context.drawImage(video, 0, 0, width, height);
      const data = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
      if (!data) return;
      const message = {
        type: 'frame',
        payload: {
          data,
          mime: 'image/jpeg',
          width,
          height,
          bytes: Math.floor((data.length * 3) / 4),
          timestamp: Date.now(),
        },
      };
      fallbackConnections.forEach((connection) => {
        if (
          !mediaReadyPeersRef.current.has(connection.peer) &&
          connection.open &&
          connection.dataChannel.bufferedAmount < 512 * 1024
        ) {
          connection.send(message);
        }
      });
    } finally {
      captureBusyRef.current = false;
      scheduleNext();
    }
  }, []);

  const stop = useCallback(async () => {
    connectionsRef.current.forEach((connection) => connection.close());
    connectionsRef.current.clear();
    mediaPeersRef.current.forEach((connection) => connection.close());
    mediaPeersRef.current.clear();
    pendingIceRef.current.clear();
    mediaReadyPeersRef.current.clear();
    connectedAtRef.current.clear();
    adaptiveSendersRef.current.clear();
    latestPointerSequenceRef.current.clear();
    peerRef.current?.destroy();
    peerRef.current = null;
    if (frameTimerRef.current) window.clearTimeout(frameTimerRef.current);
    frameTimerRef.current = undefined;
    captureBusyRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    videoRef.current = null;
    canvasRef.current = null;
    setState(initialState);
  }, []);

  const start = useCallback(
    async (deviceName?: string, sourceId?: string) => {
      await stop();
      if (!captureAvailable) {
        setState({
          ...initialState,
          status: 'error',
          error: 'Screen sharing is not available on this computer.',
        });
        return;
      }

      const label = deviceName || 'Solstice host';
      setState({ ...initialState, status: 'connecting', deviceName: label });

      try {
        if (sourceId && hostApi?.setCaptureSource) {
          await hostApi.setCaptureSource(sourceId);
        }
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 120, max: 120 },
            width: { ideal: 3840, max: 3840 },
            height: { ideal: 2160, max: 2160 },
          },
          audio: false,
        });
        streamRef.current = stream;
        const videoTrack = stream.getVideoTracks()[0];
        if (!videoTrack) throw new Error('The selected source did not provide a video track.');
        videoTrack.contentHint = 'detail';
        await videoTrack
          .applyConstraints({ frameRate: { ideal: 120, max: 120 } })
          .catch(() => undefined);

        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        await video.play();
        videoRef.current = video;

        const code = makeCode();
        const peer = new Peer(`${PEER_PREFIX}${code.toLowerCase()}`, { debug: 1 });
        peerRef.current = peer;

        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          void stop();
        });

        peer.on('open', () => {
          setState({
            status: 'connected',
            viewers: connectionsRef.current.size,
            sessionCode: code,
            deviceName: label,
            error: undefined,
          });
          frameTimerRef.current = window.setTimeout(captureFrame, 0);
        });

        peer.on('connection', (connection) => {
          const channel = connection.metadata?.channel;
          const isInputChannel = channel === 'control' || channel === 'pointer';
          const connectionKey = connection.connectionId;
          connection.on('open', () => {
            if (isInputChannel) return;
            connectionsRef.current.set(connectionKey, connection);
            connectedAtRef.current.set(connectionKey, Date.now());
            setState((previous) => ({
              ...previous,
              viewers: connectionsRef.current.size,
            }));

            connection.send({
              type: 'session_accept',
              payload: {
                code,
                deviceName: label,
                os: navigator.platform || 'Windows',
                region: 'peer-to-peer',
                viewers: connectionsRef.current.size,
              },
            });

            const mediaPeer = new RTCPeerConnection({
              iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            });
            mediaPeersRef.current.set(connectionKey, mediaPeer);
            pendingIceRef.current.set(connectionKey, []);
            mediaPeer.onicecandidate = (event) => {
              if (event.candidate && connection.open) {
                connection.send({
                  type: 'rtc_ice',
                  payload: { candidate: event.candidate.toJSON() },
                });
              }
            };
            const transceiver = mediaPeer.addTransceiver(videoTrack, {
              direction: 'sendonly',
              streams: [stream],
            });
            const videoSender = transceiver.sender;
            const codecs = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
            const codecRank = (codec: { mimeType: string }) => {
              const mime = codec.mimeType.toLowerCase();
              if (mime === 'video/h264') return 0;
              if (mime === 'video/vp9') return 1;
              if (mime === 'video/vp8') return 2;
              return 3;
            };
            transceiver.setCodecPreferences([...codecs].sort((a, b) => codecRank(a) - codecRank(b)));
            adaptiveSendersRef.current.set(connectionKey, {
              sender: videoSender,
              connection,
              sourceWidth: videoTrack.getSettings().width || video.videoWidth || 1920,
              profileIndex: 0,
              goodSamples: 0,
              lastAdjustment: 0,
            });
            void mediaPeer
              .createOffer()
              .then((offer) => mediaPeer.setLocalDescription(offer).then(() => offer))
              .then((offer) => {
                void applyStreamProfile(connectionKey, 0);
                if (connection.open) {
                  connection.send({ type: 'rtc_offer', payload: { sdp: offer.sdp } });
                }
              });
          });

          connection.on('data', (raw) => {
            const message = raw as PeerMessage;
            if (message?.type === 'input_event' && message.payload && hostApi?.applyInput) {
              if (message.payload.kind === 'mouse_move') {
                const sequence = Number(message.payload.sequence || 0);
                const latest = latestPointerSequenceRef.current.get(connection.peer) ?? 0;
                if (sequence <= latest) return;
                latestPointerSequenceRef.current.set(connection.peer, sequence);
              }
              void hostApi.applyInput(message.payload);
            }
            if (message?.type === 'media_ready') {
              mediaReadyPeersRef.current.add(connection.peer);
            }
            if (message?.type === 'media_unavailable') {
              mediaReadyPeersRef.current.delete(connection.peer);
            }
            if (message?.type === 'quality_report' && message.payload) {
              handleQualityReport(connectionKey, message.payload);
            }
            const mediaPeer = mediaPeersRef.current.get(connectionKey);
            if (message?.type === 'rtc_answer' && mediaPeer && message.payload?.sdp) {
              void mediaPeer
                .setRemoteDescription({
                  type: 'answer',
                  sdp: String(message.payload.sdp),
                })
                .then(async () => {
                  const queued = pendingIceRef.current.get(connectionKey) ?? [];
                  pendingIceRef.current.set(connectionKey, []);
                  for (const candidate of queued) await mediaPeer.addIceCandidate(candidate);
                });
            }
            if (message?.type === 'rtc_ice' && mediaPeer && message.payload?.candidate) {
              const candidate = message.payload.candidate as RTCIceCandidateInit;
              if (mediaPeer.remoteDescription) {
                void mediaPeer.addIceCandidate(candidate);
              } else {
                pendingIceRef.current.get(connectionKey)?.push(candidate);
              }
            }
          });

          const removeViewer = () => {
            if (isInputChannel) return;
            connectionsRef.current.delete(connectionKey);
            mediaReadyPeersRef.current.delete(connection.peer);
            mediaPeersRef.current.get(connectionKey)?.close();
            mediaPeersRef.current.delete(connectionKey);
            pendingIceRef.current.delete(connectionKey);
            connectedAtRef.current.delete(connectionKey);
            adaptiveSendersRef.current.delete(connectionKey);
            setState((previous) => ({
              ...previous,
              viewers: connectionsRef.current.size,
            }));
          };
          connection.on('close', removeViewer);
          connection.on('error', removeViewer);
        });

        peer.on('error', (error) => {
          setState((previous) => ({
            ...previous,
            status: 'error',
            sessionCode: undefined,
            error: error.message,
          }));
        });
      } catch (error) {
        await stop();
        setState({
          ...initialState,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [applyStreamProfile, captureAvailable, captureFrame, handleQualityReport, hostApi, stop],
  );

  useEffect(() => () => {
    void stop();
  }, [stop]);

  return useMemo(
    () => ({
      available: captureAvailable,
      mode: hostApi ? 'desktop' : 'browser',
      state,
      start,
      stop,
    }),
    [captureAvailable, hostApi, start, state, stop],
  );
};
