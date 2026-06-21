import { useEffect, useState } from 'react';
import { Download, LoaderCircle, RotateCcw, TriangleAlert } from 'lucide-react';
import type { UpdateStatus } from '../types/desktop';

export const Header = () => {
  const updates = window.solsticeDesktop?.updates;
  const appVersion = window.solsticeDesktop?.appVersion ?? 'dev';
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!updates) return undefined;
    void updates.getStatus().then((status) => {
      if (status) {
        setUpdate(status);
        if (status.percent) setProgress(Math.round(status.percent));
      }
    });
    const removeStatus = updates.onUpdateStatus(setUpdate);
    const removeProgress = updates.onUpdateProgress((next) => {
      setProgress(Math.round(next.percent));
      setUpdate((current) => current ?? { status: 'downloading' });
    });
    return () => {
      removeStatus();
      removeProgress();
    };
  }, [updates]);

  const updateControl = (() => {
    if (!update || update.status === 'not-available') return null;
    if (update.status === 'error') {
      return (
        <span
          title={update.error}
          className="inline-flex items-center gap-2 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200"
        >
          <TriangleAlert className="h-3.5 w-3.5" />
          Update failed
        </span>
      );
    }
    if (update.status === 'downloaded') {
      return (
        <button
          type="button"
          onClick={() => void updates?.installUpdate()}
          className="inline-flex items-center gap-2 rounded-lg bg-aurora px-3 py-2 text-xs font-semibold text-[#07111f] transition hover:bg-white"
        >
          <RotateCcw className="h-4 w-4" />
          Restart for {update.version ?? 'update'}
        </button>
      );
    }
    if (update.status === 'available' || update.status === 'downloading') {
      return (
        <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/70">
          <Download className="h-4 w-4 text-aurora" />
          Updating{progress ? ` ${progress}%` : ''}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/70">
        <LoaderCircle className="h-4 w-4 animate-spin text-aurora" />
        Checking updates
      </span>
    );
  })();

  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 text-white sm:px-6 sm:py-7">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white shadow-[0_12px_35px_rgba(0,0,0,0.28)]">
          <img
            src="/assets/solstice-logo.png"
            alt="Solstice Desk"
            className="h-full w-full object-cover"
          />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight text-white sm:text-lg">Solstice Desk</h1>
          <p className="text-xs text-white/45">Remote desktop · v{appVersion}</p>
        </div>
      </div>
      {updateControl}
    </header>
  );
};
