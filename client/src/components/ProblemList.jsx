import { useApp } from '../store/AppContext';

export default function ProblemList() {
  const {
    user,
    problems,
    activeProblemId,
    selectProblem,
    openModal,
    deleteProblem,
    logout,
  } = useApp();

  return (
    <aside className="problem-list">
      <div className="problem-list-head">
        <span className="problem-list-title">题目列表</span>
        <div className="flex items-center gap-2">
          <button className="primary" onClick={openModal}>+ New</button>
        </div>
      </div>
      <div className="problem-list-body">
        {problems.length === 0 && (
          <p className="problem-empty">点击 New 新建题目</p>
        )}
        {problems.map(problem => (
          <div
            key={problem.id}
            onClick={() => selectProblem(problem.id)}
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
              <p className="problem-name">{problem.name || '未命名题目'}</p>
            </div>
            <button
              className="problem-delete"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`确定要删除题目“${problem.name || '未命名题目'}”吗？`)) {
                  deleteProblem(problem.id);
                }
              }}
              title="删除"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {user && (
        <div className="problem-list-foot">
          <div className="problem-list-avatar">
            {user.email?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="problem-list-user">
            <p className="problem-list-email">{user.email}</p>
          </div>
          <button className="problem-list-logout" onClick={logout} title="退出登录">
            退出
          </button>
        </div>
      )}
    </aside>
  );
}
