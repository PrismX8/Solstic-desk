import { ConnectionPanel } from './components/ConnectionPanel';
import { RemoteSurface } from './components/RemoteSurface';
import { Header } from './components/Header';
import { HostPanel } from './components/HostPanel';
import { useRemoteSession } from './hooks/useRemoteSession';

const App = () => {
  const session = useRemoteSession();

  return (
    <div className="app-shell min-h-screen overflow-x-hidden">
      <Header />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-10 sm:px-6">
        <div className="grid gap-5 lg:grid-cols-2">
          <HostPanel />
          <ConnectionPanel session={session} />
        </div>
        {(session.status === 'connecting' || session.status === 'connected') && (
          <RemoteSurface session={session} />
        )}
      </main>
    </div>
  );
};

export default App;
