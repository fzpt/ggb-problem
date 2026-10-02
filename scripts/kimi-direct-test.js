// 最小提示词测试：LLM 识别图片 -> 直接输出题目 + GeoGebra 指令，测耗时。
// 不加白名单/约束式构造等额外约束，用于和完整提示词流程对比。
// 支持的平台/模型：
//   - SiliconFlow（api.siliconflow.cn，模型 id 带 '/' 自动路由）：
//       --model Qwen/Qwen3.8-27B
//       --model moonshotai/Kimi-K2.7-Code
//   - Kimi 官方平台（api.moonshot.cn，需显式指定）：--model kimi-k2.6 / kimi-k2.7-code ...
//   - --all：SiliconFlow 两个模型各跑一遍并输出对比汇总
// 用法：node scripts/kimi-direct-test.js [--image PATH] [--model ID] [--runs N] [--all] [--text 题目文字]
// 需要 .env 里配置 KIMI_API_KEY 和 SILICONFLOW_API_KEY。
// 每次运行生成 scripts/kimi-direct-<ts>.html，浏览器打开即可查看图形效果。
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const kimiProvider = require('../providers/kimi');

const DEFAULT_IMAGE = path.join(__dirname, '..', 'f9eaf08f-3853-4700-ac8b-990b3779be7f.png');
const SILICONFLOW_URL = 'https://api.siliconflow.cn/v1/chat/completions';
// --all 时依次测试的模型清单（SiliconFlow 两个）
const ALL_MODELS = [
  { id: 'Qwen/Qwen3.8-27B', label: 'SiliconFlow Qwen3.8-27B' },
  { id: 'moonshotai/Kimi-K2.7-Code', label: 'SiliconFlow Kimi-K2.7-Code' },
];

// SiliconFlow：OpenAI 兼容接口（非流式），返回结构与 chatCompletionDetailed 对齐
async function callSiliconFlow(messages, model) {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    throw new Error('SILICONFLOW_API_KEY 未配置（请在 .env 中加入 SILICONFLOW_API_KEY=sk-...）');
  }
  // 不用全局 fetch：undici 默认 headersTimeout 300s，硅基流动拥堵时首包常超 5 分钟。
  // 原生 https 手动设置 10 分钟超时。
  const data = await new Promise((resolve, reject) => {
    const req = https.request(
      SILICONFLOW_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 600000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          let parsed;
          try { parsed = JSON.parse(body); } catch { parsed = {}; }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const msg = parsed.message || (parsed.error && parsed.error.message) || body.slice(0, 200);
            const err = new Error(`SiliconFlow ${res.statusCode}: ${msg}`);
            err.status = res.statusCode;
            reject(err);
          } else {
            resolve(parsed);
          }
        });
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('SiliconFlow request timeout (600s)')));
    req.on('error', reject);
    req.write(JSON.stringify({ model, messages, stream: false }));
    req.end();
  });
  const content = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  return { content, providerCallId: data.id || null, usage: data.usage || null };
}

// fetch 的 TypeError('fetch failed') 不带细节，把底层 cause（ECONNRESET/超时等）提出来
function netErrorDetail(e) {
  const c = e && e.cause;
  if (!c) return e && e.message;
  return `${e.message} (${c.code || ''} ${c.message || ''})`.trim();
}

// 网络层偶发断连（ECONNRESET/ETIMEDOUT/fetch failed）值得自动重试一次，
// 4xx/5xx 等业务错误不重试
function isTransientNetError(detail) {
  return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|fetch failed/i.test(String(detail || ''));
}

// 模型 id 带 '/' 视为 SiliconFlow 模型，否则走 Kimi 官方平台
function routeCall(messages, model) {
  if (model.includes('/')) {
    return callSiliconFlow(messages, model);
  }
  return kimiProvider.chatCompletionDetailed(messages, {
    model,
    taskType: 'vision',
    userId: 'kimi-direct-test',
  });
}

