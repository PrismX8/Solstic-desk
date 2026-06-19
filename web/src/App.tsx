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

  return (
    <div className="min-h-screen overflow-x-hidden">
      <Header />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6">
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <HostPanel />
          <ConnectionPanel session={session} />
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.75fr)]">
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
