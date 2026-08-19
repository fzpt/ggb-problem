import Header from './components/Header';
import UploadCard from './components/UploadCard';
import EditorCard from './components/EditorCard';
import GeoGebraViewer from './components/GeoGebraViewer';

function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 workspace">
        <div className="left-column">
          <UploadCard />
        </div>
        <div className="right-column">
          <EditorCard />
          <GeoGebraViewer />
        </div>
      </main>
    </div>
  );
}

export default App;
