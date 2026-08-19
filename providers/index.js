const config = require('../config');
const mockProvider = require('./mock');
const openaiProvider = require('./openai');
const baiduProvider = require('./baidu');
const kimiProvider = require('./kimi');
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
function cancelCurrentRequest(providerName) {
  const name = providerName || config.llm.provider;
  if (name === 'kimi') {
    return cancelKimiRequest();
  }
  return false;
}

module.exports = {
  providers,
  extractFromImage,
  extractTextFromImage,
  extractGeometryFromText,
  generateCommands,
  cancelCurrentRequest,
  refineGeometryCommands
};