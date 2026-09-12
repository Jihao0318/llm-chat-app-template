/**
 * 根路径伪装页：nginx 默认欢迎页。
 *
 * 用途：线上 Worker 的根地址常被扫描器/测绘引擎探测，模板自带的控制台页面会直接
 * 暴露这是一个 LLM 应用（以及 /api/chat、/api/judge 等端点）。这里在根路径返回一个
 * 静态的 nginx 默认页做掩护，控制台页面不再对外提供。
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

/** 伪装页响应头（Server 头在 Cloudflare 边缘通常会被改写成 cloudflare，这里设了也无妨） */
export const DECOY_HEADERS: Record<string, string> = {
	"content-type": "text/html; charset=utf-8",
	server: "nginx",
};
