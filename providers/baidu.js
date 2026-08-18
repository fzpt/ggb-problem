const https = require('node:https');
const querystring = require('node:querystring');
const config = require('../config');

function postForm(hostname, path, form) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(form);
    const request = https.request({
      hostname,
      port: 443,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(new Error('Baidu response is not JSON: ' + error.message + '\nRaw: ' + raw.slice(0, 300)));
        }
      });
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

async function getAccessToken(apiKey, secretKey) {
  const result = await postForm('aip.baidubce.com', '/oauth/2.0/token', {
    grant_type: 'client_credentials',
    client_id: apiKey,
    client_secret: secretKey
  });
  if (!result.access_token) {
    throw new Error('Failed to get Baidu access token: ' + JSON.stringify(result));
  }
  return result.access_token;
}

async function extractText(base64, options = {}) {
  const apiKey = options.apiKey || config.ocr.baidu.apiKey;
  const secretKey = options.secretKey || config.ocr.baidu.secretKey;
  if (!apiKey || !secretKey) {
    return Promise.reject(new Error('BAIDU_API_KEY and BAIDU_SECRET_KEY environment variables are required.'));
  }

  const endpoint = options.endpoint || config.ocr.baidu.endpoint;
  const accessToken = await getAccessToken(apiKey, secretKey);

  const result = await postForm('aip.baidubce.com', `/rest/2.0/ocr/v1/${endpoint}?access_token=${accessToken}`, {
    image: base64,
    detect_direction: 'true',
    paragraph: 'false',
    probability: 'false'
  });

  if (result.error_code) {
    throw new Error(`Baidu OCR error ${result.error_code}: ${result.error_msg}`);
  }

  const words = (result.words_result || []).map(item => item.words).filter(Boolean);
  const text = words.join('\n');
  return { text, raw: result };
}

module.exports = { extractText };