#!/usr/bin/env python3
"""NexVen Studio — сайт без внешних пакетов. Одна база с ботом."""
from __future__ import annotations

import hashlib
import hmac
import http.cookies
import http.server
import json
import os
import posixpath
import secrets
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from db_shared import (
    ROOT, UPLOADS, init_shared_db, load_admins, ensure_user, get_user,
    list_products, get_product, update_product, add_product, get_balance,
    deduct_balance, add_balance, create_order, get_user_orders,
    get_pending_orders, accept_order, get_referral_stats,
    set_user_currency, create_topup_request, get_pending_topups,
    process_topup_request, get_user_topups,
)

BOT_TOKEN = "8768054266:AAE2TvyzOXyZ7pkgoH_X6rgyshdtxhq-Zuo"
BOT_USERNAME = "nexvenstudiobot"
TG_API_ID = 37794081
TG_API_HASH = "433a134cef5c871a818a9303d07b09ca"
REVIEW_LINK = "https://t.me/+LeIf6iN2tQFlNzBi"
MANAGER_USERNAME = "nexvenstudiomanager"
SITE_DIR = ROOT / "site"
HOST, PORT = "0.0.0.0", 5050
SESSIONS: dict[str, dict] = {}
SECRET = hashlib.sha256((BOT_TOKEN + "nexven-site").encode()).hexdigest()

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}


def verify_telegram_login(data: dict) -> bool:
    check_hash = data.get("hash")
    if not check_hash:
        return False
    fields = {k: v for k, v in data.items() if k != "hash" and v not in (None, "")}
    data_check_string = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret_key = hashlib.sha256(BOT_TOKEN.encode("utf-8")).digest()
    calc = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calc, check_hash):
        return False
    try:
        if time.time() - int(data.get("auth_date", 0)) > 86400 * 2:
            return False
    except Exception:
        return False
    return True


def public_user(u):
    if not u:
        return None
    count, earned = get_referral_stats(u["user_id"])
    return {
        "user_id": u["user_id"],
        "username": u.get("username"),
        "full_name": u.get("full_name"),
        "photo_url": u.get("photo_url"),
        "balance": float(u.get("balance") or 0),
        "currency": u.get("preferred_currency") or "RUB",
        "is_admin": int(u["user_id"]) in load_admins(),
        "referrals": count,
        "referral_earned": earned,
        "ref_link": f"https://t.me/{BOT_USERNAME}?start=ref_{u['user_id']}",
        "site_ref": f"/api/ref/{u['user_id']}",
    }


