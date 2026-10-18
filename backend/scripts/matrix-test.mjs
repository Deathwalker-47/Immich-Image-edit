#!/usr/bin/env node
/**
 * Live provider × model matrix test.
 *
 * Runs one real edit for every (provider, model) pair the backend advertises at
 * GET /api/settings/providers, plus one LoRA edit per LoRA-capable model, all
 * through POST /api/edit — the same request shape the frontend sends from
 * EditorPanel.tsx. Going through the HTTP API rather than calling provider
 * functions directly means the registry, the Immich original fetch, sizing and
 * the provider payload are all exercised together, and the matrix can never
 * drift from what the UI actually offers (the old test_all.js hardcoded slugs
 * and went stale within weeks).
 *
 * Every PASS spends real provider credit. Use --list to see the matrix for free,
 * and --provider / --model to narrow a run. Nothing is written to Immich.
 *
 * Outcomes:
 *   PASS       200 with an image URL
 *   CREDIT     the provider account is out of balance — not a code bug
 *   MODERATED  the provider's upstream filter rejected the INPUT image
 *              (e.g. Alibaba's DataInspectionFailed on Runware Wan 2.7). Retry
 *              with --image <neutral photo> to tell this apart from a real fault.
 *   SKIP       provider has no API key configured
 *   FAIL       anything else — the only outcome that makes the exit code non-zero
 *
 * Exit codes: 0 no real failures, 1 at least one FAIL, 2 setup error.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parseArgs } from 'node:util';

const USAGE = `Usage: npm run test:matrix -- [options]

  --base <url>         backend base URL (default $MATRIX_BASE_URL or http://localhost:3778);
                       a deployed frontend URL works too, its nginx proxies /api
  --provider <id>      only this provider (repeatable)
  --model <id>         only this model id (repeatable)
  --image <file>       send this local image as base64 instead of an Immich asset
  --asset <id>         use this Immich asset (default: newest image on the timeline)
  --prompt <text>      edit instruction
  --concurrency <n>    parallel edits (default 5)
  --timeout <s>        per-edit timeout in seconds (default 320); the provider may
                       still finish — and bill — an edit this script gave up on
  --skip-lora          skip the LoRA edits
  --list               print the matrix and exit without running any edit
  --json <file>        also write full results (incl. error details) to a file
  --help

Set EDITOR_ACCESS_KEY in the environment: the backend refuses /api requests
without the session cookie that key unlocks.`;

const KNOWN_OUTCOMES = [
  { status: 'CREDIT', pattern: /insufficientCredits|Exhausted balance|User is locked/i },
  { status: 'MODERATED', pattern: /DataInspectionFailed/i },
];

const MIME_BY_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

class SetupError extends Error {}

const edits = (n) => `${n} edit${n === 1 ? '' : 's'}`;

function parseOptions() {
  const { values } = parseArgs({
    options: {
      base: { type: 'string', default: process.env.MATRIX_BASE_URL || 'http://localhost:3778' },
      provider: { type: 'string', multiple: true },
      model: { type: 'string', multiple: true },
      image: { type: 'string' },
      asset: { type: 'string' },
      prompt: { type: 'string', default: 'Make the lighting warm golden hour, keep everything else unchanged' },
      concurrency: { type: 'string', default: '5' },
      timeout: { type: 'string', default: '320' },
      'skip-lora': { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
      json: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const concurrency = Number(values.concurrency);
  const timeoutSec = Number(values.timeout);
  if (!(concurrency >= 1) || !(timeoutSec > 0)) throw new SetupError('--concurrency and --timeout must be positive numbers');
  return { ...values, base: values.base.replace(/\/+$/, ''), concurrency, timeoutSec };
}

// The backend's /api routes need the access-key session cookie (src/auth.ts).
// Set by login() when EDITOR_ACCESS_KEY is in the environment — deliberately not
// a flag, so the key stays out of shell history and the process list.
let sessionCookie = null;

async function login(base) {
  const key = process.env.EDITOR_ACCESS_KEY;
  if (!key) return;
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
    signal: AbortSignal.timeout(30_000),
  }).catch((err) => {
    throw new SetupError(`Cannot reach ${base}/api/auth/login: ${err.message}`);
  });
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('gedit_session='));
  if (res.status !== 200 || !cookie) throw new SetupError(`Login with EDITOR_ACCESS_KEY failed (HTTP ${res.status})`);
  sessionCookie = cookie.split(';')[0];
}

/** JSON request to the backend. Never throws on HTTP status — only on network/timeout. */
async function api(base, method, path, body, timeoutMs = 60_000) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (sessionCookie) headers.Cookie = sessionCookie;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text.slice(0, 300) };
  }
  return { status: res.status, data };
}