// 提示词：JSON 输出 + 可构造性三分类 + 从动点约束定位/隐藏辅助元素 + 高频陷阱
const MINIMAL_SYSTEM = `读取图片或文字中的几何题，输出一个 JSON 对象：
{"rawText":"识别出的题目原文","completedText":"补全点所属线段后的完整题目","constructibility":"direct | conclusion | impossible","constructNote":"constructibility 为 conclusion 时的说明，其他情况为空字符串","commands":["GeoGebra Geometry 作图指令，每行一条"]}。
只输出 JSON，不要输出其他内容。

只做作图，不要证明、验证或解答题目。

作图前必须先判断能否通过作图方式完成，constructibility 取值：
- direct：可以直接按题意作图
- conclusion：直接作图困难，需要把题目结论（或部分结论）当作已知条件来定位点
- impossible：无法用 GeoGebra Geometry 作图
constructibility 为 conclusion 时，必须在 constructNote 中说明把哪个结论当作了条件。

判断构造困难或陷入长推理时，果断选择 conclusion（把结论当条件定位点），优先保证图形能画出来、指令全部可执行；不要在 direct 构造上过度纠结或反复尝试复杂作法。

题目文字处理：completedText 中如果出现"如图""如图所示"等引用图片的字样，必须去掉。

作图要求：
- 确定题目中的自由点和从动点；从动点必须用几何关系（公式/约束）定位，不能写死数值坐标。条件复杂时，可以把结论当作条件进行点的定位。
- 作图过程增加的辅助元素（辅助线、辅助圆等）最后都要用 SetVisibleInView(名称, 1, false) 隐藏。

GeoGebra Geometry 应用的实测限制（必须遵守）：
- 画平行线用 Line(点, 已有的线)，没有 Parallel 命令
- 外接圆用 Circle(A, B, C)，没有 Circumcircle 命令
- 中垂线用 PerpendicularBisector，垂线用 PerpendicularLine
- 圆弧命令名是 CircularArc，不是 CircleArc
- Polyline 是一个词，不是 PolyLine
- 过点向线段作垂线求垂足时：垂足必须用辅助直线求交（lineAB = Line(A,B)；H = Intersect(PerpendicularLine(P, lineAB), lineAB)），不要和线段求交（垂足在线段外时线段求交会失败）；辅助直线按上面的隐藏规则处理
- 线段与其他直线或曲线求交点时：必须用辅助直线代替线段求交（lineAB = Line(A, B)；P = Intersect(lineAB, 另一对象)），不要与线段求交（交点落在线段延长线上时会失败）；得到交点后，必须把交点与线段两个端点分别连线 Segment(A, P)、Segment(P, B)，使交点在线段上可见；辅助直线按上面的隐藏规则处理
- 直线与圆（或曲线）有两个交点时，禁止把 Q = Intersect(直线, 圆) 直接赋给单个点变量（会得到交点列表，后续 Line(P, Q) 等使用会报错）。按以下优先级处理：1）已知附近参考点时用三参数取最近交点：Q = Intersect(lineMQ, circPBC, 参考点)；2）交点有方向性约束（如"在射线 MQ 方向上"）时，改用射线求交：rayMQ = Ray(M, Q候选方向点)；Q = Intersect(rayMQ, circPBC)（射线与圆只有一个有效交点）；3）必须按位置从两个交点取舍时，用序号取点 Intersect(lineMQ, circPBC, 1) 或 (2)，并在步骤说明中写明位置判断依据（离哪个点近/在哪一侧）
- 自由点必须用坐标定义，如 A = (0, 0)；禁止用无参的 Point()（在 Geometry 应用中执行失败，会导致后续所有引用它的指令连锁失败）
- 点的对称用 Reflect(D, A)，没有 Reflected 命令`;
const MINIMAL_USER = '识别这道题并生成作图指令。';

function parseArgs() {
  const args = { image: DEFAULT_IMAGE, model: 'kimi-k2.6', runs: 1, text: null, all: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--image') args.image = argv[++i];
    else if (argv[i] === '--model') args.model = argv[++i];
    else if (argv[i] === '--runs') args.runs = Number(argv[++i]) || 1;
    else if (argv[i] === '--all') args.all = true;
    else if (argv[i] === '--text') args.text = argv[++i];
  }
  return args;
}

