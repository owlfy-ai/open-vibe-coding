# Web Vibe Coding

Web Vibe Coding 是一个在线 vibe coding Agent，帮助用户用自然语言创建 Web 应用。它包含基于对话的 Agent、可编辑项目文件、Sandpack 实时预览、运行时诊断，以及可选的 Tauri 桌面和移动端打包能力。

[English README](./README.md)

## 功能亮点

- 通过聊天让 Agent 创建和修改 Web 应用。
- 直接编辑生成的 HTML、CSS、JavaScript、TypeScript、JSON 等项目文件。
- 通过 Sandpack 实时预览项目。
- 捕获预览控制台输出、语法错误和运行时错误，供 Agent 诊断修复。
- 在预览中选择 DOM 元素，并要求 Agent 只修改该元素。
- 可选接入网页搜索、图片搜索、npm 包查询和长期记忆工具。
- 支持浏览器运行，也可通过 Tauri 打包桌面和移动端应用。

## 技术栈

- React 19、Vite、TypeScript
- CodeMirror 6
- `@codesandbox/sandpack-react`
- AI SDK，支持 OpenAI、Anthropic、Google 和 OpenAI-compatible provider
- Tauri 2 桌面/移动端打包
- Vitest 测试

## 快速开始

前置要求：

- Node.js 20 或更高版本
- pnpm 9
- 构建桌面或移动端应用时，需要 Rust 和 Tauri 相关环境

安装依赖：

```bash
pnpm install
```

启动开发服务：

```bash
pnpm dev
```

构建 Web 应用：

```bash
pnpm build
```

运行检查：

```bash
pnpm lint
pnpm test
pnpm check:ui
pnpm smoke:dist
```

## 配置

大部分运行时配置都在应用设置页中填写：

- AI 服务商、Base URL、API Key 和模型
- 网页搜索 provider
- 图片搜索 provider
- 主题和语言
- 长期记忆开关

详见 [docs/configuration.md](./docs/configuration.md)。

## 文档

- [设计文档](./docs/README.md)
- [开发指南](./docs/development.md)
- [配置说明](./docs/configuration.md)
- [部署说明](./docs/deployment.md)
- [隐私说明](./docs/privacy.md)

## 安全

请通过 GitHub issues 报告安全问题，但不要公开发布密钥、Token、用户隐私数据或可被直接利用的攻击细节。详见 [SECURITY.md](./SECURITY.md)。

## 贡献

欢迎贡献。提交 Pull Request 前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 和 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## 许可证

本项目采用 MIT 许可证。详见 [LICENSE](./LICENSE)。
