/* eslint-disable react-hooks/refs */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  Camera,
  Expand,
  Fullscreen,
  Focus,
  Keyboard,
  Maximize2,
  Minimize2,
  MonitorDown,
  MousePointer2,
} from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { RemoteSessionApi } from '../types/remote';
import { ToolbarButton } from './ToolbarButton';

interface Props {
  session: RemoteSessionApi;
}

type FitMode = 'contain' | 'actual';
type NormalizedPoint = { x: number; y: number };
type DisplayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const MIN_PANEL = { width: 420, height: 320 };

const resolveDisplayRect = (
  surface: HTMLDivElement,
  metadata: RemoteSessionApi['frameMetadata'],
  fitMode: FitMode,
): DisplayRect | null => {
  const rect = surface.getBoundingClientRect();
  if (!metadata?.width || !metadata.height || !rect.width || !rect.height) {
    return null;
  }

  if (fitMode === 'actual') {
    return {
      left: rect.left + Math.max(0, (rect.width - metadata.width) / 2),
      top: rect.top + Math.max(0, (rect.height - metadata.height) / 2),
      width: metadata.width,
      height: metadata.height,
    };
  }

  const imageAspect = metadata.width / metadata.height;
  const surfaceAspect = rect.width / rect.height;

  if (imageAspect > surfaceAspect) {
    const width = rect.width;
    const height = width / imageAspect;
    return {
      left: rect.left,
      top: rect.top + (rect.height - height) / 2,
      width,
      height,
    };
  }

  const height = rect.height;
  const width = height * imageAspect;
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top,
    width,
    height,
  };
};

