#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
B站 Index-Translate 免费翻译接口 · 零依赖本地 CORS 桥接代理
- 仅使用 Python 3 标准库（无需 pip install 任何第三方包）
- 解决纯静态网页 (file://) 直接请求 https://index-translate.bilibili.com/v1 时的浏览器跨域 (CORS) 问题
- 自动注入 chat_template_kwargs.enable_thinking = False 与 temperature = 0.0，去除思考标签、响应更快
- 默认监听 http://127.0.0.1:8080（与 B站官方 call_api.py --serve 端口完全一致，可无缝互换）
"""

import argparse
import json
import ssl
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_UPSTREAM = "https://index-translate.bilibili.com/v1"
DEFAULT_MODEL = "Index-Translate-35B-A3B"


def make_handler(upstream_base: str, timeout: int):
    upstream_base = upstream_base.rstrip("/")
    ssl_ctx = ssl.create_default_context()

    class ProxyHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            sys.stdout.write(f"[Index-Translate Proxy] {self.address_string()} - {fmt % args}\n")
            sys.stdout.flush()

        def _send_cors_headers(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers",
                "Content-Type, Authorization, X-Requested-With, Accept",
            )
            self.send_header("Access-Control-Max-Age", "86400")

        def _send_json(self, status: int, payload: dict):
            raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_OPTIONS(self):
            self.send_response(204)
            self._send_cors_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path in ("/", "/health", "/v1/health"):
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "service": "bilibili-index-translate-proxy",
                        "upstream": upstream_base,
                        "defaultModel": DEFAULT_MODEL,
                    },
                )
                return

            if path == "/v1/models":
                self._send_json(
                    200,
                    {
                        "object": "list",
                        "data": [
                            {"id": DEFAULT_MODEL, "object": "model", "owned_by": "bilibili"},
                            {"id": "Index-Translate-9B", "object": "model", "owned_by": "bilibili"},
                            {"id": "Index-Translate-2B", "object": "model", "owned_by": "bilibili"},
                        ],
                    },
                )
                return

            self._send_json(404, {"error": {"message": f"Not found: {path}"}})

        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if path not in ("/v1/chat/completions", "/chat/completions"):
                self._send_json(404, {"error": {"message": f"Unsupported endpoint: {path}"}})
                return

            try:
                content_len = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                content_len = 0

            raw_body = self.rfile.read(content_len) if content_len > 0 else b"{}"
            try:
                body = json.loads(raw_body.decode("utf-8"))
            except Exception as exc:
                self._send_json(400, {"error": {"message": f"Invalid JSON body: {exc}"}})
                return

            # 默认填充模型名，并抑制思考过程标签以保证译文纯净快速
            body.setdefault("model", DEFAULT_MODEL)
            body.setdefault("temperature", 0.0)
            ctk = body.get("chat_template_kwargs")
            if not isinstance(ctk, dict):
                ctk = {}
            ctk.setdefault("enable_thinking", False)
            body["chat_template_kwargs"] = ctk

            target_url = f"{upstream_base}/chat/completions"
            req_bytes = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "KaoyanReading-IndexTranslate-Proxy/1.0",
            }
            auth = self.headers.get("Authorization")
            if auth:
                headers["Authorization"] = auth

            req = urllib.request.Request(target_url, data=req_bytes, headers=headers, method="POST")

            try:
                with urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx) as resp:
                    resp_bytes = resp.read()
                    resp_status = resp.status
                    resp_ct = resp.headers.get("Content-Type", "application/json; charset=utf-8")
                self.send_response(resp_status)
                self._send_cors_headers()
                self.send_header("Content-Type", resp_ct)
                self.send_header("Content-Length", str(len(resp_bytes)))
                self.end_headers()
                self.wfile.write(resp_bytes)
            except urllib.error.HTTPError as err:
                err_bytes = err.read() if err.fp else b""
                if not err_bytes:
                    err_bytes = json.dumps(
                        {"error": {"message": f"Upstream HTTP {err.code}: {err.reason}"}},
                        ensure_ascii=False,
                    ).encode("utf-8")
                self.send_response(err.code)
                self._send_cors_headers()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(err_bytes)))
                self.end_headers()
                self.wfile.write(err_bytes)
            except Exception as exc:
                self._send_json(
                    502,
                    {"error": {"message": f"连接 B站翻译接口失败: {exc}"}},
                )

    return ProxyHandler


def main():
    parser = argparse.ArgumentParser(description="Bilibili Index-Translate local CORS proxy")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8080, help="Bind port (default: 8080)")
    parser.add_argument("--upstream", default=DEFAULT_UPSTREAM, help=f"Upstream base URL (default: {DEFAULT_UPSTREAM})")
    parser.add_argument("--timeout", type=int, default=60, help="Upstream request timeout in seconds")
    args = parser.parse_args()

    handler_cls = make_handler(args.upstream, args.timeout)
    server = ThreadingHTTPServer((args.host, args.port), handler_cls)
    print("=" * 62)
    print("  B站免费翻译接口 (Index-Translate) 本地代理已启动")
    print(f"  本地接口: http://{args.host}:{args.port}/v1/chat/completions")
    print(f"  上游地址: {args.upstream}")
    print(f"  默认模型: {DEFAULT_MODEL}")
    print("  保持此窗口运行即可在 408_v4.html 英语阅读中免费翻译 (Ctrl+C 退出)")
    print("=" * 62)
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n代理已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
