#!/usr/bin/env python3
"""Trace self-host server. Optional, and the only place a backend exists.

It serves the same static frontend from the repository root, and it can hold a
SynthID API key on the server so the check runs without the key ever reaching the
browser. Python 3 standard library only. No file contents, request bodies or the
key are ever logged.
"""

import json
import mimetypes
import os
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CONFIG_PATH = os.path.join(HERE, "config.json")

DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 5665
SYNTHID_URL = "https://synthid.googleapis.com/upload/v1:verifyContent"

# Explicit MIME map. Python's mimetypes does not map .woff2 on every version, and
# the app is a set of ES modules, so the JavaScript type has to be exact.
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".map": "application/json; charset=utf-8",
}


def content_type(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in MIME:
        return MIME[ext]
    guessed, _ = mimetypes.guess_type(path)
    return guessed or "application/octet-stream"


def load_config():
    config = {
        "host": DEFAULT_HOST,
        "port": DEFAULT_PORT,
        "publicUrl": "",
        "synthidKey": "",
        "noCache": False,
    }
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            for key in config:
                if key in data and data[key] is not None:
                    config[key] = data[key]
    except FileNotFoundError:
        pass
    except (ValueError, OSError) as error:
        print(f"Could not read {CONFIG_PATH}: {error}. Using defaults.", file=sys.stderr)

    # Environment overrides take precedence over the file.
    env_host = os.environ.get("TRACE_HOST")
    if env_host:
        config["host"] = env_host
    env_port = os.environ.get("TRACE_PORT")
    if env_port:
        try:
            config["port"] = int(env_port)
        except ValueError:
            print(f"TRACE_PORT is not a number: {env_port}", file=sys.stderr)

    try:
        config["port"] = int(config["port"])
    except (TypeError, ValueError):
        config["port"] = DEFAULT_PORT
    return config


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"


class Handler(BaseHTTPRequestHandler):
    server_version = "TraceSelfHost/1.0"
    protocol_version = "HTTP/1.1"
    config = {}

    # Log the method and path only. Never the query string, headers, bodies or key.
    def log_message(self, fmt, *args):
        path = urllib.parse.urlparse(self.path).path
        sys.stderr.write("%s %s\n" % (self.command, path))

    def log_error(self, fmt, *args):
        pass

    def _common_headers(self, extra=None):
        if self.config.get("noCache"):
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
        if extra:
            for name, value in extra.items():
                self.send_header(name, value)

    def _send(self, status, body, ctype, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self._common_headers(extra)
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def do_GET(self):
        self.route()

    def do_HEAD(self):
        self.route()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/synthid":
            self.proxy_synthid()
            return
        self.send_error(404, "Not found")

    def route(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/config":
            key = (self.config.get("synthidKey") or "").strip()
            self._json(200, {"synthid": bool(key), "name": "trace"})
            return
        self.serve_static(path)

    def resolve(self, path):
        # Reject traversal: the resolved path must stay inside the repository root.
        rel = urllib.parse.unquote(path)
        if "\x00" in rel:
            return None
        rel = rel.lstrip("/")
        candidate = os.path.normpath(os.path.join(ROOT, rel))
        if candidate != ROOT and not candidate.startswith(ROOT + os.sep):
            return None
        # Never serve the config file (it can hold the SynthID key) or git internals.
        if candidate == CONFIG_PATH or candidate.startswith(os.path.join(ROOT, ".git") + os.sep) or candidate == os.path.join(ROOT, ".git"):
            return None
        if os.path.isdir(candidate):
            candidate = os.path.join(candidate, "index.html")
        return candidate

    def serve_static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        target = self.resolve(path)
        if target is None:
            self.send_error(403, "Forbidden")
            return
        if not os.path.isfile(target):
            self.send_error(404, "Not found")
            return
        try:
            with open(target, "rb") as handle:
                body = handle.read()
        except OSError:
            self.send_error(500, "Could not read the file")
            return
        ctype = content_type(target)
        if target.endswith(".html"):
            body = self.inject_config(body)
        self._send(200, body, ctype)

    def inject_config(self, html):
        # Advertise only that a server is present. The key stays on the server; the
        # frontend confirms the proxy through /api/config and never sees the key.
        hint = {"server": True}
        script = ("<script>window.TRACE_CONFIG=" + json.dumps(hint) + ";</script>").encode("utf-8")
        marker = b"<head>"
        index = html.find(marker)
        if index == -1:
            return html
        at = index + len(marker)
        return html[:at] + script + html[at:]

    def proxy_synthid(self):
        key = (self.config.get("synthidKey") or "").strip()
        if not key:
            self._json(404, {"error": "no_synthid_key_configured"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0:
            self._json(411, {"error": "empty_body"})
            return
        try:
            body = self.rfile.read(length)
        except (OSError, ValueError):
            self.send_error(400, "Could not read the request body")
            return
        ctype = self.headers.get("Content-Type", "application/octet-stream")
        request = urllib.request.Request(
            SYNTHID_URL + "?key=" + urllib.parse.quote(key),
            data=body,
            method="POST",
            headers={"Content-Type": ctype, "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = response.read()
                self._send(
                    response.status,
                    payload,
                    response.headers.get("Content-Type", "application/json"),
                )
        except urllib.error.HTTPError as error:
            payload = error.read()
            self._send(
                error.code,
                payload,
                error.headers.get("Content-Type", "application/json"),
            )
        except (urllib.error.URLError, OSError) as error:
            self._json(502, {"error": "upstream_failed", "message": str(error.reason if hasattr(error, "reason") else error)})


def main():
    config = load_config()
    host = config["host"]
    port = config["port"]
    Handler.config = config

    try:
        server = ThreadingHTTPServer((host, port), Handler)
    except OSError as error:
        print(f"Could not bind {host}:{port}: {error}", file=sys.stderr)
        print("Change port in selfhost/config.json or set TRACE_PORT.", file=sys.stderr)
        return 1

    key_state = "a server-side key is configured" if (config.get("synthidKey") or "").strip() else "no key configured, so the browser is asked for one"
    print("Trace self-host server")
    print(f"  serving   {ROOT}")
    print(f"  local     http://127.0.0.1:{port}")
    print(f"  network   http://{lan_ip()}:{port}")
    if config.get("publicUrl"):
        print(f"  public    {config['publicUrl']}")
    print(f"  synthid   {key_state}")
    print("Press Ctrl+C to stop.")
    sys.stdout.flush()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        server.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
