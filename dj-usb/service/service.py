#!/usr/bin/env python3
import json
import os
import random
import re
import shutil
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = Path(os.environ.get("SPIDER_DJ_CONFIG", ROOT / "spider-dj.json"))
RUNTIME = ROOT / "runtime"
RUNTIME.mkdir(parents=True, exist_ok=True)

DEFAULTS = {
    "station": {"name": "Broken City Network", "shortName": "BCN"},
    "service": {"host": "127.0.0.1", "port": 9876, "backend": "auto"},
    "model": {
        "backend": "auto",
        "ollamaModel": "qwen3:1.7b",
        "ollamaUrl": "http://127.0.0.1:11434/api/chat",
        "openAiCompatibleUrl": "http://127.0.0.1:11435/v1/chat/completions"
    },
    "host": {
        "name": "Webbie",
        "style": "live-radio",
        "maxTransitionSeconds": 14,
        "backAnnounce": True,
        "frontSell": True,
        "stationIds": True,
        "timeChecks": True,
        "requests": True,
        "listenerMessages": True,
        "avoidInventedCurrentEvents": True
    }
}

RECENT = []
RECENT_LOCK = threading.Lock()

def deep_merge(base, extra):
    out = dict(base)
    for key, value in (extra or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge(out[key], value)
        else:
            out[key] = value
    return out

def load_config():
    data = {}
    if CONFIG_PATH.exists():
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            data = {}
    return deep_merge(DEFAULTS, data)

def clean(value, limit=160):
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]

def recent_scripts():
    with RECENT_LOCK:
        return list(RECENT[-6:])

def remember(script):
    with RECENT_LOCK:
        RECENT.append(script)
        del RECENT[:-12]

def fallback_script(payload, cfg):
    current = payload.get("currentTrack") or {}
    nxt = payload.get("nextTrack") or {}
    station = cfg["station"]["shortName"] or "BCN"
    host = cfg["host"]["name"] or "Webbie"
    current_title = clean(current.get("title"), 90)
    current_artist = clean(current.get("artist"), 70)
    next_title = clean(nxt.get("title"), 90)
    next_artist = clean(nxt.get("artist"), 70)
    back = f"That was {current_title}" if current_title else "That was the last track"
    if current_artist:
        back += f" by {current_artist}"
    front = f"Coming up, {next_title}" if next_title else "More coming up"
    if next_artist:
        front += f" from {next_artist}"
    choices = [
        f"{back}. {host} here on {station}. {front}.",
        f"{station}. {back}. Next, {next_title or 'another one'}" + (f" by {next_artist}" if next_artist else "") + ".",
        f"{host} with you on {station}. {back}. {front}."
    ]
    return random.choice(choices)

def system_prompt(cfg):
    station_name = cfg["station"]["name"]
    station_short = cfg["station"]["shortName"]
    host = cfg["host"]["name"]
    max_seconds = int(cfg["host"].get("maxTransitionSeconds", 14))
    recent = "\n".join(f"- {x}" for x in recent_scripts()) or "- none yet"
    return f"""You are {host}, the live AI radio DJ for {station_name} ({station_short}).

Act like a real live radio host, not a generic assistant and not a robot reading metadata.
Write one natural spoken break only.
Keep it short enough to fit roughly {max_seconds} seconds unless the request explicitly marks a long-form segment.
Back-announce the current track and front-sell the next track when useful.
Use {station_short} naturally, not in every sentence.
Vary phrasing and rhythm. Do not repeat recent lines.
Never invent current news, weather, traffic, sports scores, listener messages, chart positions, facts, or events.
Do not claim personal experiences.
Do not include stage directions, markdown, labels, or JSON.
Do not mention being an AI.

Recent breaks to avoid repeating:
{recent}
"""

def user_prompt(payload, cfg):
    current = payload.get("currentTrack") or {}
    nxt = payload.get("nextTrack") or {}
    context = payload.get("context") or {}
    request = payload.get("request") or {}
    return json.dumps({
        "event": payload.get("event", "prepareDJBreak"),
        "breakType": payload.get("type", "transition"),
        "secondsRemaining": payload.get("secondsRemaining"),
        "currentTrack": {
            "title": clean(current.get("title")),
            "artist": clean(current.get("artist")),
            "album": clean(current.get("album"))
        },
        "nextTrack": {
            "title": clean(nxt.get("title")),
            "artist": clean(nxt.get("artist")),
            "album": clean(nxt.get("album"))
        },
        "show": {
            "station": cfg["station"]["name"],
            "shortName": cfg["station"]["shortName"],
            "host": cfg["host"]["name"],
            "showName": clean(context.get("showName")),
            "segment": clean(context.get("segment")),
            "tone": clean(context.get("tone")),
            "listenerMessage": clean(request.get("listenerMessage")),
            "approvedRequest": clean(request.get("approvedRequest"))
        }
    }, ensure_ascii=False)

