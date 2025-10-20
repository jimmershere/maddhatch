import asyncio
import base64
import hashlib
import os
import secrets
import ssl
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional

import asyncpg
from asyncpg import UniqueViolationError
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from ldap3 import (
    ALL,
    AUTO_BIND_DEFAULT,
    AUTO_BIND_TLS_BEFORE_BIND,
    Connection,
    MODIFY_REPLACE,
    Server,
    Tls,
)
from ldap3.core.exceptions import LDAPSocketOpenError, LDAPStartTLSError
from pydantic import BaseModel, Field


DEFAULT_BOOTSTRAP_HASH = "pbkdf2_sha256$180000$n04XKKmoufacaPJx1ODKUg==$SxWQMn9fMgmvVWHJGp9uVe2aQ5FspwLqjFK1xmTPZpI="


@dataclass
class Settings:
    database_url: str
    shared_secret: str
    bootstrap_user: str
    bootstrap_hash: str
    ldap_enabled: bool
    ldap_host: str
    ldap_port: int
    ldap_use_tls: bool
    ldap_bind_dn: str
    ldap_bind_password: str
    ldap_base_dn: str
    ldap_bootstrap_password: str
    ldap_tls_ca: Optional[str]
    ldap_tls_cert: Optional[str]
    ldap_tls_key: Optional[str]

    @classmethod
    def load(cls) -> "Settings":
        database_url = os.getenv(
            "DATABASE_URL",
            "postgres://postgres:postgres@db:5432/maddhatchery?sslmode=disable",
        )
        shared_secret = os.getenv("MADDH_SHARED_SECRET", "maddh-shared-secret")
        bootstrap_user = os.getenv("MADDH_BOOTSTRAP_ADMIN_USER", "admin")
        bootstrap_hash = os.getenv("MADDH_BOOTSTRAP_ADMIN_HASH", DEFAULT_BOOTSTRAP_HASH)

        ldap_enabled = os.getenv("MADDH_LDAP_ENABLED", "true").lower() not in {
            "false",
            "0",
            "no",
        }
        ldap_host = os.getenv("MADDH_LDAP_HOST", "ldap")
        ldap_port = int(os.getenv("MADDH_LDAP_PORT", "389"))
        ldap_use_tls = os.getenv("MADDH_LDAP_TLS", "false").lower() in {"1", "true", "yes"}
        ldap_bind_dn = os.getenv("MADDH_LDAP_BIND_DN", "cn=admin,dc=example,dc=com")
        ldap_bind_password = os.getenv("MADDH_LDAP_BIND_PASSWORD", "3wm078uu")
        ldap_base_dn = os.getenv("MADDH_LDAP_BASE_DN", "dc=example,dc=com")
        ldap_bootstrap_password = os.getenv("MADDH_LDAP_BOOTSTRAP_PASSWORD", "3wm078uu")
        ldap_tls_ca = os.getenv("LDAP_TLS_CA_FILE")
        ldap_tls_cert = os.getenv("LDAP_TLS_CERT_FILE")
        ldap_tls_key = os.getenv("LDAP_TLS_KEY_FILE")

        return cls(
            database_url=database_url,
            shared_secret=shared_secret,
            bootstrap_user=bootstrap_user,
            bootstrap_hash=bootstrap_hash,
            ldap_enabled=ldap_enabled,
            ldap_host=ldap_host,
            ldap_port=ldap_port,
            ldap_use_tls=ldap_use_tls,
            ldap_bind_dn=ldap_bind_dn,
            ldap_bind_password=ldap_bind_password,
            ldap_base_dn=ldap_base_dn,
            ldap_bootstrap_password=ldap_bootstrap_password,
            ldap_tls_ca=ldap_tls_ca,
            ldap_tls_cert=ldap_tls_cert,
            ldap_tls_key=ldap_tls_key,
        )


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode()


def hash_password(password: str, *, iterations: int = 180000) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations, dklen=32)
    return f"pbkdf2_sha256${iterations}${_b64(salt)}${_b64(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iterations, salt_b64, hash_b64 = stored.split("$")
        if scheme != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_b64)
        expected = base64.urlsafe_b64decode(hash_b64)
        calc = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), salt, int(iterations), dklen=len(expected)
        )
        return secrets.compare_digest(calc, expected)
    except Exception:
        return False


def require_shared_secret(request: Request, settings: Settings):
    token = request.headers.get("X-Maddh-Shared-Secret")
    if not token or token != settings.shared_secret:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")


async def get_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.pool


async def get_settings(request: Request) -> Settings:
    return request.app.state.settings


app = FastAPI(title="Madd Hatchery API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"] ,
    allow_headers=["*"] ,
)


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    username: str
    display_name: Optional[str]
    role: str
    groups: List[str]
    can_submit: bool
    can_admin: bool


