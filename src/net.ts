/**
 * 出站请求地址校验（发请求前必过）。
 *
 * 审核服务只应访问白名单内的模型 API；此处挡掉协议不符、内网/环回/保留地址，
 * 避免配置被改坏（或未来引入可配置 URL）时变成 SSRF 跳板。
 */
import { JudgeConfigError } from "./errors";

/** 允许的出站主机（Gemini Generative Language API） */
export const GEMINI_API_HOST = "generativelanguage.googleapis.com";

/** 内网/环回/保留地址判断（IPv4 字面量 + localhost 类主机名 + IPv6 环回/ULA/链路本地） */
function isDisallowedHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost")) return true;
	if (
		host.endsWith(".local") ||
		host.endsWith(".internal") ||
		host.endsWith(".home.arpa")
	) {
		return true;
	}
	// IPv6
	if (host === "::" || host === "::1") return true;
	if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // fc00::/7 唯一本地
	if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // fe80::/10 链路本地
	// IPv4 字面量
	const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (m) {
		const a = Number(m[1]);
		const b = Number(m[2]);
		if (a === 0 || a === 10 || a === 127) return true;
		if (a === 169 && b === 254) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
		if (a === 192 && b === 0) return true; // 192.0.0.0/24、192.0.2.0/24
		if (a === 198 && (b === 18 || b === 19)) return true;
		if (a >= 224) return true; // 组播与保留
	}
	return false;
}

/** 仅允许 http/https；拒绝内网/环回/保留地址；主机必须在白名单内 */
export function assertSafeOutboundUrl(url: URL): void {
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new JudgeConfigError(`出站地址协议不允许：${url.protocol}`);
	}
	const host = url.hostname.toLowerCase();
	if (isDisallowedHost(host)) {
		throw new JudgeConfigError(`出站地址指向内网/环回/保留地址，已拒绝：${host}`);
	}
	if (host !== GEMINI_API_HOST) {
		throw new JudgeConfigError(`出站地址不在白名单：${host}`);
	}
}
