/**
 * LLM Chat Application Template — AI Judge Edition
 *
 * Dual-purpose: general chatbot (streaming) + content judge (JSON-only).
 * The judge endpoints are called by the CloudForum backend (server-to-server,
 * via its Queues consumer): /cfai → Workers AI, /gemini → Gemini, and the legacy
 * /api/judge whose backend comes from JUDGE_PROVIDER.
 * The root path serves a decoy page (nginx default page); the real console is /admin.
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";
import { JudgeConfigError, JudgeOutputError, JudgeUpstreamError } from "./errors";
import { judgeWithWorkersAi, MODEL_ID } from "./workersAi";
import { judgeWithGemini } from "./gemini";
import { JudgeVerdict } from "./verdict";
import { DECOY_HTML, DECOY_HEADERS } from "./decoy";

/** 审核后端：workers-ai = Cloudflare Workers AI；gemini = Gemini */
type JudgeProvider = "workers-ai" | "gemini";

// Default system prompt for chat
const CHAT_SYSTEM_PROMPT =
	"You are a helpful, friendly assistant. Provide concise and accurate responses.";

/** 审核输入上限（字符）：超过直接 422，避免超长内容烧 token。 */
const JUDGE_CONTENT_LIMIT = 10_000;

/** CORS headers for cross-origin requests from the forum */
const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "https://forum.jgp.dpdns.org",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, x-judge-key",
	"Access-Control-Max-Age": "86400",
};

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);
		const { pathname } = url;

		// Handle CORS preflight
		if (request.method === "OPTIONS") {
			return new Response(null, {
				headers: {
					...CORS_HEADERS,
					"Access-Control-Allow-Origin":
						request.headers.get("Origin") || CORS_HEADERS["Access-Control-Allow-Origin"],
				},
			});
		}

		// 审核端点（POST，服务端到服务端，鉴权 x-judge-key）：
		//   /cfai      强制 Cloudflare Workers AI —— 论坛后台选「Cloudflare 官方」时调用
		//   /gemini    强制 Gemini —— 论坛后台选「Gemini」时调用
		//   /api/judge 后端由 env.JUDGE_PROVIDER 决定（默认 workers-ai），保留给旧调用方
		if (request.method === "POST") {
			if (pathname === "/cfai") return handleJudgeRequest(request, env, "workers-ai");
			if (pathname === "/gemini") return handleJudgeRequest(request, env, "gemini");
			if (pathname === "/api/judge") return handleJudgeRequest(request, env);
			// 模板遗留端点（本服务用不到，见 README「已知事项」）
			if (pathname === "/api/chat") return handleChatRequest(request, env);
			if (pathname === "/api/verify-site") return handleVerifySite(request, env);
		}

		// 页面路由：根路径返回伪装页（假 nginx 默认页），降低被扫描/探测的概率；
		// 真实控制台移到 /admin（页面内仍有站点口令校验，见 /api/verify-site）。
		// 注意 1：静态资源层会把 /index.html 重定向到 /，所以这里取资源的规范路径 /
		// 注意 2：控制台页面用相对路径加载 judge.js / chat.js，若停留在 /admin/ 会解析成
		//         /admin/judge.js（404），因此带斜杠时统一 308 跳到 /admin
		if (pathname === "/") {
			return new Response(DECOY_HTML, { headers: DECOY_HEADERS });
		}
		if (pathname === "/admin") {
			return env.ASSETS.fetch(new Request(new URL("/", url), request));
		}
		if (pathname === "/admin/") {
			return new Response(null, { status: 308, headers: { location: "/admin" } });
		}

		// 未匹配的 API 路径 → 404；其余路径 → 静态资源（chat.js / judge.js 等）
		if (pathname.startsWith("/api/")) {
			return new Response("Not found", { status: 404 });
		}
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests (streaming, general-purpose chatbot)
 */
async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: CHAT_SYSTEM_PROMPT });
		}

		const stream = await env.AI.run<typeof MODEL_ID>(MODEL_ID, {
			messages,
			max_tokens: 1024,
			stream: true,
		});

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);
		return new Response(
			JSON.stringify({ error: "Failed to process request" }),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}

/**
 * Handles site access verification
 * Simple password gate to prevent public access to the website
 */
