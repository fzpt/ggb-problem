import { useEffect, useState } from 'react';
import { getAdminSettings, putAdminSettings, testAdminModel, getAdminTasks, cancelAdminTask } from '../services/api';

const STATUS_LABEL = {
  queued: '排队中',
  running: '运行中',
  done: '完成',
  error: '失败',
  cancelled: '已取消',
};

function fmtTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

function fmtDuration(t) {
  if (!t.startedAt) return '-';
  const end = t.finishedAt || Date.now();
  const s = Math.round((end - t.startedAt) / 1000);
  return s < 60 ? `${s} 秒` : `${Math.round(s / 60)} 分钟`;
}

export default function Admin() {
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [models, setModels] = useState([]);
  const [visionModel, setVisionModel] = useState('');
  const [textModel, setTextModel] = useState('');
  const [zhipuKeyMasked, setZhipuKeyMasked] = useState('');
  const [zhipuKey, setZhipuKey] = useState('');
  const [adminEmailsText, setAdminEmailsText] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState('');
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    getAdminSettings()
      .then((s) => {
        setModels(s.models || []);
        setVisionModel(s.visionModel || '');
        setTextModel(s.textModel || '');
        setZhipuKeyMasked(s.zhipuKeyMasked || '');
        setAdminEmailsText((s.adminEmails || []).join(', '));
      })
      .catch((e) => {
        if (e.message.includes('403') || e.message.includes('管理员')) setForbidden(true);
        setStatus('加载失败：' + e.message);
      })
      .finally(() => setLoading(false));
  }, []);

  // 大模型任务轮询（3 秒刷新）
  useEffect(() => {
    if (forbidden) return undefined;
    let stopped = false;
    const load = () => {
      getAdminTasks().then((d) => { if (!stopped) setTasks(d.tasks || []); }).catch(() => {});
    };
    load();
    const timer = setInterval(load, 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [forbidden]);

  const cancelTask = (userId) => {
    cancelAdminTask(userId).then(() => {
      setStatus('已发送取消请求。');
      getAdminTasks().then((d) => setTasks(d.tasks || [])).catch(() => {});
    }).catch((e) => setStatus('取消失败：' + e.message));
  };

  const save = async () => {
    setSaving(true);
    setStatus('正在保存…');
    try {
      const patch = {
        visionModel,
        textModel,
        adminEmails: adminEmailsText.split(/[,，\s]+/).filter(Boolean),
      };
      if (zhipuKey.trim()) patch.zhipuKey = zhipuKey.trim();
      await putAdminSettings(patch);
      setStatus('已保存。');
      setZhipuKey('');
      const s = await getAdminSettings();
      setZhipuKeyMasked(s.zhipuKeyMasked || '');
    } catch (e) {
      setStatus('保存失败：' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const test = async (model) => {
    setTesting(model);
    setStatus(`正在测试 ${model} …`);
    try {
      const r = await testAdminModel(model);
      setStatus(`连接成功：${model} 回复「${(r.reply || '').slice(0, 40)}」`);
    } catch (e) {
      setStatus(`连接失败：${model} — ${e.message}`);
    } finally {
      setTesting('');
    }
  };

  if (loading) {
    return <div className="admin-shell"><p className="text-muted">加载中…</p></div>;
  }
  if (forbidden) {
    return (
      <div className="admin-shell">
        <a className="entry-back text-muted" href="#/">&larr; 返回首页</a>
        <p className="text-muted">当前账号没有管理员权限。</p>
      </div>
    );
  }

  const visionModels = models.filter((m) => m.vision);
  const textModels = models;

  return (
    <div className="admin-shell">
      <div className="entry-header">
        <a className="entry-back text-muted" href="#/">&larr; 返回首页</a>
        <span className="entry-title text-ink">管理后台</span>
      </div>
      <div className="admin-body">
        <section className="admin-section">
          <h2 className="admin-section-title">大模型配置</h2>

          <label className="entry-label">图片识别模型（需支持视觉）</label>
          <div className="admin-row">
            <select className="admin-select" value={visionModel} onChange={(e) => setVisionModel(e.target.value)}>
              {visionModels.map((m) => (
                <option key={m.id} value={m.id}>{m.label}（{m.id}）</option>
              ))}
            </select>
            <button className="button" onClick={() => test(visionModel)} disabled={!!testing || !visionModel}>
              {testing === visionModel ? '测试中…' : '测试连接'}
            </button>
          </div>

          <label className="entry-label">文本生成模型（识别补全 / 作图分析 / 指令调整）</label>
          <div className="admin-row">
            <select className="admin-select" value={textModel} onChange={(e) => setTextModel(e.target.value)}>
              {textModels.map((m) => (
                <option key={m.id} value={m.id}>{m.label}（{m.id}）</option>
              ))}
            </select>
            <button className="button" onClick={() => test(textModel)} disabled={!!testing || !textModel}>
              {testing === textModel ? '测试中…' : '测试连接'}
            </button>
          </div>
        </section>

        <section className="admin-section">
          <h2 className="admin-section-title">Provider API Key</h2>
          <label className="entry-label">Kimi（Moonshot）</label>
          <p className="text-muted admin-note">使用服务端环境变量 KIMI_API_KEY，不在此配置。</p>
          <label className="entry-label">智谱 GLM</label>
          <input
            className="admin-input"
            type="password"
            placeholder={zhipuKeyMasked ? `已配置：${zhipuKeyMasked}` : '输入智谱 API Key'}
            value={zhipuKey}
            onChange={(e) => setZhipuKey(e.target.value)}
          />
        </section>

        <section className="admin-section">
          <h2 className="admin-section-title">管理员</h2>
          <label className="entry-label">管理员邮箱（逗号或空格分隔，保存后仅这些邮箱可访问本页面）</label>
          <input
            className="admin-input"
            value={adminEmailsText}
            onChange={(e) => setAdminEmailsText(e.target.value)}
          />
        </section>

        <div className="admin-actions">
          <button className="button primary" onClick={save} disabled={saving}>保存配置</button>
          {status && <span className="text-muted admin-status">{status}</span>}
        </div>

        <section className="admin-section">
          <h2 className="admin-section-title">大模型调用任务</h2>
          {tasks.length === 0 ? (
            <p className="text-muted admin-note">暂无任务记录。</p>
          ) : (
            <table className="entry-table admin-task-table">
              <thead>
                <tr>
                  <th>状态</th>
                  <th>用户</th>
                  <th>任务</th>
                  <th>模型</th>
                  <th>开始</th>
                  <th>耗时</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td><span className={'admin-task-status ' + t.status}>{STATUS_LABEL[t.status] || t.status}</span></td>
                    <td>{t.email}</td>
                    <td>{t.type}</td>
                    <td>{t.model}</td>
                    <td>{fmtTime(t.startedAt || t.enqueuedAt)}</td>
                    <td>{fmtDuration(t)}</td>
                    <td>
                      {t.status === 'running' && (
                        <button className="button admin-cancel" onClick={() => cancelTask(t.userId)}>取消</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tasks.some((t) => t.status === 'error') && (
            <p className="text-muted admin-note">
              最近错误：{tasks.find((t) => t.status === 'error')?.error}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
