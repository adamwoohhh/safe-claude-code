import {readdir, readFile, realpath, stat} from 'node:fs/promises';
import path from 'node:path';

export type CliName = 'codex' | 'claude';
export type FeatureType = 'skill' | 'plugin';

export type Feature = {
  type: FeatureType;
  name: string;
  path: string;
  selected: boolean;
  group: string;
  lockedGroup?: {
    key: string;
    label?: string;
  };
};

const skillLockFiles = ['.skill-lock.json', 'skill-lock.json', 'skills-lock.json'];
const skillNameFields = ['skill', 'skillName', 'skill_name', 'name', 'id'];
const skillGroupLabelFields = [
  'group',
  'pluginName',
  'plugin_name',
  'pluginId',
  'plugin_id',
  'package',
  'packageName',
  'package_name',
  'bundle',
  'namespace'
];
const skillGroupFields = [
  'plugin',
  'source',
  'sourceName',
  'source_name',
  'sourceUrl',
  'source_url',
  ...skillGroupLabelFields
];
const containerKeys = new Set(['skills', 'skill', 'plugins', 'plugin', 'sources', 'packages', 'groups']);

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function realDir(dir: string): Promise<string | undefined> {
  try {
    return await realpath(dir);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function assignSkillGroup(
  groups: Map<string, {key: string; label?: string}>,
  skill: string,
  group: string,
  label?: string
): void {
  const normalizedSkill = skill.trim();
  const normalizedGroup = group.trim();
  if (normalizedSkill && normalizedGroup && normalizedSkill !== normalizedGroup) {
    groups.set(normalizedSkill, {key: normalizedGroup, label});
  }
}

function assignSkillsFromValue(
  groups: Map<string, {key: string; label?: string}>,
  value: unknown,
  group: string,
  label?: string
): void {
  if (typeof value === 'string') {
    assignSkillGroup(groups, value, group, label);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assignSkillsFromValue(groups, item, group, label);
    }
    return;
  }
  if (isRecord(value)) {
    const skill = stringField(value, skillNameFields);
    if (skill) {
      assignSkillGroup(groups, skill, group, label);
    }
  }
}

function collectSkillLockGroups(
  value: unknown,
  groups: Map<string, {key: string; label?: string}>,
  parentKey?: string
): void {
  if (Array.isArray(value)) {
    if (parentKey && !containerKeys.has(parentKey)) {
      assignSkillsFromValue(groups, value, parentKey);
    }
    for (const item of value) {
      collectSkillLockGroups(item, groups);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  const group = stringField(value, skillGroupFields)
    ?? (parentKey && !containerKeys.has(parentKey) ? parentKey : undefined);
  const label = stringField(value, skillGroupLabelFields);
  const skill = stringField(value, skillNameFields);
  if (group && skill) {
    assignSkillGroup(groups, skill, group, label);
  }
  if (group && parentKey && !containerKeys.has(parentKey)) {
    assignSkillGroup(groups, parentKey, group, label);
  }
  if (group && 'skills' in value) {
    assignSkillsFromValue(groups, value.skills, group, label);
  }

  for (const [key, child] of Object.entries(value)) {
    collectSkillLockGroups(child, groups, key);
  }
}

async function readSkillLockGroups(root: string): Promise<Map<string, {key: string; label?: string}>> {
  const groups = new Map<string, {key: string; label?: string}>();
  const roots = [path.dirname(root), root];
  for (const lockRoot of roots) {
    for (const file of skillLockFiles) {
      const raw = await readFile(path.join(lockRoot, file), 'utf8').catch(() => '');
      if (!raw) {
        continue;
      }
      try {
        collectSkillLockGroups(JSON.parse(raw), groups);
      } catch {
        continue;
      }
    }
  }
  return groups;
}

function agentsSkillRootFromPath(filePath: string): string | undefined {
  const resolved = path.resolve(filePath);
  const parts = resolved.split(path.sep);
  const agentsIndex = parts.findIndex((part, index) => part === '.agents' && parts[index + 1] === 'skills');
  if (agentsIndex < 0) {
    return undefined;
  }
  return path.join(path.sep, ...parts.slice(1, agentsIndex + 2));
}

async function lockGroupsForResolvedPath(
  baseGroups: Map<string, {key: string; label?: string}>,
  resolvedPath: string
): Promise<Map<string, {key: string; label?: string}>> {
  const agentsSkillRoot = agentsSkillRootFromPath(resolvedPath);
  if (!agentsSkillRoot) {
    return baseGroups;
  }

  return new Map([
    ...baseGroups,
    ...(await readSkillLockGroups(agentsSkillRoot))
  ]);
}

function sourceSlug(source: string): string {
  const trimmed = source.trim().replace(/\.git$/, '');
  if (trimmed.includes('/')) {
    return trimmed.split('/').filter(Boolean).at(-1) ?? trimmed;
  }
  return trimmed;
}

function commonPrefix(features: Feature[]): string | undefined {
  const prefixes = new Set(features.map(prefixFor));
  return prefixes.size === 1 ? [...prefixes][0] : undefined;
}

function lockedGroupLabel(group: {key: string; label?: string}, members: Feature[]): string {
  const memberLabel = members
    .map(member => member.lockedGroup?.label)
    .find(label => label && label.trim());
  if (memberLabel) {
    return memberLabel;
  }
  if (group.key.includes('/')) {
    return sourceSlug(group.key);
  }
  const prefix = commonPrefix(members);
  if (prefix) {
    return prefix;
  }
  return sourceSlug(group.key);
}

async function discoverSkillDir(root: string): Promise<Feature[]> {
  if (!(await pathExists(root))) {
    return [];
  }

  const features: Feature[] = [];
  const lockedGroups = await readSkillLockGroups(root);
  const entries = await readdir(root, {withFileTypes: true});
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    const entryPath = path.join(root, entry.name);
    const resolved = await realDir(entryPath);
    if (!resolved) {
      continue;
    }
    const entryLockedGroups = await lockGroupsForResolvedPath(lockedGroups, resolved);

    if (await pathExists(path.join(resolved, 'SKILL.md'))) {
      features.push({
        type: 'skill',
        name: entry.name,
        path: resolved,
        selected: true,
        group: 'skill',
        lockedGroup: entryLockedGroups.get(entry.name)
      });
      continue;
    }

    const children = await readdir(resolved, {withFileTypes: true}).catch(() => []);
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!child.isDirectory() && !child.isSymbolicLink()) {
        continue;
      }
      const childPath = path.join(resolved, child.name);
      const childResolved = await realDir(childPath);
      if (!childResolved || !(await pathExists(path.join(childResolved, 'SKILL.md')))) {
        continue;
      }
      const name = `${entry.name}:${child.name}`;
      features.push({
        type: 'skill',
        name,
        path: childResolved,
        selected: true,
        group: 'skill',
        lockedGroup: entryLockedGroups.get(name) ?? entryLockedGroups.get(child.name) ?? entryLockedGroups.get(entry.name)
      });
    }
  }

  return features;
}

