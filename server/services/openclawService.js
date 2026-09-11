const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const OPENCLAW_BIN = process.env.OPENCLAW_BIN || 'openclaw';
const OPENCLAW_MODEL = process.env.OPENCLAW_MODEL || process.env.GEMINI_MODEL || 'google/gemini-2.5-flash';
const OPENCLAW_TOOL_PROFILE = process.env.OPENCLAW_TOOL_PROFILE || 'messaging';
const OPENCLAW_STATE_DIR = process.env.OPENCLAW_STATE_DIR || path.join(os.tmpdir(), 'openclaw-state');
const OPENCLAW_WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE_DIR || path.join(os.tmpdir(), 'openclaw-workspace');
const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || path.join(OPENCLAW_STATE_DIR, 'openclaw.json');
const OPENCLAW_AGENT_TIMEOUT_SECONDS = Number(process.env.OPENCLAW_AGENT_TIMEOUT_SECONDS || 120);
const OPENCLAW_THINKING = process.env.OPENCLAW_THINKING || 'medium';

function shouldUseOpenClawPlanner() {
  const engine = String(process.env.RECRUITER_AI_ENGINE || process.env.AI_ENGINE || '').trim().toLowerCase();
  return engine === 'openclaw' || engine === 'openclaw-local';
}

function hasOpenClawPlannerPrereqs() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function getOpenClawPlannerLabel() {
  return `OpenClaw (${OPENCLAW_MODEL})`;
}

function buildOpenClawConfig() {
  return {
    agents: {
      defaults: {
        workspace: OPENCLAW_WORKSPACE_DIR,
        model: {
          primary: OPENCLAW_MODEL,
        },
        models: {
          [OPENCLAW_MODEL]: {},
        },
      },
    },
    plugins: {
      allow: ['browser', 'web_search', 'web_fetch', 'exec', 'read', 'write'],
      browser: {
        profile: 'openclaw',
        headless: true,
        stealth: true,
      },
    },
    tools: {
      profile: OPENCLAW_TOOL_PROFILE,
    },
    auth: {
      profiles: {
        'google:default': {
          provider: 'google',
          mode: 'api_key',
        },
      },
    },
  };
}

async function ensureOpenClawRuntime() {
  await fs.mkdir(OPENCLAW_STATE_DIR, { recursive: true });
  await fs.mkdir(OPENCLAW_WORKSPACE_DIR, { recursive: true });
  await fs.writeFile(
    OPENCLAW_CONFIG_PATH,
    `${JSON.stringify(buildOpenClawConfig(), null, 2)}\n`,
    'utf8'
  );
}

function cleanJsonFence(text = '') {
  return String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
}

function flattenPromptParts(parts = []) {
  return parts
    .map(part => String(part?.text || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

async function callOpenClawPlannerJson(parts, options = {}) {
  const prompt = flattenPromptParts(parts);
  if (!prompt) {
    throw new Error('OPENCLAW_PROMPT_MISSING');
  }

  if (!hasOpenClawPlannerPrereqs()) {
    throw new Error('OPENCLAW_GEMINI_API_KEY_MISSING');
  }

  await ensureOpenClawRuntime();

  const sessionKey = String(options.sessionKey || 'recruiter-main')
    .replace(/[^a-z0-9:_-]/gi, '-')
    .slice(0, 120);

  const args = [
    'agent',
    '--local',
    '--session-id',
    sessionKey,
    '--message',
    prompt,
    '--timeout',
    String(OPENCLAW_AGENT_TIMEOUT_SECONDS),
    '--thinking',
    OPENCLAW_THINKING,
    '--json',
  ];

  const env = {
    ...process.env,
    OPENCLAW_CONFIG_PATH,
    OPENCLAW_STATE_DIR,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };

  let stdout = '';
  let stderr = '';

  try {
    const result = await execFileAsync(OPENCLAW_BIN, args, {
      env,
      timeout: OPENCLAW_AGENT_TIMEOUT_SECONDS * 1000,
      maxBuffer: 10 * 1024 * 1024,
    });
    stdout = result.stdout || '';
    stderr = result.stderr || '';
  } catch (error) {
    const details = String(error.stderr || error.stdout || error.message || '').trim();
    throw new Error(`OPENCLAW_EXEC_FAILED: ${details}`);
  }

  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`OPENCLAW_JSON_PARSE_FAILED: ${String(stdout || stderr || error.message).trim()}`);
  }

  const replyText = Array.isArray(payload?.payloads)
    ? payload.payloads.map(item => String(item?.text || '').trim()).filter(Boolean).join('\n')
    : '';

  if (!replyText) {
    throw new Error(`OPENCLAW_EMPTY_REPLY: ${String(stdout || stderr || '').trim()}`);
  }

  try {
    return JSON.parse(cleanJsonFence(replyText) || '{}');
  } catch (error) {
    throw new Error(`OPENCLAW_REPLY_JSON_INVALID: ${replyText}`);
  }
}

module.exports = {
  OPENCLAW_MODEL,
  callOpenClawPlannerJson,
  getOpenClawPlannerLabel,
  hasOpenClawPlannerPrereqs,
  shouldUseOpenClawPlanner,
};
