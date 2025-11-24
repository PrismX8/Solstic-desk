import { ConnectionPanel } from './components/ConnectionPanel';
import { RemoteSurface } from './components/RemoteSurface';
import { ChatPanel } from './components/ChatPanel';
import { ActivityPanel } from './components/ActivityPanel';
import { TransferPanel } from './components/TransferPanel';
import { Header } from './components/Header';
import { HostPanel } from './components/HostPanel';
import { useRemoteSession } from './hooks/useRemoteSession';

const App = () => {
  const session = useRemoteSession();
  const hostAvailable =
    typeof window !== 'undefined' && Boolean(window.solsticeDesktop?.host);

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pb-16">
        <div
          className={`grid gap-6 ${
            hostAvailable ? 'lg:grid-cols-2' : 'grid-cols-1'
          }`}
        >
          {hostAvailable && <HostPanel />}
          <ConnectionPanel session={session} />
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.6fr_0.7fr]">
          <RemoteSurface session={session} />
          <div className="space-y-6">
            <ChatPanel session={session} />
            <ActivityPanel session={session} />
            <TransferPanel session={session} />
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
