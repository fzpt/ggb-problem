import { useApp } from '../store/AppContext';

export default function Header() {
  const { status } = useApp();
  return (
    <section className="hero" aria-label="页面标题">
      <div>
        <p className="eyebrow">GeoGebra Geometry Console</p>
        <h1>用文本指令，现场生成几何图形。</h1>
      </div>
      <div>
        <p>
          在左侧写入 GeoGebra 指令，每行一条；页面会自动清空并重建右端 Geometry 画布。
          适合把构造步骤、教学脚本或练习题快速变成可视图形。
        </p>
        <div className="status-pill">
          <span className="dot" style={{ background: status.color, boxShadow: `0 0 0 5px ${status.color}26` }} />
          <span>{status.text}</span>
        </div>
      </div>
    </section>
  );
}
