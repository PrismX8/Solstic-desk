import { useEffect, useState } from 'react';
import { Activity, Download, LoaderCircle, RadioTower, RotateCcw, Sparkles } from 'lucide-react';
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
          className="inline-flex items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-rose-200"
        >
          Update failed
        </span>
      );
    }
    if (update.status === 'downloaded') {
      return (
        <button
          type="button"
          onClick={() => void updates?.installUpdate()}
          className="inline-flex items-center gap-2 rounded-lg border border-aurora/30 bg-aurora/10 px-3 py-2 text-aurora hover:bg-aurora/20"
        >
          <RotateCcw className="h-4 w-4" />
          Restart for {update.version ?? 'update'}
        </button>
      );
    }
    if (update.status === 'available' || update.status === 'downloading') {
      return (
        <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
          <Download className="h-4 w-4 text-aurora" />
          Updating{progress ? ` ${progress}%` : ''}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
        <LoaderCircle className="h-4 w-4 animate-spin text-aurora" />
        Checking updates
      </span>
    );
  })();

  return (
    <header className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 text-white sm:px-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white text-[#071016] shadow-[0_16px_45px_rgba(0,0,0,0.25)]">
          <Sparkles className="h-6 w-6" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs uppercase tracking-[0.3em] text-aurora">Solstice Desk</p>
            <span className="rounded border border-white/15 bg-white/[0.07] px-2 py-0.5 text-xs font-semibold text-white/80">
              Version {appVersion}
            </span>
          </div>
          <h1 className="text-2xl font-semibold text-white sm:text-3xl">Remote support console</h1>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-sm text-white/75">
        {updateControl}
        <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-3 py-2">
          <RadioTower className="h-4 w-4 text-emerald-300" />
          P2P ready
        </span>
        <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
          <Activity className="h-4 w-4 text-aurora" />
          Host or connect
        </span>
      </div>
    </header>
  );
};
