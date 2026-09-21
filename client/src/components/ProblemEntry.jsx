import { useCallback, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { analyzeProblemImage, analyzeConstruction } from '../services/api';

// 压缩图片：最长边限制在 1600px，JPEG 质量 0.85，控制上传体积
function compressImage(dataUrl, maxSide = 1600, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      if (scale >= 1 && dataUrl.startsWith('data:image/jpeg')) return resolve(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export default function ProblemEntry() {
  const { addProblem, user } = useApp();
  const fileInputRef = useRef(null);

  const [name, setName] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState(null);
  const [textInput, setTextInput] = useState('');
  const [rawText, setRawText] = useState('');
  const [completedText, setCompletedText] = useState('');
  const [steps, setSteps] = useState([]);
  const [commandsText, setCommandsText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [constructing, setConstructing] = useState(false);
  const [status, setStatus] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const setImage = useCallback(async (dataUrl) => {
    setStatus('正在处理图片…');
    const compressed = await compressImage(dataUrl);
    setImageDataUrl(compressed);
    setStatus('');
  }, []);

  const onFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) {
      setStatus('请选择图片文件。');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result);
    reader.readAsDataURL(file);
  }, [setImage]);

  const onPaste = useCallback((e) => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) onFile(file);
        return;
      }
    }
  }, [onFile]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  }, [onFile]);

  const runAnalyze = async () => {
    if (!imageDataUrl && !textInput.trim()) return;
    setAnalyzing(true);
    setStatus('正在识别分析…');
    try {
      const result = await analyzeProblemImage(imageDataUrl, textInput.trim());
      setRawText(result.rawText || '');
      setCompletedText(result.completedText || result.rawText || '');
      setStatus('识别完成，可修改下方文字。');
    } catch (e) {
      setStatus('识别失败：' + (e.message || '未知错误'));
    } finally {
      setAnalyzing(false);
    }
  };

  const problemText = (completedText || rawText || textInput).trim();

  const runConstruction = async () => {
    if (!problemText) return;
    setConstructing(true);
    setStatus('正在作图分析…');
    try {
      const result = await analyzeConstruction(problemText);
      setSteps(result.steps || []);
      setCommandsText((result.commands || []).join('\n'));
      setStatus(
        result.warnings?.length
          ? `作图分析完成，${result.warnings.length} 条指令被过滤。`
          : '作图分析完成。'
      );
    } catch (e) {
      setStatus('作图分析失败：' + (e.message || '未知错误'));
    } finally {
      setConstructing(false);
    }
  };

  const confirmDraw = () => {
    if (!commandsText.trim()) return;
    addProblem({
      name: name.trim() || '未命名题目',
      imageDataUrl,
      ocrText: problemText,
      commands: commandsText,
    });
    window.location.hash = '#/app';
  };

  const canAnalyze = Boolean(imageDataUrl || textInput.trim()) && !analyzing && !constructing;
  const canConstruct = Boolean(problemText) && !analyzing && !constructing;

  return (
    <div className="entry-shell" onPaste={onPaste}>
      <div className="entry-header">
        <a className="entry-back text-muted" href="#/">&larr; 返回首页</a>
        <span className="entry-title text-ink">新建题目</span>
        <input
          className="entry-name"
          placeholder="题目名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {!user && <span className="text-muted entry-hint">未登录，识别功能需要登录后使用</span>}
      </div>

      <div className="entry-body">
        {/* 左列：输入 + 识别分析 */}
        <div className="entry-left">
          <div
            className={'entry-dropzone' + (dragOver ? ' dragover' : '') + (imageDataUrl ? ' has-image' : '')}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => !imageDataUrl && fileInputRef.current?.click()}
          >
            {imageDataUrl ? (
              <div className="entry-preview">
                <img src={imageDataUrl} alt="题目图片" />
                <button
                  className="button entry-remove-image"
                  onClick={(e) => { e.stopPropagation(); setImageDataUrl(null); }}
                >
                  移除图片
                </button>
              </div>
            ) : (
              <p className="text-muted">
                点击选择、拖拽或粘贴图片到此处
              </p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = '';
              }}
            />
          </div>

          <textarea
            className="entry-text-input"
            placeholder="或直接输入题目文字"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
          />

          <button className="button primary" onClick={runAnalyze} disabled={!canAnalyze}>
            {analyzing ? '识别分析中…' : '识别分析'}
          </button>

          <label className="entry-label">原始识别文字</label>
          <textarea
            className="entry-box"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="识别出的原始题目文字"
          />

          <label className="entry-label">补全后题目</label>
          <textarea
            className="entry-box"
            value={completedText}
            onChange={(e) => setCompletedText(e.target.value)}
            placeholder="补全点所属线段等信息后的完整题目"
          />

          <button className="button primary" onClick={runConstruction} disabled={!canConstruct}>
            {constructing ? '作图分析中…' : '作图分析'}
          </button>

          {status && <p className="entry-status text-muted">{status}</p>}
        </div>

        {/* 右列：作图步骤 + 指令 */}
        <div className="entry-right">
          <div className="entry-steps">
            <label className="entry-label">作图步骤分析</label>
            {steps.length === 0 ? (
              <p className="text-muted entry-placeholder">作图分析后在此显示构建次序</p>
            ) : (
              <table className="entry-table">
                <thead>
                  <tr>
                    <th>次序</th>
                    <th>对象</th>
                    <th>点的类型</th>
                    <th>依赖</th>
                    <th>约束条件</th>
                  </tr>
                </thead>
                <tbody>
                  {steps.map((s, i) => (
                    <tr key={i}>
                      <td>{s.order}</td>
                      <td>{s.object}</td>
                      <td>{s.type}</td>
                      <td>{s.dependencies}</td>
                      <td>{s.constraint}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="entry-commands">
            <label className="entry-label">GeoGebra 作图指令</label>
            <textarea
              className="entry-box entry-commands-box"
              value={commandsText}
              onChange={(e) => setCommandsText(e.target.value)}
              placeholder="作图分析后生成，可手动修改"
              spellCheck={false}
            />
            <button
              className="button primary entry-draw"
              onClick={confirmDraw}
              disabled={!commandsText.trim()}
            >
              作图
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
