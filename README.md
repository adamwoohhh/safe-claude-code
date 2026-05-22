# Safe Claude Code

如果你是通过静态住宅 IP 代理访问 Clade 的，启动 Claude Code 之前，先检查你的网络环境，避免污染 IP 使用记录。

`safe-claude-code` 通过 [ipinfo.io](https://ipinfo.io) 拿到当前出口 IP 的地理信息，按你配置的规则做白名单校验，命中才启动 `claude`，否则打印完整 JSON 并退出。

## 安装

```bash
curl -fsSL https://raw.githubusercontent.com/adamwoohhh/safe-claude-code/main/install.sh | bash
```

安装到 `~/.local/bin/` 下，会建三个命令：

- `safe-claude-code`（全名，主包装器）
- `scc`（短名，`safe-claude-code` 的符号链接）
- `scc-config`（配置管理工具，独立命令，避免和 `claude` 自己的子命令冲突）

如果 `~/.local/bin` 不在 PATH，安装器会提示你加。

### 安装器的环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `SCC_REPO` | `adamwoohhh/safe-claude-code` | 拉取的仓库（fork 时改这里）|
| `SCC_REF` | `main` | 分支/tag/commit SHA |
| `SCC_INSTALL_DIR` | `$HOME/.local/bin` | 安装目录 |

例如装到 `/usr/local/bin`：

```bash
curl -fsSL https://raw.githubusercontent.com/adamwoohhh/safe-claude-code/main/install.sh \
  | SCC_INSTALL_DIR=/usr/local/bin bash
```

## 使用前提

确保 `ipinfo.io` 和 claude 相关的域名使用的是同一套代理规则。完整的代理教程可以参考 [Claude Code 安全使用指南](https://github.com/sakurs2/safe-claude?tab=readme-ov-file)。

```yaml
rules:
  - DOMAIN-KEYWORD,anthropic,纯净IP代理
  - DOMAIN-KEYWORD,claude,纯净IP代理
  - DOMAIN-KEYWORD,ipinfo,纯净IP代理
  - DOMAIN-KEYWORD,github,机房代理
  - DOMAIN-KEYWORD,google,机房代理
```

## 用法

把原本敲 `claude` 的地方换成 `scc`（或 `safe-claude-code`）即可，参数会原样转发给 `claude`。

### 规则语义

- 白名单：所有配置的字段都必须命中其允许的 pattern 列表才放行
- Pattern 支持 glob 通配符：`*`、`?`、`[...]`
- 大小写不敏感
- 多个 pattern 用逗号分隔，命中任意一个即可
- 未配置的字段不检查
- **未配置任何规则时拒绝启动**（避免裸跑）

### 通过环境变量配置

变量名格式：`SCC_<ipinfo字段名>=pattern1,pattern2,...`

```bash
# 只允许中国大陆或香港
SCC_country=CN,HK scc

# 时区必须是亚洲
SCC_timezone='Asia/*' scc

# 多字段同时校验
SCC_country=CN SCC_city='Beijing' scc
```

### 通过配置文件配置

默认路径：`~/.config/safe-claude-code/rules.conf`，可用 `SCC_CONFIG_FILE` 环境变量覆盖。

格式：每行 `field=patterns`，`#` 开头为注释，空行忽略。

```conf
# ~/.config/safe-claude-code/rules.conf
country=CN,HK
timezone=Asia/*
# city=Beijing,Shanghai,*Hong Kong*
```

环境变量优先于配置文件，方便临时覆盖。

### 用 `scc-config` 管理配置

懒得记路径或者想确认生效情况，用配套的 `scc-config`：

```bash
scc-config edit     # 在 $EDITOR 里打开 rules.conf；不存在则先生成带注释的模板
scc-config show     # 打印合并后生效的规则（文件 + SCC_* 环境变量），并标注来源
scc-config path     # 只打印配置文件路径
```

`scc-config show` 的输出示例：

```
# Config file: /Users/you/.config/safe-claude-code/rules.conf

country=CN,HK                     # from file
timezone=Asia/Shanghai            # from env:SCC_timezone
```

> 之所以拆成独立命令而不是做成 `scc config ...`，是为了避免和未来 `claude` 自己的子命令冲突——`scc` 永远是纯透传。

### 可用字段

来自 ipinfo.io 响应的顶层字段：

- `ip` — 出口 IP
- `city` — 城市
- `region` — 省/州
- `country` — 国家代码（如 `CN`、`HK`、`US`）
- `loc` — 经纬度
- `org` — ISP/运营商（含 ASN）
- `postal` — 邮编
- `timezone` — 时区（如 `Asia/Shanghai`）

### 保留环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `SCC_API` | `https://ipinfo.io` | 改成自建/代理的 IP 信息接口 |
| `SCC_CONFIG_FILE` | `~/.config/safe-claude-code/rules.conf` | 配置文件路径 |

## 失败时的行为

任一条件不满足都会：

1. 打印 `❌` + 错误原因（哪个字段、当前值、期望 pattern）到 stderr
2. 打印完整的 ipinfo.io JSON 到 stderr，方便排查
3. 退出码 `1`，不会启动 `claude`

## 依赖

- `bash` 3.2+（macOS 自带版本即可）
- `curl`

无需 `jq` 或其它工具。

## 开发

跑单元测试（纯 bash，无依赖，所有测试在临时目录里跑并 mock 掉 `curl` / `claude`，不会碰你 `~/.config/` 或 `~/.local/bin/`）：

```bash
./test.sh
```

## 升级 / 卸载

```bash
# 升级（重跑安装器即可）
curl -fsSL https://raw.githubusercontent.com/adamwoohhh/safe-claude-code/main/install.sh | bash

# 卸载
rm ~/.local/bin/safe-claude-code ~/.local/bin/scc ~/.local/bin/scc-config
```