export const RemoteSurface = ({ session }: Props) => {
  const sectionRef = useRef<HTMLElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const pointerTimerRef = useRef<number | null>(null);
  const pendingPointerRef = useRef<NormalizedPoint | null>(null);
  const lastPointerSentAtRef = useRef(0);
  const pressedButtonsRef = useRef(new Set<'left' | 'middle' | 'right'>());
  const pressedKeysRef = useRef(new Map<string, { key: string; code: string }>());
  const resizeStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    width: number;
    height: number;
  } | null>(null);

  const [fitMode, setFitMode] = useState<FitMode>('contain');
  const [isControlling, setIsControlling] = useState(false);
  const [cursor, setCursor] = useState<NormalizedPoint | null>(null);
  const [panelSize, setPanelSize] = useState({ width: 0, height: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  const [cursorStyle, setCursorStyle] = useState<{ left: number; top: number } | null>(null);

  const effectiveMetadata = session.frameMetadata ?? videoSize;
  const hasFrame = Boolean(session.mediaStream || (effectiveMetadata?.width && effectiveMetadata.height));
  const resolutionLabel = hasFrame
    ? effectiveMetadata?.width && effectiveMetadata.height
      ? `${effectiveMetadata.width} x ${effectiveMetadata.height}`
      : 'Live video'
    : 'No signal';
  const surfaceReady = session.status === 'connected' && hasFrame;
  const sendInput = session.sendInput;

  const releaseHeldInputs = useCallback(() => {
    pressedButtonsRef.current.forEach((button) => {
      sendInput({ kind: 'mouse_up', button });
    });
    pressedButtonsRef.current.clear();
    pressedKeysRef.current.forEach(({ key, code }) => {
      sendInput({ kind: 'key_up', key, code });
    });
    pressedKeysRef.current.clear();
  }, [sendInput]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !session.mediaStream) return;
    video.srcObject = session.mediaStream;
    void video.play();
  }, [session.mediaStream]);

  useEffect(() => {
    if (session.status !== 'connected') {
      releaseHeldInputs();
      setIsControlling(false);
    }
  }, [releaseHeldInputs, session.status]);

  useEffect(() => {
    if (isControlling) {
      surfaceRef.current?.focus();
    }
  }, [isControlling]);

  useEffect(() => {
    const handleControlToggle = (event: KeyboardEvent) => {
      if (event.code !== 'Backquote' || event.repeat || !surfaceReady) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setIsControlling((active) => {
        if (active) releaseHeldInputs();
        return !active;
      });
    };
    window.addEventListener('keydown', handleControlToggle, true);
    return () => window.removeEventListener('keydown', handleControlToggle, true);
  }, [releaseHeldInputs, surfaceReady]);

  useEffect(() => {
    const handleBlur = () => releaseHeldInputs();
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [releaseHeldInputs]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === sectionRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || isResizing) return undefined;

    const updateSize = () => {
      const rect = shell.getBoundingClientRect();
      if (!rect.width) return;
      const width = Math.max(MIN_PANEL.width, rect.width);
      const height = Math.max(MIN_PANEL.height, width * 0.5625);
      setPanelSize((current) =>
        Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
          ? current
          : { width, height },
      );
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [isResizing]);

  const getNormalizedCoords = useCallback(
    (clientX: number, clientY: number): NormalizedPoint | null => {
      const surface = surfaceRef.current;
      if (!surface) return null;

      const display = resolveDisplayRect(surface, effectiveMetadata, fitMode);
      if (!display) return null;

      return {
        x: clamp01((clientX - display.left) / display.width),
        y: clamp01((clientY - display.top) / display.height),
      };
    },
    [effectiveMetadata, fitMode],
  );

  const sendPointerPosition = useCallback(
    (clientX: number, clientY: number, reliable = false) => {
      const surface = surfaceRef.current;
      const coords = getNormalizedCoords(clientX, clientY);
      if (!surface || !coords) return;
      const display = resolveDisplayRect(surface, effectiveMetadata, fitMode);
      const surfaceRect = surface.getBoundingClientRect();
      if (!display) return;
      setCursor(coords);
      setCursorStyle({
        left: display.left - surfaceRect.left + coords.x * display.width,
        top: display.top - surfaceRect.top + coords.y * display.height,
      });
      if (reliable) {
        if (pointerTimerRef.current !== null) window.clearTimeout(pointerTimerRef.current);
        pointerTimerRef.current = null;
        pendingPointerRef.current = null;
        lastPointerSentAtRef.current = performance.now();
        session.sendInput({ kind: 'mouse_move', x: coords.x, y: coords.y, reliable: true });
        return;
      }

      pendingPointerRef.current = coords;
      if (pointerTimerRef.current !== null) return;
      const delay = Math.max(0, 16 - (performance.now() - lastPointerSentAtRef.current));
      pointerTimerRef.current = window.setTimeout(() => {
        pointerTimerRef.current = null;
        const latest = pendingPointerRef.current;
        pendingPointerRef.current = null;
        if (!latest) return;
        lastPointerSentAtRef.current = performance.now();
        session.sendInput({ kind: 'mouse_move', x: latest.x, y: latest.y });
      }, delay);
    },
    [effectiveMetadata, fitMode, getNormalizedCoords, session],
  );

  useEffect(() => () => {
    if (pointerTimerRef.current !== null) window.clearTimeout(pointerTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isControlling) return undefined;
    const releasePointer = (event: PointerEvent) => {
      const button = event.button === 1 ? 'middle' : event.button === 2 ? 'right' : 'left';
      if (!pressedButtonsRef.current.has(button)) return;
      pressedButtonsRef.current.delete(button);
      sendInput({ kind: 'mouse_up', button });
    };
    const releaseAllPointers = () => {
      pressedButtonsRef.current.forEach((button) => sendInput({ kind: 'mouse_up', button }));
      pressedButtonsRef.current.clear();
    };
    window.addEventListener('pointerup', releasePointer, true);
    window.addEventListener('pointercancel', releasePointer, true);
    window.addEventListener('blur', releaseAllPointers);
    return () => {
      window.removeEventListener('pointerup', releasePointer, true);
      window.removeEventListener('pointercancel', releasePointer, true);
      window.removeEventListener('blur', releaseAllPointers);
    };
  }, [isControlling, sendInput]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    const handleWheel = (event: WheelEvent) => {
      if (!isControlling || !surfaceReady) return;
      event.preventDefault();
      sendInput({
        kind: 'mouse_wheel',
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
    };
    surface.addEventListener('wheel', handleWheel, { passive: false });
    return () => surface.removeEventListener('wheel', handleWheel);
  }, [isControlling, sendInput, surfaceReady]);

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isControlling || !surfaceReady || isResizing) return;
    const latest = event.nativeEvent.getCoalescedEvents?.().at(-1) ?? event.nativeEvent;
    sendPointerPosition(latest.clientX, latest.clientY);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isControlling || !surfaceReady || isResizing) return;
    event.preventDefault();
    sendPointerPosition(event.clientX, event.clientY, true);
    const button = event.button === 1 ? 'middle' : event.button === 2 ? 'right' : 'left';
    if (pressedButtonsRef.current.has(button)) {
      session.sendInput({ kind: 'mouse_up', button });
    }
    pressedButtonsRef.current.add(button);
    session.sendInput({ kind: 'mouse_down', button });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isControlling || !surfaceReady) return;
    event.preventDefault();
    sendPointerPosition(event.clientX, event.clientY, true);
    const button = event.button === 1 ? 'middle' : event.button === 2 ? 'right' : 'left';
    if (!pressedButtonsRef.current.has(button)) return;
    pressedButtonsRef.current.delete(button);
    session.sendInput({ kind: 'mouse_up', button });
  };

  const handleResizeStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (isControlling) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      width: panelSize.width || MIN_PANEL.width,
      height: panelSize.height || MIN_PANEL.height,
    };
    setIsResizing(true);
  };

  const handleResizeMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isResizing || !resizeStartRef.current) return;
    const start = resizeStartRef.current;
    setPanelSize({
      width: Math.max(MIN_PANEL.width, start.width + event.clientX - start.pointerX),
      height: Math.max(MIN_PANEL.height, start.height + event.clientY - start.pointerY),
    });
  };

  const handleResizeEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeStartRef.current = null;
    setIsResizing(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isControlling || event.code === 'Backquote') return;
    event.preventDefault();
    pressedKeysRef.current.set(event.code, { key: event.key, code: event.code });
    session.sendInput({
      kind: 'key_down',
      key: event.key,
      code: event.code,
      meta: {
        alt: event.altKey,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        meta: event.metaKey,
      },
    });
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isControlling || event.code === 'Backquote') return;
    event.preventDefault();
    pressedKeysRef.current.delete(event.code);
    session.sendInput({ kind: 'key_up', key: event.key, code: event.code });
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await sectionRef.current?.requestFullscreen();
  };

  const handleScreenshot = () => {
    const canvas = session.canvasRef.current;
    const video = videoRef.current;
    if ((!canvas || !canvas.width || !canvas.height) && (!video || !video.videoWidth)) return;
    const output = document.createElement('canvas');
    output.width = video?.videoWidth || canvas?.width || 1;
    output.height = video?.videoHeight || canvas?.height || 1;
    const context = output.getContext('2d');
    if (!context) return;
    context.drawImage((video?.videoWidth ? video : canvas) as CanvasImageSource, 0, 0);
    output.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `solstice-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
    }, 'image/jpeg', 0.95);
  };

  const remoteCursorMarkers = useMemo(() => {
    const cursors = session.frameMetadata?.cursors ?? [];
    return cursors.map((remoteCursor, index) => ({
      ...remoteCursor,
      color: ['bg-cyan-400', 'bg-pink-400', 'bg-lime-400', 'bg-amber-300', 'bg-violet-400', 'bg-orange-400'][index % 6],
    }));
  }, [session.frameMetadata?.cursors]);

  return (
    <section
      ref={sectionRef}
      className={clsx(
        'glass-panel overflow-hidden',
        isFullscreen && 'flex h-screen w-screen flex-col rounded-none bg-[#05070f]',
      )}
    >
      <div className="flex flex-col gap-4 border-b border-white/5 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">Remote Surface</p>
          <p className="text-lg font-semibold text-white">{session.deviceName ?? 'Awaiting host'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ToolbarButton
            icon={<MousePointer2 />}
            label="Control"
            hotkey="`"
            active={isControlling}
            disabled={!surfaceReady}
            onClick={() =>
              setIsControlling((active) => {
                if (active) releaseHeldInputs();
                return !active;
              })
            }
          />
          <ToolbarButton
            icon={<Expand />}
            label={fitMode === 'contain' ? 'Actual' : 'Fit'}
            hotkey="F"
            active={fitMode === 'actual'}
            disabled={!surfaceReady}
            onClick={() => setFitMode((mode) => (mode === 'contain' ? 'actual' : 'contain'))}
          />
          <ToolbarButton
            icon={isFullscreen ? <Minimize2 /> : <Fullscreen />}
            label={isFullscreen ? 'Exit full screen' : 'Full screen'}
            active={isFullscreen}
            disabled={!surfaceReady}
            onClick={() => void toggleFullscreen()}
          />
          <ToolbarButton
            icon={<Camera />}
            label="Capture"
            disabled={!surfaceReady}
            onClick={handleScreenshot}
          />
        </div>
      </div>

      <div ref={shellRef} className={clsx('relative p-4', isFullscreen && 'min-h-0 flex-1')}>
        <div
          className="relative max-w-full"
          style={{
            width: isFullscreen ? '100%' : panelSize.width ? `${panelSize.width}px` : '100%',
            height: isFullscreen ? '100%' : panelSize.height ? `${panelSize.height}px` : '420px',
          }}
        >
          <div
            ref={surfaceRef}
            tabIndex={0}
            className={clsx(
              'relative flex h-full w-full items-center justify-center rounded-xl bg-[#05070f] ring-1 ring-white/10 shadow-[0_25px_70px_rgba(0,0,0,0.6)] outline-none',
              fitMode === 'contain' ? 'overflow-hidden' : 'overflow-auto',
              isControlling && 'cursor-none ring-aurora/50',
            )}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onMouseEnter={(event) => {
              if (isControlling && surfaceReady) {
                surfaceRef.current?.focus();
                sendPointerPosition(event.clientX, event.clientY);
              }
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onContextMenu={(event) => {
              if (isControlling) event.preventDefault();
            }}
          >
            <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2 text-xs font-medium text-white/80">
              <span className="rounded-full bg-black/40 px-3 py-1 backdrop-blur">
                {session.status === 'connected'
                  ? 'Live view'
                  : session.status === 'connecting'
                    ? 'Connecting...'
                    : 'Idle'}
              </span>
              <span className="rounded-full bg-black/40 px-3 py-1 backdrop-blur">
                {Math.round(session.fps || 0)} fps
              </span>
              <span className="rounded-full bg-black/40 px-3 py-1 backdrop-blur">
                {resolutionLabel}
              </span>
              {session.viewers > 0 && (
                <span className="rounded-full bg-black/40 px-3 py-1 backdrop-blur">
                  {session.viewers} viewer{session.viewers === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {session.mediaStream ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                onLoadedMetadata={(event) =>
                  setVideoSize({
                    width: event.currentTarget.videoWidth,
                    height: event.currentTarget.videoHeight,
                  })
                }
                className={clsx(
                  'select-none rounded-lg border border-white/5 shadow-2xl',
                  fitMode === 'contain' ? 'h-full w-full object-contain' : 'max-w-none',
                )}
                style={
                  fitMode === 'actual' && effectiveMetadata?.width && effectiveMetadata.height
                    ? { width: `${effectiveMetadata.width}px`, height: `${effectiveMetadata.height}px` }
                    : undefined
                }
              />
            ) : (
              <canvas
                ref={session.canvasRef}
                className={clsx(
                  'select-none rounded-lg border border-white/5 shadow-2xl',
                  fitMode === 'contain' ? 'h-full w-full object-contain' : 'max-w-none',
                  !hasFrame && 'opacity-0',
                )}
                style={
                  fitMode === 'actual' && effectiveMetadata?.width && effectiveMetadata.height
                    ? { width: `${effectiveMetadata.width}px`, height: `${effectiveMetadata.height}px` }
                    : undefined
                }
              />
            )}

            {!hasFrame && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-white/55">
                <MonitorDown className="h-12 w-12 text-white/20" />
                <p>No feed yet - waiting for the host to share.</p>
              </div>
            )}

            {isControlling && surfaceReady && (
              <div className="pointer-events-none absolute inset-0 z-20">
                <div className="absolute inset-x-4 top-3 mx-auto max-w-md rounded-full border border-aurora/30 bg-[#07141a]/90 px-4 py-2 text-center text-sm text-aurora shadow-glow">
                  Control active - press ` to release
                </div>
                {cursor && cursorStyle && (
                  <div
                    className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-aurora bg-aurora/40 shadow-glow"
                    style={{ left: `${cursorStyle.left}px`, top: `${cursorStyle.top}px` }}
                  />
                )}
              </div>
            )}

            {remoteCursorMarkers.length > 0 && (
              <div className="pointer-events-none absolute inset-0 z-10">
                {remoteCursorMarkers.map((remoteCursor) => (
                  <div
                    key={remoteCursor.viewerId}
                    className={clsx(
                      'absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-lg',
                      remoteCursor.color,
                    )}
                    style={{
                      left: `${remoteCursor.x * 100}%`,
                      top: `${remoteCursor.y * 100}%`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {!isFullscreen && <button
            type="button"
            aria-label="Resize remote surface"
            className="absolute bottom-2 right-2 z-30 flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-black/40 text-white/70 backdrop-blur transition hover:border-white/40 hover:text-white"
            disabled={isControlling}
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
          >
            <Maximize2 className="h-4 w-4" />
          </button>}
        </div>
      </div>

      <footer className="flex flex-col gap-3 border-t border-white/5 px-6 py-3 text-sm text-white/60 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1">
            <MousePointer2 className="h-4 w-4" />
            <span>{isControlling ? 'Control live' : 'View only'}</span>
          </div>
          <div className="flex items-center gap-1">
            <Keyboard className="h-4 w-4" />
            <span>Press ` to toggle control</span>
          </div>
        </div>
        <div className="flex items-center gap-1 text-white">
          <Focus className="h-4 w-4" />
          <span>{session.fps || 0} fps</span>
        </div>
      </footer>
    </section>
  );
};
