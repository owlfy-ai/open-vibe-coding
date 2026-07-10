<div align="center">
  <img src="./public/logo.svg" alt="Open Vibe Coding Logo" width="96" />

  # Open Vibe Coding

  **用自然语言描述想法，把它变成真正可以运行的 Web 应用。**

  一个开源、运行在浏览器中的 Vibe Coding Agent：代码随时可见、效果即时预览，Agent 还能检查并修复自己构建的应用。

  [在线快速预览](https://qidea.ai/) · [English README](./README.md) · [项目文档](./docs/README.md) · [反馈问题](https://github.com/owlfy-ai/open-vibe-coding/issues)

  [![License: MIT](https://img.shields.io/badge/License-MIT-18181b.svg)](./LICENSE)
  [![React](https://img.shields.io/badge/React-19-149eca.svg)](https://react.dev/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)](https://www.typescriptlang.org/)
  [![Tauri](https://img.shields.io/badge/Tauri-2-24c8db.svg)](https://tauri.app/)
</div>

<video src="https://github.com/user-attachments/assets/825c82e0-1fa6-46d5-8e08-af87bf5827c4" controls width="100%"></video>

## Open Vibe Coding 是什么？

Open Vibe Coding 是一个完整的 AI Web 应用创作空间。你可以描述需求、上传参考图片，也可以直接点选预览中的页面元素，让 Agent 按照你的要求完成规划、创建文件、修改代码、安装依赖和运行检查。

它不只是一个返回代码片段的聊天框。对话、项目文件、实时运行效果和错误诊断都在同一个工作区中：每一次修改都能查看，任何代码都能亲手编辑，完成后的项目也可以随时下载。

## 为什么选择它？

- **对话即开发** — 从一句想法开始，创建 React 应用、小游戏、产品原型或交互页面。
- **代码始终透明** — Agent 操作的是真实项目文件，生成结果全部可见、可编辑，而不是封闭的黑盒。
- **即时看到结果** — Sandpack 在浏览器中完成依赖安装、编译和运行，修改后立即预览。
- **根据真实错误修复** — 控制台信息、构建失败和运行时异常都可以反馈给 Agent 继续诊断。
- **指哪改哪** — 在预览中选中某个元素，再用自然语言描述要如何修改。
- **自由选择模型** — 可使用 OpenAI、Anthropic、Google 或兼容 OpenAI 协议的模型服务。
- **边搜索边创作** — 可选接入网页搜索、图片搜索与 npm 包查询，让 Agent 获得更完整的外部信息。
- **项目归你所有** — 项目和对话默认保存在本地，完整源码可以随时导出为 ZIP。
- **不止运行在网页** — 可通过 Tauri 2 将应用进一步打包为桌面端或移动端程序。

## 工作方式

```text
你的需求
   ↓
编码 Agent   ── 读取、创建、修改并检索项目文件
   ↓
Sandpack     ── 在浏览器中安装依赖并运行应用
   ↓
运行诊断     ── 将控制台和运行时错误反馈给 Agent
   ↓
可编辑源码 + 实时预览 + 可下载项目
```

除了项目文件工具，Agent 还可以使用运行诊断、网页研究、图片搜索、npm 包查询，以及由用户自主控制的长期记忆。各项能力通过清晰的接口隔离，因此可以独立替换模型服务或运行环境，而不会让核心逻辑与具体平台绑定。

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) 20 或更高版本
- [pnpm](https://pnpm.io/) 9
- 一个受支持的模型服务 API Key

### 本地运行

```bash
git clone https://github.com/owlfy-ai/open-vibe-coding.git
cd open-vibe-coding
pnpm install
pnpm dev
```

打开 Vite 输出的本地地址，在应用的**设置**中选择模型服务，并填写 API Key、Base URL 和模型名称，即可开始创作。

开源版本无需部署应用后端，模型请求由客户端直接发出，因此所选服务需要允许浏览器跨域访问。对于不支持浏览器 CORS 的服务，Tauri 客户端内置了原生网络代理。

## 配置说明

大部分选项都可以在设置面板中直接完成，并保存在当前设备上。

| 能力 | 可选配置 |
| --- | --- |
| AI 模型 | OpenAI、Anthropic、Google、兼容 OpenAI 协议的服务 |
| 网页研究 | 模型内置搜索、Tavily、Firecrawl 或关闭 |
| 图片搜索 | Pexels、Pixabay、Unsplash 或关闭 |
| 个性化 | 界面语言、明暗主题、可选长期记忆 |

更多细节请查看[配置指南](./docs/configuration.md)。请勿将 API Key 提交到仓库，也不要在公开 Issue 中粘贴密钥。

## 参与开发

```bash
# TypeScript 类型检查
pnpm lint

# 运行测试
pnpm test

# 构建生产版本
pnpm build

# UI 复杂度与构建产物检查
pnpm check:ui
pnpm smoke:dist
```

如需开发桌面版本，请先安装 [Tauri 所需环境](https://v2.tauri.app/start/prerequisites/)，然后运行：

```bash
pnpm tauri:dev
```

## 项目架构

项目采用分层架构，让核心业务规则不依赖 React、具体模型服务、Sandpack 或 Tauri：

```text
src/
├── domain/          纯领域模型与业务规则
├── application/     用例、Agent 运行时、工具与端口
├── infrastructure/  AI、存储、预览、搜索与导出适配器
├── presentation/    React 界面、工作区、对话、主题与国际化
├── app/             应用启动与服务装配
└── shared/          通用基础类型
```

建议先阅读[系统概览](./docs/01-system-overview.md)，再继续查看[架构设计](./docs/03-architecture.md)与 [Agent 运行机制](./docs/06-agent-runtime.md)。

## 项目文档

- [开发指南](./docs/development.md)
- [配置指南](./docs/configuration.md)
- [部署指南](./docs/deployment.md)
- [隐私说明](./docs/privacy.md)
- [设计文档索引](./docs/README.md)

## 参与贡献

欢迎提交问题、功能建议、文档改进和 Pull Request。准备进行较大改动前，请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)，并遵守[社区行为准则](./CODE_OF_CONDUCT.md)。

安全问题请按照 [SECURITY.md](./SECURITY.md) 中的方式反馈，不要在公开 Issue 中发布密钥、隐私数据或可直接利用的漏洞细节。

## 开源许可

Open Vibe Coding 基于 [MIT License](./LICENSE) 开源。