def parse_multipart(headers, body: bytes):
    ctype = headers.get("Content-Type", "")
    if "multipart/form-data" not in ctype:
        return {}, {}
    boundary = None
    for part in ctype.split(";"):
        part = part.strip()
        if part.lower().startswith("boundary="):
            boundary = part.split("=", 1)[1].strip().strip('"')
    if not boundary:
        return {}, {}
    raw_parts = body.split(("--" + boundary).encode())
    fields, files = {}, {}
    for raw in raw_parts:
        if raw in (b"", b"--", b"--\r\n", b"\r\n"):
            continue
        if raw.startswith(b"--"):
            continue
        if raw.startswith(b"\r\n"):
            raw = raw[2:]
        if b"\r\n\r\n" not in raw:
            continue
        head, data = raw.split(b"\r\n\r\n", 1)
        if data.endswith(b"\r\n"):
            data = data[:-2]
        header_text = head.decode("utf-8", "ignore")
        name = filename = None
        for line in header_text.split("\r\n"):
            if line.lower().startswith("content-disposition:"):
                for item in line.split(";"):
                    item = item.strip()
                    if item.startswith("name="):
                        name = item.split("=", 1)[1].strip('"')
                    if item.startswith("filename="):
                        filename = item.split("=", 1)[1].strip('"')
        if not name:
            continue
        if filename:
            files[name] = (filename, data)
        else:
            fields[name] = data.decode("utf-8", "ignore")
    return fields, files


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("[site]", fmt % args)

    def _sid(self):
        cookie = http.cookies.SimpleCookie(self.headers.get("Cookie", ""))
        if "nv_sid" in cookie:
            sid = cookie["nv_sid"].value
            if sid in SESSIONS:
                return sid
        sid = secrets.token_hex(16)
        SESSIONS[sid] = {}
        return sid

    def _user(self):
        sid = getattr(self, "sid", None)
        if not sid:
            return None
        uid = SESSIONS.get(sid, {}).get("user_id")
        return get_user(int(uid)) if uid else None

    def _send(self, code, body, content_type="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            raw = body.encode("utf-8")
        else:
            raw = body
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        sid = getattr(self, "sid", None)
        if sid:
            self.send_header("Set-Cookie", f"nv_sid={sid}; Path=/; HttpOnly; SameSite=Lax")
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def _json(self, code, obj):
        self._send(code, obj)

    def _read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return {}

    def _read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def _safe_file(self, folder: Path, name: str):
        folder = folder.resolve()
        path = (folder / name).resolve()
        if not str(path).startswith(str(folder)):
            return None
        return path if path.is_file() else None

    def do_GET(self):
        self.sid = self._sid()
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        qs = parse_qs(parsed.query)

        if path == "/api/config":
            return self._json(200, {
                "ok": True,
                "bot_username": BOT_USERNAME,
                "review_link": REVIEW_LINK,
                "manager": MANAGER_USERNAME,
                "tg_api_id": TG_API_ID,
                "firebase": {
                    "apiKey": "AIzaSyAPTTDTPzDpKQjpPvze1IBsJQJw74_ua34",
                    "authDomain": "custom-graphics-36c50.firebaseapp.com",
                    "projectId": "custom-graphics-36c50",
                    "storageBucket": "custom-graphics-36c50.firebasestorage.app",
                    "messagingSenderId": "130011001835",
                    "appId": "1:130011001835:web:1ba6e4e4b3c7a6f0b7dfae",
                    "measurementId": "G-94YQXEFZDD",
                },
            })
        if path == "/api/me":
            return self._json(200, {"ok": True, "user": public_user(self._user())})
        if path == "/api/products":
            cat = (qs.get("category") or [None])[0]
            items = list_products(cat)
            for p in items:
                p["image_url"] = ("/uploads/" + Path(p["image"]).name) if p.get("image") else None
            return self._json(200, {"ok": True, "products": items})
        if path == "/api/orders":
            u = self._user()
            if not u:
                return self._json(401, {"ok": False, "error": "Нужно войти через Telegram"})
            return self._json(200, {"ok": True, "orders": get_user_orders(u["user_id"])})
        if path == "/api/admin/orders":
            u = self._user()
            if not u or int(u["user_id"]) not in load_admins():
                return self._json(403, {"ok": False, "error": "Нет доступа"})
            return self._json(200, {"ok": True, "orders": get_pending_orders()})
        if path == "/api/admin/topups":
            u = self._user()
            if not u or int(u["user_id"]) not in load_admins():
                return self._json(403, {"ok": False, "error": "Нет доступа"})
            return self._json(200, {"ok": True, "topups": get_pending_topups()})
        if path == "/api/topups":
            u = self._user()
            if not u:
                return self._json(401, {"ok": False, "error": "Нужно войти"})
            return self._json(200, {"ok": True, "topups": get_user_topups(u["user_id"])})
        if path.startswith("/api/ref/"):
            try:
                SESSIONS[self.sid]["ref"] = int(path.rsplit("/", 1)[-1])
            except Exception:
                pass
            self._send(302, b"", "text/html", {"Location": "/"})
            return

        if path.startswith("/uploads/"):
            f = self._safe_file(UPLOADS, path.split("/uploads/", 1)[1])
            return self._file(f)
        if path == "/":
            path = "/index.html"
        rel = path.lstrip("/")
        f = self._safe_file(SITE_DIR, rel)
        return self._file(f)

    def _file(self, f: Path | None):
        if not f:
            return self._send(404, "Not found", "text/plain; charset=utf-8")
        data = f.read_bytes()
        ctype = MIME.get(f.suffix.lower(), "application/octet-stream")
        self._send(200, data, ctype)

    def do_POST(self):
        self.sid = self._sid()
        path = urlparse(self.path).path
        u = self._user()

        if path == "/api/auth/telegram":
            data = self._read_json()
            incoming = {k: str(data[k]) for k in data if data[k] is not None}
            if not verify_telegram_login(incoming):
                return self._json(403, {
                    "ok": False,
                    "error": "Подпись Telegram не прошла. Укажите домен боту в @BotFather (/setdomain).",
                })
            uid = int(incoming["id"])
            first = incoming.get("first_name") or ""
            last = incoming.get("last_name") or ""
            full = (first + " " + last).strip()
            ref = SESSIONS.get(self.sid, {}).get("ref")
            ensure_user(uid, incoming.get("username"), full or first, None, incoming.get("photo_url"), referred_by=ref)
            SESSIONS[self.sid]["user_id"] = uid
            return self._json(200, {"ok": True, "user": public_user(get_user(uid))})

        if path == "/api/auth/logout":
            SESSIONS[self.sid] = {}
            return self._json(200, {"ok": True})

        if path == "/api/products":
            if not u or int(u["user_id"]) not in load_admins():
                return self._json(403, {"ok": False, "error": "Нет доступа"})
            data = self._read_json()
            pid = (data.get("id") or "").strip()
            name = (data.get("name") or "").strip()
            try:
                price = float(data.get("price"))
            except Exception:
                return self._json(400, {"ok": False, "error": "Цена неверная"})
            if not pid or not name:
                return self._json(400, {"ok": False, "error": "Нужны id и название"})
            if get_product(pid):
                update_product(pid, name, price, data.get("description"), data.get("category"))
            else:
                add_product(pid, name, price, data.get("description") or "", data.get("category") or "catalog")
            return self._json(200, {"ok": True, "product": get_product(pid)})

        if path.startswith("/api/products/") and path.endswith("/image"):
            if not u or int(u["user_id"]) not in load_admins():
                self._read_body()
                return self._json(403, {"ok": False, "error": "Нет доступа"})
            pid = path.split("/api/products/", 1)[1].rsplit("/image", 1)[0]
            if not get_product(pid):
                self._read_body()
                return self._json(404, {"ok": False, "error": "Товар не найден"})
            fields, files = parse_multipart(self.headers, self._read_body())
            if "file" not in files:
                return self._json(400, {"ok": False, "error": "Нет файла"})
            filename, content = files["file"]
            ext = Path(filename).suffix.lower()
            if ext not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
                return self._json(400, {"ok": False, "error": "Можно png/jpg/webp/gif"})
            fname = f"{pid}_{uuid.uuid4().hex[:8]}{ext}"
            UPLOADS.mkdir(parents=True, exist_ok=True)
            (UPLOADS / fname).write_bytes(content)
            update_product(pid, image=fname)
            return self._json(200, {"ok": True, "image_url": "/uploads/" + fname})

        if path == "/api/orders":
            if not u:
                return self._json(401, {"ok": False, "error": "Нужно войти через Telegram"})
            data = self._read_json()
            pid = data.get("product_id")
            desc = (data.get("description") or "").strip()
            if not pid or len(desc) < 5:
                return self._json(400, {"ok": False, "error": "Нужен товар и описание от 5 символов"})
            prod = get_product(pid)
            if not prod:
                return self._json(404, {"ok": False, "error": "Товар не найден"})
            price = float(prod["price"])
            if not deduct_balance(u["user_id"], price):
                return self._json(400, {"ok": False, "error": "Недостаточно средств. Пополните баланс в боте."})
            oid = create_order(u["user_id"], pid, prod["name"], price, desc)
            return self._json(200, {"ok": True, "order_id": oid, "balance": get_balance(u["user_id"])})

        if path.startswith("/api/admin/orders/") and path.endswith("/accept"):
            if not u or int(u["user_id"]) not in load_admins():
                return self._json(403, {"ok": False, "error": "Нет доступа"})
            try:
                oid = int(path.split("/api/admin/orders/", 1)[1].split("/")[0])
            except Exception:
                return self._json(400, {"ok": False, "error": "Неверный id"})
            uname = u.get("username") or u.get("full_name") or str(u["user_id"])
            ok, msg = accept_order(oid, u["user_id"], uname)
            return self._json(200, {"ok": ok, "message": msg})

        if path == "/api/admin/give":
            if not u or int(u["user_id"]) not in load_admins():
                return self._json(403, {"ok": False, "error": "Нет доступа"})
            data = self._read_json()
            try:
                uid = int(data.get("user_id"))
                amount = float(data.get("amount"))
            except Exception:
                return self._json(400, {"ok": False, "error": "Нужны user_id и amount"})
            if amount <= 0:
                return self._json(400, {"ok": False, "error": "Сумма должна быть больше 0"})
            ensure_user(uid)
            add_balance(uid, amount)
            return self._json(200, {"ok": True, "balance": get_balance(uid)})

        if path == "/api/currency":
            if not u:
                return self._json(401, {"ok": False, "error": "Нужно войти"})
            data = self._read_json()
            cur = set_user_currency(u["user_id"], (data.get("currency") or "RUB").upper())
            return self._json(200, {"ok": True, "currency": cur})

        if path == "/api/topup":
            if not u:
                return self._json(401, {"ok": False, "error": "Нужно войти"})
            data = self._read_json()
            try:
                amount = float(data.get("amount"))
            except Exception:
                return self._json(400, {"ok": False, "error": "Укажите сумму"})
            method = (data.get("method") or "").strip().lower()
            allowed = {"sbp", "google_pay", "apple_pay", "stars"}
            if method not in allowed:
                return self._json(400, {"ok": False, "error": "Метод: sbp, google_pay, apple_pay, stars"})
            if amount < 10:
                return self._json(400, {"ok": False, "error": "Минимум 10 ₽"})
            if amount > 100000:
                return self._json(400, {"ok": False, "error": "Максимум 100000 ₽"})
            if method == "stars":
                amt = int(round(amount))
                return self._json(200, {
                    "ok": True,
                    "method": "stars",
                    "amount": amt,
                    "bot_link": f"https://t.me/{BOT_USERNAME}?start=topup_{amt}",
                    "message": f"Пополнение {amt} ₽ звёздами — откройте бота",
                })
            rid = create_topup_request(u["user_id"], amount, method)
            return self._json(200, {
                "ok": True,
                "request_id": rid,
                "method": method,
                "amount": amount,
                "message": "Заявка создана. Оплатите выбранным способом и дождитесь начисления админом, либо напишите менеджеру @" + MANAGER_USERNAME,
                "manager": MANAGER_USERNAME,
            })

        if path.startswith("/api/admin/topups/") and path.endswith("/approve"):
            if not u or int(u["user_id"]) not in load_admins():
                return self._json(403, {"ok": False, "error": "Нет доступа"})
            try:
                rid = int(path.split("/api/admin/topups/", 1)[1].split("/")[0])
            except Exception:
                return self._json(400, {"ok": False, "error": "Неверный id"})
            ok, msg = process_topup_request(rid, u["user_id"], approve=True)
            return self._json(200, {"ok": ok, "message": msg})

        if path.startswith("/api/admin/topups/") and path.endswith("/reject"):
            if not u or int(u["user_id"]) not in load_admins():
                return self._json(403, {"ok": False, "error": "Нет доступа"})
            try:
                rid = int(path.split("/api/admin/topups/", 1)[1].split("/")[0])
            except Exception:
                return self._json(400, {"ok": False, "error": "Неверный id"})
            ok, msg = process_topup_request(rid, u["user_id"], approve=False)
            return self._json(200, {"ok": ok, "message": msg})

        return self._json(404, {"ok": False, "error": "Not found"})


def main():
    init_shared_db()
    print("=" * 46)
    print("  NexVen Studio SITE")
    print(f"  http://127.0.0.1:{PORT}")
    print("  DB:", ROOT / "bot_database.db")
    print("=" * 46)
    http.server.ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