class UserRecord(BaseModel):
    username: str
    display_name: Optional[str]
    role: str
    can_portal: bool
    can_submit: bool
    can_admin: bool
    created_at: datetime
    updated_at: datetime


class UserCreate(BaseModel):
    username: str
    password: str
    display_name: Optional[str] = None
    role: str = Field(default="view", pattern="^(view|submit|admin)$")
    can_portal: bool = True
    can_submit: bool = False
    can_admin: bool = False


class UserUpdate(BaseModel):
    password: Optional[str] = None
    display_name: Optional[str] = None
    role: Optional[str] = Field(default=None, pattern="^(view|submit|admin)$")
    can_portal: Optional[bool] = None
    can_submit: Optional[bool] = None
    can_admin: Optional[bool] = None


class SupportTicketIn(BaseModel):
    ticket_id: str = Field(..., alias="id")
    summary: str
    severity: int = Field(..., ge=1, le=4)
    user: Optional[str] = None


class SupportTicket(BaseModel):
    id: str
    user_username: Optional[str]
    summary: str
    severity: int
    status: str
    created_at: datetime


class ProviderState(BaseModel):
    provider: str
    enabled: bool
    updated_at: datetime


async def fetch_user(pool: asyncpg.Pool, username: str) -> Optional[asyncpg.Record]:
    query = """
        SELECT username, display_name, password_hash, role, can_portal, can_submit,
               can_admin, created_at, updated_at
        FROM app_users WHERE username=$1
    """
    return await pool.fetchrow(query, username)


async def ensure_bootstrap_admin(pool: asyncpg.Pool, settings: Settings):
    record = await fetch_user(pool, settings.bootstrap_user)
    if record:
        return
    await pool.execute(
        """
        INSERT INTO app_users (username, display_name, password_hash, role, can_portal, can_submit, can_admin)
        VALUES ($1, $2, $3, 'admin', true, true, true)
        """,
        settings.bootstrap_user,
        "Bootstrap Administrator",
        settings.bootstrap_hash,
    )


def build_tls(settings: Settings) -> Optional[Tls]:
    if not settings.ldap_use_tls:
        return None
    tls = Tls()
    tls.validate = ssl.CERT_NONE if not settings.ldap_tls_ca else ssl.CERT_REQUIRED
    tls.version = ssl.PROTOCOL_TLSv1_2
    if settings.ldap_tls_ca:
        tls.ca_certs_file = settings.ldap_tls_ca
    if settings.ldap_tls_cert:
        tls.local_certificate_file = settings.ldap_tls_cert
    if settings.ldap_tls_key:
        tls.local_private_key_file = settings.ldap_tls_key
    return tls


def _use_ssl(settings: Settings) -> bool:
    return settings.ldap_use_tls and settings.ldap_port == 636


def create_ldap_connection(settings: Settings, *, user: str, password: str) -> Connection:
    tls = build_tls(settings)
    use_ssl = _use_ssl(settings)

    start_tls_requested = (
        settings.ldap_use_tls
        and not use_ssl
        and not getattr(settings, "_ldap_tls_failed", False)
    )

    def _build_server(*, use_ssl_flag: bool, tls_config: Optional[Tls]) -> Server:
        return Server(
            settings.ldap_host,
            port=settings.ldap_port,
            use_ssl=use_ssl_flag,
            get_info=ALL,
            tls=tls_config,
        )

    def _connect(*, use_ssl_flag: bool, tls_config: Optional[Tls], start_tls: bool) -> Connection:
        server = _build_server(use_ssl_flag=use_ssl_flag, tls_config=tls_config)
        conn = Connection(
            server,
            user=user,
            password=password,
            auto_bind=AUTO_BIND_DEFAULT,
            raise_exceptions=True,
        )
        try:
            conn.open()
            if start_tls:
                conn.start_tls()
            if not conn.bound:
                conn.bind()
        except Exception:
            conn.unbind()
            raise
        return conn

    try:
        return _connect(use_ssl_flag=use_ssl, tls_config=tls, start_tls=start_tls_requested)
    except (LDAPStartTLSError, LDAPSocketOpenError):
        if not start_tls_requested:
            raise
        setattr(settings, "_ldap_tls_failed", True)
        return _connect(use_ssl_flag=False, tls_config=None, start_tls=False)


