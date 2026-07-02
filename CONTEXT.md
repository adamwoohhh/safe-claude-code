# Agent Launcher

Agent Launcher prepares an agent CLI session by discovering launch-time capabilities and letting the user choose which ones are enabled for that session.

## Language

**Feature**:
A launch-time capability that can be enabled or disabled before starting the selected agent CLI. A Feature is either a Skill or a Plugin.
_Avoid_: Capability, option

**Skill**:
A reusable instruction package discovered from a supported agent CLI's skill roots.
_Avoid_: Prompt, command

**Plugin**:
An installed extension bundle discovered from a supported agent CLI's plugin configuration or marketplace.
_Avoid_: Extension, addon

**Feature group**:
A set of related Features presented together so the user can toggle them as a unit.
_Avoid_: Category, section

**Skill lock**:
A registry of installed Skills and their installation sources, used as the preferred signal for deciding which Skills belong to the same Feature group.
_Avoid_: Lockfile, manifest
