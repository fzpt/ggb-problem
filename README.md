# GeoGebra 拍照几何题识别

把几何题照片转换成 GeoGebra Geometry 可交互图形。

## 流程

拍照/截图 → **百度 OCR** 识别文字 → 人工检查/编辑 → **Kimi** 解析几何结构 → GeoGebra 指令 → 右侧画布渲染

这是两步流程：先识别题目文字，确认后再生成指令。

## 快速开始

```bash
cd D:\proj\geogebra
node server.js
```

然后启动前端开发服务器：

```bash
cd client
npm install
npm run dev
```

打开 http://localhost:5173

或者用根目录的并发命令同时启动前后端：

```bash
npm install
npm run dev
```

## 测试 Mock 模式

1. 点击或拖拽上传一张照片。
2. 文字识别选择 `Mock（本地示例）`。
3. 点击「识别题目」。
4. 检查识别出的题目文字，可手动修改。
5. 指令生成选择 `Mock（本地示例）`。
6. 点击「生成 GeoGebra 指令」。

Mock 模式无需联网或 API key。

## 使用真实 API

### 1. 百度 OCR

设置环境变量：

```bash
set BAIDU_API_KEY=你的百度 API key
set BAIDU_SECRET_KEY=你的百度 Secret key
set OCR_PROVIDER=baidu
node server.js
```

可选：指定百度 OCR 接口

```bash
set BAIDU_OCR_ENDPOINT=accurate_basic
```

可选接口：`general_basic`（通用）、`accurate_basic`（通用高精度）、`webimage`（网络图片）等。

### 2. Kimi（Moonshot AI）

设置环境变量：

```bash
set KIMI_API_KEY=你的 Kimi API key
set LLM_PROVIDER=kimi
node server.js
```

可选：指定模型

```bash
set KIMI_MODEL=kimi-k2.7-code
```

## 项目结构

- `server.js` — Node 内置 http 服务，提供 `/api/ocr`、`/api/extract`、`/api/refine`、`/api/cancel`。
- `providers/` — 可插拔 provider。
  - `mock.js` — 本地示例，无需 API。
  - `baidu.js` — 百度 OCR，图片 → 文字。
  - `kimi.js` — Kimi，文字 → 几何结构/指令。
  - `openai.js` — 保留的视觉识别（可选）。
- `lib/generate.js` — 把结构化几何 JSON 转成 GeoGebra 命令。
- `client/` — React + Vite 前端。
  - `src/App.jsx` — 页面布局。
  - `src/components/UploadCard.jsx` — 左侧：上传 / OCR / 题目文字 / 持续改进 Tab。
  - `src/components/EditorCard.jsx` — 右上：Construction Script 编辑器。
  - `src/components/GeoGebraViewer.jsx` — 右下：GeoGebra Geometry 画布。
  - `src/store/AppContext.jsx` — 全局状态。
  - `src/services/api.js` — 后端 API 封装。
- `test-generate.js` — 测试命令生成器。
- `test-extract.js` — 测试 `/api/extract` 端点。

## 两步 API

### `/api/ocr` — 图片 → 文字

```json
{
  "image": "data:image/png;base64,...",
  "provider": "baidu"
}
```

返回：

```json
{
  "provider": "baidu",
  "text": "在三角形 ABC 中..."
}
```

### `/api/extract` — 文字 → GeoGebra 指令

```json
{
  "text": "在三角形 ABC 中...",
  "provider": "kimi"
}
```

返回：

```json
{
  "provider": "kimi",
  "text": "...",
  "geometry": { ... },
  "assumptions": [...],
  "commands": ["A = (0, 0)", "Segment(A, B)", ...]
}
```

### `/api/refine` — 持续改进指令

```json
{
  "text": "在三角形 ABC 中...",
  "currentCommands": "A = (0, 0)\n...",
  "history": [{"role": "user", "text": "把 A 点往左移"}],
  "instruction": "把 B 点往右移",
  "provider": "kimi"
}
```

返回：

```json
{
  "provider": "kimi",
  "commands": ["A = (0, 0)", "Segment(A, B)", ...]
}
```

## 扩展更多模型

在 `providers/index.js` 中注册新 provider，实现对应接口：

- 图片 → 文字：`extractText(base64, options)`
- 文字 → 几何 JSON：`extractFromText(text, options)`
- 改进指令：`refineFromText(text, currentCommands, history, options)`

## 注意事项

- 当前坐标在题目未给出时采用默认定位（第一个点放原点，底边放 x 轴）。
- 复杂约束（垂直、平行、等长、相切等）目前以注释形式保留，后续会转成 GeoGebra 构造命令。
- `.env` 文件包含 API key，不会被提交到 Git。