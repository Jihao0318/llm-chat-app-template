/**
 * LLM Chat Application Template — AI Judge Edition
 *
 * Dual-purpose: general chatbot (streaming) + content judge (JSON-only).
 * The /api/judge endpoint is designed to be called by the CloudForum frontend
 * to review post content before publishing.
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";
import { DECOY_HTML, DECOY_HEADERS } from "./decoy";

// Model ID for Workers AI model
const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

// Default system prompt for chat
const CHAT_SYSTEM_PROMPT =
	"You are a helpful, friendly assistant. Provide concise and accurate responses.";

// Strict system prompt for content judge — protocol aligned with CloudForum spec S6:
// response must be {"verdict":"pass|flag","confidence":0.0-1.0,"reasons":[...],"summary":"..."}
const SYSTEM_PROMPT = `你是一个中文社区论坛的内容审核员。你的唯一任务是判断帖子中的**纯文本内容**是否违规。你必须严格遵守以下规定，不得自作主张修改、删除或转义任何 Markdown / HTML 语法，也不得对任何嵌入媒体（图片、视频、音频等）的 URL 或代码进行安全校验，所有媒体标签一律视为无害。

【审核核心原则】
1. 只审核"人类可读的叙述性文字"，不审核任何代码、标签、链接地址、文件路径、数字编号、emoji表情符号。
2. 对于 Markdown 语法（如 **粗体**、*斜体*、\`代码块\`、[链接文字](url) 等），提取其中的显示文本（用户实际看到的文字）进行审核，包裹符号视为格式装饰，不参与判断。
3. 图片、视频、音频、嵌入式 video 等标签一律放行，不检查其 src 地址、域名与内容。标签内的 alt/标题文字仅作为普通叙述文字审核，URL 本身绝不作为违规证据。
4. 代码块内内容视为纯技术文本，跳过不审；数学公式、LaTeX 同样跳过。

【违规类别（reason 取值必须严格取自以下枚举）】
- illegal：违法/涉政/毒品/赌博
- porn：色情低俗
- ads：广告营销（正常分享个人作品或开源项目不算）
- abuse：人身攻击/辱骂/引战/仇恨言论（含针对群体歧视）
- fraud：诈骗/刷单/返利/非法贷款等诈骗暗示
- privacy：隐私泄露（电话/身份证/住址等个人信息）
- spam：垃圾灌水/刷屏

【审核注意】
- 正常讨论、中性表达、无明显恶意的不算违规。
- 对事实性争议话题保持中立，谣言类仅限具有明显误导性的突发信息。
- 模棱两可时倾向于通过（pass），除非明确恶意。

【审核流程与输出】
1. 阅读整篇帖子，提取纯文本。
2. 根据上述标准判断是否违规。
3. 只输出一个纯 JSON 对象，禁止添加任何前缀、后缀、解释、Markdown 代码块包裹或思考过程。格式如下：
{"verdict": "pass|flag", "confidence": 0.0-1.0, "reasons": ["类别枚举1", "类别枚举2"], "summary": "一句话说明"}
- verdict=pass 表示无违规；verdict=flag 表示违规。
- confidence 为判定置信度（0.0-1.0，违规越明确越高）。
- reasons 从上述违规类别枚举中选取（无违规时为空数组）。
- summary 用一句话说明判定依据。`;

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

		// 根路径给伪装页（nginx 默认欢迎页）：避免被扫描器一眼认出是 LLM 应用；控制台页面不再对外提供
		if (url.pathname === "/") {
			return new Response(DECOY_HTML, { headers: DECOY_HEADERS });
		}

		// Handle static assets (frontend)
		if (!url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// API Routes
		if (url.pathname === "/api/chat" && request.method === "POST") {
			return handleChatRequest(request, env);
		}

		if (url.pathname === "/api/judge" && request.method === "POST") {
			return handleJudgeRequest(request, env);
		}

		// 站点访问密码验证
		if (url.pathname === "/api/verify-site" && request.method === "POST") {
			return handleVerifySite(request, env);
		}

		// Handle 404 for unmatched routes
		return new Response("Not found", { status: 404 });
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
 * 1. Forum sends {title, content} to /api/judge with header x-judge-key
 * 2. AI returns {"verdict":"pass|flag","confidence":0-1,"reasons":[...],"summary":"..."}
 * 3. Forum decides whether to publish based on verdict/confidence threshold
 */
async function handleJudgeRequest(
	request: Request,
	env: Env,
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

		// Call AI with judge system prompt — non-streaming since output is tiny JSON
		const result = await env.AI.run<typeof MODEL_ID>(MODEL_ID, {
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: `【帖子标题】${title || "（无标题）"}\n【帖子正文】${content}` },
			],
			max_tokens: 1024,
			temperature: 0,
			stream: false,
		});

		const rawResponse =
			typeof result === "object" && result !== null
				? ((result as { response?: unknown }).response ?? "")
				: String(result);

		// Strictly parse the AI JSON; parse failure = explicit error (upstream queue retries / circuit-breaks)
		let parsed: unknown;
		try {
			parsed = JSON.parse(String(rawResponse).trim());
		} catch {
			return new Response(
				JSON.stringify({ status: "error", error: "AI returned non-JSON response" }),
				{ status: 502, headers: jsonHeaders(origin) },
			);
		}

		const verdict = (parsed as { verdict?: unknown })?.verdict;
		if (verdict !== "pass" && verdict !== "flag") {
			return new Response(
				JSON.stringify({ status: "error", error: "AI response missing valid verdict" }),
				{ status: 502, headers: jsonHeaders(origin) },
			);
		}

		const confidence =
			typeof (parsed as { confidence?: unknown }).confidence === "number"
				? Math.min(1, Math.max(0, (parsed as { confidence: number }).confidence))
				: 0.5;
		const reasons = Array.isArray((parsed as { reasons?: unknown }).reasons)
			? ((parsed as { reasons: unknown[] }).reasons.filter(
					(r): r is string => typeof r === "string",
				)).slice(0, 10)
			: [];
		const summary =
			typeof (parsed as { summary?: unknown }).summary === "string"
				? (parsed as { summary: string }).summary.slice(0, 200)
				: "";

		return new Response(
			JSON.stringify({ verdict, confidence, reasons, summary }),
			{ headers: jsonHeaders(origin) },
		);
	} catch (error) {
		console.error("Error processing judge request:", error);
		return new Response(
			JSON.stringify({ status: "error", error: "审核服务异常" }),
			{ status: 502, headers: jsonHeaders(origin) },
		);
	}
}
