/**
 * Type definitions for the LLM chat application.
 */

export interface Env {
	/**
	 * Binding for the Workers AI API.
	 */
	AI: Ai;

	/**
	 * Binding for static assets.
	 */
	ASSETS: { fetch: (request: Request) => Promise<Response> };

	/**
	 * API key required by /api/judge (x-judge-key header).
	 * MUST be set via `wrangler secret put JUDGE_KEY` — no fallback.
	 */
	JUDGE_KEY: string;

	/**
	 * Site access password (verify-site endpoint).
	 * Set via wrangler secret put SITE_PASSWORD — no fallback.
	 */
	SITE_PASSWORD?: string;

	/**
	 * 审核后端：'workers-ai'（默认）| 'gemini'。
	 * 不设置时保持 Workers AI 行为，既有部署不受影响。
	 */
	JUDGE_PROVIDER?: string;

	/**
	 * Gemini API Key（provider=gemini 时必填）。
	 * 只从 Secret 读取：`wrangler secret put GEMINI_API_KEY`；
	 * 源码/示例/测试中不得出现任何可用的密钥字面量。
	 */
	GEMINI_API_KEY?: string;

	/** Gemini 模型 ID（如 gemini-2.5-flash）。走 URL 路径，须与官方模型名一致。 */
	GEMINI_MODEL?: string;

	/** Gemini 请求超时（毫秒，1000-60000，默认 12000） */
	GEMINI_TIMEOUT_MS?: string;

	/**
	 * 可选的思考预算（Gemini 2.5 系列）：0 = 关闭思考。
	 * 留空则不下发 thinkingConfig，避免不支持该字段的模型直接 400。
	 */
	GEMINI_THINKING_BUDGET?: string;
}

/**
 * Represents a chat message.
 */
export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}
