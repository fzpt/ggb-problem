import { useApp } from '../store/AppContext';

const EXAMPLES = {
  triangle: `// 三角形与外接圆\nA = (0, 0)\nB = (5, 0)\nC = (1.6, 3.2)\nPolygon(A, B, C)\nSegment(A, B)\nSegment(B, C)\nSegment(C, A)\nl = PerpendicularBisector(A, B)\nm = PerpendicularBisector(B, C)\nO = Intersect(l, m)\nCircle(O, A)`,
  circle: `// 圆与一条切线\nO = (0, 0)\nA = (3, 0)\nc = Circle(O, A)\nP = (6, 4)\nTangent(P, c)\nSegment(O, A)\nSegment(O, P)`,
  parabola: `// 抛物线、焦点与准线\nF = (0, 1)\nd: y = -1\np = Parabola(F, d)\nA = (-3, 0)\nB = (3, 0)\nLine(A, B)`,
};

export default function EditorCard() {
  const { commands, setCommands, log, setLog } = useApp();

  const lineCount = commands
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//')).length;

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

  return (
    <article className="card flex flex-col min-h-[300px]">
      <div className="card-head">
        <div className="label-row">
          <span className="font-bold text-ink">Construction Script</span>
          <span className="text-sm text-muted">{lineCount} 条指令</span>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={() => loadExample('triangle')}>三角形</button>
          <button onClick={() => loadExample('circle')}>圆与切线</button>
          <button onClick={() => loadExample('parabola')}>抛物线</button>
        </div>
      </div>
      <textarea
        value={commands}
        onChange={e => setCommands(e.target.value)}
        className="flex-1 min-h-[200px] p-6 bg-transparent font-mono text-base leading-relaxed resize-none outline-none"
        spellCheck={false}
        placeholder="在此输入 GeoGebra 指令..."
      />
      <div className="editor-foot">
        <div className="actions">
          <button onClick={() => setCommands('')}>清空画布</button>
          <button onClick={copy}>复制指令</button>
        </div>
        <p className="hint">
          写法示例：<code>A=(0,0)</code>、<code>Segment(A,B)</code>、<code>Circle(A,2)</code>。空行和以 <code>//</code> 开头的注释会被忽略。
        </p>
        {log && <div className="log">{log}</div>}
      </div>
    </article>
  );
}
