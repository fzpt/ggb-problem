// 一次性对比测试：现有"识别 + 作图分析"两次调用流程 vs 合并为一次调用。
// 用法：node scripts/compare-analysis.js [--rounds-glm N] [--rounds-kimi N] [--image PATH]
// 严格串行执行（Kimi 组织并发=1）。报告写入 scripts/compare-report-<ts>.json。
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns');
const net = require('node:net');

// 加载 .env（与 server.js 相同的简易逻辑）
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const kimiProvider = require('../providers/kimi');
const ggb = require('../lib/ggb-commands');
const { SYSTEM_PROMPT_IMAGE_ANALYZE, SYSTEM_PROMPT_CONSTRUCTION } = kimiProvider;

const DEFAULT_IMAGE = path.join(__dirname, '..', 'f9eaf08f-3853-4700-ac8b-990b3779be7f.png');

// 合并一次调用的实验提示词：识别 + 补全 + 作图分析一把出
const SYSTEM_PROMPT_ONESHOT = `You are a GeoGebra Geometry problem pipeline, NEVER prove, verify, or solve the problem. Given a photo of a Chinese geometry problem (or plain text), do ALL of the following in ONE response: recognize the text, complete the problem statement, and plan the GeoGebra Geometry construction. Output a single valid JSON object with exactly four fields:

{
  "rawText": "the literal text recognized from the image, transcribed as-is",
  "completedText": "the problem statement rewritten to be self-contained and complete, with each named point's segment/line membership spelled out",
  "steps": [
    {"order": 1, "object": "A", "type": "point", "dependencies": "无", "constraint": "free point at origin"}
  ],
  "commands": [
    "A = (0, 0)",
    "Segment(A, B)"
  ]
}

Rules:
1. Output ONLY valid JSON. No markdown fences. No explanations.
2. Do NOT prove, verify, or solve the problem. Construction only.
3. completedText keeps the original meaning; fill in missing implicit information (which segments/lines each point belongs to).
4. Build objects with geometric CONSTRAINTS (Intersect, Circle, PerpendicularBisector, Rotate, etc.), never computed numeric coordinates for derived points.
5. Hide intermediate construction artifacts where possible; the commands must render the final figure.
6. ONLY use GeoGebra Geometry commands from this verified reference:
${ggb.referenceText()}
7. Verify every command against the allowed list before outputting; replace or omit anything not in the list.`;

function parseArgs() {
  const args = { roundsGlm: 5, roundsKimi: 2, image: DEFAULT_IMAGE };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rounds-glm') args.roundsGlm = Number(argv[++i]) || 0;
    else if (argv[i] === '--rounds-kimi') args.roundsKimi = Number(argv[++i]) || 0;
    else if (argv[i] === '--image') args.image = argv[++i];
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

function correctionFeedback(invalid) {
  const lines = invalid.map((x) => `- ${x.item}: ${x.reason}`).join('\n');
  return `Some commands are invalid:\n${lines}\nReturn the FULL corrected JSON object with the same schema. Only use allowed GeoGebra Geometry commands.`;
}

async function timedCall(messages, model, taskType, userId) {
  const startedAt = Date.now();
  try {
    const r = await kimiProvider.chatCompletionDetailed(messages, { model, taskType, userId });
    return {
      ok: true,
      content: r.content,
      wallMs: Date.now() - startedAt,
      usage: r.usage || null,
      providerCallId: r.providerCallId || null,
      callId: r.callId,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      wallMs: Date.now() - startedAt,
      usage: null,
      providerCallId: err.providerCallId || null,
    };
  }
}

// 臂 A：生产同款两步流程（含白名单校验失败后的纠正重试，与线上一致）
async function runArmA(model, imageUrl, userId) {
  const calls = [];
  const m1 = [
    { role: 'system', content: SYSTEM_PROMPT_IMAGE_ANALYZE },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: 'Recognize and complete this geometry problem. Output only the JSON object.' },
      ],
    },
  ];
  const c1 = await timedCall(m1, model, 'vision', userId);
  calls.push(c1);
  if (!c1.ok) return { calls, jsonOk: false, error: c1.error };
  let parsed;
  try {
    parsed = parseJson(c1.content);
  } catch (e) {
    return { calls, jsonOk: false, error: 'armA call1 JSON parse failed: ' + e.message };
  }
  const completedText = parsed.completedText || parsed.rawText || '';

  const m2 = [
    { role: 'system', content: SYSTEM_PROMPT_CONSTRUCTION },
    { role: 'user', content: `Analyze the construction of this geometry problem and produce the construction plan and GeoGebra commands:\n\n${completedText}` },
  ];
  let c2 = await timedCall(m2, model, 'text', userId);
  calls.push(c2);
  if (!c2.ok) return { calls, jsonOk: false, error: c2.error };
  let p2;
  try {
    p2 = parseJson(c2.content);
  } catch (e) {
    return { calls, jsonOk: false, error: 'armA call2 JSON parse failed: ' + e.message };
  }
  let validation = ggb.validateCommands(p2.commands);
  if (validation.invalid.length > 0) {
    m2.push({ role: 'assistant', content: c2.content });
    m2.push({ role: 'user', content: correctionFeedback(validation.invalid) });
    c2 = await timedCall(m2, model, 'text', userId);
    calls.push(c2);
    if (!c2.ok) return { calls, jsonOk: false, error: c2.error };
    try {
      p2 = parseJson(c2.content);
    } catch (e) {
      return { calls, jsonOk: false, error: 'armA retry JSON parse failed: ' + e.message };
    }
    validation = ggb.validateCommands(p2.commands);
  }
  return { calls, jsonOk: true, commands: p2.commands || [], steps: p2.steps || [], validation, retried: calls.length > 2 };
}

