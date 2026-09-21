import { useEffect, useState } from 'react';
import { getAdminSettings, putAdminSettings, testAdminModel } from '../services/api';

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
      </div>
    </div>
  );
}
