#!/usr/bin/env python3
"""Authenticated call to the project's backend API, without exposing secrets.

Secrets come only from the agent automation env file (e.g. .agents/automations/.env),
never from the app's or server's .env. Secret values are never printed: every byte of
output is passed through redaction.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CANDIDATES = [
    ".agents/automations/.env",
    ".agent/automations/.env",
    ".claude/automations/.env",
    ".gemini/automations/.env",
]
SECRET_HINTS = ("TOKEN", "SECRET", "KEY", "PASSWORD", "PASS", "AUTH", "CREDENTIAL")
READ_METHODS = {"GET", "HEAD"}
RETRY_STATUS = {429, 502, 503, 504}
SHOWN_HEADERS = {"content-type", "x-request-id", "link", "retry-after",
                 "x-ratelimit-remaining", "x-ratelimit-reset", "x-total-count", "location"}

_SECRETS = []


def die(msg, code=2):
    sys.stderr.write(redact("agent_api: " + msg) + "\n")
    sys.exit(code)


def redact(text):
    if not isinstance(text, str):
        text = str(text)
    for s in _SECRETS:
        if s and len(s) >= 4:
            text = text.replace(s, "[REDACTED]")
    return text


def find_env_file():
    override = os.environ.get("AGENT_AUTOMATION_ENV")
    if override:
        p = Path(override).expanduser().resolve()
        if p.parent.name != "automations":
            die("AGENT_AUTOMATION_ENV must point to a file inside an 'automations/' folder "
                "(the agent env, not the app or server .env).")
        if not p.is_file():
            die("AGENT_AUTOMATION_ENV file not found.")
        return p
    here = Path.cwd().resolve()
    for d in [here, *here.parents]:
        for rel in CANDIDATES:
            p = d / rel
            if p.is_file():
                return p
    die("No agent env file found (looked for " + ", ".join(CANDIDATES) +
        "). Ask the user to create one; do not use the app or server .env.")


def load_env(path):
    values = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[7:]
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip()
            if val and val[0] in "\"'" and val[-1:] == val[0]:
                val = val[1:-1]
            elif " #" in val:
                val = val.split(" #", 1)[0].rstrip()
            values[key] = val
    for k, v in values.items():
        if any(h in k.upper() for h in SECRET_HINTS):
            _SECRETS.append(v)
    _SECRETS.sort(key=len, reverse=True)
    return values


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # never forward the auth header anywhere else


def build_url(base, path, query):
    if not path.startswith("/") or "://" in path or path.startswith("//"):
        die("path must be relative to API_BASE_URL and start with '/'.")
    base_parts = urllib.parse.urlsplit(base)
    if base_parts.scheme not in ("https", "http") or not base_parts.netloc:
        die("API_BASE_URL is not a valid http(s) URL.")
    url = base.rstrip("/") + path
    if query:
        pairs = []
        for q in query:
            if "=" not in q:
                die("--query must be key=value.")
            pairs.append(tuple(q.split("=", 1)))
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(pairs)
    if urllib.parse.urlsplit(url).netloc != base_parts.netloc:
        die("refusing to send the token to a host other than API_BASE_URL.")
    return url


def main():
    ap = argparse.ArgumentParser(description="Call the backend API with the agent token (secrets never printed).")
    ap.add_argument("method")
    ap.add_argument("path", help="path relative to API_BASE_URL, e.g. /v1/users")
    ap.add_argument("--query", action="append", default=[], help="key=value (repeatable)")
    body = ap.add_mutually_exclusive_group()
    body.add_argument("--json", help="JSON request body as a string")
    body.add_argument("--json-file", help="file containing the JSON request body")
    ap.add_argument("--header", action="append", default=[], help="extra 'Name: value' header (cannot override auth)")
    ap.add_argument("--idempotency-key")
    ap.add_argument("--write-ok", action="store_true", help="required for any method other than GET/HEAD")
    ap.add_argument("--out", help="write the response body to this file instead of stdout")
    ap.add_argument("--max-retries", type=int, default=3)
    args = ap.parse_args()

    method = args.method.upper()
    if method not in READ_METHODS and not args.write_ok:
        die(f"{method} changes data; re-run with --write-ok after the user has confirmed the plan.")

    env = load_env(find_env_file())
    base, token = env.get("API_BASE_URL"), env.get("API_TOKEN")
    if not base or not token:
        die("API_BASE_URL and API_TOKEN must be set in the agent env file.")
    if token not in _SECRETS:
        _SECRETS.append(token)
        _SECRETS.sort(key=len, reverse=True)

    auth_header = env.get("API_AUTH_HEADER") or "Authorization"
    scheme = env.get("API_AUTH_SCHEME", "Bearer")
    timeout = float(env.get("API_TIMEOUT") or 30)
    url = build_url(base, args.path, args.query)

    data = None
    if args.json is not None or args.json_file:
        raw = args.json if args.json is not None else Path(args.json_file).read_text(encoding="utf-8")
        try:
            data = json.dumps(json.loads(raw)).encode("utf-8")
        except json.JSONDecodeError as e:
            die(f"request body is not valid JSON: {e}")

    headers = {"Accept": "application/json", "User-Agent": "agent-api-automation/1.0"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if args.idempotency_key:
        headers["Idempotency-Key"] = args.idempotency_key
    for h in args.header:
        name, _, val = h.partition(":")
        if name.strip().lower() in (auth_header.lower(), "authorization", "cookie"):
            die("extra headers may not set auth or cookie headers.")
        headers[name.strip()] = val.strip()
    headers[auth_header] = f"{scheme} {token}".strip() if scheme else token

    opener = urllib.request.build_opener(NoRedirect)
    attempt = 0
    while True:
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            resp = opener.open(req, timeout=timeout)
            status, resp_headers, payload = resp.status, resp.headers, resp.read()
        except urllib.error.HTTPError as e:
            status, resp_headers, payload = e.code, e.headers, e.read()
        except urllib.error.URLError as e:
            die(f"network error: {e.reason}", 1)
        if status in RETRY_STATUS and method in READ_METHODS and attempt < args.max_retries:
            attempt += 1
            wait = resp_headers.get("Retry-After")
            try:
                delay = min(float(wait), 60.0) if wait else 2 ** attempt
            except ValueError:
                delay = 2 ** attempt
            time.sleep(delay)
            continue
        break

    text = payload.decode("utf-8", errors="replace")
    try:
        parsed = json.loads(text) if text else None
    except json.JSONDecodeError:
        parsed = text
    shown = {k: v for k, v in resp_headers.items() if k.lower() in SHOWN_HEADERS}
    if 300 <= status < 400:
        shown["note"] = "redirect not followed (token is never forwarded); report it if unexpected"

    if args.out:
        Path(args.out).write_text(redact(json.dumps(parsed, indent=2, ensure_ascii=False)), encoding="utf-8")
        result = {"status": status, "headers": shown, "body_written_to": args.out}
    else:
        result = {"status": status, "headers": shown, "body": parsed}
    print(redact(json.dumps(result, indent=2, ensure_ascii=False)))
    sys.exit(0 if 200 <= status < 300 else 1)


if __name__ == "__main__":
    main()
