// Centralized configuration for API keys and provider defaults.

module.exports = {
  port: Number(process.env.PORT) || 3000,
 ocr: {
   provider: process.env.OCR_PROVIDER || 'baidu',
    baidu: {
      apiKey: process.env.BAIDU_API_KEY,
      secretKey: process.env.BAIDU_SECRET_KEY,
      endpoint: process.env.BAIDU_OCR_ENDPOINT || 'general_basic'
    }
  },
 llm: {
   provider: process.env.LLM_PROVIDER || 'kimi',
    kimi: {
      apiKey: process.env.KIMI_API_KEY,
      model: process.env.KIMI_MODEL || 'kimi-k2.7-code'
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o'
    }
  }
};
