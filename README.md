# CC WebUI

**简体中文** | [English](README.en.md)

在浏览器里使用 Claude Code 的本地 Web 界面，基于 [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)。

```
浏览器 (React)  ⇄  WebSocket  ⇄  本地 Node 服务 (仅 127.0.0.1)  ⇄  Agent SDK  →  Claude Code
```

会话、登录、CLAUDE.md、settings、插件、skill、MCP 全部复用本机 Claude Code 的配置（`~/.claude`），
在终端里开的会话可以在网页里接着聊，反之亦然。

在同一个界面里管理项目和会话，选择模型、推理强度与权限模式，查看工具执行过程、上下文用量和每轮费用估算。

![CC WebUI 首页动态演示](docs/screenshots/homepage.gif)

## 目录

- [环境要求](#环境要求)
- [使用](#使用)
- [功能介绍](#功能介绍)
- [安全](#安全)
- [代码结构](#代码结构)
- [版本对应](#版本对应)
- [冒烟测试](#冒烟测试)
- [已知限制](#已知限制)

## 环境要求

- Node.js ≥ 22.18（服务端直接运行 TypeScript，不需要编译）
- 本机 Claude Code 已登录（`claude` 能正常使用即可）

## 使用

```bash
npm install
npm run build     # 构建前端
npm start         # 启动服务
```

然后在浏览器里打开 `http://127.0.0.1:8787` 即可，不需要令牌。

如果想要求访问令牌，用 `npm start -- --token` 启动：令牌首次启动时生成，保存在 `~/.ccwebui/token`，
终端会打印带令牌的链接，浏览器打开一次后会记住。

改了前端代码要重新 `npm run build`；改了服务端代码要重启 `npm start`。

开发模式（前端热更新）：

```bash
npm run dev       # 同时启动后端 (8787) 和 Vite (5173)，打开终端里的「开发前端」链接
```

可选参数：`npm start -- --port 9000`、`--token`（开启令牌校验）、`--debug`（把 Claude Code 进程的 stderr 打到终端）；
环境变量 `CCWEBUI_PORT`（端口，开发模式下 Vite 的代理也会跟着改）、`CCWEBUI_TOKEN`（开启令牌校验并临时指定令牌，不改动令牌文件）。

类型检查：`npm run typecheck`。

## 功能介绍

### 起始页与项目选择

打开页面、点「新会话」或输入 `/clear` 时，页面中间是 Claude Code 的标志和一个大输入框。
输入框上方可以选择在哪个项目文件夹里开始，发送第一条消息后切换成对话布局。

### 输入框与快捷操作

| 位置 | 控件 |
|---|---|
| 左下角 `+` | Skills 列表（选中后插入到输入框开头）、插件管理、添加附件 |
| 左下角 📎 | 添加图片或文本文件，也可以直接粘贴或拖进输入框 |
| 左下角权限按钮 | 始终询问（默认）/ 自动接受编辑 / 计划模式 / 完全权限。完全权限会跳过所有确认，开启后输入框上方有红色提示。没有提供自动模式：通过第三方 API 网关使用时，它的分类器请求不在 Claude Code 新的计费方式之内 |
| 右下角圆环 | 上下文窗口已用百分比，点开有分类明细和「压缩」按钮（发送 `/compact`）。70% 变黄，90% 变红 |
| 右下角模型按钮 | 模型和推理强度（Auto / Low / Medium / High / Extra High / Max），对话中途也能改 |
| 发送按钮 | Enter 发送，Shift+Enter 换行；Claude 工作时变成「中断」 |

输入 `/` 弹出命令和 skill 菜单（只能在终端里用的命令会自动隐藏）；输入 `@` 补全项目里的文件，
在 git 仓库里按 `.gitignore` 过滤，选中目录可以继续往下选。
`/clear`、`/new`、`/model`、`/effort` 由网页直接处理，和右下角的选择器保持同步。

### 模型与推理强度

点击输入框右下角的模型按钮，可以在同一个菜单中选择模型和推理强度，不需要回到终端修改。
推理强度包括 Auto / Low / Medium / High / Extra High / Max，实际可选项随模型支持情况变化；对话过程中也可以调整。
使用 `/model`、`/effort` 修改时，界面上的选项会同步更新。

![模型与推理强度选择](docs/screenshots/model-and-reasoning.png)

### 上下文用量与压缩

输入框下方的圆环持续显示上下文窗口的已用比例。点开后可以查看用量分类、已用 token 数和窗口容量，
帮助判断当前会话是否需要压缩。用量达到 70% 时变黄，达到 90% 时变红。

面板中的「压缩」按钮会发送 `/compact`；会话有内容、且 Claude 空闲时可以使用。

![输入框下方的上下文用量](docs/screenshots/context-usage.png)

### 侧边栏与会话管理

- 按「文件夹 → 会话」的树状结构列出所有项目的历史会话，文件夹可以折叠、隐藏、按最近使用或名称排序
- 「工作区」右边的文件夹按钮会弹出系统的文件夹选择窗口（Windows 是资源管理器样式，macOS 是 Finder，Linux 用 zenity 或 kdialog），
  默认停在当前项目的上一级目录。窗口被挡住时可以点「重新弹出」；弹不出来时会改为手动输入路径。起始页项目选择里的「打开其他文件夹…」也一样
- 每个会话的 `…` 菜单：重命名、加标签、复制为新分支、删除（删除前会二次确认）
- 搜索（Ctrl+K）：同时匹配标题、标签、文件夹名和对话全文，高亮显示命中的片段
- 左下角切换浅色 / 深色主题，选择会记住；左上角可以收起侧边栏
- 正在运行的会话旁边有橙色圆点，等你确认的是黄色圆点

快捷键：Ctrl+K 搜索，Ctrl+Shift+O 新会话。

#### 删除单个会话

在会话的 `…` 菜单中选择删除，会先出现确认提示。确认后会删除磁盘上对应的对话记录，无法恢复。
这个操作针对选中的会话，便于清理不再需要的历史对话。

![删除单个会话](docs/screenshots/delete-conversation.png)

### 对话与内容渲染

#### Markdown 与表格

回复以流式方式显示，支持 Markdown、代码高亮和表格渲染。
表格内容直接在对话中按行列呈现，代码则以带高亮的代码块展示。

![对话中的 Markdown 表格](docs/screenshots/markdown-tables.png)

#### SVG 预览

SVG 代码块右上角有预览按钮，可以在源码和渲染效果之间切换，在聊天界面里直接查看生成的 SVG。
预览通过 `<img>` 显示，SVG 中的脚本不会执行，也不会加载外部资源。

![对话中的 SVG 渲染与预览](docs/screenshots/svg-preview.webp)

#### 工具调用卡片

工具执行过程以独立卡片显示，便于把正文回复与操作过程分开阅读：

- Bash / PowerShell：查看终端调用及输出。
- Edit / Write：查看文件修改的 diff。
- Read / Grep / Glob：查看文件读取与搜索过程。
- 子 Agent 与任务列表：查看嵌套的执行过程和任务进展。

![工具使用与终端调用卡片](docs/screenshots/tool-calls.png)

#### CLI 风格的运行状态

Claude 工作时，聊天界面会显示 Claude Code CLI 风格的动态状态词，以及耗时、token 和推理强度等状态信息，
例如 `✻ Cascading… (40s · ↓ 1.7k tokens · thinking with xhigh effort)`。

下面是两张运行状态示例：

![CLI 风格的运行状态示例一](docs/screenshots/thinking-status.png)

![CLI 风格的运行状态示例二](docs/screenshots/thinking-status-alt.png)

#### Token 用量

每轮结束后，对话下方会显示输入 / 输出 token 数、耗时和轮数。
把鼠标停在统计行上，还可以查看缓存读写的明细。

![每轮对话的输入与输出 token 用量](docs/screenshots/token-usage.png)

#### 每轮费用与累计费用

统计行同时显示本轮费用和当前会话的累计费用，便于比较单次交互与整个会话的用量。
例如：`输入 41.9k · 输出 49 · 1.8s · 1 轮 · 本轮 $0.005 · 累计 $0.103`。

这里的费用是按 API 价格计算的估算值，不是实际账单；使用订阅账号登录时，实际不按 token 扣费。

![每轮费用与累计费用统计](docs/screenshots/cost-tracking.png)

#### 编辑、恢复与系统提示

- 编辑并重发：鼠标移到以前的某条提问上，点铅笔图标，会从这条提问之前分叉出一个新会话，并把原文放回输入框，原会话不变
- 历史里的斜杠命令输出（例如 `/context` 的表格）恢复会话后也能正常显示
- API 重试、自动拒绝等系统提示会显示在对话里

### 权限模式与审批

在输入框下方可以直接选择 Claude 的权限模式：始终询问（默认）、自动接受编辑、计划模式、完全权限。
「完全权限」会跳过所有确认，开启后输入框上方会显示红色提示。

![输入框下方的权限模式选择](docs/screenshots/permission-modes.png)

需要确认的操作会在对话中显示审批面板：

- 工具调用：允许 / 本会话始终允许 / 拒绝（可以附上理由告诉 Claude 应该怎么做）；Edit 和 Write 会显示 diff
- Claude 提问（AskUserQuestion）：选项卡片，也可以自己填写
- 计划审批（计划模式下）：批准后自动接受编辑 / 批准后逐项确认 / 写下修改意见继续规划

### Skills 与插件

#### 统一入口

输入框左下角的 `+` 菜单提供 Skills、插件管理和附件入口，直接在聊天界面中选择需要的能力。

![Skills 与插件入口](docs/screenshots/skills-and-plugins.png)

#### 选择 Skill

打开 Skills 列表后，选择的 skill 会插入到输入框开头，再补充具体需求即可发送。
也可以输入 `/` 打开命令和 skill 菜单。

![在输入框中选择 Skill](docs/screenshots/skill-picker.png)

#### 插件管理与市场

在 `+` → 插件里管理，改动写入 Claude Code 的用户设置，终端里同样生效，当前会话会自动重新加载：

- 已安装：启用、停用、卸载
- 市场：列出已配置的插件市场里的所有插件，按安装量排序，可以搜索和安装。「更新市场」会从 GitHub 等来源拉取最新目录（需要联网）
- 有的插件要在本机执行市场声明的命令才能安装，这时会先把命令显示出来，确认后才会执行

![浏览插件市场并安装插件](docs/screenshots/plugin-marketplace.png)

### 多会话

切到别的会话时，正在运行的任务会在后台继续跑。断线会自动重连；
空闲的 Claude Code 进程过一段时间会自动回收，再发消息时自动恢复。

## 安全

- 只监听 `127.0.0.1`，并校验 Host 头（防 DNS rebinding）
- REST 和 WebSocket 请求都校验来源：其他网站的页面发来的请求一律拒绝（按浏览器加的 `Origin` / `Sec-Fetch-Site` 头判断），
  所以在浏览器里打开的其他网站没法借你的浏览器调用这个服务
- 默认不需要令牌，本机上的任何程序都能访问这个端口。电脑有其他人共用、或者装了不放心的软件时，请用 `--token` 启动
- 这个服务能以你的身份执行命令，不要把它暴露到公网。需要远程访问时，请走 SSH 隧道或 Tailscale
- SVG 预览通过 `<img>` 显示，里面的脚本不会执行，也不会加载外部资源

## 代码结构

```
shared/protocol.ts        前后端共用的消息类型
server/src/
  index.ts                HTTP + WebSocket 服务、访问校验、消息分发
  live.ts                 每个会话一个 Claude Code 进程（Agent SDK query）：流式消息、权限、费用、上下文用量
  api.ts                  REST 接口：会话列表 / 重命名 / 标签 / 分叉 / 删除、搜索、文件补全、插件
  history.ts              读取磁盘上的会话记录，补回 SDK 丢掉的系统消息和费用总额
  search.ts               会话全文搜索
  files.ts                @ 文件补全
  picker.ts               弹出系统的文件夹选择窗口（窗口由本地服务弹出，浏览器拿不到文件夹的完整路径）
  plugins.ts              调用内置的 claude CLI 管理插件
  auth.ts / static.ts     Host / 来源 / 令牌校验 / 前端静态文件
web/src/
  lib/store.ts            前端状态（zustand）与 WebSocket 消息处理
  lib/transcript.ts       把 SDK 消息整理成界面要渲染的条目
  components/             界面组件（ChatView、Composer、Sidebar、Transcript、PermissionPanel、PluginsPanel、ContextMeter …）
scripts/smoke.ts          端到端冒烟测试
docs/screenshots/         中英文 README 共用的功能截图
```

## 版本对应

`@anthropic-ai/claude-agent-sdk` 锁定在 `0.3.281`，对应 Claude Code `2.1.281`。
SDK 自带同版本的 Claude Code 可执行文件（会话和插件命令都用它），升级时两者一起升级。

## 冒烟测试

服务启动后，可以用下面的脚本跑一遍端到端流程。它会调用真实的 Claude，产生少量用量：

```bash
node scripts/smoke.ts <端口> <一个测试用的目录> [令牌]   # 令牌只在服务用 --token 启动时需要
```

## 已知限制

- 上下文用量的统计口径和终端里的 `/context` 相同。对话刚开始时，Claude Code 对固定部分（系统提示词、工具定义）的估算略偏高，
  「对话消息」一项会接近 0；对话变长后会按实际用量增长
- 历史会话文件里不保存每轮的统计行，恢复旧会话后，之前各轮不显示 token 数和费用
- 网页端新建的会话记为 `entrypoint: "ccwebui"`，可以在终端的 `/resume` 列表里看到。
  2026-09-29 之前在网页端建的会话记的是 `sdk-ts`，Claude Code 的 `/resume` 列表会隐藏这类会话，
  只能在对应项目目录里用 `claude --resume <会话ID>` 打开（会话 ID 就是 `~/.claude/projects/<项目>/` 下的 `.jsonl` 文件名）
- 没有做手机和窄屏布局
- 界面文字目前只有中文
