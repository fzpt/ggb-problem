import { useApp, DIFFICULTY_LABELS, EXAM_TYPES } from '../store/AppContext';

import { useEffect, useState } from 'react';
import { getAdminCheck } from '../services/api';
import ConfirmDialog from './ConfirmDialog';

function formatTs(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ProblemList() {
  const {
    user,
    problems,
    activeProblem,
    activeProblemId,
    selectProblem,
    deleteProblem,
    addProblem,
    updateProblem,
    logout,
    tagVocab,
    editingIds,
    locks,
    startEdit,
    forceEdit,
    stopEdit,
  } = useApp();
  const [isAdmin, setIsAdmin] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [filters, setFilters] = useState({ year: '', region: '', type: '', maxDifficulty: '', tag: '' });
  const [tab, setTab] = useState('recent');
  const [keyword, setKeyword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  // 强制接管确认：{ problem, lockedBy, since }
  const [confirmForce, setConfirmForce] = useState(null);

  const requestEdit = async (problem) => {
    const r = await startEdit(problem.id);
    if (!r.ok && r.lockedBy) {
      setConfirmForce({ problem, lockedBy: r.lockedBy, since: r.since });
    }
  };

  const editButton = (problem) => {
    if (editingIds.includes(problem.id)) {
      return (
        <button
          className="problem-edit editing"
          onClick={(e) => { e.stopPropagation(); stopEdit(problem.id); }}
          title="退出编辑状态（其他用户即可编辑）"
        >
          退出
        </button>
      );
    }
    const lock = locks[problem.id];
    if (lock) {
      return (
        <button
          className="problem-edit locked"
          onClick={(e) => {
            e.stopPropagation();
            setConfirmForce({ problem, lockedBy: lock.holder_email, since: lock.heartbeat_at });
          }}
          title={`正在由 ${lock.holder_email} 编辑，点击强制接管（对方将变为只读）`}
        >
          🔒{lock.holder_email}
        </button>
      );
    }
    return (
      <button
        className="problem-edit"
        onClick={(e) => { e.stopPropagation(); requestEdit(problem); }}
        title="进入编辑状态（防止多页面同时编辑冲突）"
      >
        编辑
      </button>
    );
  };

  const searchedProblems = problems.filter((p) => {
    if (tab !== 'search') return true;
    // 搜索 tab 缺省为空列表，必须给出至少一个条件才返回结果
    if (!keyword.trim() && !Object.values(filters).some(Boolean)) return false;
    const kw = keyword.trim();
    if (kw && !(p.name || '').includes(kw)) return false;
    if (filters.year && String(p.examYear ?? '') !== String(filters.year)) return false;
    if (filters.region && !(p.examRegion || '').includes(filters.region)) return false;
    if (filters.type && p.examType !== filters.type) return false;
    if (filters.maxDifficulty && !(p.difficulty != null && p.difficulty <= Number(filters.maxDifficulty))) return false;
    if (filters.tag && !(p.tags || []).includes(filters.tag)) return false;
    return true;
  });

  const visibleProblems = tab === 'recent'
    ? [...searchedProblems].sort((a, b) => (b.updated_at || b.created_at || 0) - (a.updated_at || a.created_at || 0))
    : searchedProblems;

  // 点击搜索结果 = 进入该题目：切回"最近修改"列表并定位到它
  const openProblem = (id) => {
    if (tab === 'search') {
      setTab('recent');
      setKeyword('');
      setFilters({ year: '', region: '', type: '', maxDifficulty: '', tag: '' });
    }
    selectProblem(id);
  };

  const hasFilter = Object.values(filters).some(Boolean);
  const setFilter = (k, v) => setFilters((prev) => ({ ...prev, [k]: v }));

  useEffect(() => {
    if (!user) return;
    getAdminCheck().then((r) => setIsAdmin(Boolean(r.admin))).catch(() => {});
  }, [user]);

  // 复制题目：应用内浏览器拦截 window.prompt，改为行内命名输入
  const [dupNaming, setDupNaming] = useState(false);
  const [dupName, setDupName] = useState('');
  const [dupHint, setDupHint] = useState('');
  const startDuplicate = () => {
    const src = activeProblem;
    if (!src) {
      setDupHint('请先在列表中选中一道题目，再执行复制。');
      setTimeout(() => setDupHint(''), 2500);
      return;
    }
    setDupName(`${src.name || '未命名题目'} 副本`);
    setDupNaming(true);
  };
  const confirmDuplicate = () => {
    const src = activeProblem;
    if (!src) { setDupNaming(false); return; }
    const defaultName = `${src.name || '未命名题目'} 副本`;
    addProblem({
      name: dupName.trim() || defaultName,
      imageDataUrl: src.imageDataUrl,
      ocrText: src.ocrText,
      commands: src.commands,
      ggbState: src.ggbState,
      jxgSteps: src.jxgSteps,
      engine: src.engine,
      ocrProvider: src.ocrProvider,
      llmProvider: src.llmProvider,
      refineHistory: (src.refineHistory || []).map(h => ({ ...h })),
      refineInput: '',
    });
    setDupNaming(false);
  };

  return (
    <aside className="problem-list">
      <div className="problem-list-head">
        <span className="problem-list-title">题目列表</span>
        {dupNaming ? (
          <div className="flex items-center gap-1 dup-naming">
            <input
              autoFocus
              value={dupName}
              onChange={(e) => setDupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmDuplicate();
                if (e.key === 'Escape') setDupNaming(false);
              }}
              placeholder="新题目名称"
              className="dup-name-input"
            />
            <button className="primary" onClick={confirmDuplicate}>确定</button>
            <button onClick={() => setDupNaming(false)}>取消</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={startDuplicate} title="复制当前选中的题目">复制</button>
            <button className="primary" onClick={() => { window.location.hash = '#/entry'; }}>+ New</button>
          </div>
        )}
      </div>
      {dupHint && <div className="dup-hint">{dupHint}</div>}
      <div className="problem-tabs">
        <button
          className={tab === 'recent' ? 'active' : ''}
          onClick={() => setTab('recent')}
        >
          最近修改
        </button>
        <button
          className={tab === 'search' ? 'active' : ''}
          onClick={() => setTab('search')}
        >
          搜索
        </button>
      </div>
      {problems.length > 0 && tab === 'search' && (
        <div className="problem-filters">
          <input
            className="filter-input filter-keyword"
            type="text"
            placeholder="搜索题目名称"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <input
            className="filter-input filter-year"
            type="number"
            placeholder="年份"
            value={filters.year}
            onChange={(e) => setFilter('year', e.target.value)}
          />
          <input
            className="filter-input"
            type="text"
            placeholder="地区"
            value={filters.region}
            onChange={(e) => setFilter('region', e.target.value)}
          />
          <select
            className="filter-input"
            value={filters.type}
            onChange={(e) => setFilter('type', e.target.value)}
          >
            <option value="">类型</option>
            {EXAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            className="filter-input"
            value={filters.maxDifficulty}
            onChange={(e) => setFilter('maxDifficulty', e.target.value)}
            title="难度上限"
          >
            <option value="">难度</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>≤{n} {DIFFICULTY_LABELS[n]}</option>)}
          </select>
          <select
            className="filter-input"
            value={filters.tag}
            onChange={(e) => setFilter('tag', e.target.value)}
          >
            <option value="">知识点</option>
            {tagVocab.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {hasFilter && (
            <button className="filter-clear" onClick={() => setFilters({ year: '', region: '', type: '', maxDifficulty: '', tag: '' })} title="清除筛选">
              清除
            </button>
          )}
        </div>
      )}
      <div className="problem-list-body">
        {problems.length === 0 && (
          <p className="problem-empty">点击 New 新建题目</p>
        )}
        {problems.length > 0 && visibleProblems.length === 0 && (
          <p className="problem-empty">
            {tab === 'search' && !keyword.trim() && !hasFilter
              ? '输入名称关键字或筛选条件进行搜索'
              : '没有符合筛选条件的题目'}
          </p>
        )}
        {visibleProblems.map(problem => (
          <div
            key={problem.id}
            onClick={() => openProblem(problem.id)}
            className={`problem-item ${activeProblemId === problem.id ? 'active' : ''}`}
          >
            <div className="problem-thumb">
              {problem.imageDataUrl ? (
                <img src={problem.imageDataUrl} alt="" />
              ) : (
                <span className="problem-placeholder">题</span>
              )}
            </div>
            <div className="problem-info">
              {editingId === problem.id ? (
                <input
                  className="problem-name-input"
                  value={editName}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => {
                    const name = editName.trim();
                    if (name) updateProblem(problem.id, { name });
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.target.blur();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <p
                  className="problem-name"
                  title="双击修改题目名称"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingId(problem.id);
                    setEditName(problem.name || '');
                  }}
                >
                  {problem.name || '未命名题目'}
                </p>
              )}
              {(problem.examYear || problem.examRegion || problem.examType || problem.difficulty != null || (problem.tags || []).length > 0) && (
                <div className="problem-attrs">
                  {problem.examType && <span className="attr-badge">{problem.examType}</span>}
                  {problem.examYear && <span className="attr-badge">{problem.examYear}</span>}
                  {problem.examRegion && <span className="attr-badge">{problem.examRegion}</span>}
                  {problem.difficulty != null && (
                    <span className="attr-badge" title={DIFFICULTY_LABELS[problem.difficulty]}>
                      难度{problem.difficulty}
                    </span>
                  )}
                  {(problem.tags || []).map((t) => <span key={t} className="attr-badge attr-tag">{t}</span>)}
                </div>
              )}
              <div className="problem-times">
                {tab === 'search' && (
                  <span title={`创建时间：${formatTs(problem.created_at)}`}>建 {formatTs(problem.created_at)}</span>
                )}
                <span title={`最后修改：${formatTs(problem.updated_at)}`}>{formatTs(problem.updated_at)}</span>
                <span className="problem-id" title={`题目 ID：${problem.id}`}>ID {problem.id.slice(0, 8)}</span>
              </div>
            </div>
            {editButton(problem)}
            <button
              className="problem-delete"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(problem);
              }}
              title="删除"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="删除题目"
          message={`确定要删除题目“${confirmDelete.name || '未命名题目'}”吗？删除后不可恢复。`}
          confirmText="删除"
          danger
          onConfirm={() => {
            deleteProblem(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {confirmForce && (
        <ConfirmDialog
          title="强制接管编辑"
          message={`该题正在被 ${confirmForce.lockedBy} 编辑。强制接管后，对方页面将变为只读（未保存的改动可能丢失）。确定接管吗？`}
          confirmText="强制接管"
          danger
          onConfirm={() => {
            forceEdit(confirmForce.problem.id);
            setConfirmForce(null);
          }}
          onCancel={() => setConfirmForce(null)}
        />
      )}
      {user && (
        <div className="problem-list-foot">
          <div className="problem-list-avatar">
            {user.email?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="problem-list-user">
            <p className="problem-list-email">{user.email}</p>
          </div>
          {isAdmin && (
            <button
              className="problem-list-logout"
              onClick={() => { window.location.hash = '#/admin'; }}
              title="管理后台"
            >
              管理
            </button>
          )}
          <button className="problem-list-logout" onClick={logout} title="退出登录">
            退出
          </button>
        </div>
      )}
    </aside>
  );
}
