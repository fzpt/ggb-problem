export default function HomeEntry() {
  return (
    <div className="home-entry">
      <h1 className="home-title text-ink">几何工具</h1>
      <div className="home-cards">
        <a className="home-card" href="#/app">
          <h2 className="text-ink">题目生成图形</h2>
          <p className="text-muted">
            拍照或输入几何题，识别题目文字，由 AI 生成 GeoGebra 指令并绘制可交互的几何图，支持会话调整。
          </p>
          <span className="home-card-link">进入 &rarr;</span>
        </a>
        <a className="home-card" href="#/console">
          <h2 className="text-ink">指令控制台</h2>
          <p className="text-muted">
            直接输入 GeoGebra Geometry 指令，点击执行即可实时绘制几何图形，适合调试指令或手工构图。
          </p>
          <span className="home-card-link">进入 &rarr;</span>
        </a>
      </div>
    </div>
  );
}
