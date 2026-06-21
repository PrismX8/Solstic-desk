import { useState } from 'react';
import { Check, Copy, LoaderCircle, MonitorUp, Power, X } from 'lucide-react';
import { useHostSession } from '../hooks/useHostSession';
import type { CaptureSource } from '../types/desktop';

export const HostPanel = () => {
  const { available, state, start, stop } = useHostSession();
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!available) return null;

  const busy = state.status === 'connecting';
  const running = state.status === 'connected';

  const handleShare = async () => {
    if (running) {
      await stop();
      return;
    }

    if (window.solsticeDesktop?.host?.listCaptureSources) {
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

    await start();
  };

  const selectSource = async (source: CaptureSource) => {
    setSourcePickerOpen(false);
    await start(undefined, source.id);
  };

  const copyCode = async () => {
    if (!state.sessionCode) return;
    await navigator.clipboard.writeText(state.sessionCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <section className="glass-panel flex min-h-[300px] flex-col p-6 sm:p-7">
      <div className="flex items-start gap-3.5">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-aurora">
          <MonitorUp className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-white">Share this computer</h2>
          <p className="mt-1 text-sm leading-6 text-white/50">Create a one-time code for someone you trust.</p>
        </div>
      </div>

      {running ? (
        <div className="mt-7 rounded-2xl border border-emerald-300/15 bg-emerald-400/[0.06] p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-emerald-200/65">Your access code</p>
              <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.18em] text-white sm:text-4xl">
                {state.sessionCode}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void copyCode()}
              title="Copy access code"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-3 text-xs text-white/40">
            {state.viewers > 0 ? `${state.viewers} viewer${state.viewers === 1 ? '' : 's'} connected` : 'Waiting for the other computer…'}
          </p>
        </div>
      ) : (
        <div className="mt-8 rounded-2xl border border-dashed border-white/10 bg-black/15 px-5 py-6 text-center">
          <p className="text-sm font-medium text-white/70">Nothing is being shared</p>
          <p className="mt-1 text-xs leading-5 text-white/35">You choose the screen or window before sharing starts.</p>
        </div>
      )}

      {state.error && (
        <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {state.error}
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleShare()}
        className={`mt-auto inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-semibold transition ${
          running
            ? 'border border-rose-300/20 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20'
            : 'bg-white text-[#0a1019] hover:bg-aurora'
        }`}
        disabled={busy || sourcesLoading}
      >
        {sourcesLoading || busy ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : running ? (
          <Power className="h-4 w-4" />
        ) : (
          <MonitorUp className="h-4 w-4" />
        )}
        {sourcesLoading ? 'Loading screens' : busy ? 'Starting' : running ? 'Stop sharing' : 'Choose screen to share'}
      </button>

      {sourcePickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="max-h-[85vh] w-full max-w-4xl overflow-auto rounded-2xl border border-white/10 bg-[#10141c] p-5 shadow-2xl sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Choose what to share</h3>
                <p className="mt-1 text-sm text-white/45">Select one screen or application window.</p>
              </div>
              <button
                type="button"
                title="Close source picker"
                onClick={() => setSourcePickerOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-white/60 transition hover:bg-white/10 hover:text-white"
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
                  className="overflow-hidden rounded-xl border border-white/10 bg-black/20 text-left transition hover:border-aurora/60 hover:bg-white/[0.05]"
                >
                  <img src={source.thumbnail} alt="" className="aspect-video w-full bg-black object-contain" />
                  <span className="block truncate px-3.5 py-3 text-sm font-medium text-white/80">{source.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
