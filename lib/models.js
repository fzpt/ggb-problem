// 服务可用的大模型注册表。
// provider: 'kimi' 走 Moonshot API（key 来自服务端 env），'zhipu' 走智谱 API（key 在管理后台配置）。
// vision: 是否支持图片输入（决定能否用于"图片识别"任务）。
const MODELS = [
  { id: 'kimi-k2.7-code', provider: 'kimi', label: 'Kimi K2.7 Code', vision: false },
  { id: 'kimi-k3', provider: 'kimi', label: 'Kimi K3', vision: false },
  { id: 'kimi-k2.6', provider: 'kimi', label: 'Kimi K2.6（视觉）', vision: true },
  { id: 'glm-5.3-flash', provider: 'zhipu', label: 'GLM-5.3-Flash', vision: true },
];

function findModel(id) {
  return MODELS.find((m) => m.id === id) || null;
}

module.exports = { MODELS, findModel };
