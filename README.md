# Nota

Nota 是一个受 NotebookLM 启发的 AI 研究工作台。每个笔记本拥有独立的来源、对话上下文和知识产物，支持从文档与网页中生成带原文引用的答案。

## 当前能力

- 独立笔记本的创建、切换、重命名与删除
- PDF、DOCX、PPTX、XLSX、EPUB、TXT、Markdown、CSV、HTML、RTF、JSON 解析
- 网页正文导入与 SSRF 防护
- 基于 MiniMax 的来源约束问答
- 页码、幻灯片和正文片段级引用定位
- 自动摘要、思维导图、记忆卡与 Wiki
- Docker 部署与持久化数据目录

## 本地运行

需要 Node.js 22。

```bash
cp .env.example .env
npm install
npm run dev
```

`.env`：

```dotenv
MINIMAX_API_KEY=replace-me
MINIMAX_MODEL=MiniMax-M2.7
NOTA_DATA_DIR=./data
```

## 测试

```bash
npm test
```

## Docker

```bash
docker compose up --build -d
```

生产环境请使用 HTTPS、登录鉴权和独立密钥管理，不要提交 `.env`、PEM 或运行时数据。
