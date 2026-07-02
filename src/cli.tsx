#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {planLaunch} from './launcher.js';
import {promptCli, promptConfirm, promptFeatures} from './ui.js';

async function fetchIpInfo(): Promise<string> {
  const apiUrl = process.env.SCC_API || 'https://ipinfo.io';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {'user-agent': 'agent-launcher'}
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function printError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'Cancelled.') {
    console.error('Cancelled.');
  } else {
    console.error(`Error: ${message}`);
  }
}

async function main(): Promise<void> {
  const plan = await planLaunch({
    argv: process.argv.slice(2),
    env: process.env,
    selectCli: promptCli,
    selectFeatures: promptFeatures,
    confirm: promptConfirm,
    fetchIpInfo
  });

  if (plan.debugCommand) {
    console.error(plan.debugCommand);
  }

  const child = spawn(plan.cli.path, plan.args, {stdio: 'inherit'});
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
  child.on('error', error => {
    printError(error);
    process.exit(1);
  });
}

main().catch(error => {
  printError(error);
  process.exit(1);
});
