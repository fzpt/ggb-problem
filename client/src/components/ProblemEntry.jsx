import { useCallback, useRef, useState } from 'react';
import { useApp, DIFFICULTY_LABELS, EXAM_TYPES } from '../store/AppContext';
import { analyzeProblemImage, analyzeConstruction, analyzeOnce } from '../services/api';

const CONSTRUCT_LABELS = { direct: '可以直接作图', conclusion: '结论当作条件', impossible: '无法作图' };

// 知识点标签多选：词表 chips 选择 + 输入新建
function TagPicker({ vocab, selected, onChange }) {
  const [input, setInput] = useState('');
  const add = (name) => {
    const n = name.trim();
    if (!n || selected.includes(n)) return;
    onChange([...selected, n]);
    setInput('');
  };
  const available = vocab.filter((t) => !selected.includes(t));
  return (
    <div className="tag-picker">
      <div className="tag-selected">
        {selected.length === 0 && <span className="text-muted tag-empty">未选择知识点</span>}
        {selected.map((t) => (
          <span key={t} className="tag-chip selected">
            {t}
            <button type="button" className="tag-remove" onClick={() => onChange(selected.filter((x) => x !== t))}>×</button>
          </span>
        ))}
      </div>
      <div className="tag-add-row">
        <input
          className="tag-input"
          placeholder="输入新知识点，回车添加"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(input); } }}
        />
        <button type="button" className="button" onClick={() => add(input)} disabled={!input.trim()}>添加</button>
      </div>
      {available.length > 0 && (
        <div className="tag-vocab">
          {available.map((t) => (
            <button key={t} type="button" className="tag-chip" onClick={() => add(t)}>+ {t}</button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const { addProblem, user, tagVocab } = useApp();
  const fileInputRef = useRef(null);

  const [name, setName] = useState('');
  const [examType, setExamType] = useState('');
  const [examYear, setExamYear] = useState('');
  const [examRegion, setExamRegion] = useState('');
  const [difficulty, setDifficulty] = useState(null);
  const [selectedTags, setSelectedTags] = useState([]);
  const [imageDataUrl, setImageDataUrl] = useState(null);
  const [textInput, setTextInput] = useState('');
  const [rawText, setRawText] = useState('');
  const [completedText, setCompletedText] = useState('');
  const [steps, setSteps] = useState([]);
  const [commandsText, setCommandsText] = useState('');
  const [jxgSteps, setJxgSteps] = useState([]);
  const [engine, setEngine] = useState('jxg');
  const [mode, setMode] = useState('once');
  const [constructInfo, setConstructInfo] = useState({ value: '', note: '' });
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
  const isJxg = engine === 'jxg';

  const runOnce = async () => {
    if (!imageDataUrl && !textInput.trim()) return;
    setAnalyzing(true);
    setStatus('正在识别并生成作图指令…');
    try {
      const result = await analyzeOnce(imageDataUrl, textInput.trim(), undefined, isJxg ? 'jxg' : undefined);
      setRawText(result.rawText || '');
      setCompletedText(result.completedText || result.rawText || '');
      setSteps([]);
      if (isJxg) {
        setJxgSteps(result.jxgSteps || []);
        setCommandsText('');
      } else {
        setCommandsText((result.commands || []).join('\n'));
        setJxgSteps([]);
      }
      setConstructInfo({ value: result.constructibility || '', note: result.constructNote || '' });
      const cons = CONSTRUCT_LABELS[result.constructibility] || '';
      setStatus(
        (result.warnings?.length
          ? `生成完成，${result.warnings.length} 条指令未过校验。`
          : '生成完成。') + (cons ? ` 可构造性：${cons}。` : '')
      );
    } catch (e) {
      setStatus('生成失败：' + (e.message || '未知错误'));
    } finally {
      setAnalyzing(false);
    }
  };

  const runConstruction = async () => {
    if (!problemText) return;
    setConstructing(true);
    setStatus('正在作图分析…');
    try {
      const result = await analyzeConstruction(problemText, undefined, isJxg ? 'jxg' : undefined);
      setSteps(result.steps || []);
      if (isJxg) {
        setJxgSteps(result.jxgSteps || []);
        setCommandsText('');
      } else {
        setCommandsText((result.commands || []).join('\n'));
        setJxgSteps([]);
      }
      setConstructInfo({ value: result.constructibility || '', note: result.constructNote || '' });
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
    if (isJxg ? jxgSteps.length === 0 : !commandsText.trim()) return;
    addProblem({
      name: name.trim() || '未命名题目',
      imageDataUrl,
      ocrText: problemText,
      commands: isJxg ? '' : commandsText,
      engine,
      jxgSteps: isJxg ? jxgSteps : [],
      examType: examType || null,
      examYear: examYear ? Number(examYear) : null,
      examRegion: examRegion.trim() || null,
      difficulty,
      tags: selectedTags,
    });
    window.location.hash = '#/app';
  };

  const busy = analyzing || constructing;
  const canAnalyze = Boolean(imageDataUrl || textInput.trim()) && !busy;
  const canConstruct = Boolean(problemText) && !analyzing && !constructing;
  const canDraw = isJxg ? jxgSteps.length > 0 : Boolean(commandsText.trim());

  return (
    <div className="entry-shell" onPaste={onPaste}>
      <div className="entry-header">
        <a className="entry-back text-muted" href="#/app">&larr; 返回列表</a>
        <span className="entry-title text-ink">新建题目</span>
        <input
          className="entry-name"
          placeholder="题目名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="mode-switch">
          <button
            type="button"
            className={engine === 'jxg' ? 'active' : ''}
            onClick={() => setEngine('jxg')}
            title="使用 JSXGraph 引擎生成 JSON 构造步骤（默认）"
          >
            JSXGraph
          </button>
          <button
            type="button"
            className={engine === 'ggb' ? 'active' : ''}
            onClick={() => setEngine('ggb')}
            title="使用 GeoGebra Geometry 指令"
          >
            GeoGebra
          </button>
          <span className="tool-sep"></span>
          <button
            type="button"
            className={mode === 'once' ? 'active' : ''}
            onClick={() => setMode('once')}
            title="一次调用完成识别、题目补全和作图指令生成（更快）"
          >
            合并一步
          </button>
          <button
            type="button"
            className={mode === 'twice' ? 'active' : ''}
            onClick={() => setMode('twice')}
            title="先识别题目，确认后再单独生成作图指令"
          >
            识别+作图两步
          </button>
        </div>
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

          {mode === 'twice' && (
            <button className="button primary" onClick={runAnalyze} disabled={!canAnalyze}>
              {analyzing ? '识别分析中…' : '识别分析'}
            </button>
          )}
          {mode === 'once' && (
            <button className="button primary" onClick={runOnce} disabled={!canAnalyze}>
              {analyzing ? '识别并生成中…' : '识别并生成指令'}
            </button>
          )}

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

          <label className="entry-label">题目属性</label>
          <div className="attr-row">
            <select
              className="attr-select"
              value={examType}
              onChange={(e) => setExamType(e.target.value)}
              title="来源类型"
            >
              <option value="">来源类型</option>
              {EXAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              className="attr-input attr-year"
              type="number"
              min="1990"
              max="2100"
              placeholder="年份"
              value={examYear}
              onChange={(e) => setExamYear(e.target.value)}
            />
            <input
              className="attr-input"
              type="text"
              placeholder="地区，如福州"
              value={examRegion}
              onChange={(e) => setExamRegion(e.target.value)}
            />
          </div>
          <div className="attr-row attr-difficulty">
            <span className="attr-label">难度</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={'diff-btn' + (difficulty === n ? ' active' : '')}
                title={DIFFICULTY_LABELS[n]}
                onClick={() => setDifficulty(difficulty === n ? null : n)}
              >
                {n}
              </button>
            ))}
            {difficulty != null && <span className="attr-label text-muted">{DIFFICULTY_LABELS[difficulty]}</span>}
          </div>
          <TagPicker vocab={tagVocab} selected={selectedTags} onChange={setSelectedTags} />

          {mode === 'twice' && (
            <button className="button primary" onClick={runConstruction} disabled={!canConstruct}>
              {constructing ? '作图分析中…' : '作图分析'}
            </button>
          )}

          {constructInfo.value && (
            <p className="entry-status">
              可构造性：{CONSTRUCT_LABELS[constructInfo.value] || constructInfo.value}
              {constructInfo.note ? `（${constructInfo.note}）` : ''}
            </p>
          )}
          {status && <p className="entry-status text-muted">{status}</p>}
        </div>

        {/* 右列：作图步骤 + 指令 */}
        <div className="entry-right">
          <div className="entry-steps">
            <label className="entry-label">作图步骤分析</label>
            {steps.length === 0 ? (
              <p className="text-muted entry-placeholder">{mode === 'once' ? '合并一步模式不生成步骤明细' : '作图分析后在此显示构建次序'}</p>
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
            <label className="entry-label">{isJxg ? '构造步骤 JSON' : 'GeoGebra 作图指令'}</label>
            {isJxg ? (
              <textarea
                className="entry-box entry-commands-box"
                value={JSON.stringify(jxgSteps, null, 2)}
                onChange={(e) => {
                  try { setJxgSteps(JSON.parse(e.target.value || '[]')); }
                  catch { /* 编辑中的非法 JSON 暂不生效 */ }
                }}
                placeholder="作图分析后生成 JSON 构造步骤，可手动修改"
                spellCheck={false}
              />
            ) : (
              <textarea
                className="entry-box entry-commands-box"
                value={commandsText}
                onChange={(e) => setCommandsText(e.target.value)}
                placeholder="作图分析后生成，可手动修改"
                spellCheck={false}
              />
            )}
            <button
              className="button primary entry-draw"
              onClick={confirmDraw}
              disabled={!canDraw}
            >
              作图
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
