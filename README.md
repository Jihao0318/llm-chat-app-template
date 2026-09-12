# LLM Chat Application Template

A simple, ready-to-deploy chat application template powered by Cloudflare Workers AI. This template provides a clean starting point for building AI chat applications with streaming responses.

> **本仓库的实际用途**：这是 [CloudForum](https://github.com/Jihao0318/cloudfourm-rebuild) 的**帖子内容自动审核服务**源码 —— 线上 Worker 名 `forum-ai`，基于官方 `llm-chat-app-template` 改造，新增了 `/api/judge` 审核端点。本仓库代码即线上部署版本。协议说明见 [CloudForum AI 审核（/api/judge）](#cloudforum-ai-审核apijudge)。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/templates/tree/main/llm-chat-app-template)

<!-- dash-content-start -->

## Demo

This template demonstrates how to build an AI-powered chat interface using Cloudflare Workers AI with streaming responses. It features:

- Real-time streaming of AI responses using Server-Sent Events (SSE)
- Easy customization of models and system prompts
- Support for AI Gateway integration
- Clean, responsive UI that works on mobile and desktop

## Features

- 💬 Simple and responsive chat interface
- ⚡ Server-Sent Events (SSE) for streaming responses
- 🧠 Powered by Cloudflare Workers AI LLMs
- 🛠️ Built with TypeScript and Cloudflare Workers
- 📱 Mobile-friendly design
- 🔄 Maintains chat history on the client
- 🔎 Built-in Observability logging
<!-- dash-content-end -->

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or newer)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- A Cloudflare account with Workers AI access

### Installation

