import { useEffect, useState } from 'react';
import ProblemList from './components/ProblemList';
import GeoGebraViewer from './components/GeoGebraViewer';
import SessionPanel from './components/SessionPanel';
import AuthModal from './components/AuthModal';
import HomeEntry from './components/HomeEntry';
import CommandConsole from './components/CommandConsole';
import ProblemEntry from './components/ProblemEntry';
import { useApp } from './store/AppContext';

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

function Workspace() {
  const { user, authChecked } = useApp();
  return (
    <div className="app-shell">
      <ProblemList />
      <main className="main-area">
        <GeoGebraViewer />
        <SessionPanel />
      </main>
      {authChecked && !user && <AuthModal />}
    </div>
  );
}

function App() {
  const hash = useHashRoute();
  if (hash === '#/entry') {
    return <ProblemEntry />;
  }
  if (hash === '#/console') {
    return <CommandConsole />;
  }
  if (hash === '#/app') {
    return <Workspace />;
  }
  return (
    <div className="app-shell">
      <HomeEntry />
    </div>
  );
}

export default App;
