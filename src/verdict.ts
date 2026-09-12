/**
 * 审核判定输出契约（CloudForum spec S6）：
 *   { "verdict": "pass" | "flag", "confidence": 0-1, "reasons": [...], "summary": "..." }
 *
 * 两个后端（Workers AI / Gemini）共用此处的归一化与校验，保证换后端时对调用方的
 * 行为不变：模型自由发挥的字段（越界置信度、非字符串 reasons、超长 summary）
 * 在这里统一收口，不合契约的输出一律显式报错（调用方重试），绝不静默 pass。
 */
import { JudgeOutputError } from "./errors";

export interface JudgeVerdict {
	verdict: "pass" | "flag";
	confidence: number;
	reasons: string[];
	summary: string;
}

/** 解析模型返回的文本为 JSON；非 JSON → JudgeOutputError */
export function parseVerdictJson(raw: unknown): unknown {
	try {
		return JSON.parse(String(raw).trim());
	} catch {
		throw new JudgeOutputError("AI returned non-JSON response");
	}
}

/**
 * 校验 + 归一化模型输出：
 *  - verdict 必须严格是 pass/flag，否则报错
 *  - confidence 缺省或非数字 → 0.5；越界钳制到 [0,1]
 *  - reasons 只保留字符串项，最多 10 条
 *  - summary 只接受字符串，截断 200 字符
 */
export function normalizeVerdict(parsed: unknown): JudgeVerdict {
	const verdict = (parsed as { verdict?: unknown })?.verdict;
	if (verdict !== "pass" && verdict !== "flag") {
		throw new JudgeOutputError("AI response missing valid verdict");
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

	return { verdict, confidence, reasons, summary };
}
