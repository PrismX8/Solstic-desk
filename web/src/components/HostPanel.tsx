import { useState } from 'react';
import { BadgeCheck, LoaderCircle, MonitorUp, Power, ScreenShare, Shield, X } from 'lucide-react';
import { useHostSession } from '../hooks/useHostSession';
import type { CaptureSource } from '../types/desktop';

export const HostPanel = () => {
  const { available, mode, state, start, stop } = useHostSession();
  const [deviceName, setDeviceName] = useState(state.deviceName ?? '');
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [sourcesLoading, setSourcesLoading] = useState(false);

  if (!available) {
    return null;
  }

  const busy = state.status === 'connecting';
  const running = state.status === 'connected';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (running) {
      await stop();
      return;
    }

    if (mode === 'desktop' && window.solsticeDesktop?.host?.listCaptureSources) {
      setSourcesLoading(true);
      try {
        const availableSources = await window.solsticeDesktop.host.listCaptureSources();
        setSources(availableSources);
        setSourcePickerOpen(true);
      } finally {
        setSourcesLoading(false);
      }
      return;
    }

    await start(deviceName || undefined);
  };

  const selectSource = async (source: CaptureSource) => {
    setSourcePickerOpen(false);
    await start(deviceName || undefined, source.id);
  };

  return (
    <section className="glass-panel relative overflow-hidden p-6">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-300 via-aurora to-indigo-300" />
      <div className="relative z-10 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-white/50">
              Host Station
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-white">
              Share your screen
            </h2>
            <p className="text-sm text-white/70">
              {mode === 'desktop'
                ? 'Direct internet sharing with native mouse and keyboard control.'
                : 'Direct internet screen sharing from a selected window or display.'}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-white/70">
            {mode === 'desktop' ? <Shield className="h-6 w-6" /> : <ScreenShare className="h-6 w-6" />}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-white/65">
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1">
            <BadgeCheck className="h-3.5 w-3.5 text-emerald-300" />
            {mode === 'desktop' ? 'Desktop P2P host' : 'Browser P2P host'}
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
            {mode === 'desktop' ? 'Remote control enabled' : 'View-only stream'}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="flex flex-col text-sm text-white/70">
            Host label
            <input
              className="mt-1 rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-white outline-none ring-aurora/40 transition placeholder:text-white/30 focus:border-aurora/40 focus:ring"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder={mode === 'desktop' ? 'Ops-Workstation' : 'Browser host'}
              maxLength={40}
            />
          </label>

          {state.error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">
              {state.error}
            </div>
          )}

          <button
            type="submit"
            className={`inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 font-semibold transition ${
              running
                ? 'border border-rose-300/30 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25'
                : 'bg-white text-[#071016] shadow-[0_16px_40px_rgba(94,240,255,0.2)] hover:bg-aurora'
            }`}
            disabled={busy || sourcesLoading}
          >
            {sourcesLoading ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Loading sources
              </>
            ) : running ? (
              <>
                <Power className="h-4 w-4" />
                Stop sharing
              </>
            ) : (
              <>
                <MonitorUp className="h-4 w-4" />
                Start sharing
              </>
            )}
          </button>
        </form>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">
              Session code
            </p>
            <p className="text-3xl font-bold text-white">
              {state.sessionCode ?? '— — — — — —'}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">
              Viewers online
            </p>
            <p className="text-3xl font-bold text-white">{state.viewers}</p>
          </div>
        </div>
        {running && (
          <div className="grid gap-2 text-sm text-white/70 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/40">Host FPS</p>
              <p className="font-semibold text-white">{state.fps ?? 0}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/40">Capture</p>
              <p className="font-semibold text-white">{state.captureMs ?? 0} ms</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/40">Dropped</p>
              <p className="font-semibold text-white">{state.droppedFrames ?? 0}</p>
            </div>
          </div>
        )}
      </div>

      {sourcePickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="max-h-[85vh] w-full max-w-4xl overflow-auto rounded-lg border border-white/15 bg-[#0a0d16] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-white/50">Share source</p>
                <h3 className="text-xl font-semibold text-white">Choose a screen or window</h3>
              </div>
              <button
                type="button"
                title="Close source picker"
                onClick={() => setSourcePickerOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 text-white/70 hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sources.map((source) => (
                <button
                  type="button"
                  key={source.id}
                  onClick={() => void selectSource(source)}
                  className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.03] text-left transition hover:border-aurora/60 hover:bg-white/[0.07]"
                >
                  <img
                    src={source.thumbnail}
                    alt=""
                    className="aspect-video w-full bg-black object-contain"
                  />
                  <span className="block truncate px-3 py-2 text-sm font-medium text-white">
                    {source.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