async function handleVerifySite(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		const { password } = (await request.json()) as { password: string };
		const sitePassword = env.SITE_PASSWORD;

		if (sitePassword && password === sitePassword) {
			return new Response(
				JSON.stringify({ success: true }),
				{ headers: { "content-type": "application/json" } },
			);
		}

		return new Response(
			JSON.stringify({ success: false, error: "密码错误" }),
			{ status: 401, headers: { "content-type": "application/json" } },
		);
	} catch {
		return new Response(
			JSON.stringify({ success: false, error: "请求格式错误" }),
			{ status: 400, headers: { "content-type": "application/json" } },
		);
	}
}

/**
 * Handles judge API requests (non-streaming, returns pass/flag JSON per CloudForum spec S6)
 *
 * Called by the CloudForum backend (server-to-server, via Cloudflare Queues consumer):
 * 1. Forum sends {title, content} with header x-judge-key to /cfai、/gemini 或 /api/judge
 * 2. AI returns {"verdict":"pass|flag","confidence":0-1,"reasons":[...],"summary":"..."}
 * 3. Forum decides whether to publish based on verdict/confidence threshold
 *
 * @param providerOverride 路径强制的后端（/cfai → workers-ai、/gemini → gemini）；
 *   省略时按 env.JUDGE_PROVIDER（默认 workers-ai）
 */
async function handleJudgeRequest(
	request: Request,
	env: Env,
	providerOverride?: JudgeProvider,
): Promise<Response> {
	const jsonHeaders = (origin: string | null): Record<string, string> => ({
		"content-type": "application/json",
		...CORS_HEADERS,
		"Access-Control-Allow-Origin": origin || CORS_HEADERS["Access-Control-Allow-Origin"],
	});
	const origin = request.headers.get("Origin");

	try {
		// 校验密钥：必须携带 x-judge-key 头且等于 JUDGE_KEY Secret（无硬编码兜底）
		const judgeKey = request.headers.get("x-judge-key");
		if (!judgeKey || !env.JUDGE_KEY || judgeKey !== env.JUDGE_KEY) {
			return new Response(
				JSON.stringify({ status: "error", error: "未授权，请提供有效的审核密钥" }),
				{ status: 401, headers: jsonHeaders(origin) },
			);
		}

		const body = (await request.json()) as { title?: unknown; content?: unknown };
		const title = typeof body.title === "string" ? body.title.slice(0, 200) : "";
		const content = typeof body.content === "string" ? body.content : "";

		if (content.trim().length === 0) {
			return new Response(
				JSON.stringify({ status: "error", error: "Content is required" }),
				{ status: 400, headers: jsonHeaders(origin) },
			);
		}
		if (content.length > JUDGE_CONTENT_LIMIT) {
			return new Response(
				JSON.stringify({ status: "error", error: `Content too long (max ${JUDGE_CONTENT_LIMIT} chars)` }),
				{ status: 422, headers: jsonHeaders(origin) },
			);
		}

		// 审核后端选择：路径强制（/cfai、/gemini）> env.JUDGE_PROVIDER > 默认 workers-ai。
		// 两个后端共用提示词与输出契约，所以换后端对调用方完全透明、可直接 A/B 对比
		const provider = providerOverride ?? String(env.JUDGE_PROVIDER ?? "workers-ai").trim().toLowerCase();

		let verdict: JudgeVerdict;
		try {
			if (provider === "gemini") {
				verdict = await judgeWithGemini(env, title, content);
			} else if (provider === "workers-ai") {
				verdict = await judgeWithWorkersAi(env, title, content);
			} else {
				throw new JudgeConfigError(
					`JUDGE_PROVIDER 非法：${provider}（可选 workers-ai | gemini）`,
				);
			}
		} catch (e) {
			// 已知失败类别 → 502 + 具体原因（调用方按非 2xx 重试，连续失败触发熔断）；
			// 未预期异常交给外层 catch 统一返回「审核服务异常」
			if (
				e instanceof JudgeConfigError ||
				e instanceof JudgeUpstreamError ||
				e instanceof JudgeOutputError
			) {
				console.error(`judge failed [${provider}]:`, e.message);
				return new Response(
					JSON.stringify({ status: "error", error: e.message }),
					{ status: 502, headers: jsonHeaders(origin) },
				);
			}
			throw e;
		}

		return new Response(JSON.stringify(verdict), { headers: jsonHeaders(origin) });
	} catch (error) {
		console.error("Error processing judge request:", error);
		return new Response(
			JSON.stringify({ status: "error", error: "审核服务异常" }),
			{ status: 502, headers: jsonHeaders(origin) },
		);
	}
}
