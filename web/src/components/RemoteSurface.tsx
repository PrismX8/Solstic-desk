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
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const lastMouseMoveTime = useRef<number>(0);
  const [fitMode, setFitMode] = useState<'contain' | 'actual'>('contain');
  const [isControlling, setIsControlling] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Optimize frame rendering - use requestAnimationFrame for smooth updates
  useEffect(() => {
    if (!session.frame || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { 
      alpha: false,
      desynchronized: true, // Better performance
      willReadFrequently: false 
    });
    if (!ctx) return;
    
    let rafId: number;
    
    // Use image caching to avoid reloading
    if (!imageRef.current || imageRef.current.src !== session.frame.src) {
      const img = new Image();
      img.onload = () => {
        rafId = requestAnimationFrame(() => {
          if (canvas && ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
          }
        });
      };
      img.src = session.frame.src;
      imageRef.current = img;
    } else {
      // Image already loaded, just redraw with RAF
      rafId = requestAnimationFrame(() => {
        if (canvas && ctx && imageRef.current?.complete) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(imageRef.current, 0, 0);
        }
      });
    }
    
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [session.frame]);

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

  // Initialize container size
  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    }
  }, []);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle mouse resize
  useEffect(() => {
    if (!isResizing || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const startX = rect.left;
    const startY = rect.top;
    const startWidth = rect.width;
    const startHeight = rect.height;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(400, startWidth + (e.clientX - startX - startWidth));
      const newHeight = Math.max(300, startHeight + (e.clientY - startY - startHeight));
      setContainerSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const calculateNormalizedCoords = (clientX: number, clientY: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || !session.frame) return null;
    
    const imgAspect = session.frame.width / session.frame.height;
    const containerAspect = rect.width / rect.height;
    let x, y;
    
    if (fitMode === 'contain') {
      // For contain mode
      if (imgAspect > containerAspect) {
        const scale = rect.width / session.frame.width;
        const scaledHeight = session.frame.height * scale;
        const offsetY = (rect.height - scaledHeight) / 2;
        const localX = clientX - rect.left;
        const localY = clientY - rect.top - offsetY;
        x = clamp(localX / rect.width);
        y = clamp(localY / scaledHeight);
      } else {
        const scale = rect.height / session.frame.height;
        const scaledWidth = session.frame.width * scale;
        const offsetX = (rect.width - scaledWidth) / 2;
        const localX = clientX - rect.left - offsetX;
        const localY = clientY - rect.top;
        x = clamp(localX / scaledWidth);
        y = clamp(localY / rect.height);
      }
    } else {
      // Actual size mode
      x = clamp((clientX - rect.left) / session.frame.width);
      y = clamp((clientY - rect.top) / session.frame.height);
    }
    
    return { x, y };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isControlling || session.status !== 'connected') return;
    
    // Throttle mouse move events to max 60fps (16ms)
    const now = Date.now();
    if (now - lastMouseMoveTime.current < 16) return;
    lastMouseMoveTime.current = now;
    
    const coords = calculateNormalizedCoords(event.clientX, event.clientY);
    if (!coords) return;
    
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (rect) {
      setCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    }
    
    session.sendInput({ kind: 'mouse_move', x: coords.x, y: coords.y });
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isControlling || session.status !== 'connected') return;
    event.preventDefault();
    event.stopPropagation();
    
    // Send mouse position with click
    const coords = calculateNormalizedCoords(event.clientX, event.clientY);
    if (coords) {
      session.sendInput({ kind: 'mouse_move', x: coords.x, y: coords.y });
    }
    
    const button =
      event.button === 1
        ? 'middle'
        : event.button === 2
          ? 'right'
          : 'left';
    session.sendInput({ kind: 'mouse_down', button });
  };

  const handleMouseUp = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isControlling || session.status !== 'connected') return;
    event.preventDefault();
    event.stopPropagation();
    
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
            label={fitMode === 'contain' ? 'Actual Size' : 'Fit'}
            hotkey="F"
            onClick={() =>
              setFitMode((mode) => (mode === 'contain' ? 'actual' : 'contain'))
            }
            active={fitMode === 'actual'}
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
        ref={containerRef}
        className="relative"
        style={{
          width: containerSize.width > 0 ? `${containerSize.width}px` : '100%',
          height: containerSize.height > 0 ? `${containerSize.height}px` : 'auto',
          minHeight: '420px',
          minWidth: '400px',
        }}
      >
        <div
          ref={surfaceRef}
          tabIndex={0}
          className={clsx(
            'relative flex h-full w-full items-center justify-center bg-[#040714]',
            fitMode === 'contain' ? 'overflow-hidden' : 'overflow-auto',
            isControlling && 'cursor-none',
          )}
        onPointerMove={handlePointerMove}
        onMouseEnter={(e) => {
          if (isControlling && surfaceRef.current) {
            surfaceRef.current.focus();
            // Send initial mouse position immediately on hover
            if (session.status === 'connected') {
              const coords = calculateNormalizedCoords(e.clientX, e.clientY);
              if (coords) {
                session.sendInput({ kind: 'mouse_move', x: coords.x, y: coords.y });
              }
            }
          }
        }}
        onMouseLeave={() => {
          // Release any pointer capture
          if (surfaceRef.current && surfaceRef.current.releasePointerCapture) {
            try {
              surfaceRef.current.releasePointerCapture(1);
            } catch {}
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
          <canvas
            ref={canvasRef}
            width={session.frame.width}
            height={session.frame.height}
            className={clsx(
              'select-none border border-white/5 shadow-2xl rounded-2xl',
              fitMode === 'contain'
                ? 'max-h-full max-w-full'
                : '',
            )}
            style={
              fitMode === 'actual'
                ? {
                    width: `${session.frame.width}px`,
                    height: `${session.frame.height}px`,
                  }
                : {
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                  }
            }
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
        {/* Resize handle */}
        <div
          className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize bg-white/10 hover:bg-white/20"
          style={{
            clipPath: 'polygon(100% 0, 0 100%, 100% 100%)',
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsResizing(true);
          }}
        />
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

