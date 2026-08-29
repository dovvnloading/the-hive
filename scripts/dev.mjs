#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const bridgeScript = fileURLToPath(
  new URL('./arena-bridge.mjs', import.meta.url),
);
const vinextCli = fileURLToPath(
  new URL('../node_modules/vinext/dist/cli.js', import.meta.url),
);
const bridgePort = Number(process.env.ARENA_BRIDGE_PORT || 8787);
const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
const forwardedArgs = process.argv.slice(2);

let web;
let stopping = false;
let exitCode = 0;

function launch(script, args = []) {
  return spawn(process.execPath, [script, ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  if (web && !web.killed) web.kill();
  if (bridge && !bridge.killed) bridge.kill();
  setTimeout(() => process.exit(exitCode), 250).unref();
}

async function waitForBridge() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (bridge.exitCode !== null) {
      throw new Error(`arena bridge exited with code ${bridge.exitCode}`);
    }
    try {
      const response = await fetch(`${bridgeUrl}/health`);
      if (response.ok) return;
    } catch {
      // The bridge has not started listening yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`arena bridge did not become ready at ${bridgeUrl}`);
}

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

const bridge = launch(bridgeScript);
bridge.once('exit', (code, signal) => {
  if (!stopping) {
    process.stderr.write(
      `[dev] arena bridge stopped unexpectedly (${signal || `code ${code ?? 1}`})\n`,
    );
    stop(code || 1);
  }
});

try {
  await waitForBridge();
  web = launch(vinextCli, ['dev', ...forwardedArgs]);
  web.once('exit', (code, signal) => {
    if (!stopping && signal)
      process.stderr.write(`[dev] web server stopped (${signal})\n`);
    stop(code || 0);
  });
} catch (error) {
  process.stderr.write(`[dev] ${error.message}\n`);
  stop(1);
}
