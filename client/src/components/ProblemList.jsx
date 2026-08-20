import { useApp } from '../store/AppContext';

export default function ProblemList() {
  const {
    problems,
    activeProblemId,
    selectProblem,
    openModal,
    deleteProblem,
  } = useApp();

  return (
    <aside className="problem-list">
      <div className="problem-list-head">
        <span className="problem-list-title">题目列表</span>
        <button className="primary" onClick={openModal}>+ New</button>
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
              <p className="problem-meta">
                {problem.commands ? '已生成' : '待生成'} · {problem.ocrProvider} / {problem.llmProvider}
              </p>
            </div>
            <button
              className="problem-delete"
              onClick={(e) => {
                e.stopPropagation();
                deleteProblem(problem.id);
              }}
              title="删除"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
