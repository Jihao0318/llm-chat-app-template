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
}

/**
 * Represents a chat message.
 */
export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}
