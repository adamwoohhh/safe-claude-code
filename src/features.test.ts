import {mkdtemp, mkdir, realpath, writeFile, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  buildClaudeFeatureArgs,
  buildCodexFeatureArgs,
  discoverFeatures,
  groupFeatures,
  sortFeatures
} from './features.js';

let tempRoots: string[] = [];

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-launcher-test-'));
  tempRoots.push(dir);
  return dir;
}

async function addSkill(dir: string, name: string): Promise<string> {
  const skillDir = path.join(dir, name);
  await mkdir(skillDir, {recursive: true});
  await writeFile(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  return skillDir;
}

afterEach(async () => {
  await Promise.all(tempRoots.map(async root => {
    await import('node:fs/promises').then(fs => fs.rm(root, {recursive: true, force: true}));
  }));
  tempRoots = [];
});

describe('feature discovery', () => {
  it('discovers Codex skills from agents and codex roots plus enabled plugins only', async () => {
    const home = await tempHome();
    await addSkill(path.join(home, '.agents/skills'), 'zeta');
    await addSkill(path.join(home, '.codex/skills'), 'alpha');
    await mkdir(path.join(home, '.codex'), {recursive: true});
    await writeFile(path.join(home, '.codex/config.toml'), [
      '[plugins."browser@openai-bundled"]',
      'enabled = true',
      '',
      '[plugins."disabled-plugin"]',
      'enabled = false',
      '',
      '[mcp_servers.node_repl]',
      'command = "node-repl"'
    ].join('\n'));

    const features = await discoverFeatures('codex', home);

    expect(features.map(feature => `${feature.type}:${feature.name}`)).toEqual([
      'skill:alpha',
      'skill:zeta',
      'plugin:browser@openai-bundled'
    ]);
  });

  it('follows symlinked bundle skills and stores real directories', async () => {
    const home = await tempHome();
    const realBundle = path.join(home, 'real-superpowers');
    await addSkill(realBundle, 'brainstorming');
    await addSkill(realBundle, 'systematic-debugging');
    await mkdir(path.join(home, '.agents/skills'), {recursive: true});
    await symlink(realBundle, path.join(home, '.agents/skills/superpowers'));

    const features = await discoverFeatures('codex', home);
    const realBrainstorming = await realpath(path.join(realBundle, 'brainstorming'));

    expect(features.map(feature => feature.name)).toEqual([
      'superpowers:brainstorming',
      'superpowers:systematic-debugging'
    ]);
    expect(features[0]?.path).toBe(realBrainstorming);
  });
});

describe('feature grouping and args', () => {
  it('sorts by type then display name and groups shared prefixes', () => {
    const sorted = groupFeatures(sortFeatures([
      {type: 'plugin', name: 'official:lark-im', path: '/p1', selected: true, group: 'plugin'},
      {type: 'skill', name: 'understand-chat', path: '/s2', selected: true, group: 'skill'},
      {type: 'skill', name: 'understand', path: '/s1', selected: true, group: 'skill'},
      {type: 'plugin', name: 'official:browser', path: '/p2', selected: true, group: 'plugin'}
    ]));

    expect(sorted.map(feature => `${feature.type}:${feature.name}:${feature.group}`)).toEqual([
      'skill:understand:skill:understand',
      'skill:understand-chat:skill:understand',
      'plugin:official:browser:plugin',
      'plugin:official:lark-im:plugin'
    ]);
  });

  it('builds Codex config overrides for disabled skills and plugins', () => {
    const args = buildCodexFeatureArgs([
      {type: 'skill', name: 'alpha', path: '/real/alpha', selected: false, group: 'skill'},
      {type: 'skill', name: 'beta', path: '/real/beta', selected: true, group: 'skill'},
      {type: 'plugin', name: 'browser@openai-bundled', path: '/config', selected: false, group: 'plugin'}
    ]);

    expect(args).toEqual([
      '-c',
      'skills.config=[{path="/real/alpha/SKILL.md",enabled=false}]',
      '-c',
      'plugins."browser@openai-bundled".enabled=false'
    ]);
  });

  it('builds one Claude settings override for disabled skills and marketplace plugins', () => {
    const args = buildClaudeFeatureArgs([
      {type: 'skill', name: 'alpha', path: '/skill', selected: false, group: 'skill'},
      {type: 'plugin', name: 'official:plugin-alpha', path: '/plugin', selected: false, group: 'plugin'}
    ]);

    expect(args).toEqual([
      '--settings',
      '{"skillOverrides":{"alpha":"off"},"enabledPlugins":{"plugin-alpha@official":false}}'
    ]);
  });
});
