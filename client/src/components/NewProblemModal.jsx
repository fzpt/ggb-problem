import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import * as api from '../services/api';

const TAB_INFO = [
  { id: 'image', label: '原图' },
  { id: 'text', label: '题目文字' },
];

export default function NewProblemModal() {
  const { addProblem, updateProblem, closeModal, setStatus, setLog } = useApp();

  const fileInputRef = useRef(null);
  const abortRef = useRef(null);

  const [name, setName] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState(null);
  const [ocrText, setOcrText] = useState('');
 const [activeTab, setActiveTab] = useState('image');
 const [ocrProvider, setOcrProvider] = useState('baidu');
 const [llmProvider, setLlmProvider] = useState('kimi');
  const [recognizing, setRecognizing] = useState(false);
  const [draftProblemId, setDraftProblemId] = useState(null);

  // 支持在弹窗内用 Ctrl+V 直接粘贴图片
  useEffect(() => {
    const onGlobalPaste = (e) => {
      if (e.defaultPrevented) return;
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        const imageFile = Array.from(files).find(f => f.type.startsWith('image/'));
        if (imageFile) {
          e.preventDefault();
          handleFile(imageFile);
          setActiveTab('image');
          setLog('已从剪贴板粘贴图片，可点击识别题目。');
        }
      }
    };
    window.addEventListener('paste', onGlobalPaste);
    return () => window.removeEventListener('paste', onGlobalPaste);
  }, []);
  const [generating, setGenerating] = useState(false);

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
      const text = res.text || '';
      setOcrText(text);
      setActiveTab('text');
      if (!draftProblemId) {
        const id = addProblem({
          name: name.trim() || '未命名题目',
          imageDataUrl,
          ocrText: text,
          commands: '',
          refineHistory: [],
          ocrProvider,
          llmProvider,
          activeTab: 'text',
        });
        setDraftProblemId(id);
      } else {
        updateProblem(draftProblemId, { ocrText: text });
      }
      setLog(`OCR 完成（${res.provider}），请检查题目文字后点击生成。`);
    } catch (e) {
      setLog('识别失败：' + e.message);
    } finally {
      setRecognizing(false);
    }
  };

  const confirmAndGenerate = async () => {
    const text = ocrText.trim();
    if (!text) return;
    if (!name.trim()) {
      setLog('请填写题目名称。');
      return;
    }
    abortRef.current = new AbortController();
    setGenerating(true);
    setStatus({ text: '正在生成指令...', color: '#555555' });
    setLog(`正在用 ${llmProvider} 生成 GeoGebra 指令...`);
    try {
      let problemId = draftProblemId;
      if (!problemId) {
        problemId = addProblem({
          name: name.trim() || '未命名题目',
          imageDataUrl,
          ocrText: text,
          commands: '',
          refineHistory: [],
          ocrProvider,
          llmProvider,
          activeTab: 'text',
        });
        setDraftProblemId(problemId);
      }
      const res = await api.extractCommands(text, llmProvider, abortRef.current.signal);
      const newCommands = (res.commands || []).join('\n');
      updateProblem(problemId, {
        name: name.trim() || '未命名题目',
        commands: newCommands,
        activeTab: 'refine',
        refineHistory: [
          { role: 'kimi', text: `首次生成 ${res.commands?.length || 0} 条指令。你可以输入调整说明。` }
        ],
      });
      setStatus({ text: '生成完成', color: '#333333' });
      setLog(`生成完成，使用 ${res.provider} 生成 ${res.commands?.length || 0} 条指令。`);
      closeModal();
    } catch (e) {
      if (e.name !== 'AbortError') {
        setLog('生成失败：' + e.message);
        setStatus({ text: '生成失败', color: '#555555' });
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
    setStatus({ text: '已终止生成', color: '#555555' });
    setLog('已终止生成。');
  };

  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>新建题目</h2>
          <button className="modal-close" onClick={closeModal}>×</button>
        </div>
        <div className="modal-body">
          <div className="name-row">
            <label htmlFor="problem-name">题目名称</label>
            <input
              id="problem-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如：三角形 ABC 求垂线"
            />
          </div>

          <div className="flex gap-2 mt-4 mb-3" role="tablist">
            {TAB_INFO.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-sm font-bold rounded-t-lg transition ${
                  activeTab === tab.id
                    ? 'bg-white/80 text-ink shadow-[inset_0_-2px_0_#333333]'
                    : 'text-muted hover:bg-white/50 hover:text-ink'
                }`}
                role="tab"
                aria-selected={activeTab === tab.id}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'image' && (
            <div className="flex flex-col flex-1 animate-rise">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={onDrop}
                onDragOver={e => e.preventDefault()}
                className="relative flex flex-col items-center justify-center gap-2 p-7 border-2 border-dashed border-black/15 rounded-2xl bg-white/40 text-muted cursor-pointer hover:border-accent hover:bg-white/70 transition min-h-[200px]"
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
              </div>
            </div>
          )}

          {activeTab === 'text' && (
            <div className="flex flex-col flex-1 animate-rise">
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
                <button className="primary" onClick={confirmAndGenerate} disabled={!ocrText.trim() || !name.trim() || generating}>
                  {generating ? '生成中...' : '确认并生成 GeoGebra 指令'}
                </button>
                {generating && (
                  <button onClick={cancelGenerate}>终止生成</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
