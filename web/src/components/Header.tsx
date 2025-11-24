import { Sparkles } from 'lucide-react';

export const Header = () => (
  <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-8 text-white">
    <div className="flex items-center gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-aurora/20 text-aurora shadow-glow">
        <Sparkles />
      </div>
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-white/60">
          Solstice Desk
        </p>
        <h1 className="text-2xl font-semibold text-white">Remote Control</h1>
      </div>
    </div>
    <div className="flex gap-3 text-sm text-white/70">
      <span className="rounded-full border border-white/15 px-3 py-1">
        Relay online
      </span>
      <a
        className="rounded-full border border-white/30 px-3 py-1 hover:border-aurora/60 hover:text-white"
        href="#docs"
      >
        Docs
      </a>
    </div>
  </header>
);

