/**
 * Gemini 审核后端（实验）。
 *
 * 与 Workers AI 后端的差异只在"谁来判"：送审文本、系统提示词、输出契约完全一致，
 * 所以两个 Worker 可以对同一批帖子做 A/B 对比。密钥只从 Secret 读取
 * （wrangler secret put GEMINI_API_KEY），源码/示例/测试中不出现任何可用密钥字面量。
 */
import type { Env } from "./types";
import { JudgeConfigError, JudgeUpstreamError } from "./errors";
import { buildJudgeUserText, SYSTEM_PROMPT } from "./prompt";
import { normalizeVerdict, parseVerdictJson, JudgeVerdict } from "./verdict";
import { assertSafeOutboundUrl, GEMINI_API_HOST } from "./net";

/** 与 Workers AI 后端对齐的输出上限 */
const MAX_OUTPUT_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 12_000;
const TIMEOUT_RANGE = { min: 1_000, max: 60_000 } as const;

/** 模型 ID 走 URL 路径，限制字符集避免路径注入 */
const MODEL_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function buildEndpoint(model: string): URL {
	if (!MODEL_PATTERN.test(model)) {
		throw new JudgeConfigError(
			`GEMINI_MODEL 非法（只允许字母/数字/._-，且不含路径分隔符）：${JSON.stringify(model).slice(0, 60)}`,
		);
	}
	const url = new URL(
		`https://${GEMINI_API_HOST}/v1beta/models/${model}:generateContent`,
	);
	assertSafeOutboundUrl(url);
	return url;
}

function resolveTimeoutMs(raw: Env["GEMINI_TIMEOUT_MS"]): number {
	const n = Number(raw);
	if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
	return Math.min(TIMEOUT_RANGE.max, Math.max(TIMEOUT_RANGE.min, Math.floor(n)));
}

/** 生成配置：temperature=0 与 JSON 输出模式；GEMINI_THINKING_BUDGET 仅在显式配置时下发 */
function buildGenerationConfig(env: Env): Record<string, unknown> {
	const config: Record<string, unknown> = {
		temperature: 0,
		maxOutputTokens: MAX_OUTPUT_TOKENS,
		responseMimeType: "application/json",
	};
	const raw = env.GEMINI_THINKING_BUDGET;
	if (raw !== undefined && raw !== "") {
		const budget = Number(raw);
		if (Number.isFinite(budget) && budget >= 0) {
			config.thinkingConfig = { thinkingBudget: Math.floor(budget) };
		} else {
			throw new JudgeConfigError(`GEMINI_THINKING_BUDGET 非法（应为 >=0 的整数）：${raw}`);
		}
	}
	return config;
}

/** 从 Gemini 响应里取出模型文本；无候选（安全拦截/被截断）时给出可定位的报错 */
function extractCandidateText(payload: any): string {
	const finishReason = payload?.candidates?.[0]?.finishReason;
	const parts = payload?.candidates?.[0]?.content?.parts;
	const text = Array.isArray(parts)
		? parts
				.map((p: any) => (typeof p?.text === "string" ? p.text : ""))
				.join("")
			: "";
	if (text.trim().length > 0) return text;
	const blockReason = payload?.promptFeedback?.blockReason;
	if (blockReason) {
		throw new JudgeUpstreamError(`Gemini 因安全策略拒绝审核（blockReason: ${blockReason}）`);
	}
	throw new JudgeUpstreamError(
		`Gemini 未返回文本内容${finishReason ? `（finishReason: ${finishReason}）` : ""}`,
	);
}

export async function judgeWithGemini(
	env: Env,
	title: string,
	content: string,
): Promise<JudgeVerdict> {
	const apiKey = String(env.GEMINI_API_KEY ?? "").trim();
	if (!apiKey) {
		throw new JudgeConfigError("GEMINI_API_KEY 未配置（wrangler secret put GEMINI_API_KEY）");
	}
	const model = String(env.GEMINI_MODEL ?? "").trim();
	if (!model) {
		throw new JudgeConfigError("GEMINI_MODEL 未配置（wrangler vars GEMINI_MODEL）");
	}

	const endpoint = buildEndpoint(model);
	const timeoutMs = resolveTimeoutMs(env.GEMINI_TIMEOUT_MS);
	const body = {
		systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
		contents: [
			{ role: "user", parts: [{ text: buildJudgeUserText(title, content) }] },
		],
		generationConfig: buildGenerationConfig(env),
	};

	let res: Response;
	try {
		res = await fetch(endpoint, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-goog-api-key": apiKey,
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (e: any) {
		if (e?.name === "TimeoutError" || e?.name === "AbortError") {
			throw new JudgeUpstreamError(`Gemini 请求超时（${timeoutMs}ms）`);
		}
		throw new JudgeUpstreamError(`Gemini 网络请求失败：${e?.message || "未知错误"}`);
	}

	const rawText = await res.text().catch(() => "");
	if (!res.ok) {
		throw new JudgeUpstreamError(`Gemini 返回 HTTP ${res.status}：${rawText.slice(0, 200)}`);
	}

	let payload: unknown;
	try {
		payload = rawText ? JSON.parse(rawText) : null;
	} catch {
		throw new JudgeUpstreamError(`Gemini 响应不是有效 JSON：${rawText.slice(0, 120)}`);
	}

	return normalizeVerdict(parseVerdictJson(extractCandidateText(payload)));
}