def ensure_ldap_entries(settings: Settings):
    conn = create_ldap_connection(
        settings,
        user=settings.ldap_bind_dn,
        password=settings.ldap_bind_password,
    )

    base_dn = settings.ldap_base_dn
    users_dn = f"ou=users,{base_dn}"
    roles_dn = f"ou=roles,{base_dn}"

    def ensure_entry(dn: str, object_classes: List[str], attributes: Dict[str, Any]):
        if not conn.search(dn, "(objectClass=*)", attributes=[]):
            conn.add(dn, object_classes, attributes)

    ensure_entry(base_dn, ["top", "domain"], {"dc": base_dn.split(",")[0].split("=")[1]})
    ensure_entry(users_dn, ["top", "organizationalUnit"], {"ou": "users"})
    ensure_entry(roles_dn, ["top", "organizationalUnit"], {"ou": "roles"})

    admin_dn = f"uid={settings.bootstrap_user},{users_dn}"
    ensure_entry(
        admin_dn,
        ["top", "person", "organizationalPerson", "inetOrgPerson"],
        {
            "cn": settings.bootstrap_user,
            "sn": "Administrator",
            "uid": settings.bootstrap_user,
            "userPassword": settings.ldap_bootstrap_password,
        },
    )

    for role in ("view", "submit", "admin"):
        group_dn = f"cn={role},{roles_dn}"
        ensure_entry(
            group_dn,
            ["top", "groupOfNames"],
            {"cn": role, "member": [admin_dn]},
        )
        members: List[str] = []
        if conn.search(group_dn, "(objectClass=groupOfNames)", attributes=["member"]):
            entry = conn.entries[0]
            if hasattr(entry, "member"):
                members = list({str(m) for m in entry.member})
        if admin_dn not in members:
            members.append(admin_dn)
            conn.modify(group_dn, {"member": [(MODIFY_REPLACE, members)]})

    conn.unbind()


def ldap_authenticate(settings: Settings, username: str, password: str) -> Dict[str, Any]:
    user_dn = f"uid={username},ou=users,{settings.ldap_base_dn}"
    try:
        conn = create_ldap_connection(settings, user=user_dn, password=password)
    except Exception:
        return {}

    groups: List[str] = []
    roles_base = f"ou=roles,{settings.ldap_base_dn}"
    if conn.search(roles_base, f"(member={user_dn})", attributes=["cn"]):
        groups = [entry.cn.value for entry in conn.entries]
    conn.unbind()
    return {"username": username, "groups": groups}


def merge_groups(user: Optional[asyncpg.Record], ldap_groups: List[str]) -> List[str]:
    groups = set(g.lower() for g in ldap_groups)
    if user:
        groups.update(["view"])
        if user["role"] == "submit":
            groups.update({"submit"})
        if user["role"] == "admin":
            groups.update({"submit", "admin"})
        if user["can_submit"]:
            groups.add("submit")
        if user["can_admin"]:
            groups.add("admin")
    return sorted(groups)


@app.on_event("startup")
async def startup_event():
    settings = Settings.load()
    app.state.settings = settings
    app.state.pool = await asyncpg.create_pool(dsn=settings.database_url)
    await ensure_bootstrap_admin(app.state.pool, settings)
    if settings.ldap_enabled:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, ensure_ldap_entries, settings)


@app.on_event("shutdown")
async def shutdown_event():
    pool: asyncpg.Pool = app.state.pool
    await pool.close()


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.post("/auth/login", response_model=LoginResponse)
async def auth_login(
    payload: LoginRequest,
    request: Request,
    pool: asyncpg.Pool = Depends(get_pool),
    settings: Settings = Depends(get_settings),
):
    require_shared_secret(request, settings)

    user = await fetch_user(pool, payload.username)
    valid = False
    groups: List[str] = []

    if user and verify_password(payload.password, user["password_hash"]):
        valid = True
    ldap_info: Dict[str, Any] = {}
    if not valid and settings.ldap_enabled:
        ldap_info = ldap_authenticate(settings, payload.username, payload.password)
        valid = bool(ldap_info)
        if valid and not user:
            # Automatically mirror LDAP user record locally for group mapping
            await pool.execute(
                """
                INSERT INTO app_users (username, display_name, password_hash, role, can_portal, can_submit, can_admin)
                VALUES ($1, $2, $3, 'view', true, false, false)
                ON CONFLICT (username) DO NOTHING
                """,
                payload.username,
                payload.username,
                hash_password(payload.password),
            )
            user = await fetch_user(pool, payload.username)

    if not valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")

    groups = merge_groups(user, ldap_info.get("groups", []))
    return LoginResponse(
        username=user["username"] if user else payload.username,
        display_name=(user["display_name"] if user else payload.username),
        role=(user["role"] if user else "view"),
        groups=groups,
        can_submit=user["can_submit"] if user else "submit" in groups,
        can_admin=user["can_admin"] if user else "admin" in groups,
    )


@app.get("/admin/users", response_model=List[UserRecord])
async def admin_users(
    request: Request,
    pool: asyncpg.Pool = Depends(get_pool),
    settings: Settings = Depends(get_settings),
):
    require_shared_secret(request, settings)
    rows = await pool.fetch(
        """
        SELECT username, display_name, role, can_portal, can_submit, can_admin, created_at, updated_at
        FROM app_users ORDER BY username
        """
    )
    return [UserRecord(**dict(row)) for row in rows]


