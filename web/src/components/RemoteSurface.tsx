import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Expand, Focus, Keyboard, MousePointer2, MonitorDown, Square } from 'lucide-react';
import type { RemoteSessionApi } from '../types/remote';
import { ToolbarButton } from './ToolbarButton';

interface Props {
  session: RemoteSessionApi;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export const RemoteSurface = ({ session }: Props) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [fitMode, setFitMode] = useState<'contain' | 'fill' | 'actual'>('contain');
  const [isControlling, setIsControlling] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (session.status !== 'connected') {
      setIsControlling(false);
    }
  }, [session.status]);

  useEffect(() => {
    if (isControlling && surfaceRef.current) {
      surfaceRef.current.focus();
    }
  }, [isControlling]);

  useEffect(() => {
    if (fitMode === 'fill' && surfaceRef.current) {
      // Enter fullscreen when fill mode is enabled
      const enterFullscreen = async () => {
        try {
          if (surfaceRef.current && !document.fullscreenElement) {
            await surfaceRef.current.requestFullscreen();
          }
        } catch (error) {
          console.error('Failed to enter fullscreen:', error);
        }
      };
      enterFullscreen();
    } else {
      // Exit fullscreen when leaving fill mode
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }, [fitMode]);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isControlling || session.status !== 'connected') return;
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || !session.frame) return;
    
    // Calculate normalized coordinates based on fit mode
    let x, y;
    const imgAspect = session.frame.width / session.frame.height;
    const containerAspect = rect.width / rect.height;
    
    if (fitMode === 'fill') {
      // For fill mode, map to the image coordinates directly
      let scaleX, scaleY, offsetX = 0, offsetY = 0;
      
      if (imgAspect > containerAspect) {
        // Image is wider - fit to height, crop width
        scaleX = scaleY = rect.height / session.frame.height;
        offsetX = (rect.width - session.frame.width * scaleX) / 2;
      } else {
        // Image is taller - fit to width, crop height
        scaleX = scaleY = rect.width / session.frame.width;
        offsetY = (rect.height - session.frame.height * scaleY) / 2;
      }
      
      const localX = event.clientX - rect.left - offsetX;
      const localY = event.clientY - rect.top - offsetY;
      x = clamp(localX / (session.frame.width * scaleX));
      y = clamp(localY / (session.frame.height * scaleY));
    } else if (fitMode === 'contain') {
      // For contain mode, use the existing logic
      if (imgAspect > containerAspect) {
        const scale = rect.width / session.frame.width;
        const scaledHeight = session.frame.height * scale;
        const offsetY = (rect.height - scaledHeight) / 2;
        const localX = event.clientX - rect.left;
        const localY = event.clientY - rect.top - offsetY;
        x = clamp(localX / rect.width);
        y = clamp(localY / scaledHeight);
      } else {
        const scale = rect.height / session.frame.height;
        const scaledWidth = session.frame.width * scale;
        const offsetX = (rect.width - scaledWidth) / 2;
        const localX = event.clientX - rect.left - offsetX;
        const localY = event.clientY - rect.top;
        x = clamp(localX / scaledWidth);
        y = clamp(localY / rect.height);
      }
    } else {
      // Actual size mode
      x = clamp((event.clientX - rect.left) / session.frame.width);
      y = clamp((event.clientY - rect.top) / session.frame.height);
    }
    
    setCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    session.sendInput({ kind: 'mouse_move', x, y });
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isControlling) return;
    event.preventDefault();
    const button =
      event.button === 1
        ? 'middle'
        : event.button === 2
          ? 'right'
          : 'left';
    session.sendInput({ kind: 'mouse_down', button });
  };

  const handleMouseUp = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isControlling) return;
    event.preventDefault();
    const button =
      event.button === 1
        ? 'middle'
        : event.button === 2
          ? 'right'
          : 'left';
    session.sendInput({ kind: 'mouse_up', button });
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!isControlling) return;
    event.preventDefault();
    session.sendInput({
      kind: 'mouse_wheel',
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isControlling) {
      if (event.key === 'c' && event.metaKey) {
        setIsControlling(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      setIsControlling(false);
      return;
    }
    if (event.repeat) return;
    event.preventDefault();
    session.sendInput({
      kind: 'key_down',
      key: event.key,
      meta: {
        alt: event.altKey,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        meta: event.metaKey,
      },
    });
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isControlling) return;
    session.sendInput({ kind: 'key_up', key: event.key });
  };

  const handleScreenshot = () => {
    if (!session.frame) return;
    const anchor = document.createElement('a');
    anchor.href = session.frame.src;
    anchor.download = `solstice-${new Date().toISOString()}.jpg`;
    anchor.click();
  };

  return (
    <section className="glass-panel relative overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">
            Remote Surface
          </p>
          <p className="text-lg font-semibold text-white">
            {session.deviceName ?? 'Awaiting host'}
          </p>
        </div>
        <div className="flex gap-2">
          <ToolbarButton
            icon={<MousePointer2 />}
            label="Control"
            hotkey="C"
            active={isControlling}
            disabled={session.status !== 'connected'}
            onClick={() => setIsControlling((flag) => !flag)}
          />
          <ToolbarButton
            icon={<Expand />}
            label={
              fitMode === 'contain' ? 'Fill' : fitMode === 'fill' ? 'Fit' : 'Contain'
            }
            hotkey="F"
            onClick={() =>
              setFitMode((mode) => 
                mode === 'contain' ? 'fill' : mode === 'fill' ? 'actual' : 'contain'
              )
            }
            active={fitMode === 'fill' || fitMode === 'actual'}
            disabled={!session.frame}
          />
          <ToolbarButton
            icon={<Square />}
            label="Capture"
            onClick={handleScreenshot}
            disabled={!session.frame}
          />
        </div>
      </div>

      <div
        ref={surfaceRef}
        tabIndex={0}
        className={clsx(
          'relative flex min-h-[420px] items-center justify-center bg-[#040714]',
          fitMode === 'contain' || fitMode === 'fill' ? 'overflow-hidden' : 'overflow-auto',
          isControlling && 'cursor-none',
          fitMode === 'fill' && 'h-screen w-screen',
        )}
        onPointerMove={handlePointerMove}
        onMouseEnter={(e) => {
          if (isControlling && surfaceRef.current) {
            surfaceRef.current.focus();
            // Start controlling immediately on hover
            if (session.status === 'connected' && session.frame) {
              const rect = surfaceRef.current.getBoundingClientRect();
              const x = clamp((e.clientX - rect.left) / rect.width);
              const y = clamp((e.clientY - rect.top) / rect.height);
              session.sendInput({ kind: 'mouse_move', x, y });
            }
          }
        }}
        onPointerEnter={() => {
          if (isControlling && surfaceRef.current) {
            surfaceRef.current.focus();
          }
        }}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onContextMenu={(e) => {
          if (isControlling) e.preventDefault();
        }}
      >
        {session.frame ? (
          <img
            src={session.frame.src}
            alt="Remote desktop feed"
            className={clsx(
              'select-none border border-white/5 shadow-2xl transition',
              fitMode === 'fill'
                ? 'h-full w-full object-cover rounded-none border-0'
                : fitMode === 'contain'
                ? 'max-h-[540px] max-w-full object-contain rounded-2xl'
                : 'h-auto w-auto rounded-2xl',
            )}
            style={
              fitMode === 'actual'
                ? {
                    width: `${session.frame.width}px`,
                    height: `${session.frame.height}px`,
                  }
                : undefined
            }
            draggable={false}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-center text-white/50">
            <MonitorDown className="h-12 w-12 text-white/20" />
            <p>No feed yet – waiting for the host to share.</p>
          </div>
        )}

        {isControlling && session.status === 'connected' && (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-1/4 top-3 mx-auto max-w-md rounded-full border border-aurora/30 bg-aurora/10 px-4 py-2 text-center text-sm text-aurora">
              Input captured – press ESC to release
            </div>
            {cursor && (
              <div
                className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-aurora bg-aurora/40 shadow-glow"
                style={{ left: cursor.x, top: cursor.y }}
              />
            )}
          </div>
        )}

        {/* Render all viewer cursors */}
        {session.frame?.cursors && session.frame.cursors.length > 0 && (
          <div className="pointer-events-none absolute inset-0">
            {session.frame.cursors.map((remoteCursor, idx) => {
              const rect = surfaceRef.current?.getBoundingClientRect();
              if (!rect || !session.frame) return null;
              
              // Calculate scale and offset for the displayed image
              const imgAspect = session.frame.width / session.frame.height;
              const containerAspect = rect.width / rect.height;
              let scaleX = 1;
              let scaleY = 1;
              let offsetX = 0;
              let offsetY = 0;

              if (fitMode === 'contain') {
                if (imgAspect > containerAspect) {
                  // Image is wider - fit to width
                  scaleX = scaleY = rect.width / session.frame.width;
                  offsetY = (rect.height - session.frame.height * scaleY) / 2;
                } else {
                  // Image is taller - fit to height
                  scaleX = scaleY = rect.height / session.frame.height;
                  offsetX = (rect.width - session.frame.width * scaleX) / 2;
                }
              } else if (fitMode === 'fill') {
                if (imgAspect > containerAspect) {
                  // Image is wider - fit to height, crop width
                  scaleX = scaleY = rect.height / session.frame.height;
                  offsetX = (rect.width - session.frame.width * scaleX) / 2;
                } else {
                  // Image is taller - fit to width, crop height
                  scaleX = scaleY = rect.width / session.frame.width;
                  offsetY = (rect.height - session.frame.height * scaleY) / 2;
                }
              } else {
                // Actual size
                scaleX = rect.width / session.frame.width;
                scaleY = rect.height / session.frame.height;
              }

              const x = remoteCursor.x * session.frame.width * scaleX + offsetX;
              const y = remoteCursor.y * session.frame.height * scaleY + offsetY;

              // Generate a color based on viewerId
              const colors = [
                'bg-cyan-400',
                'bg-pink-400',
                'bg-green-400',
                'bg-yellow-400',
                'bg-purple-400',
                'bg-orange-400',
              ];
              const color = colors[idx % colors.length];

              return (
                <div
                  key={remoteCursor.viewerId}
                  className={clsx(
                    'absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-lg',
                    color,
                  )}
                  style={{ left: x, top: y }}
                />
              );
            })}
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-white/5 px-6 py-3 text-sm text-white/60">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <MousePointer2 className="h-4 w-4" />
            <span>{isControlling ? 'Control live' : 'View only'}</span>
          </div>
          <div className="flex items-center gap-1">
            <Keyboard className="h-4 w-4" />
            <span>Hold Shift + ? for shortcuts</span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-white">
          <div className="flex items-center gap-1">
            <Focus className="h-4 w-4" />
            <span>{session.fps || 0} fps</span>
          </div>
        </div>
      </footer>
    </section>
  );
};

