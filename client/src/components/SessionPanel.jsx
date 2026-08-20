import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext';
import * as api from '../services/api';

const EXAMPLES = {
  triangle: `// 三角形与外接圆\nA = (0, 0)\nB = (5, 0)\nC = (1.6, 3.2)\nPolygon(A, B, C)\nSegment(A, B)\nSegment(B, C)\nSegment(C, A)\nl = PerpendicularBisector(A, B)\nm = PerpendicularBisector(B, C)\nO = Intersect(l, m)\nCircle(O, A)`,
  circle: `// 圆与一条切线\nO = (0, 0)\nA = (3, 0)\nc = Circle(O, A)\nP = (6, 4)\nTangent(P, c)\nSegment(O, A)\nSegment(O, P)`,
  parabola: `// 抛物线、焦点与准线\nF = (0, 1)\nd: y = -1\np = Parabola(F, d)\nA = (-3, 0)\nB = (3, 0)\nLine(A, B)`,
};

const TAB_INFO = [
  { id: 'text', label: '题目文字' },
  { id: 'refine', label: '调整会话' },
];

export default function SessionPanel() {
  const {
    activeProblem,
    updateProblem,
    setLog,
    setStatus,
  } = useApp();

  const [refining, setRefining] = useState(false);
  const [sessionTab, setSessionTab] = useState(activeProblem?.activeTab === 'text' ? 'text' : 'refine');

  useEffect(() => {
    setSessionTab(activeProblem?.activeTab === 'text' ? 'text' : 'refine');
  }, [activeProblem?.activeTab]);

  if (!activeProblem) {
    return (
      <div className="session-panel empty">
        <p className="text-muted">点击左侧题目进入编辑状态</p>
      </div>
    );
  }

  const { id, name, ocrText, commands, refineHistory, refineInput, llmProvider, activeTab } = activeProblem;

  const setCommands = (value) => updateProblem(id, { commands: value });
  const setRefineInput = (value) => updateProblem(id, { refineInput: value });

  const setRefineHistory = (next) => {
    if (Array.isArray(next)) {
      updateProblem(id, { refineHistory: next });
    }
  };

  const appendHistory = (entry) => {
    setRefineHistory([...refineHistory, entry]);
  };

  const sendRefine = async () => {
    const instruction = refineInput.trim();
    const text = ocrText.trim();
    if (!instruction || !text) return;
    const currentCommands = commands;
    const history = refineHistory
      .filter(h => h.role === 'user' || h.role === 'kimi')
      .map(h => ({ role: h.role, text: h.text }));
    setRefining(true);
    appendHistory({ role: 'user', text: instruction });
    setRefineInput('');
    setLog('正在请 Kimi 根据说明调整指令...');
    setStatus({ text: '正在调整...', color: '#555555' });
    try {
      const res = await api.refineCommands(text, currentCommands, history, instruction, llmProvider);
      const newCommands = (res.commands || []).join('\n');
      appendHistory({ role: 'kimi', text: `已调整，生成 ${res.commands?.length || 0} 条指令。` });
      if (newCommands) {
        setCommands(newCommands);
        setLog('调整完成，已更新 GeoGebra 图形。');
        setStatus({ text: '调整完成', color: '#333333' });
      } else {
        setLog('Kimi 没有返回可执行指令。');
      }
    } catch (e) {
      appendHistory({ role: 'kimi', text: '调整出错：' + e.message });
      setLog('调整失败：' + e.message);
      setStatus({ text: '调整失败', color: '#555555' });
    } finally {
      setRefining(false);
    }
  };

  const onRefineKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendRefine();
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(commands);
      setLog('指令已复制到剪贴板。');
    } catch {
      setLog('复制失败。');
    }
  };

  const loadExample = (key) => {
    setCommands(EXAMPLES[key]);
  };

  const switchTab = (tab) => {
    setSessionTab(tab);
    updateProblem(id, { activeTab: tab });
  };

  const lineCount = commands
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//')).length;

  return (
    <div className="session-panel">
      <div className="session-head">
        <div className="flex flex-col gap-1">
          <div className="session-title">
            <span className="font-bold text-ink">{name || '未命名题目'}</span>
            <span className="text-sm text-muted">{lineCount} 条指令 · {llmProvider}</span>
          </div>
          <div className="flex gap-2" role="tablist">
            {TAB_INFO.map(tab => (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className={`px-2 py-1 text-xs rounded-md border transition ${
                  sessionTab === tab.id
                    ? 'bg-ink text-white border-ink'
                    : 'bg-white/70 text-muted border-black/10 hover:text-ink'
                }`}
                role="tab"
                aria-selected={sessionTab === tab.id}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => loadExample('triangle')}>三角形</button>
          <button onClick={() => loadExample('circle')}>圆与切线</button>
          <button onClick={() => loadExample('parabola')}>抛物线</button>
        </div>
      </div>

      <div className="session-body">
        {sessionTab === 'text' ? (
          <div className="problem-text-view">
            <textarea
              value={ocrText}
              readOnly
              className="editor-textarea"
              placeholder="尚未识别题目文字"
            />
          </div>
        ) : (
          <>
            <div className="chat">
              {refineHistory.length === 0 && (
                <p className="text-sm text-muted text-center py-4">已生成初始指令，可以在这里输入调整说明。</p>
              )}
              {refineHistory.map((entry, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col gap-1 ${entry.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[90%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap ${
                      entry.role === 'user'
                        ? 'bg-accent text-white rounded-br-sm'
                        : 'bg-white/70 text-ink rounded-bl-sm'
                    }`}
                  >
                    {entry.text}
                  </div>
                </div>
              ))}
            </div>

            <div className="editor">
              <textarea
                value={commands}
                onChange={e => setCommands(e.target.value)}
                className="editor-textarea"
                spellCheck={false}
                placeholder="在此输入 GeoGebra 指令..."
              />
            </div>
          </>
        )}
      </div>

      <div className="session-foot">
        <div className="refine-input-row">
          <textarea
            value={refineInput}
            onChange={e => setRefineInput(e.target.value)}
            onKeyDown={onRefineKeyDown}
            className="refine-input"
            placeholder="输入调整说明，例如：把 A 点往左移一点、添加 AB 边上的高..."
            disabled={refining}
          />
          <button className="primary" onClick={sendRefine} disabled={!refineInput.trim() || refining}>
            {refining ? '调整中…' : '发送给 Kimi'}
          </button>
        </div>
        <div className="actions">
          <button onClick={() => setCommands('')}>清空画布</button>
          <button onClick={copy}>复制指令</button>
        </div>
        <p className="hint">
          写法示例：<code>A=(0,0)</code>、<code>Segment(A,B)</code>、<code>Circle(A,2)</code>。空行和以 <code>//</code> 开头的注释会被忽略。
        </p>
      </div>
    </div>
  );
}