function parseJson(content) {
  let s = (content || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function writeViewer({ outPath, model, wallMs, usage, providerCallId, rawText, completedText, constructibility, constructNote, commands, imageDataUrl }) {
  const consLabel = { direct: '可以直接作图', conclusion: '结论当作条件', impossible: '无法作图' }[constructibility] || constructibility || '-';
  const modelLabel = model.includes('/') ? `SiliconFlow ${model}` : `Kimi 官方 ${model}`;
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(modelLabel)} - 直接生成效果查看</title>
<script src="ggb/deployggb.js"></script>
<style>
body{font-family:system-ui,'Segoe UI',sans-serif;margin:16px;color:#1a1a1a;font-size:14px}
h1{font-size:16px}
.meta{color:#666;font-size:12px;margin-bottom:8px}
.layout{display:flex;gap:12px;align-items:flex-start}
.left{width:360px;flex:none}
.right{flex:1;min-width:0}
label{display:block;font-weight:600;margin:8px 0 4px;font-size:13px}
pre{white-space:pre-wrap;border:1px solid #ccc;border-radius:4px;padding:8px;font-size:12.5px;max-height:200px;overflow:auto;margin:0}
#ggb-wrap{border:1px solid #ccc;border-radius:4px}
#errs{color:#a00;font-size:12px;margin-top:6px;white-space:pre-wrap}
#exec-result{font-size:12px;margin-top:4px;white-space:pre-wrap}
#exec-input{width:100%;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;padding:6px;font-size:12.5px;font-family:ui-monospace,Consolas,monospace}
img{max-width:100%;border:1px solid #ccc;border-radius:4px}
.copy-btn{margin-top:6px;padding:4px 10px;font-size:12px;border:1px solid #999;border-radius:4px;background:#fff;cursor:pointer}
</style>
</head>
<body>
<h1>${esc(modelLabel)}：题目 + 作图指令（同一提示词）</h1>
<p class="meta">模型 ${esc(model)} ｜ 耗时 ${(wallMs / 1000).toFixed(1)}s ｜ prompt ${usage ? usage.prompt_tokens : '-'} / completion ${usage ? usage.completion_tokens : '-'} / total ${usage ? usage.total_tokens : '-'} tokens ｜ 可构造性：${esc(consLabel)} ｜ providerCallId ${esc(providerCallId || '-')} ｜ ${new Date().toISOString()}</p>
<div class="layout">
  <div class="left">
    ${imageDataUrl ? `<label>原图</label><img src="${imageDataUrl}" alt="题目图片">` : ''}
    ${constructNote ? `<label>结论当作条件的说明</label><pre>${esc(constructNote)}</pre>` : ''}
    <label>原始识别文字</label>
    <pre>${esc(rawText || '')}</pre>
    <label>完善后题目</label>
    <pre>${esc(completedText || '')}</pre>
    <label>作图指令（${commands.length} 条）</label>
    <pre>${esc(commands.join('\n'))}</pre>
    <button id="copy-btn" class="copy-btn" onclick="copyCommands()">复制指令（可直接粘贴到指令控制台）</button>
    <label>追加执行指令</label>
    <textarea id="exec-input" rows="3" placeholder="GeoGebra 指令，每行一条，例如 Z = (1, 1)、Segment(A, B)；执行后立即在右侧图形生效"></textarea>
    <button class="copy-btn" onclick="execMore()">执行指令</button>
    <div id="exec-result"></div>
    <div id="errs"></div>
  </div>
  <div class="right">
    <div id="ggb-wrap"></div>
  </div>
</div>
<script>
var commands = ${JSON.stringify(commands)};
var ggbApi = null;
// SetVisibleInView 在 Geometry 应用的 evalCommand 下必返回 false（实测各 view 参数均无效），
// 隐藏必须走 JS API setVisible；这里统一拦截翻译
var SVIV_RE = /^(?:[\\w\\u0370-\\u03ff]+\\s*=\\s*)?SetVisibleInView\\(\\s*([^,]+?)\\s*,\\s*\\d+\\s*,\\s*(true|false)\\s*\\)$/i;
var SHOWAXES_RE = /^ShowAxes\\(\\s*(true|false)\\s*\\)$/i;
var SHOWGRID_RE = /^ShowGrid\\(\\s*(true|false)\\s*\\)$/i;
function runCmd(api, c) {
  var m = c.match(SVIV_RE);
  if (m) { api.setVisible(m[1], m[2] === 'true'); return true; }
  m = c.match(SHOWAXES_RE);
  if (m) { var v = m[1] === 'true'; if (api.setAxesVisible) { api.setAxesVisible(v, v); return true; } return false; }
  m = c.match(SHOWGRID_RE);
  if (m) { if (api.setGridVisible) { api.setGridVisible(m[1] === 'true'); return true; } return false; }
  return api.evalCommand(c);
}
function copyCommands() {
  var text = commands.join('\\n');
  var b = document.getElementById('copy-btn');
  var done = function (msg) {
    b.textContent = msg;
    setTimeout(function () { b.textContent = '复制指令（可直接粘贴到指令控制台）'; }, 2500);
  };
  // 首选 clipboard API（https/localhost 下可用）；file:// 下走 execCommand 兜底
  var legacy = function () {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (ok) { done('已复制，可粘贴到指令控制台'); }
    else { done('复制失败：请手动选择上方指令，Ctrl+C 复制'); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      done('已复制，可粘贴到指令控制台');
    }).catch(legacy);
  } else { legacy(); }
}
// 在已生成的图上追加执行指令，立即看到效果
function execMore() {
  var ta = document.getElementById('exec-input');
  var out = document.getElementById('exec-result');
  if (!ggbApi) { out.textContent = 'GeoGebra 尚未加载完成，请稍候。'; out.style.color = '#a00'; return; }
  var lines = ta.value.split(/\\r?\\n/).map(function (s) { return s.trim(); }).filter(function (s) { return s && !s.startsWith('//'); });
  var errs = [], ok = 0;
  lines.forEach(function (c) {
    try { if (runCmd(ggbApi, c)) { ok++; } else { errs.push(c + '  -> 返回 false'); } }
    catch (e) { errs.push(c + '  -> ' + e.message); }
  });
  out.style.color = errs.length ? '#a00' : '#060';
  out.textContent = '执行完成：' + ok + ' 条成功' + (errs.length ? '\\n失败：\\n' + errs.join('\\n') : '');
}
var params = {
  appName: 'geometry',
  width: window.innerWidth - 420,
  height: 640,
  showToolBar: false,
  showAlgebraInput: false,
  showMenuBar: false,
  appletOnLoad: function (api) {
    ggbApi = api;
    var errs = [];
    commands.forEach(function (c) {
      try {
        if (!runCmd(api, c)) errs.push(c + '  -> 返回 false');
      } catch (e) {
        errs.push(c + '  -> ' + e.message);
      }
    });
    if (errs.length) {
      document.getElementById('errs').textContent = '执行失败的指令：\\n' + errs.join('\\n');
    }
  }
};
var __applet = new GGBApplet(params, true);
if (__applet.setHTML5Codebase) __applet.setHTML5Codebase('ggb/web3d/');
__applet.inject('ggb-wrap');
</script>
</body>
</html>`;
  fs.writeFileSync(outPath, html);
}

// 对单个模型跑 runs 轮，返回结果数组（每项含 wallMs/usage/commands 或 error）
async function runModel(model, messages, runs) {
  const results = [];
  for (let i = 1; i <= runs; i++) {
    const t = Date.now();
    console.log(`[${model} run ${i}/${runs}] calling ...`);
    try {
      const r = await routeCall(messages, model);
      const wallMs = Date.now() - t;
      let parsed;
      try {
        parsed = parseJson(r.content);
      } catch (e) {
        console.log(`  JSON parse failed: ${e.message}; content head: ${(r.content || '').slice(0, 120)}`);
        results.push({ ok: false, wallMs, error: e.message });
        continue;
      }
      const commands = Array.isArray(parsed.commands) ? parsed.commands : [];
      console.log(`  OK ${(wallMs / 1000).toFixed(1)}s total=${r.usage ? r.usage.total_tokens : '?'} tokens, ${commands.length} commands`);
      results.push({
        ok: true,
        wallMs,
        usage: r.usage,
        providerCallId: r.providerCallId,
        rawText: parsed.rawText || '',
        completedText: parsed.completedText || '',
        constructibility: parsed.constructibility || '',
        constructNote: parsed.constructNote || '',
        commands,
      });
    } catch (e) {
      const detail = netErrorDetail(e);
      console.log(`  FAIL ${((Date.now() - t) / 1000).toFixed(1)}s: ${detail}`);
      results.push({ ok: false, wallMs: Date.now() - t, error: detail });
      if (isTransientNetError(detail)) {
        console.log('  transient network error, retrying once in 5s ...');
        await new Promise((res) => setTimeout(res, 5000));
        const t2 = Date.now();
        try {
          const r2 = await routeCall(messages, model);
          const wallMs2 = Date.now() - t2;
          const parsed2 = parseJson(r2.content);
          const commands2 = Array.isArray(parsed2.commands) ? parsed2.commands : [];
          console.log(`  retry OK ${(wallMs2 / 1000).toFixed(1)}s total=${r2.usage ? r2.usage.total_tokens : '?'} tokens, ${commands2.length} commands`);
          results.push({
            ok: true,
            wallMs: wallMs2,
            usage: r2.usage,
            providerCallId: r2.providerCallId,
            rawText: parsed2.rawText || '',
            completedText: parsed2.completedText || '',
            constructibility: parsed2.constructibility || '',
            constructNote: parsed2.constructNote || '',
            commands: commands2,
            retried: true,
          });
        } catch (e2) {
          const detail2 = netErrorDetail(e2);
          console.log(`  retry FAIL: ${detail2}`);
          results.push({ ok: false, wallMs: Date.now() - t2, error: 'retry: ' + detail2 });
        }
      }
    }
  }
  return results;
}

function summarize(model, results) {
  console.log(`\n===== ${model} =====`);
  const ok = results.filter((r) => r.ok);
  for (const r of results) {
    console.log(`  ${r.ok ? 'ok' : 'FAIL'} ${(r.wallMs / 1000).toFixed(1)}s ${r.usage ? 'total=' + r.usage.total_tokens : r.error || ''}`);
  }
  if (ok.length) {
    const avg = ok.reduce((a, r) => a + r.wallMs, 0) / ok.length;
    const avgTok = ok.reduce((a, r) => a + (r.usage ? r.usage.total_tokens : 0), 0) / ok.length;
    console.log(`  avg wall ${(avg / 1000).toFixed(1)}s, avg total tokens ${Math.round(avgTok)}`);
  }
}

async function main() {
  const args = parseArgs();
  let imageDataUrl = null;
  let userContent;
  if (args.text) {
    userContent = '题目：\n' + args.text + '\n\n识别补全并生成作图指令。';
  } else {
    if (!fs.existsSync(args.image)) {
      console.error('image not found:', args.image);
      process.exit(1);
    }
    const base64 = fs.readFileSync(args.image).toString('base64');
    imageDataUrl = `data:image/png;base64,${base64}`;
    userContent = [
      { type: 'image_url', image_url: { url: imageDataUrl } },
      { type: 'text', text: MINIMAL_USER },
    ];
  }
  const messages = [
    { role: 'system', content: MINIMAL_SYSTEM },
    { role: 'user', content: userContent },
  ];

  const models = args.all ? ALL_MODELS.map((m) => m.id) : [args.model];
  const allReports = [];
  for (const model of models) {
    const results = await runModel(model, messages, args.runs);
    summarize(model, results);
    const ok = results.filter((r) => r.ok);
    const best = ok[ok.length - 1] || null;
    let viewerPath = null;
    if (best) {
      const safe = model.replace(/[^\w.-]+/g, '_');
      viewerPath = path.join(__dirname, `kimi-direct-${safe}-${Date.now()}.html`);
      writeViewer({
        outPath: viewerPath,
        model,
        wallMs: best.wallMs,
        usage: best.usage,
        providerCallId: best.providerCallId,
        rawText: best.rawText,
        completedText: best.completedText,
        constructibility: best.constructibility,
        constructNote: best.constructNote,
        commands: best.commands,
        imageDataUrl,
      });
      console.log('  viewer written to', viewerPath);
    }
    allReports.push({ model, results, viewerPath });
  }

  // --all：跨模型对比汇总
  if (args.all) {
    console.log('\n===== CROSS-MODEL SUMMARY =====');
    for (const rep of allReports) {
      const ok = rep.results.filter((r) => r.ok);
      if (ok.length) {
        const avg = ok.reduce((a, r) => a + r.wallMs, 0) / ok.length;
        const avgTok = ok.reduce((a, r) => a + (r.usage ? r.usage.total_tokens : 0), 0) / ok.length;
        const cons = ok[ok.length - 1].constructibility || '-';
        console.log(`  ${rep.model.padEnd(28)} ok=${ok.length}/${rep.results.length} avg ${(avg / 1000).toFixed(1)}s avg ${Math.round(avgTok)} tok cons=${cons}`);
      } else {
        console.log(`  ${rep.model.padEnd(28)} all failed: ${rep.results[0] ? rep.results[0].error : ''}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