def call_ollama(payload, cfg):
    model = cfg["model"].get("ollamaModel") or "qwen3:1.7b"
    url = cfg["model"].get("ollamaUrl") or "http://127.0.0.1:11434/api/chat"
    body = json.dumps({
        "model": model,
        "stream": False,
        "think": False,
        "messages": [
            {"role": "system", "content": system_prompt(cfg)},
            {"role": "user", "content": user_prompt(payload, cfg)}
        ],
        "options": {"temperature": 0.9, "top_p": 0.9}
    }).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as response:
        data = json.loads(response.read().decode("utf-8"))
    return clean(((data.get("message") or {}).get("content")), 900)

def call_openai_compatible(payload, cfg):
    url = cfg["model"].get("openAiCompatibleUrl") or "http://127.0.0.1:11435/v1/chat/completions"
    body = json.dumps({
        "messages": [
            {"role": "system", "content": system_prompt(cfg)},
            {"role": "user", "content": user_prompt(payload, cfg)}
        ],
        "temperature": 0.9,
        "max_tokens": 220
    }).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as response:
        data = json.loads(response.read().decode("utf-8"))
    return clean((((data.get("choices") or [{}])[0].get("message") or {}).get("content")), 900)

def generate_script(payload, cfg):
    backend = str(cfg["model"].get("backend", "auto")).lower()
    attempts = []
    if backend in ("auto", "llama", "llama.cpp", "openai-compatible"):
        attempts.append(call_openai_compatible)
    if backend in ("auto", "ollama"):
        attempts.append(call_ollama)
    for attempt in attempts:
        try:
            script = attempt(payload, cfg)
            if script:
                return script
        except Exception:
            pass
    return fallback_script(payload, cfg)

def find_tts():
    for candidate in [ROOT / "bin" / "espeak-ng", ROOT / "bin" / "espeak-ng.exe"]:
        if candidate.exists():
            return str(candidate)
    return shutil.which("espeak-ng") or shutil.which("espeak")

def synthesize(script):
    binary = find_tts()
    if not binary:
        return ""
    filename = f"dj-{int(time.time() * 1000)}-{random.randint(1000,9999)}.wav"
    target = RUNTIME / filename
    subprocess.run(
        [binary, "-s", "158", "-p", "38", "-w", str(target), script],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=20,
        check=True
    )
    for old in sorted(RUNTIME.glob("dj-*.wav"), key=lambda p: p.stat().st_mtime)[:-24]:
        try:
            old.unlink()
        except Exception:
            pass
    return target.resolve().as_uri()

def prepare(payload):
    cfg = load_config()
    script = generate_script(payload, cfg)
    remember(script)
    try:
        audio = synthesize(script)
    except Exception:
        audio = ""
    try:
        remaining = max(0.0, float(payload.get("secondsRemaining") or 0))
    except Exception:
        remaining = 12.0
    talk_start = min(9.0, max(3.0, remaining - 1.0)) if remaining else 6.0
    return {
        "id": f"dj-{int(time.time() * 1000)}",
        "type": payload.get("type", "transition"),
        "script": script,
        "audioFile": audio,
        "talkOver": {
            "startSecondsBeforeEnd": round(talk_start, 1),
            "duckLevel": 0.28,
            "crossfadeSeconds": 3.0
        }
    }

class Handler(BaseHTTPRequestHandler):
    server_version = "BCNPortableDJ/1.0"
    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.path == "/health":
            cfg = load_config()
            self._json(200, {"ok": True, "station": cfg["station"], "host": cfg["host"].get("name"), "config": str(CONFIG_PATH)})
            return
        self._json(404, {"ok": False, "error": "not found"})
    def do_POST(self):
        if self.path != "/dj/prepare":
            self._json(404, {"ok": False, "error": "not found"})
            return
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 1024 * 1024)
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            self._json(200, prepare(payload))
        except Exception as error:
            self._json(500, {"ok": False, "error": str(error)})
    def log_message(self, fmt, *args):
        print(f"[BCN DJ] {self.address_string()} {fmt % args}")

def main():
    cfg = load_config()
    host = str(cfg["service"].get("host") or "127.0.0.1")
    port = int(cfg["service"].get("port") or 9876)
    print(f"Broken City Network portable AI DJ listening on http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()

if __name__ == "__main__":
    main()
