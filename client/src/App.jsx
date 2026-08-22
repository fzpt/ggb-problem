import ProblemList from './components/ProblemList';
import GeoGebraViewer from './components/GeoGebraViewer';
import SessionPanel from './components/SessionPanel';
import NewProblemModal from './components/NewProblemModal';
import AuthModal from './components/AuthModal';
import { useApp } from './store/AppContext';

function App() {
  const { isModalOpen, user, authChecked } = useApp();
  return (
    <div className="app-shell">
      <ProblemList />
      <main className="main-area">
        <GeoGebraViewer />
        <SessionPanel />
      </main>
      {isModalOpen && <NewProblemModal />}
      {authChecked && !user && <AuthModal />}
    </div>
  );
}

export default App;