1. Clone this repository:

   ```bash
   git clone https://github.com/cloudflare/templates.git
   cd templates/llm-chat-app
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Generate Worker type definitions:
   ```bash
   npm run cf-typegen
   ```

### Development

Start a local development server:

```bash
npm run dev
```

This will start a local server at http://localhost:8787.

Note: Using Workers AI accesses your Cloudflare account even during local development, which will incur usage charges.

### Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

### Monitor

View real-time logs associated with any deployed Worker:

```bash
npm wrangler tail
```

## Project Structure

```
/
├── public/             # Static assets
│   ├── index.html      # Chat UI HTML
│   └── chat.js         # Chat UI frontend script
├── src/
│   ├── index.ts        # Main Worker entry point
│   └── types.ts        # TypeScript type definitions
├── test/               # Test files
├── wrangler.jsonc      # Cloudflare Worker configuration
├── tsconfig.json       # TypeScript configuration
└── README.md           # This documentation
```

## How It Works

### Backend

The backend is built with Cloudflare Workers and uses the Workers AI platform to generate responses. The main components are:

1. **API Endpoint** (`/api/chat`): Accepts POST requests with chat messages and streams responses
2. **Streaming**: Uses Server-Sent Events (SSE) for real-time streaming of AI responses
3. **Workers AI Binding**: Connects to Cloudflare's AI service via the Workers AI binding

### Frontend

The frontend is a simple HTML/CSS/JavaScript application that:

1. Presents a chat interface
2. Sends user messages to the API
3. Processes streaming responses in real-time
4. Maintains chat history on the client side

## Customization

### Changing the Model

To use a different AI model, update the `MODEL_ID` constant in `src/index.ts`. You can find available models in the [Cloudflare Workers AI documentation](https://developers.cloudflare.com/workers-ai/models/).

### Using AI Gateway

The template includes commented code for AI Gateway integration, which provides additional capabilities like rate limiting, caching, and analytics.

To enable AI Gateway:

1. [Create an AI Gateway](https://dash.cloudflare.com/?to=/:account/ai/ai-gateway) in your Cloudflare dashboard
2. Uncomment the gateway configuration in `src/index.ts`
3. Replace `YOUR_GATEWAY_ID` with your actual AI Gateway ID
4. Configure other gateway options as needed:
   - `skipCache`: Set to `true` to bypass gateway caching
   - `cacheTtl`: Set the cache time-to-live in seconds

Learn more about [AI Gateway](https://developers.cloudflare.com/ai-gateway/).

### Modifying the System Prompt

The default system prompt can be changed by updating the `SYSTEM_PROMPT` constant in `src/index.ts`.

### Styling

The UI styling is contained in the `<style>` section of `public/index.html`. You can modify the CSS variables at the top to quickly change the color scheme.

## CloudForum AI 审核（/api/judge）

本 fork 为中文社区论坛提供帖子内容审核。调用方（论坛后端）与审核服务是**两个独立 Worker**，通过 Cloudflare Queues + service binding 协作：论坛发帖成功 → 投递 `{postId}` 到队列 → 论坛的队列消费者重读帖子 → 携带密钥调用本服务的 `/api/judge` → 按 `verdict` + `confidence` 决定放行 / 转人工复核 / 下架。

### 端点

| 路由 | 鉴权 | 说明 |
| --- | --- | --- |
| `POST /api/judge` | `x-judge-key: <JUDGE_KEY>` | 审核核心，非流式，返回 JSON |
| `POST /api/chat` | 无 | 模板遗留的流式聊天端点（保留未用，见下方「已知事项」） |
| `POST /api/verify-site` | `SITE_PASSWORD` | 模板遗留的站点口令验证 |

### `/api/judge` 协议

请求体：

```json
{ "title": "...", "content": "..." }
```

- `content` 必填；空 → `400`；超过 `JUDGE_CONTENT_LIMIT`（10000 字符）→ `422`
- `title` 可选，入库前截断到 200 字符

成功响应：

```json
{ "verdict": "pass", "confidence": 0.95, "reasons": [], "summary": "内容合规" }
```

- `verdict`：`pass`（无违规）/ `flag`（违规）
- `confidence`：0–1，审核方按自己的阈值决定采信程度（越界值会被 clamp）
- `reasons`：违规类别枚举，最多 10 条 —— `illegal`（违法涉政）/ `porn`（色情低俗）/ `ads`（广告营销）/ `abuse`（人身攻击辱骂引战）/ `fraud`（诈骗刷单返利）/ `privacy`（隐私泄露）/ `spam`（垃圾灌水）

失败响应：`{"status":"error","error":"..."}`

| 状态码 | 场景 |
| --- | --- |
| `401` | `x-judge-key` 缺失或不等于 `JUDGE_KEY` |
| `400` | `content` 缺失或空白 |
| `422` | `content` 超长 |
| `502` | LLM 输出不是合法 JSON / 缺少合法 `verdict` / 服务异常 —— **不静默放行**，调用方应重试 |

模型：`@cf/meta/llama-3.1-8b-instruct-fp8`（Workers AI binding `AI`），`temperature: 0`、`max_tokens: 1024`、`stream: false`。审核规则写在 `src/index.ts` 的 `SYSTEM_PROMPT`（中文，仅明显违规才 flag，模棱两可倾向 pass）。

### 环境变量与密钥

| 名称 | 必填 | 用途 |
| --- | --- | --- |
| `JUDGE_KEY` | 是 | `/api/judge` 鉴权（`x-judge-key`），**无硬编码兜底** |
| `SITE_PASSWORD` | 否 | `/api/verify-site` 口令，未设置时该端点一律拒绝 |

设置密钥时用 `printf` 而非 `echo`（`echo` 的尾随换行会让密钥永远比对失败）：

```bash
printf '%s' '<your-key>' | npx wrangler secret put JUDGE_KEY
```

### 部署

```bash
npm install
npx tsc --noEmit   # 类型检查
npm run deploy     # 或 npx wrangler deploy
```

### 已知事项

- `POST /api/chat` 无鉴权，公网任何人可调用并消耗你的 Workers AI 额度；本服务用不到它，建议删除或加鉴权。

## 审核后端：Workers AI / Gemini 可切换（分支 `gemini-judge`）

`main` 分支的审核后端是 Workers AI。`gemini-judge` 分支把"模型调用"抽成两个可切换的实现，**默认行为不变**（不设 `JUDGE_PROVIDER` 时走 Workers AI），Gemini 作为实验后端并存：

| 环境变量 | 说明 |
| --- | --- |
| `JUDGE_PROVIDER` | `workers-ai`（默认）或 `gemini` |
| `GEMINI_API_KEY` | Secret，`provider=gemini` 时必填：`wrangler secret put GEMINI_API_KEY` |
| `GEMINI_MODEL` | 模型 ID，如 `gemini-2.5-flash`（走 URL 路径，需与官方模型名一致） |
| `GEMINI_TIMEOUT_MS` | 可选，1000–60000，默认 12000 |
| `GEMINI_THINKING_BUDGET` | 可选，Gemini 2.5 系列的思考预算（`0` = 关闭思考）；留空则不下发该字段，避免不支持它的模型直接 400 |

两个后端共用 `src/prompt.ts` 的提示词和 `src/verdict.ts` 的输出契约，因此可以对同一批帖子做 A/B 对比。Gemini 调用为 `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`，密钥走 `x-goog-api-key` 头，参数 `temperature: 0` + `responseMimeType: application/json`；出站地址在发请求前经过白名单与内网/环回/保留地址校验（`src/net.ts`）。

失败语义与 Workers AI 版完全一致：上游非 2xx、超时、模型输出非 JSON、`verdict` 非法 → 一律 `502 {"status":"error",...}`，由调用方重试，**绝不静默放行**。

### 部署成独立实验 Worker

实验部署用单独的配置文件（Worker 名 `forum-ai-gemini`），不会覆盖线上的 `forum-ai`：

```bash
npx wrangler deploy -c wrangler.gemini.jsonc
printf '%s' '<gemini-key>' | npx wrangler secret put GEMINI_API_KEY -c wrangler.gemini.jsonc
printf '%s' '<judge-key>' | npx wrangler secret put JUDGE_KEY -c wrangler.gemini.jsonc
```

本地调试可把 `.dev.vars.example` 复制成 `.dev.vars`（已被 gitignore，切勿提交真实密钥）。

## Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
- [Workers AI Models](https://developers.cloudflare.com/workers-ai/models/)
