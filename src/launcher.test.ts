import {mkdtemp, mkdir, realpath, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {detectClis, detectLocalProxyType, invalidDebugValue, planLaunch} from './launcher.js';

let tempRoots: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-launcher-bin-'));
  tempRoots.push(dir);
  return dir;
}

async function fakeExecutable(dir: string, name: string): Promise<string> {
  const filePath = path.join(dir, name);
  await writeFile(filePath, '#!/usr/bin/env bash\nexit 0\n', {mode: 0o755});
  return filePath;
}

afterEach(async () => {
  await Promise.all(tempRoots.map(async root => {
    await import('node:fs/promises').then(fs => fs.rm(root, {recursive: true, force: true}));
  }));
  tempRoots = [];
});

describe('launcher planning', () => {
  it('detects supported CLIs from PATH in stable order', async () => {
    const bin = await tempDir();
    const codex = await fakeExecutable(bin, 'codex');
    const claude = await fakeExecutable(bin, 'claude');

    await expect(detectClis(`${bin}${path.delimiter}/usr/bin`)).resolves.toEqual([
      {name: 'codex', path: codex},
      {name: 'claude', path: claude}
    ]);
  });

  it('rejects missing CLIs', async () => {
    const home = await tempDir();
    await expect(planLaunch({
      argv: ['--model', 'gpt-5'],
      env: {PATH: '/usr/bin', HOME: home},
      selectCli: vi.fn(),
      selectFeatures: vi.fn(),
      confirm: vi.fn(),
      confirmNetworkFailure: vi.fn(),
      checkNetwork: vi.fn()
    })).rejects.toThrow('No supported CLI found');
  });

  it('uses selected CLI, feature args, and forwarded args when confirmed', async () => {
    const home = await tempDir();
    const bin = path.join(home, 'bin');
    await mkdir(bin);
    const codex = await fakeExecutable(bin, 'codex');
    const skillDir = path.join(home, '.codex/skills/alpha');
    await mkdir(skillDir, {recursive: true});
    await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: alpha\n---\n');

    const plan = await planLaunch({
      argv: ['--foo'],
      env: {PATH: bin, HOME: home},
      selectCli: vi.fn(),
      selectFeatures: vi.fn(async features => features.map(feature => ({...feature, selected: false}))),
      confirm: vi.fn(async () => true),
      confirmNetworkFailure: vi.fn(),
      checkNetwork: vi.fn(async () => ({
        publicIpInfo: 'IP\t: 1.2.3.4\n地址\t: 中国',
        proxyType: 'no-proxy'
      }))
    });
    const realSkillDir = await realpath(skillDir);

    expect(plan).toEqual({
      cli: {name: 'codex', path: codex},
      args: ['-c', `skills.config=[{path="${realSkillDir}/SKILL.md",enabled=false}]`, '--foo'],
      networkInfo: {
        publicIpInfo: 'IP\t: 1.2.3.4\n地址\t: 中国',
        proxyType: 'no-proxy'
      },
      debugCommand: undefined
    });
  });

  it('lets users ignore failed public IP checks and continue', async () => {
    const home = await tempDir();
    const bin = path.join(home, 'bin');
    await mkdir(bin);
    await fakeExecutable(bin, 'claude');
    const confirmNetworkFailure = vi.fn(async () => true);
    const confirm = vi.fn(async () => true);

    const plan = await planLaunch({
      argv: [],
      env: {PATH: bin, HOME: home},
      selectCli: vi.fn(),
      selectFeatures: vi.fn(),
      confirm,
      confirmNetworkFailure,
      checkNetwork: vi.fn(async () => {
        throw new Error('curl exited with code 28');
      })
    });

    expect(confirmNetworkFailure).toHaveBeenCalledWith('curl exited with code 28');
    expect(confirm).not.toHaveBeenCalled();
    expect(plan.networkInfo).toEqual({
      publicIpInfo: 'Public IP check skipped after failure: curl exited with code 28',
      proxyType: 'unknown'
    });
  });

  it('rejects cancelled confirmations', async () => {
    const home = await tempDir();
    const bin = path.join(home, 'bin');
    await mkdir(bin);
    await fakeExecutable(bin, 'claude');

    await expect(planLaunch({
      argv: [],
      env: {PATH: bin, HOME: home},
      selectCli: vi.fn(),
      selectFeatures: vi.fn(),
      confirm: vi.fn(async () => false),
      confirmNetworkFailure: vi.fn(),
      checkNetwork: vi.fn(async () => ({
        publicIpInfo: 'IP\t: 1.2.3.4',
        proxyType: 'no-proxy'
      }))
    })).rejects.toThrow('Cancelled');
  });

  it('detects proxy type from environment and virtual network interfaces', () => {
    expect(detectLocalProxyType({}, {})).toBe('no-proxy');
    expect(detectLocalProxyType({HTTPS_PROXY: 'http://127.0.0.1:7890'}, {})).toBe('http-proxy');
    expect(detectLocalProxyType({ALL_PROXY: 'socks5://127.0.0.1:7891'}, {})).toBe('socks5-proxy');
    expect(detectLocalProxyType({}, {utun4: [{address: '10.0.0.2', family: 'IPv4', internal: false}]})).toBe('virtual-nic-proxy');
  });

  it('recognizes false-like debug values', () => {
    expect(invalidDebugValue(undefined)).toBe(true);
    expect(invalidDebugValue('off')).toBe(true);
    expect(invalidDebugValue('0')).toBe(true);
    expect(invalidDebugValue('yes')).toBe(false);
  });
});
