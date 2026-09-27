import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useSession, loadState, signOut, getKnowledgeTags, createKnowledgeTag, putProblem, deleteProblemRemote, saveActiveProblemId, acquireProblemLock, releaseProblemLock, getLocks } from '../services/api';

const AppContext = createContext(null);

export const DIFFICULTY_LABELS = { 1: '很简单', 2: '简单', 3: '中等', 4: '偏难', 5: '难' };
export const EXAM_TYPES = ['中考', '模拟考', '期中', '期末', '练习', '竞赛', '其他'];

function createProblem({ id = crypto.randomUUID(), name = '未命名题目', ...rest } = {}) {
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
    examType: null,
    examYear: null,
    examRegion: null,
    difficulty: null,
    tags: [],
    ...rest,
  };
}

export function AppProvider({ children }) {
  const { data: session, isPending } = useSession();
  const user = session?.user || null;
  const authChecked = !isPending;

  const [problems, setProblems] = useState([]);
  const [activeProblemId, setActiveProblemId] = useState(null);
  const [drawnProblemId, setDrawnProblemId] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [status, setStatus] = useState({ text: '准备就绪', color: '#333333' });
  const [log, setLog] = useState('');
  const [tagVocab, setTagVocab] = useState([]);
  // ---------- 每题编辑锁：防止多标签页同时编辑保存造成冲突/丢失 ----------
  // 锁按"浏览器标签页实例"区分：10s 心跳续期，35s 无心跳可被他人接管
  const instanceIdRef = useRef(
    sessionStorage.getItem('ggbEditInstance') || (() => {
      const id = crypto.randomUUID();
      try { sessionStorage.setItem('ggbEditInstance', id); } catch { /* 隐私模式等场景忽略 */ }
      return id;
    })()
  );
  const [editProblemId, setEditProblemId] = useState(null);
  const editProblemIdRef = useRef(null);
  editProblemIdRef.current = editProblemId;
  // problemId -> { holder_email, heartbeat_at }（含自己的锁，展示时排除当前编辑题）
  const [locks, setLocks] = useState({});

  const releaseEditLock = useCallback(async () => {
    const cur = editProblemIdRef.current;
    if (!cur) return;
    setEditProblemId(null);
    try {
      await releaseProblemLock(cur, instanceIdRef.current);
    } catch (e) {
      console.error('release lock failed', e);
    }
  }, []);

  const startEdit = useCallback(async (id) => {
    if (editProblemIdRef.current && editProblemIdRef.current !== id) {
      await releaseEditLock();
    }
    try {
      await acquireProblemLock(id, instanceIdRef.current, false);
      setEditProblemId(id);
      return { ok: true };
    } catch (e) {
      if (e.lockedBy) return { ok: false, lockedBy: e.lockedBy, since: e.since };
      console.error('acquire lock failed', e);
      setLog('获取编辑锁失败：' + (e.message || '未知错误'));
      return { ok: false, error: e.message };
    }
  }, [releaseEditLock, setLog]);

  const forceEdit = useCallback(async (id) => {
    try {
      await acquireProblemLock(id, instanceIdRef.current, true);
      setEditProblemId(id);
      return { ok: true };
    } catch (e) {
      setLog('强制接管编辑失败：' + (e.message || '未知错误'));
      return { ok: false, error: e.message };
    }
  }, [setLog]);

  const stopEdit = useCallback(async () => {
    await releaseEditLock();
  }, [releaseEditLock]);

  // 心跳续期；若 409 说明被其他实例强制接管，本页自动退出编辑态
  useEffect(() => {
    if (!user || !editProblemId) return undefined;
    const timer = setInterval(async () => {
      try {
        await acquireProblemLock(editProblemId, instanceIdRef.current, false);
      } catch (e) {
        if (e.lockedBy) {
          setEditProblemId(null);
          setLog(`该题的编辑权已被 ${e.lockedBy} 接管，本页面已切换为只读。`);
          setStatus({ text: '编辑权已被接管', color: '#555555' });
        }
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [user, editProblemId, setLog, setStatus]);

  // 定期拉取锁列表，供题目列表展示"正在被谁编辑"
  useEffect(() => {
    if (!user) return undefined;
    const load = () => getLocks()
      .then((r) => {
        const map = {};
        for (const l of r.locks || []) map[l.problem_id] = l;
        setLocks(map);
      })
      .catch(() => {});
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [user]);
  // 纯画布移动（自动保存/切题 flush）只改 ggbState，不应刷新修改时间；
  // 这里记录本次保存期间哪些题目是"静默"保存，保存时保留其 updated_at

  const refreshTags = useCallback(async () => {
    if (!user) return;
    try {
      const data = await getKnowledgeTags();
      const names = new Set([
        ...(data.tags || []).map((t) => t.name),
        ...(data.mine || []),
      ]);
      setTagVocab([...names].sort((a, b) => a.localeCompare(b, 'zh-CN')));
    } catch (e) {
      console.error('load knowledge tags failed', e);
    }
  }, [user]);

  useEffect(() => {
    if (user) refreshTags();
  }, [user, refreshTags]);

  const addTag = useCallback(async (name) => {
    const n = String(name || '').trim();
    if (!n) return;
    if (!tagVocab.includes(n)) {
      try {
        await createKnowledgeTag(n);
      } catch (e) {
        console.error('create knowledge tag failed', e);
      }
      setTagVocab((prev) => [...prev, n].sort((a, b) => a.localeCompare(b, 'zh-CN')));
    }
  }, [tagVocab]);

  const loadUserState = useCallback(async () => {
    if (!user) return;
    try {
      const data = await loadState();
      setProblems(data.problems.map(p => ({ ...createProblem(), ...p })));
      setActiveProblemId(data.activeProblemId || null);
    } catch (e) {
      console.error('load problems failed', e);
      setLog('加载题目失败：' + (e.message || '未知错误'));
    }
  }, [user]);

  // Load problems when user becomes available.
  useEffect(() => {
    if (user) loadUserState();
  }, [user, loadUserState]);

  // ---------- 每题增量同步（替代全量替换保存） ----------
  // 任何题目变更只把该题 PUT 到服务端；删除立即 DELETE。
  // 多标签页并存时，旧页面的自动保存不会再抹掉新页面创建的题目。
  const problemsRef = useRef([]);
  problemsRef.current = problems;
  // 待落库的题目 id 集合；flushTick 驱动防抖落库
  const dirtyIdsRef = useRef(new Set());
  const retriesRef = useRef(new Map());
  const [flushTick, setFlushTick] = useState(0);

  const markDirty = useCallback((id) => {
    dirtyIdsRef.current.add(id);
    setFlushTick((t) => t + 1);
  }, []);

  const flushOne = useCallback(async (id) => {
    const p = problemsRef.current.find((x) => x.id === id);
    if (!p) return; // 已被删除（删除走 DELETE，不在此处理）
    try {
      await putProblem(id, p);
      retriesRef.current.delete(id);
    } catch (e) {
      console.error('save problem failed', id, e);
      const n = (retriesRef.current.get(id) || 0) + 1;
      if (n < 5) {
        retriesRef.current.set(id, n);
        dirtyIdsRef.current.add(id);
        setFlushTick((t) => t + 1);
      } else {
        retriesRef.current.delete(id);
        setLog(`保存失败（已重试 5 次）：${p.name || id}`);
      }
    }
  }, [setLog]);

  // 防抖落库：800ms 内多次变更合并为一次 PUT
  useEffect(() => {
    if (!user || flushTick === 0) return undefined;
    const timer = setTimeout(() => {
      const ids = [...dirtyIdsRef.current];
      dirtyIdsRef.current.clear();
      setFlushTick(0);
      ids.forEach((id) => flushOne(id));
    }, 800);
    return () => clearTimeout(timer);
  }, [flushTick, user, flushOne]);

  // 页面关闭时把未落库的改动尽力带走（keepalive fetch）
  useEffect(() => {
    if (!user) return undefined;
    const onUnload = () => {
      // 同步释放当前编辑锁（服务端另有 35s 失联兜底）
      const lockedId = editProblemIdRef.current;
      if (lockedId) {
        try {
          fetch(`/api/problems/${lockedId}/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            keepalive: true,
            body: JSON.stringify({ instanceId: instanceIdRef.current }),
          }).catch(() => {});
        } catch { /* 关闭流程中失败无法补救，忽略 */ }
      }
      for (const id of dirtyIdsRef.current) {
        const p = problemsRef.current.find((x) => x.id === id);
        if (!p) continue;
        try {
          fetch(`/api/problems/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            keepalive: true,
            body: JSON.stringify(p),
          }).catch(() => {});
        } catch {
          // 关闭流程中失败无法补救，忽略
        }
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [user]);

  const activeProblem = useMemo(() =>
    problems.find(p => p.id === activeProblemId) || null,
  [problems, activeProblemId]);

  const onAuth = useCallback(async () => {
    await loadUserState();
  }, [loadUserState]);

  const logout = useCallback(async () => {
    try {
      await signOut();
    } catch (e) {
      console.error(e);
    }
    dirtyIdsRef.current.clear();
    retriesRef.current.clear();
    setEditProblemId(null);
    setProblems([]);
    setActiveProblemId(null);
    setDrawnProblemId(null);
  }, []);

  const addProblem = useCallback((initial = {}) => {
    const now = Date.now();
    const problem = createProblem({ ...initial, created_at: now, updated_at: now });
    setProblems(prev => [...prev, problem]);
    setActiveProblemId(problem.id);
    markDirty(problem.id);
    // 新建题目自动进入编辑态
    startEdit(problem.id);
    return problem.id;
  }, [markDirty, startEdit]);

  // opts.silent：纯画布移动（自动保存/切题 flush）只改 ggbState，
  // 保留原修改时间；实质编辑默认刷新 updated_at
  const updateProblem = useCallback((id, updates, opts = {}) => {
    const merged = opts.silent || 'updated_at' in updates
      ? updates
      : { ...updates, updated_at: Date.now() };
    setProblems(prev => prev.map(p => p.id === id ? { ...p, ...merged } : p));
    markDirty(id);
  }, [markDirty]);

  const deleteProblem = useCallback((id) => {
    dirtyIdsRef.current.delete(id);
    retriesRef.current.delete(id);
    if (editProblemIdRef.current === id) {
      setEditProblemId(null);
      releaseProblemLock(id, instanceIdRef.current).catch(() => {});
    }
    setProblems(prev => {
      const next = prev.filter(p => p.id !== id);
      if (activeProblemId === id) {
        setActiveProblemId(next.length ? next[0].id : null);
      }
      return next;
    });
    deleteProblemRemote(id).catch((e) => console.error('delete problem failed', id, e));
  }, [activeProblemId]);

  const selectProblem = useCallback((id) => {
    // 切换到其他题目时释放当前编辑锁（防呆：未点"退出"直接切走）
    if (editProblemIdRef.current && editProblemIdRef.current !== id) {
      setEditProblemId(null);
      releaseProblemLock(editProblemIdRef.current, instanceIdRef.current).catch(() => {});
    }
    setActiveProblemId(id);
    saveActiveProblemId(id).catch(() => {});
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
      tagVocab,
      refreshTags,
      addTag,
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
      editProblemId,
      locks,
      startEdit,
      forceEdit,
      stopEdit,
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
