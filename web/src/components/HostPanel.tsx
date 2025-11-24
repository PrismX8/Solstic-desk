import { useEffect, useState } from 'react';
import { MonitorUp, Power, Shield } from 'lucide-react';
import { useHostSession } from '../hooks/useHostSession';

export const HostPanel = () => {
  const { available, state, start, stop } = useHostSession();
  const [deviceName, setDeviceName] = useState(state.deviceName ?? '');

  useEffect(() => {
    if (state.deviceName) {
      setDeviceName(state.deviceName);
    }
  }, [state.deviceName]);

  if (!available) {
    return null;
  }

  const busy = state.status === 'connecting';
  const running = state.status === 'connected';

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (running) {
      stop();
    } else {
      start(deviceName || undefined);
    }
  };

  return (
    <section className="glass-panel relative overflow-hidden p-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(95,100,245,0.25),transparent_55%)]" />
      <div className="relative z-10 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-white/50">
              Host Station
            </p>
            <h2 className="text-2xl font-semibold text-white">
              Share your screen
            </h2>
            <p className="text-sm text-white/70">
              Generates a one-time code for viewers to connect.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 p-3 text-white/70">
            <Shield className="h-6 w-6" />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="flex flex-col text-sm text-white/70">
            Host label
            <input
              className="mt-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none ring-aurora/40 focus:ring"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="Ops-Workstation"
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
            className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold transition ${
              running
                ? 'bg-rose-500/20 text-rose-200 hover:bg-rose-500/30'
                : 'bg-aurora text-[#041016] shadow-glow hover:bg-aurora/90'
            }`}
            disabled={busy}
          >
            {running ? (
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
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">
              Session code
            </p>
            <p className="text-3xl font-bold text-white">
              {state.sessionCode ?? '— — — — — —'}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">
              Viewers online
            </p>
            <p className="text-3xl font-bold text-white">{state.viewers}</p>
          </div>
        </div>
      </div>
    </section>
  );
};

