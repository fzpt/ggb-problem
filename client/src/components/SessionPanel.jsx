import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import * as api from '../services/api';

export default function SessionPanel() {
  const {
    activeProblem,
    updateProblem,
    log,
    setLog,
    setStatus,
    drawnProblemId,
    setDrawnProblemId,
  } = useApp();

  const [refining, setRefining] = useState(false);
  const abortRefineRef = useRef(null);

  useEffect(() => {
    setRefining(false);
  }, [activeProblem?.id]);

  if (!activeProblem) {
    return (
      <div className="session-panel empty">
        <p className="text-muted">点击左侧题目进入编辑状态</p>
      </div>
    );
  }

  const { id, name, ocrText, commands, refineHistory, refineInput } = activeProblem;
  const llmProvider = activeProblem.llmProvider || 'kimi';

  const setRefineInput = (value) => updateProblem(id, { refineInput: value });
  const setRefineHistory = (next) => {
    if (Array.isArray(next)) {
      updateProblem(id, { refineHistory: next });
    }
  };

  const sendRefine = async () => {
    const instruction = refineInput.trim();
    const text = ocrText.trim() || '（无原始题目文字）';
    if (!instruction) {
      setLog('请输入调整说明。');
      return;
    }
    const currentCommands = commands;
    const needsReset = id !== drawnProblemId;
    let baseHistory = [];
    if (needsReset) {
      setDrawnProblemId(id);
      if (window.ggbApplet) {
        window.ggbApplet.reset();
        window.ggbApplet.setAxesVisible(true, true);
        window.ggbApplet.setGridVisible(true);
      }
      setLog('检测到切换题目，已重置绘图并清空 Kimi 会话上下文。');
    } else {
      baseHistory = refineHistory
        .filter(h => h.role === 'user' || h.role === 'kimi')
        .map(h => ({ role: h.role, text: h.text }));
    }
    const userEntry = { role: 'user', text: instruction };
    const resetEntry = needsReset
      ? { role: 'system', text: '检测到切换题目，已重置绘图并清空 Kimi 会话上下文。' }
      : null;
    const nextHistory = resetEntry
      ? [...refineHistory, resetEntry, userEntry]
      : [...refineHistory, userEntry];
    setRefineHistory(nextHistory);
    setRefineInput('');
    setRefining(true);
    const controller = new AbortController();
    abortRefineRef.current = controller;
    setStatus({ text: '正在调整...', color: '#555555' });
    try {
      const res = await api.refineCommands(text, currentCommands, baseHistory, instruction, llmProvider, controller.signal);
      const newCommands = (res.commands || []).join('\n');
      const kimiEntry = { role: 'kimi', text: `已调整，生成 ${res.commands?.length || 0} 条指令。` };
      setRefineHistory([...nextHistory, kimiEntry]);
      if (newCommands) {
        updateProblem(id, { commands: newCommands });
        setLog('调整完成，已更新 GeoGebra 图形。');
        setStatus({ text: '调整完成', color: '#333333' });
      } else {
        setLog('Kimi 没有返回可执行指令。');
      }
    } catch (e) {
      console.error('[sendRefine] error', e);
      if (e.name === 'AbortError' || (e.message && e.message.includes('aborted'))) {
        setLog('已终止生成');
        setStatus({ text: '已终止', color: '#555555' });
      } else {
        setRefineHistory([...nextHistory, { role: 'kimi', text: '调整出错：' + e.message }]);
        setLog('调整失败：' + e.message);
        setStatus({ text: '调整失败', color: '#555555' });
      }
    } finally {
      setRefining(false);
      abortRefineRef.current = null;
    }
  };

  const cancelRefine = async () => {
    abortRefineRef.current?.abort();
    try { await api.cancelRequest(); } catch {}
  };

  const onRefineKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendRefine();
    }
  };

  const lineCount = commands
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//')).length;

  return (
    <div className="session-panel">
      <div className="session-head">
        <div className="session-title">
          <span className="font-bold text-ink">{name || '未命名题目'}</span>
          <span className="text-sm text-muted">{lineCount} 条指令 · {llmProvider}</span>
        </div>
      </div>

      <div className="session-body">
       <div className="problem-text-panel">
         <textarea
           value={ocrText}
           className="editor-textarea"
           placeholder="尚未识别题目文字，也可直接输入或修改..."
           onChange={e => updateProblem(id, { ocrText: e.target.value })}
         />
       </div>
        <div className="chat-panel">
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
        </div>
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
          {refining ? (
            <>
              <button className="primary" disabled>调整中…</button>
              <button onClick={cancelRefine}>终止</button>
            </>
          ) : (
            <button className="primary" onClick={sendRefine} disabled={!refineInput.trim()}>
              {llmProvider === 'kimi' ? '发送给 Kimi' : '发送调整说明'}
            </button>
          )}
        </div>
        <p className="hint">
          写法示例：<code>A=(0,0)</code>、<code>Segment(A,B)</code>、<code>Circle(A,2)</code>。空行和以 <code>//</code> 开头的注释会被忽略。
        </p>
        <div className="log">{log}</div>
      </div>
    </div>
  );
}
