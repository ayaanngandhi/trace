// Quick shell check: load index.html over http and file://, report console problems,
// module script count, horizontal overflow at 360 and 1440, and capture screenshots.
import { launch, prepare, summarizeProblems } from './browser.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolve, join } from 'node:path';

const PORT = 8137;
const ROOT = resolve(new URL('..', import.meta.url).pathname);

async function startServer() {
  const p = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] });
  await sleep(700);
  return p;
}

function showerrors(label, conn) {
  const { consoleErrors, exceptions, logErrors } = summarizeProblems(conn);
  console.log(`\n[${label}] console errors: ${consoleErrors.length}, exceptions: ${exceptions.length}, log errors: ${logErrors.length}`);
  for (const e of consoleErrors) console.log('  console.error:', JSON.stringify(e.args));
  for (const e of exceptions) console.log('  exception:', e.exception?.description || e.text);
  for (const e of logErrors) console.log('  log:', e.text, e.url || '');
}

async function main() {
  const server = await startServer();
  const { proc, conn, httpBase } = await launch({ width: 1440, height: 900 });
  try {
    await prepare(conn);
    await conn.navigate(`http://127.0.0.1:${PORT}/index.html`);
    const info = await conn.evaluate(`({
      modules: document.querySelectorAll('script[type=module]').length,
      title: document.title,
      h1: document.querySelector('h1')?.textContent,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    })`);
    console.log('[http]', JSON.stringify(info));
    showerrors('http', conn);
    await conn.screenshot(join(ROOT, 'docs/screens/empty-1440.png'));

    const { conn: c2 } = { conn };
    await conn.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
    await sleep(250);
    const narrow = await conn.evaluate(`({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, bodyScrollW: document.body.scrollWidth })`);
    console.log('[360]', JSON.stringify(narrow));
    await conn.send('Emulation.clearDeviceMetricsOverride');

    // file:// test
    const { conn: fileConn, proc: p2 } = await launch({ width: 900, height: 700 });
    await prepare(fileConn);
    await fileConn.navigate('file://' + ROOT + '/index.html');
    await sleep(500);
    const finfo = await fileConn.evaluate(`({ modules: document.querySelectorAll('script[type=module]').length, hasJs: document.documentElement.classList.contains('js') })`);
    console.log('[file]', JSON.stringify(finfo));
    showerrors('file', fileConn);
    fileConn.close(); p2.kill('SIGKILL');
  } finally {
    conn.close(); proc.kill('SIGKILL'); server.kill('SIGKILL');
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
