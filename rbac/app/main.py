import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx
from fastapi import Depends, FastAPI, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates


def b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode()


def b64decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data.encode())


@dataclass
class Settings:
    api_url: str
    shared_secret: str
    session_secret: bytes
    cookie_name: str
    cookie_domain: Optional[str]
    cookie_secure: bool
    session_ttl: int

    @classmethod
    def load(cls) -> "Settings":
        api_url = os.getenv("MADDH_API_URL", "http://api:8000")
        shared = os.getenv("MADDH_SHARED_SECRET", "maddh-shared-secret")
        session_secret = os.getenv("RBAC_SESSION_SECRET", "rbac-session-secret").encode()
        cookie_name = os.getenv("RBAC_COOKIE_NAME", "maddh_session")
        cookie_domain = os.getenv("RBAC_COOKIE_DOMAIN") or None
        cookie_secure = os.getenv("RBAC_COOKIE_SECURE", "true").lower() in {"1", "true", "yes"}
        session_ttl = int(os.getenv("RBAC_SESSION_TTL", "28800"))  # 8h
        return cls(
            api_url=api_url.rstrip("/"),
            shared_secret=shared,
            session_secret=session_secret,
            cookie_name=cookie_name,
            cookie_domain=cookie_domain,
            cookie_secure=cookie_secure,
            session_ttl=session_ttl,
        )


app = FastAPI(title="Madd Hatchery RBAC Proxy")
templates = Jinja2Templates(directory="app/templates")


async def get_settings(request: Request) -> Settings:
    if not hasattr(request.app.state, "settings"):
        request.app.state.settings = Settings.load()
    return request.app.state.settings


async def fetch_identity(settings: Settings, username: str, password: str) -> Dict[str, Any]:
    payload = {"username": username, "password": password}
    headers = {"X-Maddh-Shared-Secret": settings.shared_secret}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(f"{settings.api_url}/auth/login", json=payload, headers=headers)
    if resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")
    return resp.json()


def sign_session(settings: Settings, data: Dict[str, Any]) -> str:
    payload = json.dumps(data, separators=(",", ":"), sort_keys=True).encode()
    signature = hmac.new(settings.session_secret, payload, hashlib.sha256).digest()
    return f"{b64encode(payload)}.{b64encode(signature)}"


def verify_session(settings: Settings, token: str) -> Optional[Dict[str, Any]]:
    try:
        payload_b64, sig_b64 = token.split(".")
        payload = b64decode(payload_b64)
        expected_sig = hmac.new(settings.session_secret, payload, hashlib.sha256).digest()
        if not hmac.compare_digest(expected_sig, b64decode(sig_b64)):
            return None
        data = json.loads(payload.decode())
        if data.get("exp") and data["exp"] < int(time.time()):
            return None
        return data
    except Exception:
        return None


async def current_session(request: Request, settings: Settings = Depends(get_settings)) -> Optional[Dict[str, Any]]:
    token = request.cookies.get(settings.cookie_name)
    if not token:
        return None
    return verify_session(settings, token)


@app.get("/oauth2/start")
async def oauth_start(
    request: Request,
    settings: Settings = Depends(get_settings),
    session: Optional[Dict[str, Any]] = Depends(current_session),
):
    rd = request.query_params.get("rd", "/")
    if session:
        return RedirectResponse(url=rd, status_code=status.HTTP_303_SEE_OTHER)
    return RedirectResponse(url=f"/oauth2/sign_in?rd={rd}", status_code=status.HTTP_303_SEE_OTHER)


@app.get("/oauth2/sign_in", response_class=HTMLResponse)
async def oauth_sign_in(request: Request, settings: Settings = Depends(get_settings)):
    rd = request.query_params.get("rd", "/")
    return templates.TemplateResponse("login.html", {"request": request, "next": rd})


@app.post("/oauth2/sign_in")
async def oauth_sign_in_post(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    next: str = Form("/"),
    settings: Settings = Depends(get_settings),
):
    identity = await fetch_identity(settings, username, password)
    now = int(time.time())
    session_data = {
        "sub": identity.get("username", username),
        "name": identity.get("display_name") or username,
        "role": identity.get("role", "view"),
        "groups": identity.get("groups", []),
        "can_submit": identity.get("can_submit", False),
        "can_admin": identity.get("can_admin", False),
        "iat": now,
        "exp": now + settings.session_ttl,
    }
    token = sign_session(settings, session_data)
    response = RedirectResponse(url=next or "/", status_code=status.HTTP_303_SEE_OTHER)
    response.set_cookie(
        settings.cookie_name,
        token,
        max_age=settings.session_ttl,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        domain=settings.cookie_domain,
    )
    return response


@app.get("/oauth2/userinfo")
async def oauth_userinfo(
    session: Optional[Dict[str, Any]] = Depends(current_session),
):
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthenticated")
    return {
        "username": session["sub"],
        "display_name": session.get("name"),
        "role": session.get("role", "view"),
        "groups": session.get("groups", []),
        "can_submit": session.get("can_submit", False),
        "can_admin": session.get("can_admin", False),
    }


@app.get("/oauth2/logout")
async def oauth_logout(request: Request, settings: Settings = Depends(get_settings)):
    response = RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie(settings.cookie_name, domain=settings.cookie_domain)
    return response


@app.get("/")
async def root():
    return RedirectResponse(url="/oauth2/start", status_code=status.HTTP_302_FOUND)
