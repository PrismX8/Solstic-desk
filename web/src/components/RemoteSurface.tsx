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
  const [fitMode, setFitMode] = useState<'contain' | 'actual'>('contain');
  const [isControlling, setIsControlling] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (session.status !== 'connected') {
      setIsControlling(false);
    }
  }, [session.status]);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isControlling || session.status !== 'connected') return;
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clamp((event.clientX - rect.left) / rect.width);
    const y = clamp((event.clientY - rect.top) / rect.height);
    setCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    session.sendInput({ kind: 'mouse_move', x, y });
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isControlling) return;
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
            label={fitMode === 'contain' ? 'Fill' : 'Fit'}
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
        ref={surfaceRef}
        tabIndex={0}
        className={clsx(
          'relative flex min-h-[420px] items-center justify-center bg-[#040714]',
          fitMode === 'contain' ? 'overflow-hidden' : 'overflow-auto',
        )}
        onPointerMove={handlePointerMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      >
        {session.frame ? (
          <img
            src={session.frame.src}
            alt="Remote desktop feed"
            className={clsx(
              'select-none rounded-2xl border border-white/5 shadow-2xl transition',
              fitMode === 'contain' ? 'max-h-[540px] max-w-full object-contain' : '',
            )}
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

