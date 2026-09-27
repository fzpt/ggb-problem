// 最小提示词测试：Kimi 识别图片 -> 直接输出题目 + GeoGebra 指令，测耗时。
// 不加白名单/约束式构造等额外约束，用于和完整提示词流程对比。
// 用法：node scripts/kimi-direct-test.js [--image PATH] [--model kimi-k2.6] [--runs N]
// 每次运行生成 scripts/kimi-direct-<ts>.html，浏览器打开即可查看图形效果。
const fs = require('node:fs');
const path = require('node:path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const kimiProvider = require('../providers/kimi');

const DEFAULT_IMAGE = path.join(__dirname, '..', 'f9eaf08f-3853-4700-ac8b-990b3779be7f.png');

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
- 线段与其他直线或曲线求交点时：必须用辅助直线代替线段求交（lineAB = Line(A, B)；P = Intersect(lineAB, 另一对象)），不要与线段求交（交点落在线段延长线上时会失败）；得到交点后，必须把交点与线段两个端点分别连线 Segment(A, P)、Segment(P, B)，使交点在线段上可见；辅助直线按上面的隐藏规则处理`;
const MINIMAL_USER = '识别这道题并生成作图指令。';

function parseArgs() {
  const args = { image: DEFAULT_IMAGE, model: 'kimi-k2.6', runs: 1, text: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--image') args.image = argv[++i];
    else if (argv[i] === '--model') args.model = argv[++i];
    else if (argv[i] === '--runs') args.runs = Number(argv[++i]) || 1;
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
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Kimi 直接生成 - 效果查看</title>
<script src="https://www.geogebra.org/apps/deployggb.js"></script>
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
img{max-width:100%;border:1px solid #ccc;border-radius:4px}
.copy-btn{margin-top:6px;padding:4px 10px;font-size:12px;border:1px solid #999;border-radius:4px;background:#fff;cursor:pointer}
</style>
</head>
<body>
<h1>Kimi 直接生成：题目 + 作图指令（无额外约束）</h1>
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
    <button class="copy-btn" onclick="copyCommands()">复制指令（可直接粘贴到指令控制台）</button>
    <div id="errs"></div>
  </div>
  <div class="right">
    <div id="ggb-wrap"></div>
  </div>
</div>
<script>
var commands = ${JSON.stringify(commands)};
function copyCommands() {
  var text = commands.join('\\n');
  var done = function () {
    var b = document.querySelector('.copy-btn');
    b.textContent = '已复制，可粘贴到指令控制台';
    setTimeout(function () { b.textContent = '复制指令（可直接粘贴到指令控制台）'; }, 2000);
  };
  var fallback = function () {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch (e) {
      window.prompt('自动复制失败，请手动复制：', text);
    }
    document.body.removeChild(ta);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  } else {
    fallback();
  }
}
var params = {
  appName: 'geometry',
  width: window.innerWidth - 420,
  height: 640,
  showToolBar: false,
  showAlgebraInput: false,
  showMenuBar: false,
  appletOnLoad: function (api) {
    var errs = [];
    commands.forEach(function (c) {
      try {
        if (!api.evalCommand(c)) errs.push(c + '  -> 返回 false');
      } catch (e) {
        errs.push(c + '  -> ' + e.message);
      }
    });
    if (errs.length) {
      document.getElementById('errs').textContent = '执行失败的指令：\n' + errs.join('\n');
    }
  }
};
new GGBApplet(params, true).inject('ggb-wrap');
</script>
</body>
</html>`;
  fs.writeFileSync(outPath, html);
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

  const results = [];
  for (let i = 1; i <= args.runs; i++) {
    const t = Date.now();
    console.log(`[run ${i}/${args.runs}] calling ${args.model} ...`);
    try {
      const r = await kimiProvider.chatCompletionDetailed(messages, {
        model: args.model,
        taskType: 'vision',
        userId: 'kimi-direct-test',
      });
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
      console.log(`  FAIL ${((Date.now() - t) / 1000).toFixed(1)}s: ${e.message}`);
      results.push({ ok: false, wallMs: Date.now() - t, error: e.message });
    }
  }

  console.log('\n===== SUMMARY =====');
  const ok = results.filter((r) => r.ok);
  for (const r of results) {
    console.log(`  ${r.ok ? 'ok' : 'FAIL'} ${(r.wallMs / 1000).toFixed(1)}s ${r.usage ? 'total=' + r.usage.total_tokens : r.error || ''}`);
  }
  if (ok.length) {
    const avg = ok.reduce((a, r) => a + r.wallMs, 0) / ok.length;
    const avgTok = ok.reduce((a, r) => a + (r.usage ? r.usage.total_tokens : 0), 0) / ok.length;
    console.log(`  avg wall ${(avg / 1000).toFixed(1)}s, avg total tokens ${Math.round(avgTok)}`);
  }

  const best = ok[ok.length - 1] || null;
  if (best) {
    const outPath = path.join(__dirname, `kimi-direct-${Date.now()}.html`);
    writeViewer({
      outPath,
      model: args.model,
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
    console.log('viewer written to', outPath);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