// 臂 B：合并一次调用（单次，不做纠正重试，校验不过就记为不过）
async function runArmB(model, imageUrl, userId) {
  const m1 = [
    { role: 'system', content: SYSTEM_PROMPT_ONESHOT },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: 'Recognize, complete, and plan the construction for this geometry problem. Output only the JSON object.' },
      ],
    },
  ];
  const c1 = await timedCall(m1, model, 'vision', userId);
  if (!c1.ok) return { calls: [c1], jsonOk: false, error: c1.error };
  let parsed;
  try {
    parsed = parseJson(c1.content);
  } catch (e) {
    return { calls: [c1], jsonOk: false, error: 'armB JSON parse failed: ' + e.message };
  }
  const validation = ggb.validateCommands(parsed.commands);
  return { calls: [c1], jsonOk: true, commands: parsed.commands || [], steps: parsed.steps || [], validation, retried: false };
}

function validRate(validation, commands) {
  const total = (commands || []).length;
  if (!total) return null;
  const valid = validation ? validation.valid.length : 0;
  return valid / total;
}

function tok(u, k) {
  return u && Number.isFinite(u[k]) ? u[k] : null;
}

// 智谱连通性预检：DNS 解析 + 443 TCP 连接，超时 6 秒；不通就不跑 GLM，避免卡住
function checkZhipuReachable(timeoutMs = 6000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    dns.lookup('open.bigmodel.cn', (err, address) => {
      if (err || !address) {
        clearTimeout(timer);
        return resolve(false);
      }
      const sock = net.connect(443, address, () => {
        clearTimeout(timer);
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtNum(v) {
  return v == null ? '-' : Number(v).toLocaleString('en-US');
}

// 生成可浏览器查看的 HTML 报告（与 JSON 同名同目录）
function writeHtmlReport(report, outPath) {
  const rows = [];
  for (const [model, arms] of Object.entries(report.byModel || {})) {
    for (const arm of ['A', 'B']) {
      const d = arms[arm];
      rows.push(`<tr>
        <td>${esc(model)}</td>
        <td>${arm === 'A' ? '两步流程' : '合并一次'}</td>
        <td>${d.okRounds}/${d.rounds}</td>
        <td>${fmtNum(d.avgWallMs)}</td>
        <td>${fmtNum(d.medianWallMs)}</td>
        <td>${fmtNum(d.avgTotalTokens)}</td>
        <td>${fmtNum(d.medianTotalTokens)}</td>
        <td>${fmtNum(d.avgPromptTokens)}</td>
        <td>${fmtNum(d.avgCompletionTokens)}</td>
        <td>${d.validCommandRate == null ? '-' : (d.validCommandRate * 100).toFixed(0) + '%'}</td>
        <td>${d.retriedRounds}</td>
      </tr>`);
    }
  }
  const detailRows = [];
  for (const r of report.records) {
    const calls = r.calls.map((c, i) =>
      `#${i + 1} ${c.ok ? 'ok' : 'FAIL'} ${fmtNum(c.wallMs)}ms tok=${fmtNum(c.usage && c.usage.total_tokens)}${c.error ? ' err=' + esc(c.error) : ''}`
    ).join('<br>');
    detailRows.push(`<tr>
      <td>${esc(r.model)}</td>
      <td>${r.round}</td>
      <td>${r.arm === 'A' ? '两步流程' : '合并一次'}</td>
      <td>${r.armOk ? 'ok' : esc(r.error || '失败')}</td>
      <td>${r.retried ? '是' : '否'}</td>
      <td>${r.commandsCount}</td>
      <td>${r.validRate == null ? '-' : (r.validRate * 100).toFixed(0) + '%'}</td>
      <td>${calls}</td>
    </tr>`);
  }
  const skipped = (report.skippedPlans || []).map((p) => `<p class="skip">已跳过 ${esc(p.model)}：${esc(p.reason)}</p>`).join('');
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>识别/作图 两步 vs 一次 对比报告</title>
<style>
body{font-family:system-ui,'Segoe UI',sans-serif;margin:24px;color:#222;font-size:14px}
h1{font-size:18px} h2{font-size:15px;margin-top:24px}
table{border-collapse:collapse;margin-top:8px;width:100%}
th,td{border:1px solid #ccc;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#f3f3f3}
.meta{color:#666;font-size:12px}
.skip{color:#a00}
td:last-child{font-family:Consolas,monospace;font-size:12px}
</style>
</head>
<body>
<h1>识别/作图"两步 vs 一次"对比报告</h1>
<p class="meta">生成时间：${esc(report.generatedAt)}　图片：${esc(report.image)}</p>
${skipped}
<h2>汇总（每臂 totals；耗时 ms，tokens 为各次调用之和）</h2>
<table>
<tr><th>模型</th><th>方案</th><th>成功轮数</th><th>平均耗时</th><th>中位耗时</th><th>平均总tokens</th><th>中位总tokens</th><th>平均prompt</th><th>平均completion</th><th>指令全合法</th><th>重试轮数</th></tr>
${rows.join('\n')}
</table>
<h2>明细（每轮每次调用）</h2>
<table>
<tr><th>模型</th><th>轮</th><th>方案</th><th>结果</th><th>重试</th><th>指令数</th><th>合法率</th><th>调用明细</th></tr>
${detailRows.join('\n')}
</table>
</body>
</html>`;
  fs.writeFileSync(outPath, html);
}

function sumBy(calls, fn) {
  return calls.reduce((acc, c) => {
    const v = fn(c);
    return v == null ? acc : acc + v;
  }, 0);
}

function summarize(records) {
  const byArm = { A: [], B: [] };
  for (const r of records) if (byArm[r.arm]) byArm[r.arm].push(r);
  const out = {};
  for (const arm of ['A', 'B']) {
    const ok = byArm[arm].filter((r) => r.armOk);
    const wall = ok.map((r) => sumBy(r.calls, (c) => c.wallMs)).sort((a, b) => a - b);
    const totalTokens = ok.map((r) => sumBy(r.calls, (c) => tok(c.usage, 'total_tokens'))).sort((a, b) => a - b);
    const mid = (arr) => (arr.length ? (arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2) : null);
    out[arm] = {
      rounds: byArm[arm].length,
      okRounds: ok.length,
      avgWallMs: wall.length ? Math.round(wall.reduce((a, b) => a + b, 0) / wall.length) : null,
      medianWallMs: wall.length ? Math.round(mid(wall)) : null,
      avgTotalTokens: totalTokens.length ? Math.round(totalTokens.reduce((a, b) => a + b, 0) / totalTokens.length) : null,
      medianTotalTokens: totalTokens.length ? Math.round(mid(totalTokens)) : null,
      avgPromptTokens: ok.length ? Math.round(ok.reduce((a, r) => a + sumBy(r.calls, (c) => tok(c.usage, 'prompt_tokens')), 0) / ok.length) : null,
      avgCompletionTokens: ok.length ? Math.round(ok.reduce((a, r) => a + sumBy(r.calls, (c) => tok(c.usage, 'completion_tokens')), 0) / ok.length) : null,
      jsonOkRate: byArm[arm].length ? ok.filter((r) => r.jsonOk).length / byArm[arm].length : null,
      validCommandRate: ok.length ? ok.filter((r) => r.validRate === 1).length / ok.length : null,
      retriedRounds: ok.filter((r) => r.retried).length,
    };
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const imagePath = args.image;
  if (!fs.existsSync(imagePath)) {
    console.error('image not found:', imagePath);
    process.exit(1);
  }
  const base64 = fs.readFileSync(imagePath).toString('base64');
  const imageUrl = `data:image/png;base64,${base64}`;
  const userId = 'compare-test';

  const plans = [
    { model: 'glm-5.3-flash', rounds: args.roundsGlm },
    { model: 'kimi-k2.6', rounds: args.roundsKimi },
  ].filter((p) => p.rounds > 0);
  const skippedPlans = [];

  // 智谱预检：网络不通就跳过，不卡住整体
  if (plans.some((p) => p.model.startsWith('glm'))) {
    console.log('checking zhipu connectivity ...');
    const reachable = await checkZhipuReachable();
    if (!reachable) {
      console.log('zhipu unreachable, skipping glm plan.');
      for (const p of plans.filter((x) => x.model.startsWith('glm'))) {
        skippedPlans.push({ model: p.model, reason: 'open.bigmodel.cn 网络不通（DNS/TCP 预检失败），已跳过' });
      }
      plans.splice(0, plans.length, ...plans.filter((x) => !x.model.startsWith('glm')));
    } else {
      console.log('zhipu reachable.');
    }
  }

  if (!process.env.KIMI_API_KEY && plans.some((p) => p.model.startsWith('kimi'))) {
    console.error('KIMI_API_KEY not set in .env');
    process.exit(1);
  }

  const records = [];
  for (const plan of plans) {
    for (let round = 1; round <= plan.rounds; round++) {
      // 交替两臂先后，抵消顺序偏差
      const order = round % 2 === 1 ? ['A', 'B'] : ['B', 'A'];
      const results = {};
      for (const arm of order) {
        console.log(`[${plan.model}] round ${round}/${plan.rounds} arm ${arm} ...`);
        results[arm] = arm === 'A' ? await runArmA(plan.model, imageUrl, userId) : await runArmB(plan.model, imageUrl, userId);
        const r = results[arm];
        console.log(`  -> ${r.jsonOk ? 'ok' : 'FAIL: ' + r.error} (${r.calls.length} call(s), ${r.calls.map((c) => c.wallMs + 'ms').join('+')})`);
      }
      for (const arm of ['A', 'B']) {
        const r = results[arm];
        records.push({
          model: plan.model,
          round,
          arm,
          armOk: !!r.jsonOk,
          error: r.error || null,
          retried: !!r.retried,
          commandsCount: (r.commands || []).length,
          stepsCount: (r.steps || []).length,
          validRate: r.validation ? validRate(r.validation, r.commands) : null,
          calls: r.calls.map((c) => ({
            ok: c.ok,
            error: c.error || null,
            wallMs: c.wallMs,
            usage: c.usage || null,
            providerCallId: c.providerCallId,
          })),
        });
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    image: imagePath,
    rounds: plans,
    skippedPlans,
    byModel: {},
    records,
  };
  for (const plan of plans) {
    report.byModel[plan.model] = summarize(records.filter((r) => r.model === plan.model));
  }

  const outPath = path.join(__dirname, `compare-report-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  const htmlPath = outPath.replace(/\.json$/, '.html');
  writeHtmlReport(report, htmlPath);

  console.log('\n===== SUMMARY =====');
  for (const plan of plans) {
    console.log(`\n## ${plan.model} (${plan.rounds} rounds)`);
    const s = report.byModel[plan.model];
    for (const arm of ['A', 'B']) {
      const d = s[arm];
      console.log(`  arm ${arm} (${arm === 'A' ? 'two-call' : 'one-shot'}): okRounds=${d.okRounds}/${d.rounds} avgWall=${d.avgWallMs}ms medianWall=${d.medianWallMs}ms avgTotalTokens=${d.avgTotalTokens} medianTotalTokens=${d.medianTotalTokens} avgPrompt=${d.avgPromptTokens} avgCompletion=${d.avgCompletionTokens} allCommandsValid=${d.validCommandRate} retried=${d.retriedRounds}`);
    }
  }
  console.log('\nreport written to', outPath);
  console.log('html report written to', htmlPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
