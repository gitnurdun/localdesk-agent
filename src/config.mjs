import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function loadConfig(overrides = {}) {
  const raw = JSON.parse(await fs.readFile(path.join(APP, 'config.json'), 'utf8'));
  const config = { webSearch: { enabled:true, provider:'duckduckgo', url:'' }, maxCatalogTools:7, ...raw, ...overrides };
  if (!Number.isInteger(config.contextTokens) || config.contextTokens < 4096 || config.contextTokens >= 32000) throw Error('contextTokens must be 4096..31999.');
  if (!Number.isInteger(config.outputTokens) || config.outputTokens < 128 || config.outputTokens > config.contextTokens / 3) throw Error('Invalid outputTokens.');
  const u = new URL(config.ollamaUrl);
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password) throw Error('Ollama must be a local HTTP service.');
  if (config.model.includes('cloud')) throw Error('Cloud models are disabled.');
  for (const [key, min, max] of [['maxSteps',1,50],['workerSteps',1,15],['maxDelegations',0,5],['taskTimeoutSeconds',10,1800],['requestTimeoutSeconds',5,300],['port',1024,65535]]) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) throw Error(`Invalid ${key}`);
  }
  config.app = APP;
  config.workspace = path.resolve(APP, config.workspace);
  config.data = path.resolve(overrides.data ?? path.join(APP, 'data'));
  config.skillsDir = path.resolve(overrides.skillsDir ?? path.join(APP,'extensions','skills'));
  config.readRoots = [...new Set([config.workspace, ...config.readRoots.map(p => path.resolve(APP,p))])];
  config.writeRoots = [...new Set([config.workspace, ...config.writeRoots.map(p => path.resolve(APP,p))])];
  for (const dir of [config.workspace, config.data, config.skillsDir, path.join(config.data, 'conversations'), path.join(config.data,'integrations'), path.join(config.data, 'tasks'), path.join(config.data, 'backups'), path.join(config.data, 'memory')]) await fs.mkdir(dir,{recursive:true});
  return config;
}
