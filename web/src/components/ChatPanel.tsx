import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import type { RemoteSessionApi } from '../types/remote';

interface Props {
  session: RemoteSessionApi;
}

export const ChatPanel = ({ session }: Props) => {
  const [message, setMessage] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session.chat]);

  const handleSend = (event: React.FormEvent) => {
    event.preventDefault();
    if (!message.trim()) return;
    session.sendChat(message.trim());
    setMessage('');
  };

  return (
    <section className="glass-panel flex h-full flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">
            Secure chat
          </p>
          <p className="text-lg font-semibold text-white">Session feed</p>
        </div>
        <span className="rounded-full border border-white/10 px-2 py-1 text-xs text-white/60">
          {session.chat.length} messages
        </span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-white/5 bg-white/3 p-4">
        {session.chat.map((entry) => (
          <article
            key={entry.id}
            className="rounded-2xl border border-white/5 bg-white/5 px-3 py-2"
          >
            <div className="flex items-center justify-between text-xs text-white/50">
              <span className="font-medium text-white/80">{entry.nickname}</span>
              <time>
                {new Date(entry.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
            <p className="text-sm text-white">{entry.message}</p>
          </article>
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={handleSend} className="flex gap-2">
        <input
          className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none ring-aurora/50 focus:ring"
          placeholder="Send instructions..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={session.status !== 'connected'}
        />
        <button
          type="submit"
          className="flex items-center justify-center rounded-2xl bg-aurora px-4 py-3 text-[#041016] shadow-glow transition hover:bg-aurora/90"
          disabled={session.status !== 'connected'}
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </section>
  );
};

