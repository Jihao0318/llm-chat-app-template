/**
 * 伪装页：根路径返回的「nginx 默认欢迎页」。
 *
 * 目的：线上 Worker 的根地址常被扫描器/测绘引擎探测，默认模板页会暴露这是一个
 * LLM 聊天模板（暴露出 /api/chat、/api/judge 等端点）。这里用一个静态的 nginx
 * 默认页做掩护，真实控制台移到 /admin（页面内仍有站点口令校验）。
 *
 * 放在源码里而不是 public/ 下：避免多出一个可被直接访问、可被搜索引擎收录的 html 文件，
 * 也绕开静态资源层对 .html 的重定向行为。
 */
export const DECOY_HTML = `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto;
font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>
`;

/** 伪装页响应头：连同 Server 头一起对齐 nginx，降低一眼看出是 Worker 的概率 */
export const DECOY_HEADERS: Record<string, string> = {
	"content-type": "text/html; charset=utf-8",
	server: "nginx",
};
