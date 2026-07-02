#!/usr/bin/env node
import {execFile, spawn} from 'node:child_process';
import {networkInterfaces} from 'node:os';
import {promisify} from 'node:util';
import {detectLocalProxyType, planLaunch, type NetworkInfo} from './launcher.js';
import {promptCli, promptConfirm, promptFeatures, promptNetworkFailure} from './ui.js';

const execFileAsync = promisify(execFile);

async function checkNetwork(): Promise<NetworkInfo> {
  const proxyType = detectLocalProxyType(process.env, networkInterfaces());
  try {
    const {stdout} = await execFileAsync('curl', ['-fsSL', '--max-time', '5', 'cip.cc'], {
      timeout: 7000,
      maxBuffer: 1024 * 1024
    });
    const publicIpInfo = stdout.trim();
    if (!publicIpInfo) {
      throw new Error('curl cip.cc returned an empty response');
    }
    return {publicIpInfo, proxyType};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`curl cip.cc failed (${proxyType}): ${message}`);
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
    confirmNetworkFailure: promptNetworkFailure,
    checkNetwork
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
