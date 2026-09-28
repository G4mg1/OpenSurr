import os, json, time, secrets
from datetime import timedelta
from functools import wraps
from flask import (Flask, request, jsonify, session,
                   Response, stream_with_context)
import requests

# -------------------- CONFIG --------------------
HF_API_KEY = os.environ.get("HF_API_KEY", "").strip()
HF_CHAT    = "https://router.huggingface.co/v1/chat/completions"
HF_IMAGES  = "https://router.huggingface.co/v1/images/generations"

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", secrets.token_hex(32))
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=True,
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)

# -------------------- MODELS --------------------
MODELS = {
    "luna":  {"label": "Luna",  "hf": "meta-llama/Llama-3.2-3B-Instruct",  "tokens": 512},
    "swift": {"label": "Swift", "hf": "Qwen/Qwen2.5-7B-Instruct",          "tokens": 700},
    "sage":  {"label": "Sage",  "hf": "meta-llama/Llama-3.1-8B-Instruct", "tokens": 900},
}

SYSTEM_PROMPT = (
    "You are Mirox, a warm, concise, and helpful AI assistant made by the OpenSurr team. "
    "Your name is Mirox. If asked who made you, answer: OpenSurr. "
    "Never mention any other company, model, or provider. "
    "Answer clearly. Keep replies short unless the user asks for depth. "
    "Use plain, natural language."
)

# -------------------- HELPERS --------------------
def current_user():
    if not session.get("uid"):
        return None
    return {
        "id":    session["uid"],
        "email": session.get("email", ""),
        "name":  session.get("name", ""),
        "tier":  session.get("tier", "free"),
    }

def require_user(fn):
    @wraps(fn)
    def w(*a, **k):
        if not session.get("uid"):
            return jsonify({"ok": False, "error": "Sign in first"}), 401
        return fn(*a, **k)
    return w

# -------------------- META --------------------
@app.route("/api/config")
def config():
    return jsonify({
        "models": [
            {"id": k, "label": v["label"]} for k, v in MODELS.items()
        ],
        "hf_ready": bool(HF_API_KEY),
    })

@app.route("/api/health")
def health():
    return jsonify({"ok": True, "hf": bool(HF_API_KEY), "t": int(time.time())})

# -------------------- AUTH --------------------
@app.route("/api/auth/login", methods=["POST"])
def login():
    data  = request.get_json(silent=True) or {}
    name  = (data.get("name")  or "").strip()[:60]
    email = (data.get("email") or "").strip().lower()[:120]
    if not name or "@" not in email or "." not in email.split("@")[-1]:
        return jsonify({"ok": False, "error": "Valid name and email required"}), 400
    session.permanent = True
    session["uid"]   = email
    session["email"] = email
    session["name"]  = name
    session.setdefault("tier", "free")
    return jsonify({"ok": True, "user": current_user()})

@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})

@app.route("/api/me")
def me():
    return jsonify({"user": current_user()})

# -------------------- HF CHAT (stream) --------------------
def hf_stream(model_id, messages, max_tokens, timeout=45):
    if not HF_API_KEY:
        raise RuntimeError("HF_API_KEY not configured")
    r = requests.post(
        HF_CHAT,
        headers={
            "Authorization": f"Bearer {HF_API_KEY}",
            "Content-Type":  "application/json",
            "Accept":        "text/event-stream",
        },
        json={
            "model":       model_id,
            "messages":    messages,
            "max_tokens":  max_tokens,
            "temperature": 0.7,
            "top_p":       0.95,
            "stream":      True,
        },
        stream=True,
        timeout=timeout,
    )
    if r.status_code >= 400:
        body = ""
        try: body = r.text[:200]
        except Exception: pass
        raise RuntimeError(f"HTTP {r.status_code} {body}")

    for raw in r.iter_lines(decode_unicode=True):
        if not raw:
            continue
        if not raw.startswith("data:"):
            continue
        payload = raw[5:].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            obj = json.loads(payload)
        except Exception:
            continue
        choices = obj.get("choices") or []
        if not choices:
            continue
        delta = choices[0].get("delta") or {}
        content = delta.get("content")
        if content:
            yield content

def build_messages(message, history):
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
    for h in (history or [])[-12:]:
        role = h.get("role")
        text = (h.get("content") or "").strip()[:3000]
        if role in ("user", "assistant") and text:
            msgs.append({"role": role, "content": text})
    msgs.append({"role": "user", "content": message[:8000]})
    return msgs

@app.route("/api/chat", methods=["POST"])
@require_user
def chat():
    data    = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    history = data.get("history") or []
    model_key = data.get("model") or "luna"

    if not message:
        return jsonify({"ok": False, "error": "Empty message"}), 400

    cfg = MODELS.get(model_key) or MODELS["luna"]
    messages = build_messages(message, history)

    def generate():
        t0 = time.time()
        try:
            for token in hf_stream(cfg["hf"], messages, cfg["tokens"]):
                yield f"data: {json.dumps({'d': token})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)[:220]})}\n\n"
            return
        yield f"data: {json.dumps({'done': True, 'model': cfg['label'], 'ms': int((time.time()-t0)*1000)})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )

# -------------------- IMAGE --------------------
@app.route("/api/image", methods=["POST"])
@require_user
def image():
    data   = request.get_json(silent=True) or {}
    prompt = (data.get("prompt") or "").strip()[:1000]
    if not prompt:
        return jsonify({"ok": False, "error": "Prompt required"}), 400
    if not HF_API_KEY:
        return jsonify({"ok": False, "error": "HF_API_KEY missing"}), 500
    try:
        r = requests.post(
            HF_IMAGES,
            headers={
                "Authorization": f"Bearer {HF_API_KEY}",
                "Content-Type":  "application/json",
            },
            json={
                "model": "black-forest-labs/FLUX.1-schnell",
                "prompt": prompt,
                "n": 1,
                "size": "1024x1024",
                "response_format": "url",
            },
            timeout=60,
        )
        if r.status_code >= 400:
            return jsonify({"ok": False, "error": f"HTTP {r.status_code}"}), 502
        d = r.json()
        item = (d.get("data") or [{}])[0]
        url  = item.get("url") or (("data:image/png;base64," + item["b64_json"]) if item.get("b64_json") else None)
        if not url:
            return jsonify({"ok": False, "error": "No image returned"}), 502
        return jsonify({"ok": True, "url": url})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)[:200]}), 502
