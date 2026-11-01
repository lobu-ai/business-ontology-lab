import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const ROOT = fileURLToPath(new URL('.', import.meta.url));
export const BASE = (process.env.LOBU_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
export const ORG = process.env.LOBU_ORG || 'ontology-demo';
if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(ORG)) throw new Error('Invalid workspace slug');
const baseUrl = new URL(BASE);
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname);
if (
  baseUrl.username ||
  baseUrl.password ||
  baseUrl.search ||
  baseUrl.hash ||
  !['http:', 'https:'].includes(baseUrl.protocol)
)
  throw new Error('Invalid Lobu URL');
if (baseUrl.protocol !== 'https:' && !loopback) throw new Error('Remote endpoints must use HTTPS');
export const STATE_ROOT =
  path.resolve(process.env.LOBU_EVAL_STATE_DIR || path.join(ROOT, '../../.runtime', ORG)) +
  path.sep;
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class Lobu {
  constructor(token, org = ORG, cookie = null) {
    this.token = token;
    this.org = org;
    this.cookie = cookie;
  }
  static async connect(org = ORG) {
    if (process.env.LOBU_TOKEN) return new Lobu(process.env.LOBU_TOKEN, org);
    if (!loopback || process.env.LOBU_LOCAL_INIT !== '1')
      throw new Error(
        'Set LOBU_TOKEN for an existing session, or explicitly enable LOBU_LOCAL_INIT=1 for a loopback-only disposable runtime',
      );
    const r = await fetch(BASE + '/api/local-init', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lobu-client': 'ontology-demo',
        origin: BASE,
      },
      body: '{}',
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    if (!r.ok || !d.session_token)
      throw new Error(
        'Local bootstrap failed: HTTP ' +
          r.status +
          (typeof d.error === 'string' ? ' (' + d.error + ')' : ''),
      );
    const cookie = (r.headers.getSetCookie?.() || []).map((x) => x.split(';')[0]).join('; ');
    return Object.assign(new Lobu(d.session_token, org, cookie), { localInstallUser: d.user });
  }
  redact(value) {
    let text = String(value);
    for (const secret of [this.token, this.cookie])
      if (secret) text = text.split(secret).join('[redacted]');
    return text;
  }
  async raw(route, body, options = {}) {
    if (!route.startsWith('/api/'))
      throw new Error('Only same-origin Lobu API routes are supported');
    const headers = {
      'content-type': 'application/json',
      'x-lobu-client': 'ontology-demo',
      origin: BASE,
    };
    if (options.cookie && this.cookie) headers.cookie = this.cookie;
    else if (this.token) headers.authorization = 'Bearer ' + this.token;
    const response = await fetch(BASE + route, {
      method: options.method || (body === undefined ? 'GET' : 'POST'),
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeout || 90000),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: this.redact(text.slice(0, 1000)) };
    }
    return { status: response.status, data };
  }
  async request(route, body, options = {}) {
    const r = await this.raw(route, body, options);
    if (r.status >= 400)
      throw Object.assign(
        new Error(
          this.redact(route + ' HTTP ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 1200)),
        ),
        { status: r.status, detail: r.data },
      );
    return r.data;
  }
  async sdk(code, write = false) {
    const result = await this.request(
      '/api/' + this.org + '/' + (write ? 'run_sdk' : 'query_sdk'),
      { script: 'export default async(ctx,client)=>{' + code + '}', timeout_ms: 60000 },
    );
    if (!result.success)
      throw Object.assign(new Error(this.redact(result.error?.message || JSON.stringify(result))), {
        code: result.error?.code,
        detail: result.error,
      });
    if (result.return_truncated)
      throw new Error('SDK output truncated: narrow or paginate the query');
    return result.return_value;
  }
  async call(method, args, write = false) {
    if (!/^[a-zA-Z]+\.[a-zA-Z]+$/.test(method)) throw new Error('Invalid SDK method');
    return this.sdk('return await client.' + method + '(' + JSON.stringify(args) + ');', write);
  }
  async query(sql) {
    return this.sdk('return await client.query(' + JSON.stringify(sql) + ');');
  }
  async save(draft) {
    return applied(await this.call('knowledge.save', draft, true));
  }
}
export function applied(result) {
  if (
    result.status === 'pending_approval' ||
    result.approval_queued ||
    result.blocked_fields?.length
  )
    throw new Error('Mutation awaits human approval; not applied');
  return result;
}
export function eventId(result) {
  const n = Number(result.id || result.event_id || result.content_id || result.event?.id);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('No event ID in save receipt');
  return n;
}
export async function state() {
  try {
    return JSON.parse(await fs.readFile(STATE_ROOT + 'state.json', 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return { entities: {}, automations: {}, events: {}, links: {} };
  }
}
export async function saveState(value) {
  await fs.mkdir(STATE_ROOT, { recursive: true });
  await fs.writeFile(STATE_ROOT + 'state.json.tmp', JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
  await fs.rename(STATE_ROOT + 'state.json.tmp', STATE_ROOT + 'state.json');
}
export async function writeReport(name, value) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid report name');
  await fs.mkdir(STATE_ROOT + 'reports', { recursive: true });
  await fs.writeFile(STATE_ROOT + 'reports/' + name + '.json', JSON.stringify(value, null, 2));
}
export async function awaitRun(client, runId, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const { run } = await client.call('operations.getRun', Number(runId));
    if (['completed', 'failed', 'cancelled', 'timed_out'].includes(run.status)) {
      if (run.status !== 'completed')
        throw new Error(run.error_message || 'Automation ' + run.status);
      return run;
    }
    await sleep(250);
  }
  throw new Error('Automation polling timed out');
}
