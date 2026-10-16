// Minimal Chrome DevTools Protocol driver for verifying Trace in a real browser.
// Uses Node's built-in fetch and WebSocket. No dependencies.
// Not part of the shipped site; this is a development tool under tools/.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const { existsSync } = require('node:fs');
  return candidates.find((c) => existsSync(c)) || 'google-chrome';
}

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export async function launch({ width = 1440, height = 900, port = 0 } = {}) {
  const chrome = findChrome();
  const profile = mkdtempSync(join(tmpdir(), 'trace-chrome-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--hide-scrollbars=false',
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--remote-debugging-port=' + (port || 0),
    'about:blank',
  ];
  const proc = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderrChunks = [];
  proc.stderr.on('data', (d) => stderrChunks.push(d.toString()));

  // Read the actual debugging port from stderr (DevTools listening on ws://...).
  const ws = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome did not report a DevTools endpoint. stderr:\n' + stderrChunks.join(''))), 20000);
    const onData = (d) => {
      const m = d.toString().match(/ws:\/\/[^\s]+/);
      if (m) { clearTimeout(timer); proc.stderr.off('data', onData); resolve(m[0]); }
    };
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error('Chrome exited early code=' + code + '\n' + stderrChunks.join(''))); });
  });

  const httpBase = ws.replace('ws://', 'http://').replace(/\/devtools\/browser\/.*/, '');
  // Create a page target.
  const t = await (await fetch(httpBase + '/json/new?about:blank', { method: 'PUT' })).json();
  const pageWs = t.webSocketDebuggerUrl;

  const conn = await connect(pageWs);
  return { proc, httpBase, conn, profile };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const listeners = new Map();
    const consoleMessages = [];
    const exceptions = [];
    const logEntries = [];
    const events = [];

    socket.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message + ' ' + JSON.stringify(msg.error.data || '')));
        else res(msg.result);
        return;
      }
      if (msg.method) {
        events.push(msg);
        if (msg.method === 'Runtime.consoleAPICalled') {
          consoleMessages.push({ type: msg.params.type, args: msg.params.args.map((a) => a.value ?? a.description ?? a.type) });
        } else if (msg.method === 'Runtime.exceptionThrown') {
          exceptions.push(msg.params.exceptionDetails);
        } else if (msg.method === 'Log.entryAdded') {
          logEntries.push(msg.params.entry);
        }
        const ls = listeners.get(msg.method);
        if (ls) for (const fn of ls) fn(msg.params);
      }
    });

    socket.addEventListener('error', (e) => reject(new Error('WebSocket error: ' + e.message)));
    socket.addEventListener('open', () => {
      const send = (method, params = {}) => new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        socket.send(JSON.stringify({ id: mid, method, params }));
      });

      const on = (method, fn) => {
        if (!listeners.has(method)) listeners.set(method, new Set());
        listeners.get(method).add(fn);
        return () => listeners.get(method).delete(fn);
      };

      const waitEvent = (method, timeout = 30000) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { off(); reject(new Error('timeout waiting for ' + method)); }, timeout);
        const off = on(method, (p) => { clearTimeout(timer); off(); resolve(p); });
      });

      const evalJs = async (expression, { awaitPromise = true, returnByValue = true } = {}) => {
        const r = await send('Runtime.evaluate', {
          expression,
          awaitPromise,
          returnByValue,
          userGesture: true,
          allowUnsafeEvalBlockedByCSP: true,
        });
        if (r.exceptionDetails) {
          const ex = r.exceptionDetails;
          throw new Error('Evaluate threw: ' + (ex.exception?.description || ex.text));
        }
        return r.result.value;
      };

      const navigate = async (url) => {
        const loaded = waitEvent('Page.loadEventFired', 30000).catch(() => {});
        await send('Page.navigate', { url });
        await loaded;
      };

      const screenshot = async (path, opts = {}) => {
        const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...opts });
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, Buffer.from(r.data, 'base64'));
      };

      resolve({
        send, on, waitEvent, evaluate: evalJs, navigate, screenshot,
        consoleMessages, exceptions, logEntries, events,
        close: () => { try { socket.close(); } catch {} },
      });
    });
  });
}

export async function prepare(conn) {
  await conn.send('Runtime.enable');
  await conn.send('Log.enable');
  await conn.send('Page.enable');
  await conn.send('Network.enable');
}

export function summarizeProblems(conn) {
  const errs = conn.consoleMessages.filter((m) => m.type === 'error');
  const warns = conn.consoleMessages.filter((m) => m.type === 'warning');
  const ex = conn.exceptions;
  const severe = conn.logEntries.filter((e) => e.level === 'error' && !/favicon/i.test(e.text || ''));
  return { consoleErrors: errs, consoleWarnings: warns, exceptions: ex, logErrors: severe };
}
