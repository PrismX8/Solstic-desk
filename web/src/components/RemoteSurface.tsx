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
  const resizableRef = useRef<HTMLDivElement>(null);
  const lastMouseMoveTime = useRef<number>(0);
  const [fitMode, setFitMode] = useState<'contain' | 'actual'>('contain');
  const [isControlling, setIsControlling] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeCorner, setResizeCorner] = useState<'nw' | 'ne' | 'sw' | 'se' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Make default size huge - use viewport dimensions or large defaults
  const [containerSize, setContainerSize] = useState({ 
    width: typeof window !== 'undefined' ? Math.max(1920, window.innerWidth * 0.9) : 1920, 
    height: typeof window !== 'undefined' ? Math.max(1080, window.innerHeight * 0.8) : 1080 
  });
  const [containerPosition, setContainerPosition] = useState({ x: 0, y: 0 });
  
  // Get canvasRef from session (provided by useRemoteSession hook)
  // The hook handles all frame rendering via worker, we just need to attach the canvas
  const canvasRef = 'canvasRef' in session ? (session as any).canvasRef : null;

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

  // Initialize container size - use huge defaults
  useEffect(() => {
    if (containerSize.width === 0 || containerSize.height === 0) {
      const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
      const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;
      setContainerSize({ 
        width: Math.max(1920, viewportWidth * 0.9), 
        height: Math.max(1080, viewportHeight * 0.8) 
      });
    }
  }, []);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          // Only update if we're not manually resizing
          if (!isResizing) {
            setContainerSize({ width: rect.width, height: rect.height });
          }
        }
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isResizing]);

  // Handle mouse resize from corners
  useEffect(() => {
    if (!isResizing || !resizeCorner || !resizableRef.current) return;

    const rect = resizableRef.current.getBoundingClientRect();
    // Get the corner position based on which corner we're dragging
    const cornerX = resizeCorner === 'se' || resizeCorner === 'ne' ? rect.right : rect.left;
    const cornerY = resizeCorner === 'se' || resizeCorner === 'sw' ? rect.bottom : rect.top;
    const startMouseX = cornerX;
    const startMouseY = cornerY;
    const startWidth = containerSize.width || rect.width;
    const startHeight = containerSize.height || rect.height;
    const startPosX = containerPosition.x;
    const startPosY = containerPosition.y;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startMouseX;
      const deltaY = e.clientY - startMouseY;
      
      let newWidth = startWidth;
      let newHeight = startHeight;
      let newX = startPosX;
      let newY = startPosY;

      switch (resizeCorner) {
        case 'se': // Bottom-right
          newWidth = Math.max(400, startWidth + deltaX);
          newHeight = Math.max(300, startHeight + deltaY);
          break;
        case 'sw': // Bottom-left
          newWidth = Math.max(400, startWidth - deltaX);
          newHeight = Math.max(300, startHeight + deltaY);
          newX = startPosX - (newWidth - startWidth);
          break;
        case 'ne': // Top-right
          newWidth = Math.max(400, startWidth + deltaX);
          newHeight = Math.max(300, startHeight - deltaY);
          newY = startPosY - (newHeight - startHeight);
          break;
        case 'nw': // Top-left
          newWidth = Math.max(400, startWidth - deltaX);
          newHeight = Math.max(300, startHeight - deltaY);
          newX = startPosX - (newWidth - startWidth);
          newY = startPosY - (newHeight - startHeight);
          break;
      }

      setContainerSize({ width: newWidth, height: newHeight });
      setContainerPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setResizeCorner(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeCorner, containerPosition, containerSize]);

  // Handle dragging the container
  useEffect(() => {
    if (!isDragging || !resizableRef.current) return;

    const rect = resizableRef.current.getBoundingClientRect();
    const startMouseX = rect.left + containerPosition.x;
    const startMouseY = rect.top + containerPosition.y;
    const startPosX = containerPosition.x;
    const startPosY = containerPosition.y;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startMouseX;
      const deltaY = e.clientY - startMouseY;
      
      setContainerPosition({
        x: startPosX + deltaX,
        y: startPosY + deltaY,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, containerPosition]);

  const calculateNormalizedCoords = (clientX: number, clientY: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    const canvas = canvasRef?.current;
    if (!rect || !canvas || canvas.width === 0 || canvas.height === 0) return null;
    
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const imgAspect = canvasWidth / canvasHeight;
    const containerAspect = rect.width / rect.height;
    let x, y;
    
    if (fitMode === 'contain') {
      // For contain mode
      if (imgAspect > containerAspect) {
        const scale = rect.width / canvasWidth;
        const scaledHeight = canvasHeight * scale;
        const offsetY = (rect.height - scaledHeight) / 2;
        const localX = clientX - rect.left;
        const localY = clientY - rect.top - offsetY;
        x = clamp(localX / rect.width);
        y = clamp(localY / scaledHeight);
      } else {
        const scale = rect.height / canvasHeight;
        const scaledWidth = canvasWidth * scale;
        const offsetX = (rect.width - scaledWidth) / 2;
        const localX = clientX - rect.left - offsetX;
        const localY = clientY - rect.top;
        x = clamp(localX / scaledWidth);
        y = clamp(localY / rect.height);
      }
    } else {
      // Actual size mode
      x = clamp((clientX - rect.left) / canvasWidth);
      y = clamp((clientY - rect.top) / canvasHeight);
    }
    
    return { x, y };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    // Don't interfere with resize or dragging
    if (isResizing || isDragging) return;
    
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
    // Don't interfere with resize handles or dragging
    if (isResizing || isDragging) return;
    
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
    const canvas = canvasRef?.current;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    canvas.toBlob((blob: Blob | null) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `solstice-${new Date().toISOString()}.jpg`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
    }, 'image/jpeg', 0.95);
  };

  return (
    <section className="glass-panel relative overflow-visible">
      <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
        <div 
          className={clsx(
            "flex-1",
            !isControlling && "cursor-move select-none"
          )}
          onMouseDown={(e) => {
            // Only allow dragging when not controlling and not resizing
            if (isControlling || isResizing) return;
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(true);
          }}
        >
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
            disabled={!canvasRef?.current || session.status !== 'connected'}
          />
          <ToolbarButton
            icon={<Square />}
            label="Capture"
            onClick={handleScreenshot}
            disabled={!canvasRef?.current || session.status !== 'connected'}
          />
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative"
        style={{
          minHeight: '420px',
          width: '100%',
          overflow: 'visible',
        }}
      >
        <div
          ref={resizableRef}
          className="relative"
          style={{
            width: containerSize.width > 0 ? `${containerSize.width}px` : '100%',
            height: containerSize.height > 0 ? `${containerSize.height}px` : 'auto',
            minHeight: '420px',
            minWidth: '400px',
            position: 'relative',
            transform: `translate(${containerPosition.x}px, ${containerPosition.y}px)`,
            zIndex: 1,
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
        {canvasRef && canvasRef.current && canvasRef.current.width > 0 ? (
          <canvas
            ref={canvasRef}
            className={clsx(
              'select-none border border-white/5 shadow-2xl rounded-2xl',
              fitMode === 'contain'
                ? 'max-h-full max-w-full'
                : '',
            )}
            style={
              fitMode === 'actual'
                ? {
                    width: `${canvasRef.current.width}px`,
                    height: `${canvasRef.current.height}px`,
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
        {(() => {
          const metadata = (session as any).frameMetadata;
          const cursors = metadata?.cursors || [];
          const canvas = canvasRef?.current;
          if (!cursors.length || !canvas || !metadata) return null;
          
          return (
            <div className="pointer-events-none absolute inset-0">
              {cursors.map((remoteCursor: any, idx: number) => {
                const rect = surfaceRef.current?.getBoundingClientRect();
                if (!rect || !metadata.width || !metadata.height) return null;
                
                // Calculate scale and offset for the displayed image
                const imgAspect = metadata.width / metadata.height;
                const containerAspect = rect.width / rect.height;
                let scaleX = 1;
                let scaleY = 1;
                let offsetX = 0;
                let offsetY = 0;

                if (fitMode === 'contain') {
                  if (imgAspect > containerAspect) {
                    // Image is wider - fit to width
                    scaleX = scaleY = rect.width / metadata.width;
                    offsetY = (rect.height - metadata.height * scaleY) / 2;
                  } else {
                    // Image is taller - fit to height
                    scaleX = scaleY = rect.height / metadata.height;
                    offsetX = (rect.width - metadata.width * scaleX) / 2;
                  }
                } else {
                  // Actual size
                  scaleX = rect.width / metadata.width;
                  scaleY = rect.height / metadata.height;
                }

                const x = remoteCursor.x * metadata.width * scaleX + offsetX;
                const y = remoteCursor.y * metadata.height * scaleY + offsetY;

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
          );
        })()}
      </div>
        {/* Resize handles on all corners - only visible when not controlling */}
        {!isControlling && [
          { corner: 'nw', position: 'top-0 left-0', cursor: 'nwse-resize' },
          { corner: 'ne', position: 'top-0 right-0', cursor: 'nesw-resize' },
          { corner: 'sw', position: 'bottom-0 left-0', cursor: 'nesw-resize' },
          { corner: 'se', position: 'bottom-0 right-0', cursor: 'nwse-resize' },
        ].map(({ corner, position, cursor }) => (
          <div
            key={corner}
            className={`absolute ${position} z-10 h-6 w-6 bg-white/20 hover:bg-white/40 border border-white/30 rounded-sm transition-all`}
            style={{
              cursor,
              pointerEvents: isControlling ? 'none' : 'auto',
            }}
            onMouseDown={(e) => {
              if (isControlling) return;
              e.preventDefault();
              e.stopPropagation();
              setResizeCorner(corner as 'nw' | 'ne' | 'sw' | 'se');
              setIsResizing(true);
            }}
          />
        ))}
        </div>
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

