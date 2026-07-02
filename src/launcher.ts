import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {buildFeatureArgs, type CliName, discoverFeatures, type Feature} from './features.js';

export type DetectedCli = {
  name: CliName;
  path: string;
};

export type LaunchPlan = {
  cli: DetectedCli;
  args: string[];
  ipInfo: string;
  debugCommand?: string;
};

export type PlanLaunchOptions = {
  argv: string[];
  env: NodeJS.ProcessEnv;
  selectCli: (clis: DetectedCli[]) => Promise<DetectedCli>;
  selectFeatures: (features: Feature[], cli: CliName) => Promise<Feature[]>;
  confirm: (cli: CliName, ipInfo: string) => Promise<boolean>;
  fetchIpInfo: () => Promise<string>;
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

function trim(value: string): string {
  return value.trim();
}

function validateIpInfo(ipInfo: string, apiUrl: string): void {
  if (!trim(ipInfo).startsWith('{')) {
    throw new Error(`Invalid JSON from ${apiUrl}`);
  }
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

export async function planLaunch(options: PlanLaunchOptions): Promise<LaunchPlan> {
  const apiUrl = options.env.SCC_API || 'https://ipinfo.io';
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

  let ipInfo: string;
  try {
    ipInfo = await options.fetchIpInfo();
  } catch {
    throw new Error(`Failed to fetch ${apiUrl}`);
  }
  validateIpInfo(ipInfo, apiUrl);

  if (!(await options.confirm(cli.name, ipInfo))) {
    throw new Error('Cancelled.');
  }

  const args = [...buildFeatureArgs(cli.name, selectedFeatures), ...options.argv];
  const debugCommand = invalidDebugValue(options.env.AL_DEBUG)
    ? undefined
    : formatLaunchCommand(cli.name, args);

  return {
    cli,
    args,
    ipInfo,
    debugCommand
  };
}
