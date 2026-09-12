/**
 * 审核服务的错误分类。
 *
 * 三类错误一律由 handleJudgeRequest 映射为 HTTP 502 + {"status":"error","error":...}：
 * 调用方（CloudForum 队列消费者）把任何非 2xx 视作失败并重试，连续失败触发熔断，
 * 所以这里不需要区分状态码，但分类能让错误信息可定位（日志/接口响应里一眼看出是哪一环）。
 */

/** 配置问题：缺 API Key / 缺模型名 / 后端名非法 / 出站地址不安全 */
export class JudgeConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JudgeConfigError";
	}
}

/** 上游问题：模型服务 HTTP 非 2xx、网络失败、超时 */
export class JudgeUpstreamError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JudgeUpstreamError";
	}
}

/** 模型输出不符合契约：非 JSON、verdict 非法 */
export class JudgeOutputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JudgeOutputError";
	}
}