@app.post("/admin/users", status_code=201)
async def admin_user_create(
    payload: UserCreate,
    request: Request,
    pool: asyncpg.Pool = Depends(get_pool),
    settings: Settings = Depends(get_settings),
):
    require_shared_secret(request, settings)
    pwd_hash = hash_password(payload.password)
    try:
        await pool.execute(
            """
            INSERT INTO app_users (username, display_name, password_hash, role, can_portal, can_submit, can_admin)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            payload.username,
            payload.display_name or payload.username,
            pwd_hash,
            payload.role,
            payload.can_portal,
            payload.can_submit,
            payload.can_admin,
        )
    except UniqueViolationError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="user exists")
    return {"created": payload.username}


@app.put("/admin/users/{username}")
async def admin_user_update(
    username: str,
    payload: UserUpdate,
    request: Request,
    pool: asyncpg.Pool = Depends(get_pool),
    settings: Settings = Depends(get_settings),
):
    require_shared_secret(request, settings)
    user = await fetch_user(pool, username)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")

    fields: Dict[str, Any] = {}
    if payload.display_name is not None:
        fields["display_name"] = payload.display_name
    if payload.role is not None:
        fields["role"] = payload.role
    if payload.can_portal is not None:
        fields["can_portal"] = payload.can_portal
    if payload.can_submit is not None:
        fields["can_submit"] = payload.can_submit
    if payload.can_admin is not None:
        fields["can_admin"] = payload.can_admin
    if payload.password:
        fields["password_hash"] = hash_password(payload.password)

    if not fields:
        return {"updated": username}

    assignments = ", ".join(f"{k}=${i+2}" for i, k in enumerate(fields.keys()))
    values = list(fields.values())
    await pool.execute(
        f"UPDATE app_users SET {assignments} WHERE username=$1",
        username,
        *values,
    )
    return {"updated": username}


@app.post("/support/tickets", status_code=202)
async def support_ticket_create(
    payload: SupportTicketIn,
    request: Request,
    pool: asyncpg.Pool = Depends(get_pool),
    settings: Settings = Depends(get_settings),
):
    require_shared_secret(request, settings)
    await pool.execute(
        """
        INSERT INTO support_tickets (id, user_username, summary, severity)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET summary=EXCLUDED.summary, severity=EXCLUDED.severity, status='open'
        """,
        payload.ticket_id,
        payload.user,
        payload.summary,
        payload.severity,
    )
    return {"ticket": payload.ticket_id}


@app.get("/admin/tickets", response_model=List[SupportTicket])
async def admin_ticket_list(
    request: Request,
    pool: asyncpg.Pool = Depends(get_pool),
    settings: Settings = Depends(get_settings),
):
    require_shared_secret(request, settings)
    rows = await pool.fetch(
        """
        SELECT id, user_username, summary, severity, status, created_at
        FROM support_tickets
        WHERE status='open'
        ORDER BY created_at DESC
        """
    )
    return [SupportTicket(**dict(row)) for row in rows]


@app.put("/admin/tickets/{ticket_id}/status")
async def admin_ticket_status(
    ticket_id: str,
    payload: Dict[str, str],
    request: Request,
    pool: asyncpg.Pool = Depends(get_pool),
    settings: Settings = Depends(get_settings),
):
    require_shared_secret(request, settings)
    status_value = payload.get("status", "open")
    await pool.execute(
        "UPDATE support_tickets SET status=$2 WHERE id=$1",
        ticket_id,
        status_value,
    )
    return {"ticket": ticket_id, "status": status_value}


@app.get("/admin/auth/providers", response_model=List[ProviderState])
async def admin_auth_providers(
    request: Request,
    pool: asyncpg.Pool = Depends(get_pool),
    settings: Settings = Depends(get_settings),
):
    require_shared_secret(request, settings)
    rows = await pool.fetch(
        "SELECT provider, enabled, updated_at FROM maddh_auth_providers ORDER BY provider"
    )
    return [ProviderState(**dict(row)) for row in rows]


@app.put("/admin/auth/providers/{provider}")
async def admin_auth_provider_update(
    provider: str,
    payload: Dict[str, Any],
    request: Request,
    pool: asyncpg.Pool = Depends(get_pool),
    settings: Settings = Depends(get_settings),
):
    require_shared_secret(request, settings)
    enabled = bool(payload.get("enabled"))
    result = await pool.execute(
        """
        INSERT INTO maddh_auth_providers (provider, enabled)
        VALUES ($1, $2)
        ON CONFLICT (provider) DO UPDATE SET enabled=$2, updated_at=now()
        """,
        provider,
        enabled,
    )
    return {"provider": provider, "enabled": enabled, "result": result}
