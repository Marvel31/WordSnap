const fs = require('fs');
const path = require('path');
const appJson = require('./app.json');

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadLocalEnv();

module.exports = ({ config }) => ({
  ...config,
  ...appJson.expo,
  extra: {
    ...appJson.expo.extra,
    ocrSpaceApiKey: process.env.OCR_SPACE_API_KEY || appJson.expo.extra.ocrSpaceApiKey,
    geminiApiKey: process.env.GEMINI_API_KEY || appJson.expo.extra.geminiApiKey,
    geminiModel: process.env.GEMINI_MODEL || appJson.expo.extra.geminiModel
  }
});
