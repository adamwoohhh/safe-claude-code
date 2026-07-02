# Agent Launcher

一个面向 AI CLI 的会话启动器。它会在启动前选择目标 CLI、临时启停全局 skills / plugins、执行一次网络检查，然后把参数原样转发给目标工具。

当前实现基于 Node.js + TypeScript + Ink。

| Agent CLI | Support |
| --------- | ------- |
| Codex CLI | yes |
| Claude Code | yes |
| Pi Code Agent | planned |

## 安装

需要 Node.js 20+ 和 npm。

```bash
curl -fsSL https://raw.githubusercontent.com/adamwoohhh/agent-launcher/main/install.sh | bash
```

安装后会提供两个命令：

- `agent-launch`
- `al`

安装脚本默认从 `adamwoohhh/agent-launcher#main` 安装。可以用环境变量覆盖：

```bash
AGENT_LAUNCHER_REPO=your-org/agent-launcher AGENT_LAUNCHER_REF=main ./install.sh
```

## 用法

```bash
al
```

如果本机同时安装了多个支持的 CLI，会出现选择器：

```text
Select CLI to launch:

> codex      /usr/local/bin/codex
  claude     /usr/local/bin/claude
```

如果只安装了一个 CLI，会自动选择它。

选择 CLI 后，`al` 会读取该 CLI 对应的全局 skills / plugins，并用 Ink 展示可切换列表。默认全部启用：

```text
Select features to enable:

  [x] lark (2)
>   [x] skill   lark-approval
    [x] skill   lark-apps
  [x] plugin (1)
    [x] plugin  browser@openai-bundled
```

按键：

- `up/down` 移动
- `left/right` 折叠或展开分组
- `Space` 切换当前项或当前分组
- `a` 全选或全不选
- `Enter` 继续
- `q` 取消

超过 5 项的分组会默认折叠；列表最多展示 20 行。

完成选择后，启动器会执行 `curl cip.cc` 探测公网 IP，展示响应和本地代理类型，并要求确认：

```text
Public IP check:
IP	: 1.2.3.4
地址	: 中国  北京

Local proxy type: HTTP proxy

Continue and launch codex? [Y/n]
```

本地代理类型会显示为 `no proxy`、`HTTP proxy`、`SOCKS5 proxy`、`virtual NIC proxy` 或 `unknown`。如果公网 IP 探测失败，启动器会打印失败信息，并询问是否忽略该失败继续启动。

确认后，参数会原样转发给最终 CLI：

```bash
al --model gpt-5
```

## Feature 发现规则

Codex：

- skills: `~/.agents/skills`、`~/.codex/skills`
- plugins: `~/.codex/config.toml` 中 `enabled = true` 的 `[plugins."name"]`

Claude Code：

- skills: `~/.claude/skills`
- plugins: `~/.claude/plugins/marketplaces/<marketplace>/{plugins,external_plugins}/<plugin>/.claude-plugin/plugin.json`

如果 skill 目录是软链，`al` 会解析真实目录，并用真实的 `SKILL.md` 路径生成禁用配置。对于 bundle 目录，例如 `~/.agents/skills/superpowers -> ~/.codex/superpowers/skills`，会继续读取下一层的 `*/SKILL.md`，展示为 `superpowers:brainstorming` 这类名称。

Skill 分组优先读取 skill 根目录的上一级或根目录内的 `.skill-lock.json`、`skill-lock.json`、`skills-lock.json`，例如 `~/.agents/.skill-lock.json`。lock 文件里同一 `source` 或 `pluginName` 的 skills 会优先归为同组；lock 文件不存在或没有对应记录时，再按 plugin / marketplace 信息和 skill name 前缀推断分组。

## 禁用方式

Codex 反选 skills / plugins 会转成启动参数：

```bash
codex -c 'skills.config=[{path="/absolute/path/to/skill/SKILL.md",enabled=false}]' \
      -c 'plugins."browser@openai-bundled".enabled=false'
```

Claude Code 反选 skills / plugins 会转成一次性的 `--settings`：

```bash
claude --settings '{"skillOverrides":{"alpha":"off"},"enabledPlugins":{"plugin-alpha@official":false}}'
```

这种方式不会创建临时配置目录，也不会改写项目或用户全局的 Claude 配置。

## 环境变量

- `AL_DEBUG`: 打印最终启动命令。`0`、`false`、`no`、`off` 视为关闭

## 开发

```bash
npm install
npm test
npm run build
npm run dev -- --model gpt-5
```

项目结构：

- `src/features.ts`: feature 发现、排序、分组、CLI 参数生成
- `src/launcher.ts`: CLI 探测、IP 检查、启动计划编排
- `src/ui.tsx`: Ink 交互 UI
- `src/cli.tsx`: 可执行入口

## 升级 / 卸载

```bash
# 升级
curl -fsSL https://raw.githubusercontent.com/adamwoohhh/agent-launcher/main/install.sh | bash

# 卸载
npm uninstall -g agent-launcher
```
