import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { loadState, saveState } from '../services/api';

const AppContext = createContext(null);

function createProblem({ id = crypto.randomUUID(), name = '未命名题目' } = {}) {
  return {
    id,
    name,
    imageDataUrl: null,
    ocrText: '',
    commands: '',
   refineHistory: [],
   refineInput: '',
   activeTab: 'image',
   ggbState: '',
    ocrProvider: 'baidu',
    llmProvider: 'kimi',
  };
}

export function AppProvider({ children }) {
  const [problems, setProblems] = useState([]);
  const [activeProblemId, setActiveProblemId] = useState(null);
  const [drawnProblemId, setDrawnProblemId] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [status, setStatus] = useState({ text: '准备就绪', color: '#333333' });
  const [log, setLog] = useState('');

  useEffect(() => {
    let mounted = true;
   loadState().then(data => {
     if (!mounted) return;
     setProblems(data.problems.map(p => ({ ...createProblem(), ...p })));
     if (data.activeProblemId) setActiveProblemId(data.activeProblemId);
   }).catch(e => console.error('load problems failed', e));
    return () => { mounted = false; };
  }, []);

 useEffect(() => {
   const timer = setTimeout(() => {
      const problemsToSave = problems.map(p => {
        const { refineHistory, refineInput, ...rest } = p;
        return rest;
      });
      saveState({ problems: problemsToSave, activeProblemId }).catch(e => {
       console.error('save problems failed', e);
        setLog('本地保存失败：' + (e.message || '未知错误'));
     });
   }, 800);
   return () => clearTimeout(timer);
 }, [problems, activeProblemId]);

  const activeProblem = useMemo(() =>
    problems.find(p => p.id === activeProblemId) || null,
  [problems, activeProblemId]);

  const addProblem = useCallback((initial = {}) => {
    const problem = createProblem(initial);
    setProblems(prev => [...prev, problem]);
    setActiveProblemId(problem.id);
    return problem.id;
  }, []);

  const updateProblem = useCallback((id, updates) => {
    setProblems(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const deleteProblem = useCallback((id) => {
    setProblems(prev => {
      const next = prev.filter(p => p.id !== id);
      if (activeProblemId === id) {
        setActiveProblemId(next.length ? next[0].id : null);
      }
      return next;
    });
  }, [activeProblemId]);

  const selectProblem = useCallback((id) => {
    setActiveProblemId(id);
  }, []);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  return (
    <AppContext.Provider value={{
      problems,
      activeProblemId,
      activeProblem,
      drawnProblemId,
      isModalOpen,
      status,
      log,
      addProblem,
      updateProblem,
      deleteProblem,
      selectProblem,
      openModal,
      closeModal,
      setStatus,
      setLog,
      setDrawnProblemId,
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
