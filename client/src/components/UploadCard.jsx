import { useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import * as api from '../services/api';

const TAB_INFO = [
  { id: 'image', label: '原图' },
  { id: 'text', label: '题目文字' },
  { id: 'refine', label: '持续改进' },
];

export default function UploadCard() {
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);
  const {
    imageDataUrl, setImageDataUrl,
    ocrText, setOcrText,
    commands, setCommands,
    refineHistory, setRefineHistory,
    activeTab, setActiveTab,
    ocrProvider, setOcrProvider,
    llmProvider, setLlmProvider,
    setStatus, setLog,
    reset,
  } = useApp();

  const [recognizing, setRecognizing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [refineInput, setRefineInput] = useState('');

  const handleFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(reader.result);
    reader.readAsDataURL(file);
  };

  const onDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const onPaste = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (type) {
          const blob = await item.getType(type);
          handleFile(blob);
          return;
        }
      }
      setLog('剪贴板里没有找到图片。');
    } catch (e) {
      setLog('粘贴失败：' + e.message);
    }
  };

  const recognize = async () => {
    if (!imageDataUrl) return;
    setRecognizing(true);
    setLog(`正在用 ${ocrProvider} 识别题目文字...`);
    try {
      const res = await api.recognizeImage(imageDataUrl, ocrProvider);
      setOcrText(res.text || '');
      setActiveTab('text');
      setLog(`OCR 完成（${res.provider}），请检查题目文字后点击生成。`);
    } catch (e) {
      setLog('识别失败：' + e.message);
    } finally {
      setRecognizing(false);
    }
  };

  const generate = async () => {
    const text = ocrText.trim();
    if (!text) return;
    abortRef.current = new AbortController();
    setGenerating(true);
    setStatus({ text: '正在生成指令...', color: '#d8a93f' });
    setLog(`正在用 ${llmProvider} 生成 GeoGebra 指令...`);
    try {
      const res = await api.extractCommands(text, llmProvider, abortRef.current.signal);
      const newCommands = (res.commands || []).join('\n');
      setCommands(newCommands);
      setRefineHistory([
        { role: 'kimi', text: `首次生成 ${res.commands?.length || 0} 条指令。你可以输入调整说明。` }
      ]);
      setActiveTab('refine');
      setStatus({ text: '生成完成', color: '#234c3b' });
      setLog(`生成完成，使用 ${res.provider} 生成 ${res.commands?.length || 0} 条指令。`);
    } catch (e) {
      if (e.name !== 'AbortError') {
        setLog('生成失败：' + e.message);
        setStatus({ text: '生成失败', color: '#c5603b' });
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  };

  const cancelGenerate = async () => {
    abortRef.current?.abort();
    try { await api.cancelRequest(); } catch {}
    setGenerating(false);
    setStatus({ text: '已终止生成', color: '#c5603b' });
    setLog('已终止生成。');
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
    setRefineHistory(prev => [...prev, { role: 'user', text: instruction }]);
    setRefineInput('');
    setLog('正在让 Kimi 根据说明调整指令...');
    try {
      const res = await api.refineCommands(text, currentCommands, history, instruction, llmProvider);
      const newCommands = (res.commands || []).join('\n');
      setRefineHistory(prev => [...prev, { role: 'kimi', text: `已调整，生成 ${res.commands?.length || 0} 条指令。` }]);
      if (newCommands) {
        setCommands(newCommands);
        setLog('调整完成，已更新 GeoGebra 图形。');
      } else {
        setLog('Kimi 没有返回可执行指令。');
      }
    } catch (e) {
      setRefineHistory(prev => [...prev, { role: 'kimi', text: '调整出错：' + e.message }]);
      setLog('调整失败：' + e.message);
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

  return (
    <article className="card flex flex-col min-h-[620px]">
      <div className="card-head">
        <div className="label-row">
          <span className="font-bold text-ink">题目</span>
          <span className="text-sm text-muted">{ocrProvider} / {llmProvider}</span>
        </div>
        <div className="flex gap-2 mt-3" role="tablist">
          {TAB_INFO.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-sm font-bold rounded-t-lg transition ${
                activeTab === tab.id
                  ? 'bg-white/80 text-moss shadow-[inset_0_-2px_0_#234c3b]'
                  : 'text-muted hover:bg-white/50 hover:text-ink'
              }`}
              role="tab"
              aria-selected={activeTab === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {activeTab === 'image' && (
          <div className="flex flex-col flex-1 p-4 animate-rise">
            <div
              onClick={() => fileInputRef.current?.click()}
              onDrop={onDrop}
              onDragOver={e => e.preventDefault()}
              className="relative flex flex-col items-center justify-center gap-2 p-7 border-2 border-dashed border-black/15 rounded-2xl bg-white/40 text-muted cursor-pointer hover:border-moss hover:bg-white/70 transition min-h-[200px]"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="absolute inset-0 opacity-0 pointer-events-none"
                onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              {imageDataUrl ? (
                <img src={imageDataUrl} alt="preview" className="max-h-40 object-contain rounded-lg" />
              ) : (
                <span>拖拽或点击上传 / 粘贴图片</span>
              )}
            </div>
            <div className="provider-row mt-3">
              <label htmlFor="ocr-provider">文字识别</label>
              <select id="ocr-provider" value={ocrProvider} onChange={e => setOcrProvider(e.target.value)}>
                <option value="mock">Mock（本地示例）</option>
                <option value="baidu">百度 OCR（需要 API key）</option>
              </select>
            </div>
            <div className="upload-foot">
              <button className="primary" onClick={recognize} disabled={!imageDataUrl || recognizing}>
                {recognizing ? '识别中...' : '识别题目'}
              </button>
              <button onClick={onPaste}>粘贴截图</button>
              <button onClick={reset}>清除</button>
            </div>
          </div>
        )}

        {activeTab === 'text' && (
          <div className="flex flex-col flex-1 p-4 animate-rise">
            <textarea
              value={ocrText}
              onChange={e => setOcrText(e.target.value)}
              className="recognized-text"
              placeholder="识别出的题目文字会显示在这里，也可以直接输入或修改..."
            />
            <div className="provider-row mt-3">
              <label htmlFor="llm-provider">指令生成</label>
              <select id="llm-provider" value={llmProvider} onChange={e => setLlmProvider(e.target.value)}>
                <option value="mock">Mock（本地示例）</option>
                <option value="kimi">Kimi（需要 API key）</option>
              </select>
            </div>
            <div className="upload-foot">
              <button className="primary" onClick={generate} disabled={!ocrText.trim() || generating}>
                {generating ? '生成中...' : '生成 GeoGebra 指令'}
              </button>
              {generating && (
                <button onClick={cancelGenerate}>终止生成</button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'refine' && (
          <div className="flex flex-col flex-1 min-h-0 animate-rise">
            <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-2">
              {refineHistory.length === 0 && (
                <p className="text-sm text-muted text-center py-4">先生成指令，然后在这里输入调整说明。</p>
              )}
              {refineHistory.map((entry, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col gap-1 ${entry.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[90%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap ${
                      entry.role === 'user'
                        ? 'bg-moss text-white rounded-br-sm'
                        : 'bg-white/70 text-ink rounded-bl-sm'
                    }`}
                  >
                    {entry.text}
                  </div>
                </div>
              ))}
            </div>
            <div className="refine-input-wrap">
              <textarea
                value={refineInput}
                onChange={e => setRefineInput(e.target.value)}
                onKeyDown={onRefineKeyDown}
                className="refine-input"
                placeholder="输入调整说明，例如：把 A 点往左移一点、添加 AB 边上的高..."
                disabled={refining}
              />
              <button className="primary self-start" onClick={sendRefine} disabled={!refineInput.trim() || refining}>
                {refining ? '调整中...' : '发送给 Kimi'}
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