async function discoverCodexPlugins(home: string): Promise<Feature[]> {
  const configPath = path.join(home, '.codex/config.toml');
  const config = await readFile(configPath, 'utf8').catch(() => '');
  if (!config) {
    return [];
  }

  const features: Feature[] = [];
  let plugin = '';
  for (const line of config.split(/\r?\n/)) {
    const header = line.match(/^\[plugins\."([^"]+)"\]$/);
    if (header) {
      plugin = header[1] ?? '';
      continue;
    }
    if (plugin && /^enabled\s*=\s*true\s*$/.test(line)) {
      features.push({
        type: 'plugin',
        name: plugin,
        path: configPath,
        selected: true,
        group: 'plugin'
      });
      plugin = '';
    }
  }
  return features;
}

async function discoverClaudePlugins(home: string): Promise<Feature[]> {
  const root = path.join(home, '.claude/plugins/marketplaces');
  if (!(await pathExists(root))) {
    return [];
  }

  const features: Feature[] = [];
  const marketplaces = await readdir(root, {withFileTypes: true}).catch(() => []);
  for (const marketplace of marketplaces.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!marketplace.isDirectory() && !marketplace.isSymbolicLink()) {
      continue;
    }
    for (const section of ['plugins', 'external_plugins']) {
      const sectionPath = path.join(root, marketplace.name, section);
      const plugins = await readdir(sectionPath, {withFileTypes: true}).catch(() => []);
      for (const plugin of plugins.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!plugin.isDirectory() && !plugin.isSymbolicLink()) {
          continue;
        }
        const pluginPath = path.join(sectionPath, plugin.name);
        if (!(await pathExists(path.join(pluginPath, '.claude-plugin/plugin.json')))) {
          continue;
        }
        features.push({
          type: 'plugin',
          name: `${marketplace.name}:${plugin.name}`,
          path: (await realDir(pluginPath)) ?? pluginPath,
          selected: true,
          group: 'plugin'
        });
      }
    }
  }
  return features;
}

export async function discoverFeatures(cli: CliName, home = process.env.HOME ?? ''): Promise<Feature[]> {
  const features = cli === 'codex'
    ? [
        ...(await discoverSkillDir(path.join(home, '.agents/skills'))),
        ...(await discoverSkillDir(path.join(home, '.codex/skills'))),
        ...(await discoverCodexPlugins(home))
      ]
    : [
        ...(await discoverSkillDir(path.join(home, '.claude/skills'))),
        ...(await discoverClaudePlugins(home))
      ];

  return groupFeatures(sortFeatures(features));
}

