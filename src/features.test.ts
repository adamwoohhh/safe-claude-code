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

  it('groups skills by lock file before falling back to inferred groups', async () => {
    const home = await tempHome();
    const agentsRoot = path.join(home, '.agents');
    const skillRoot = path.join(agentsRoot, 'skills');
    await addSkill(skillRoot, 'lark-workflow-meeting-summary');
    await addSkill(skillRoot, 'lark-workflow-standup-report');
    await addSkill(skillRoot, 'solo');
    await mkdir(agentsRoot, {recursive: true});
    await writeFile(path.join(agentsRoot, '.skill-lock.json'), JSON.stringify({
      version: 3,
      skills: {
        'lark-workflow-meeting-summary': {source: 'open.feishu.cn'},
        'lark-workflow-standup-report': {source: 'open.feishu.cn'}
      }
    }));

    const features = await discoverFeatures('codex', home);

    expect(features.map(feature => `${feature.name}:${feature.group}`)).toEqual([
      'solo:skill',
      'lark-workflow-meeting-summary:skill:lark',
      'lark-workflow-standup-report:skill:lark'
    ]);
  });

  it('uses pluginName from the lock file as the group label when present', async () => {
    const home = await tempHome();
    const agentsRoot = path.join(home, '.agents');
    const skillRoot = path.join(agentsRoot, 'skills');
    await addSkill(skillRoot, 'ask-matt');
    await addSkill(skillRoot, 'codebase-design');
    await mkdir(agentsRoot, {recursive: true});
    await writeFile(path.join(agentsRoot, '.skill-lock.json'), JSON.stringify({
      version: 3,
      skills: {
        'ask-matt': {source: 'mattpocock/skills', pluginName: 'mattpocock-skills'},
        'codebase-design': {source: 'mattpocock/skills', pluginName: 'mattpocock-skills'}
      }
    }));

    const features = await discoverFeatures('codex', home);

    expect(features.map(feature => `${feature.name}:${feature.group}`)).toEqual([
      'ask-matt:skill:mattpocock-skills',
      'codebase-design:skill:mattpocock-skills'
    ]);
  });

  it('uses one label for all skills from the same lock source', async () => {
    const home = await tempHome();
    const agentsRoot = path.join(home, '.agents');
    const skillRoot = path.join(agentsRoot, 'skills');
    await addSkill(skillRoot, 'ask-matt');
    await addSkill(skillRoot, 'review');
    await mkdir(agentsRoot, {recursive: true});
    await writeFile(path.join(agentsRoot, '.skill-lock.json'), JSON.stringify({
      version: 3,
      skills: {
        'ask-matt': {source: 'mattpocock/skills', pluginName: 'mattpocock-skills'},
        review: {source: 'mattpocock/skills'}
      }
    }));

    const features = await discoverFeatures('codex', home);

    expect(features.map(feature => `${feature.name}:${feature.group}`)).toEqual([
      'ask-matt:skill:mattpocock-skills',
      'review:skill:mattpocock-skills'
    ]);
  });

  it('uses the source repo name as the group label for github lock sources', async () => {
    const home = await tempHome();
    const agentsRoot = path.join(home, '.agents');
    const skillRoot = path.join(agentsRoot, 'skills');
    await addSkill(skillRoot, 'feishu-cli-api');
    await addSkill(skillRoot, 'feishu-cli-doc');
    await mkdir(agentsRoot, {recursive: true});
    await writeFile(path.join(agentsRoot, '.skill-lock.json'), JSON.stringify({
      version: 3,
      skills: {
        'feishu-cli-api': {source: 'riba2534/feishu-cli'},
        'feishu-cli-doc': {source: 'riba2534/feishu-cli'}
      }
    }));

    const features = await discoverFeatures('codex', home);

    expect(features.map(feature => `${feature.name}:${feature.group}`)).toEqual([
      'feishu-cli-api:skill:feishu-cli',
      'feishu-cli-doc:skill:feishu-cli'
    ]);
  });
});

describe('feature grouping and args', () => {
  it('keeps features from the same group contiguous after grouping', () => {
    const grouped = groupFeatures(sortFeatures([
      {type: 'skill', name: 'alpha', path: '/s1', selected: true, group: 'skill'},
      {type: 'skill', name: 'lark-doc', path: '/s2', selected: true, group: 'skill', lockedGroup: {key: 'open.feishu.cn'}},
      {type: 'skill', name: 'solo', path: '/s3', selected: true, group: 'skill'},
      {type: 'skill', name: 'lark-drive', path: '/s4', selected: true, group: 'skill', lockedGroup: {key: 'open.feishu.cn'}}
    ]));

    const seen = new Set<string>();
    let previousGroup = '';
    for (const feature of grouped) {
      if (feature.group === previousGroup) {
        continue;
      }
      expect(seen.has(feature.group)).toBe(false);
      seen.add(feature.group);
      previousGroup = feature.group;
    }
  });

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
