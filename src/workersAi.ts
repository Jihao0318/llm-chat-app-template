/**
 * Workers AI 审核后端（默认）——与原 forum-ai 线上行为逐字保持一致：
 * 模型 @cf/meta/llama-3.1-8b-instruct-fp8，temperature=0、max_tokens=1024、非流式，
 * 输出必须是纯 JSON（无 Markdown 包裹），解析失败/verdict 非法一律显式报错。
 */
import type { Env } from "./types";
import { buildJudgeUserText, SYSTEM_PROMPT } from "./prompt";
import { normalizeVerdict, parseVerdictJson, JudgeVerdict } from "./verdict";

export const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

export async function judgeWithWorkersAi(
	env: Env,
	title: string,
	content: string,
): Promise<JudgeVerdict> {
	const result = await env.AI.run<typeof MODEL_ID>(MODEL_ID, {
		messages: [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: buildJudgeUserText(title, content) },
		],
		max_tokens: 1024,
		temperature: 0,
		stream: false,
	});

	const rawResponse =
		typeof result === "object" && result !== null
			? ((result as { response?: unknown }).response ?? "")
			: String(result);

	return normalizeVerdict(parseVerdictJson(rawResponse));
}