function typeRank(type: FeatureType): number {
  return type === 'skill' ? 0 : 1;
}

function baseName(feature: Pick<Feature, 'type' | 'name'>): string {
  if (feature.type === 'plugin' && feature.name.includes(':')) {
    return feature.name.split(':').slice(1).join(':');
  }
  return feature.name;
}

export function sortFeatures(features: Feature[]): Feature[] {
  return [...features].sort((a, b) => {
    const rank = typeRank(a.type) - typeRank(b.type);
    if (rank !== 0) {
      return rank;
    }
    const nameOrder = baseName(a).localeCompare(baseName(b));
    if (nameOrder !== 0) {
      return nameOrder;
    }
    return a.name.localeCompare(b.name);
  });
}

function prefixFor(feature: Feature): string {
  const base = baseName(feature);
  if (feature.type === 'skill' && feature.name.includes(':')) {
    return feature.name.split(':')[0] ?? base;
  }
  if (base.includes('-')) {
    return base.split('-')[0] ?? base;
  }
  return base;
}

export function groupFeatures(features: Feature[]): Feature[] {
  const lockedMembers = new Map<string, Feature[]>();
  for (const feature of features) {
    if (feature.type !== 'skill' || !feature.lockedGroup) {
      continue;
    }
    lockedMembers.set(feature.lockedGroup.key, [...(lockedMembers.get(feature.lockedGroup.key) ?? []), feature]);
  }

  const grouped = features.map(feature => {
    if (feature.type === 'skill' && feature.lockedGroup) {
      const members = lockedMembers.get(feature.lockedGroup.key) ?? [];
      if (members.length < 2) {
        return {
          ...feature,
          group: 'skill'
        };
      }
      return {
        ...feature,
        group: `skill:${lockedGroupLabel(feature.lockedGroup, members)}`
      };
    }

    const prefix = prefixFor(feature);
    const matches = features.filter(candidate => {
      if (candidate.type !== feature.type) {
        return false;
      }
      const candidateBase = baseName(candidate);
      if (candidate.type === 'skill' && candidate.name.startsWith(`${prefix}:`)) {
        return true;
      }
      return candidateBase === prefix || candidateBase.startsWith(`${prefix}-`);
    }).length;

    return {
      ...feature,
      group: matches > 1 ? `${feature.type}:${prefix}` : feature.type
    };
  });

  return grouped.sort((a, b) => {
    const rank = typeRank(a.type) - typeRank(b.type);
    if (rank !== 0) {
      return rank;
    }
    const groupOrder = a.group.localeCompare(b.group);
    if (groupOrder !== 0) {
      return groupOrder;
    }
    const nameOrder = baseName(a).localeCompare(baseName(b));
    if (nameOrder !== 0) {
      return nameOrder;
    }
    return a.name.localeCompare(b.name);
  });
}

export function buildCodexFeatureArgs(features: Feature[]): string[] {
  const disabled = features.filter(feature => !feature.selected);
  const skills = disabled
    .filter(feature => feature.type === 'skill')
    .map(feature => `{path="${path.join(feature.path, 'SKILL.md')}",enabled=false}`);
  const args: string[] = [];

  if (skills.length > 0) {
    args.push('-c', `skills.config=[${skills.join(',')}]`);
  }

  for (const plugin of disabled.filter(feature => feature.type === 'plugin')) {
    args.push('-c', `plugins."${plugin.name}".enabled=false`);
  }

  return args;
}

export function buildClaudeFeatureArgs(features: Feature[]): string[] {
  const disabled = features.filter(feature => !feature.selected);
  const skillOverrides: Record<string, 'off'> = {};
  const enabledPlugins: Record<string, false> = {};

  for (const feature of disabled) {
    if (feature.type === 'skill') {
      skillOverrides[feature.name] = 'off';
      continue;
    }
    if (feature.name.includes(':')) {
      const [marketplace, plugin] = feature.name.split(':');
      if (marketplace && plugin) {
        enabledPlugins[`${plugin}@${marketplace}`] = false;
      }
    } else {
      enabledPlugins[feature.name] = false;
    }
  }

  const settings: {skillOverrides?: Record<string, 'off'>; enabledPlugins?: Record<string, false>} = {};
  if (Object.keys(skillOverrides).length > 0) {
    settings.skillOverrides = skillOverrides;
  }
  if (Object.keys(enabledPlugins).length > 0) {
    settings.enabledPlugins = enabledPlugins;
  }

  if (Object.keys(settings).length === 0) {
    return [];
  }
  return ['--settings', JSON.stringify(settings)];
}

export function buildFeatureArgs(cli: CliName, features: Feature[]): string[] {
  return cli === 'codex' ? buildCodexFeatureArgs(features) : buildClaudeFeatureArgs(features);
}
