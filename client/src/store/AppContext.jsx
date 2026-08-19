import { createContext, useContext, useState, useCallback } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [imageDataUrl, setImageDataUrl] = useState(null);
  const [ocrText, setOcrText] = useState('');
  const [commands, setCommands] = useState('');
  const [refineHistory, setRefineHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('image');
  const [ocrProvider, setOcrProvider] = useState('baidu');
  const [llmProvider, setLlmProvider] = useState('kimi');
  const [status, setStatus] = useState({ text: '准备就绪', color: '#d8a93f' });
  const [log, setLog] = useState('');

  const reset = useCallback(() => {
    setImageDataUrl(null);
    setOcrText('');
    setCommands('');
    setRefineHistory([]);
    setActiveTab('image');
    setLog('');
    setStatus({ text: '准备就绪', color: '#d8a93f' });
  }, []);

  return (
    <AppContext.Provider value={{
      imageDataUrl, setImageDataUrl,
      ocrText, setOcrText,
      commands, setCommands,
      refineHistory, setRefineHistory,
      activeTab, setActiveTab,
      ocrProvider, setOcrProvider,
      llmProvider, setLlmProvider,
      status, setStatus,
      log, setLog,
      reset,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