async function getJson(base, path) {
  let res;
  try {
    res = await api(base, 'GET', path);
  } catch (err) {
    throw new SetupError(`Cannot reach ${base}${path}: ${err.message}`);
  }
  if (res.status === 401 && res.data?.code === 'AUTH_REQUIRED') {
    throw new SetupError('The backend requires its access key — set EDITOR_ACCESS_KEY in the environment');
  }
  if (res.status !== 200) throw new SetupError(`GET ${path} returned ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
  return res.data;
}

async function resolveSource(opts) {
  if (opts.image) {
    const mime = MIME_BY_EXT[extname(opts.image).toLowerCase()];
    if (!mime) throw new SetupError(`--image must be one of ${Object.keys(MIME_BY_EXT).join(' ')}`);
    const b64 = (await readFile(opts.image)).toString('base64');
    return { label: `file ${opts.image}`, fields: { imageBase64: `data:${mime};base64,${b64}` } };
  }
  let assetId = opts.asset;
  let label = `asset ${assetId}`;
  if (!assetId) {
    const items = await getJson(opts.base, '/api/immich/timeline?page=1&size=50');
    const asset = Array.isArray(items) ? items.find((a) => (a.type || 'IMAGE') === 'IMAGE') : undefined;
    if (!asset) throw new SetupError('No image asset on the Immich timeline — pass --asset or --image');
    assetId = asset.id;
    label = `asset ${assetId} (${asset.originalFileName})`;
  }
  // A relative path, exactly as the frontend sends it: each provider resolves it
  // to an internal fetch of the Immich original through the backend.
  return { label, fields: { imageUrl: `/api/immich/assets/${assetId}/original` } };
}

async function pickLora(base) {
  const { categories = {} } = (await getJson(base, '/api/edit/loras')) || {};
  const lora = categories.general?.[0] ?? Object.values(categories).flat()[0];
  return lora ? { id: lora.id, name: lora.name, weight: lora.weight ?? 1 } : null;
}

function buildJobs(providers, opts, lora) {
  const jobs = [];
  for (const p of providers) {
    if (opts.provider && !opts.provider.includes(p.id)) continue;
    for (const m of p.models || []) {
      if (opts.model && !opts.model.includes(m.id)) continue;
      const base = { provider: p.id, model: m.id, configured: p.configured !== false, avgSeconds: m.avgSeconds ?? null };
      jobs.push({ ...base, lora: null });
      if (m.loraCapable && lora && !opts['skip-lora']) jobs.push({ ...base, lora });
    }
  }
  return jobs;
}

function classify(httpStatus, data) {
  if (httpStatus === 200 && typeof data?.imageUrl === 'string' && data.imageUrl) return 'PASS';
  const message = `${data?.error ?? ''} ${JSON.stringify(data?.details ?? '')}`;
  return KNOWN_OUTCOMES.find((o) => o.pattern.test(message))?.status ?? 'FAIL';
}

async function runJob(job, opts, source) {
  if (!job.configured) return { ...job, status: 'SKIP', http: null, seconds: 0, message: 'no API key configured' };

  const body = { ...source.fields, prompt: opts.prompt, provider: job.provider, model: job.model };
  if (job.lora) body.loras = [{ id: job.lora.id, weight: job.lora.weight }];

  const started = Date.now();
  let http = null;
  let data = null;
  let status;
  let message;
  try {
    ({ status: http, data } = await api(opts.base, 'POST', '/api/edit', body, opts.timeoutSec * 1000));
    status = classify(http, data);
    message = status === 'PASS' ? data.imageUrl : String(data?.error ?? `HTTP ${http}`);
  } catch (err) {
    status = 'FAIL';
    message = err.name === 'TimeoutError' ? `timed out after ${opts.timeoutSec}s` : `${err.name}: ${err.message}`;
  }
  return {
    ...job,
    status,
    http,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    message,
    details: status === 'PASS' ? undefined : data?.details,
  };
}

async function runPool(jobs, concurrency, worker) {
  const results = new Array(jobs.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await worker(jobs[i]);
    }
  });
  await Promise.all(lanes);
  return results;
}

const row = (r) =>
  [
    r.status.padEnd(9),
    r.provider.padEnd(10),
    r.model.padEnd(24),
    (r.lora ? '+LoRA' : '').padEnd(6),
    String(r.http ?? '-').padStart(4),
    `${r.seconds.toFixed(1)}s`.padStart(7),
    ' ' + String(r.message).slice(0, 160),
  ].join(' ');

async function main() {
  const opts = parseOptions();
  await login(opts.base);
  const providers = await getJson(opts.base, '/api/settings/providers');
  const lora = opts['skip-lora'] ? null : await pickLora(opts.base);
  const jobs = buildJobs(providers, opts, lora);
  if (!jobs.length) throw new SetupError('No (provider, model) pairs match the given filters');

  console.log(`Backend: ${opts.base}`);
  if (lora) console.log(`LoRA under test: ${lora.id} (${lora.name})`);

  if (opts.list) {
    for (const j of jobs) {
      const eta = j.avgSeconds != null ? `~${j.avgSeconds}s` : '';
      console.log(`  ${j.provider.padEnd(10)} ${j.model.padEnd(24)} ${(j.lora ? '+LoRA' : '').padEnd(6)} ${eta}${j.configured ? '' : '  (no API key)'}`);
    }
    console.log(`${edits(jobs.length)} — nothing was run (--list).`);
    return 0;
  }

  const source = await resolveSource(opts);
  console.log(`Source: ${source.label}`);
  console.log(`Running ${edits(jobs.length)}, ${opts.concurrency} at a time — each PASS spends provider credit.\n`);

  const results = await runPool(jobs, opts.concurrency, async (job) => {
    const r = await runJob(job, opts, source);
    console.log(row(r));
    return r;
  });

  console.log('\nSummary');
  const sorted = [...results].sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
  for (const r of sorted) console.log('  ' + row(r));
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  console.log('\n' + Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · '));

  if (opts.json) {
    const out = { base: opts.base, source: source.label, lora, ranAt: new Date().toISOString(), results };
    await writeFile(opts.json, JSON.stringify(out, null, 2));
    console.log(`Full results written to ${opts.json}`);
  }
  return counts.FAIL ? 1 : 0;
}

// exitCode rather than process.exit(): exiting immediately can truncate output
// still buffered for a pipe (e.g. `| tee results.log`).
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err instanceof SetupError ? `Setup error: ${err.message}` : err);
    process.exitCode = 2;
  }
);
