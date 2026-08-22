import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import * as api from '../services/api';

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
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [problems, setProblems] = useState([]);
  const [activeProblemId, setActiveProblemId] = useState(null);
  const [drawnProblemId, setDrawnProblemId] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [status, setStatus] = useState({ text: '准备就绪', color: '#333333' });
  const [log, setLog] = useState('');

  const loadUserState = useCallback(async () => {
    try {
      const data = await api.loadState();
      setProblems(data.problems.map(p => ({ ...createProblem(), ...p })));
      setActiveProblemId(data.activeProblemId || null);
    } catch (e) {
      console.error('load problems failed', e);
      setLog('加载题目失败：' + (e.message || '未知错误'));
    }
  }, []);

  // On mount, check session and load the user's problems.
  useEffect(() => {
    let mounted = true;
    api.me()
      .then(u => {
        if (!mounted) return;
        setUser(u);
        setAuthChecked(true);
        return loadUserState();
      })
      .catch(e => {
        if (!mounted) return;
        console.log('not authenticated', e);
        setAuthChecked(true);
      });
    return () => { mounted = false; };
  }, [loadUserState]);

  // Auto-save state to the server (only when logged in).
  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(() => {
      const problemsToSave = problems.map(p => {
        const { refineHistory, refineInput, ...rest } = p;
        return rest;
      });
      api.saveState({ problems: problemsToSave, activeProblemId }).catch(e => {
        console.error('save problems failed', e);
        setLog('保存失败：' + (e.message || '未知错误'));
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [problems, activeProblemId, user]);

  const activeProblem = useMemo(() =>
    problems.find(p => p.id === activeProblemId) || null,
  [problems, activeProblemId]);

  const onAuth = useCallback((u) => {
    setUser(u);
    loadUserState();
  }, [loadUserState]);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch (e) { console.error(e); }
    setUser(null);
    setProblems([]);
    setActiveProblemId(null);
    setDrawnProblemId(null);
  }, []);

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
      user,
      authChecked,
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
      onAuth,
      logout,
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
