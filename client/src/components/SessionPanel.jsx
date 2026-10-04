import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import * as api from '../services/api';
import { getCurrentObjects, applyOperations } from '../lib/ggb';

export default function SessionPanel() {
  const {
    activeProblem,
    updateProblem,
    log,
    setLog,
    setStatus,
    drawnProblemId,
    setDrawnProblemId,
    editingIds,
  } = useApp();

  const [refining, setRefining] = useState(false);
  const [detailEntry, setDetailEntry] = useState(null);
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

  const { id, ocrText, commands, refineHistory, refineInput } = activeProblem;
  const llmProvider = activeProblem.llmProvider || 'kimi';
  const editable = editingIds.includes(id);
  const isJxg = activeProblem.engine === 'jxg';

  const setRefineInput = (value) => updateProblem(id, { refineInput: value });
  const setRefineHistory = (next) => {
    if (Array.isArray(next)) {
      updateProblem(id, { refineHistory: next });
    }
  };

  const sendRefine = async () => {
    if (!editable) {
      setLog('当前为只读状态，点击题目旁的「编辑」按钮后才能调整。');
      return;
    }
    const instruction = refineInput.trim();
    const text = ocrText.trim() || '（无原始题目文字）';
    if (!instruction) {
      setLog('请输入调整说明。');
      return;
    }
    const currentCommands = isJxg ? JSON.stringify(activeProblem.jxgSteps || []) : commands;
    const needsReset = id !== drawnProblemId;
    let baseHistory = [];
    if (needsReset && !isJxg) {
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
      const currentObjects = !isJxg && window.ggbApplet ? getCurrentObjects() : [];
      const res = await api.refineCommands(text, currentCommands, baseHistory, instruction, llmProvider, { currentObjects, mode: 'incremental', format: isJxg ? 'jxg' : undefined }, controller.signal);
      if (isJxg) {
        // JSXGraph 引擎：返回完整修订后的 JSON 步骤数组，交给 JxgViewer 渲染并保存
        const newSteps = Array.isArray(res.jxgSteps) ? res.jxgSteps : [];
        if (newSteps.length) {
          updateProblem(id, { jxgSteps: newSteps });
          setLog('调整完成，已更新图形。');
          setStatus({ text: '调整完成', color: '#333333' });
        } else {
          setLog('模型没有返回可渲染的步骤。');
        }
        const kimiEntry = {
          role: 'kimi',
          text: newSteps.length ? `已调整，生成 ${newSteps.length} 步构造。` : '未返回构造步骤。',
          detail: { jxgSteps: newSteps, warnings: res.warnings || [] },
        };
        setRefineHistory([...nextHistory, kimiEntry]);
      } else {
      const operations = res.operations || [];
      const newCommands = (res.commands || []).join('\n');
      const hasOperations = Array.isArray(operations) && operations.length > 0;
      let opResult = null;
      if (hasOperations) {
        const { applied, failed } = applyOperations(operations);
        opResult = { operations, failed, applied };
        if (failed.length) {
          setLog(`增量操作完成：${applied} 条成功，${failed.length} 条失败。`);
        } else {
          setLog(`增量操作完成：${applied} 条已应用。`);
        }
        setStatus({ text: '调整完成', color: '#333333' });
      } else if (newCommands) {
        updateProblem(id, { commands: newCommands });
        setLog('调整完成，已更新 GeoGebra 图形。');
        setStatus({ text: '调整完成', color: '#333333' });
      } else {
        setLog('Kimi 没有返回可执行指令或操作。');
      }
      const kimiEntry = {
        role: 'kimi',
        text: hasOperations ? `已应用 ${operations.length} 条增量操作。` : `已调整，生成 ${res.commands?.length || 0} 条指令。`,
        detail: opResult || { commands: res.commands || [] },
      };
      setRefineHistory([...nextHistory, kimiEntry]);
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

  return (
    <div className="session-panel">
      <div className="session-body">
       <div className="problem-text-panel">
         <textarea
           value={ocrText}
           className="editor-textarea"
           placeholder="尚未识别题目文字，也可直接输入或修改..."
           onChange={e => updateProblem(id, { ocrText: e.target.value })}
           disabled={!editable}
           readOnly={!editable}
         />
         {!editable && (
           <p className="readonly-hint">只读查看中，点击题目旁的「编辑」按钮后可修改。</p>
         )}
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
                  onClick={entry.role === 'kimi' && entry.detail ? () => setDetailEntry(entry) : undefined}
                  title={entry.role === 'kimi' && entry.detail ? '点击查看本次调整的指令与执行结果' : undefined}
                  className={`max-w-[90%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap ${
                    entry.role === 'user'
                      ? 'bg-accent text-white rounded-br-sm'
                      : `bg-white/70 text-ink rounded-bl-sm${entry.detail ? ' cursor-pointer hover:bg-white' : ''}`
                  }`}
                >
                  {entry.text}
                  {entry.role === 'kimi' && entry.detail && (
                    <span className="block mt-1 text-xs opacity-60">点击查看详情</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {detailEntry && (
        <div className="detail-modal-mask" onClick={() => setDetailEntry(null)}>
          <div className="detail-modal" onClick={e => e.stopPropagation()}>
            <div className="detail-modal-head">
              <span className="font-bold text-ink">调整详情</span>
              <button onClick={() => setDetailEntry(null)}>关闭</button>
            </div>
            <div className="detail-modal-body">
              {detailEntry.detail.operations && (
                <>
                  <p className="text-sm text-muted mb-2">
                    增量操作：{detailEntry.detail.applied} 条成功，{detailEntry.detail.failed.length} 条失败
                  </p>
                  <ul className="detail-op-list">
                    {detailEntry.detail.operations.map((op, i) => {
                      const fail = detailEntry.detail.failed.find(f => f.op === op);
                      return (
                        <li key={i} className={fail ? 'op-failed' : 'op-ok'}>
                          <span className="op-status">{fail ? '失败' : '成功'}</span>
                          <code>{op.cmd || `${op.op} ${op.name || ''}`}</code>
                          {fail && <span className="op-reason">{fail.reason}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {detailEntry.detail.jxgSteps && (
                <>
                  <p className="text-sm text-muted mb-2 mt-3">
                    生成的构造步骤（{detailEntry.detail.jxgSteps.length} 步）
                  </p>
                  <pre className="commands-viewer-body detail-commands">
                    {JSON.stringify(detailEntry.detail.jxgSteps, null, 2)}
                  </pre>
                </>
              )}
              {detailEntry.detail.warnings && detailEntry.detail.warnings.length > 0 && (
                <p className="text-sm text-muted mt-2">校验提示：{detailEntry.detail.warnings.join('；')}</p>
              )}
              {detailEntry.detail.commands && detailEntry.detail.commands.length > 0 && (
                <>
                  <p className="text-sm text-muted mb-2 mt-3">生成的指令（{detailEntry.detail.commands.length} 条）</p>
                  <pre className="commands-viewer-body detail-commands">{detailEntry.detail.commands.join('\n')}</pre>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="session-foot">
        <div className="refine-input-row">
          <textarea
            value={refineInput}
            onChange={e => setRefineInput(e.target.value)}
            onKeyDown={onRefineKeyDown}
            className="refine-input"
            placeholder="输入调整说明，例如：把 A 点往左移一点、添加 AB 边上的高..."
            disabled={!editable || refining}
            readOnly={!editable}
          />
          {refining ? (
            <>
              <button className="primary" disabled>调整中…</button>
              <button onClick={cancelRefine}>终止</button>
            </>
          ) : (
            <button className="primary" onClick={sendRefine} disabled={!editable || !refineInput.trim()}>
              调整
            </button>
          )}
        </div>
        <div className="log">{log}</div>
      </div>
    </div>
  );
}
