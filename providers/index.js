const config = require('../config');
const mockProvider = require('./mock');
const openaiProvider = require('./openai');
const baiduProvider = require('./baidu');
const kimiProvider = require('./kimi');
const { findModel } = require('../lib/models');
const { generateCommands } = require('../lib/generate');
const { cancelCurrentRequest: cancelKimiRequest } = require('./kimi');

const providers = {
  mock: mockProvider,
  openai: openaiProvider,
  baidu: baiduProvider,
  kimi: kimiProvider
};

function extractFromImage(base64, providerName, options) {
  const provider = providers[providerName] || providers.mock;
  return provider.extract(base64, options);
}

function extractTextFromImage(base64, providerName, options) {
  const provider = providers[providerName] || providers[config.ocr.provider];
  if (!provider.extractText) {
    return Promise.reject(new Error(`Provider ${providerName} does not support image-to-text extraction.`));
  }
  return provider.extractText(base64, options);
}

function extractGeometryFromText(text, providerName, options) {
  const provider = providers[providerName] || providers[config.llm.provider];
  if (!provider.extractFromText) {
    return Promise.reject(new Error(`Provider ${providerName} does not support text-to-geometry extraction.`));
  }
  return provider.extractFromText(text, options);
}


function refineGeometryCommands(text, currentCommands, history, providerName, options) {
  const provider = providers[providerName] || providers[config.llm.provider];
  if (!provider.refineFromText) {
    return Promise.reject(new Error(`Provider ${providerName} does not support command refinement.`));
  }
  return provider.refineFromText(text, currentCommands, history, options);
}

function analyzeImage(base64, providerName, options) {
  const provider = providers[providerName] || providers[config.llm.provider];
  if (!provider.analyzeImage) {
    return Promise.reject(new Error(`Provider ${providerName} does not support image analysis.`));
  }
  return provider.analyzeImage(base64, options);
}

function analyzeConstruction(text, providerName, options) {
  const provider = providers[providerName] || providers[config.llm.provider];
  if (!provider.analyzeConstruction) {
    return Promise.reject(new Error(`Provider ${providerName} does not support construction analysis.`));
  }
  return provider.analyzeConstruction(text, options);
}

function cancelCurrentRequest(providerName, options = {}) {
  const name = providerName || config.llm.provider;
  if (name === 'kimi') {
    return cancelKimiRequest(options.userId);
  }
  return false;
}

// 管理后台"测试连接"：用指定模型做一次最小对话
function testModel(modelId, userId) {
  const m = findModel(modelId);
  if (!m) {
    return Promise.reject(new Error('未知模型: ' + modelId));
  }
  const messages = [{ role: 'user', content: '回复 ok 即可' }];
  return kimiProvider.runTask(
    () => kimiProvider.chatCompletion(messages, { model: m.id }).then((reply) => ({ ok: true, reply })),
    userId,
    { type: '连接测试', taskType: m.vision ? 'vision' : 'text', model: m.id }
  );
}

module.exports = {
  providers,
  extractFromImage,
  extractTextFromImage,
  extractGeometryFromText,
  analyzeImage,
  analyzeConstruction,
  getTaskEvents: () => kimiProvider.getTaskEvents(),
  testModel,
  generateCommands,
  cancelCurrentRequest,
  refineGeometryCommands
};
