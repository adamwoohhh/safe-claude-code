import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import type {NetworkInterfaceInfo} from 'node:os';
import path from 'node:path';
import {buildFeatureArgs, type CliName, discoverFeatures, type Feature} from './features.js';

export type DetectedCli = {
  name: CliName;
  path: string;
};

export type LaunchPlan = {
  cli: DetectedCli;
  args: string[];
  networkInfo: NetworkInfo;
  debugCommand?: string;
};

export type ProxyType = 'no-proxy' | 'http-proxy' | 'socks5-proxy' | 'virtual-nic-proxy' | 'unknown';

export type NetworkInfo = {
  publicIpInfo: string;
  proxyType: ProxyType;
};

export type PlanLaunchOptions = {
  argv: string[];
  env: NodeJS.ProcessEnv;
  selectCli: (clis: DetectedCli[]) => Promise<DetectedCli>;
  selectFeatures: (features: Feature[], cli: CliName) => Promise<Feature[]>;
  confirm: (cli: CliName, networkInfo: NetworkInfo) => Promise<boolean>;
  confirmNetworkFailure: (message: string) => Promise<boolean>;
  checkNetwork: () => Promise<NetworkInfo>;
};

async function executablePath(dir: string, command: CliName): Promise<string | undefined> {
  const filePath = path.join(dir, command);
  try {
    await access(filePath, constants.X_OK);
    return filePath;
  } catch {
    return undefined;
  }
}

export async function detectClis(pathValue = process.env.PATH ?? ''): Promise<DetectedCli[]> {
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  const result: DetectedCli[] = [];

  for (const name of ['codex', 'claude'] as const) {
    for (const dir of dirs) {
      const found = await executablePath(dir, name);
      if (found) {
        result.push({name, path: found});
        break;
      }
    }
  }

  return result;
}

export function invalidDebugValue(value: string | undefined): boolean {
  return value === undefined || value === '' || /^(0|false|no|off)$/i.test(value);
}

function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

export function formatLaunchCommand(cli: string, args: string[]): string {
  return ['Launch command:', cli, ...args].map((part, index) => index === 0 ? part : shellQuote(part)).join(' ');
}

export function detectLocalProxyType(
  env: NodeJS.ProcessEnv,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>
): ProxyType {
  const proxyValue = [
    env.ALL_PROXY,
    env.all_proxy,
    env.HTTPS_PROXY,
    env.https_proxy,
    env.HTTP_PROXY,
    env.http_proxy
  ].find(value => value?.trim());

  if (proxyValue) {
    return /^socks5?:\/\//i.test(proxyValue) ? 'socks5-proxy' : 'http-proxy';
  }

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!/^(utun|tun|tap|ppp|wg|tailscale|zt|warp|clash|mihomo)/i.test(name)) {
      continue;
    }
    if (addresses?.some(address => !address.internal)) {
      return 'virtual-nic-proxy';
    }
  }

  return 'no-proxy';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function planLaunch(options: PlanLaunchOptions): Promise<LaunchPlan> {
  const clis = await detectClis(options.env.PATH ?? '');

  if (clis.length === 0) {
    throw new Error('No supported CLI found. Install codex or claude first.');
  }

  const cli = clis.length === 1 ? clis[0]! : await options.selectCli(clis);
  const home = options.env.HOME ?? '';
  const features = await discoverFeatures(cli.name, home);
  const selectedFeatures = features.length > 0
    ? await options.selectFeatures(features, cli.name)
    : features;

  let networkInfo: NetworkInfo;
  try {
    networkInfo = await options.checkNetwork();
  } catch (error) {
    const message = errorMessage(error);
    if (!(await options.confirmNetworkFailure(message))) {
      throw new Error('Cancelled.');
    }
    networkInfo = {
      publicIpInfo: `Public IP check skipped after failure: ${message}`,
      proxyType: 'unknown'
    };
  }

  if (networkInfo.proxyType !== 'unknown' && !(await options.confirm(cli.name, networkInfo))) {
    throw new Error('Cancelled.');
  }

  const args = [...buildFeatureArgs(cli.name, selectedFeatures), ...options.argv];
  const debugCommand = invalidDebugValue(options.env.AL_DEBUG)
    ? undefined
    : formatLaunchCommand(cli.name, args);

  return {
    cli,
    args,
    networkInfo,
    debugCommand
  };
}
