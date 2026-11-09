import mimetypes
import time
from email.utils import formatdate
from pathlib import Path

from blacksheep import Application, Router, html
from blacksheep.middlewares import MiddlewareCategory

from .config import settings
from .database import async_session_factory, engine
from .models import Base
from .services import report_codec
from .routers import (
    board,
    briefings,
    checkpoint,
    dispatches,
    incidents,
    inspectors,
    internal,
    quarters,
    registry,
    shifts,
    watchlist,
    zones,
)
from .services.zones import seed_zones

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

# Windows-реестр и урезанные образы иногда отдают .js как text/plain,
# а с nosniff браузер такой модуль не исполнит.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")

api_router = Router(
    sub_routers=[
        module.router.backend
        for module in (
            inspectors, checkpoint, board, watchlist, incidents,
            shifts, zones, quarters, dispatches, briefings, internal, registry,
        )
    ]
)

app = Application(router=api_router)
app.title = settings.checkpoint_name
app.version = settings.version


@app.lifespan
async def service_lifespan():
    report_codec.initialize()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session_factory() as db:
        await seed_zones(db)
    try:
        yield
    finally:
        await engine.dispose()


async def security_headers(request, next_handler):
    request.scope["method"] = request.method.upper()
    response = await next_handler(request)
    if request.scope.get("path") == "/internal/health":
        now = time.time()
        age = max(0, int((now - report_codec.start_epoch()) * 1_000_000))
        uptime = f"{age // 1_000_000}.{age % 1_000_000:06d}"
        response.set_header(
            b"X-Process-Uptime", uptime.encode("ascii"),
        )
        response.remove_header(b"date")
        response.set_header(
            b"Date", formatdate(now, usegmt=True).encode("ascii"),
        )
    response.set_header(b"X-Content-Type-Options", b"nosniff")
    response.set_header(b"X-Frame-Options", b"DENY")
    response.set_header(b"Cache-Control", b"no-store")
    return response


app.middlewares.append(security_headers, MiddlewareCategory.MESSAGE)

# API routes are registered on BlackSheep's Router above; static assets are
# served by BlackSheep as well, with directory browsing disabled.
app.serve_files(FRONTEND_DIR, root_path="static", index_document=None)


@app.router.get("/")
async def index():
    return html((FRONTEND_DIR / "index.html").read_text(encoding="utf-8"))


@app.router.get("/favicon.ico")
async def favicon():
    from blacksheep import no_content
    return no_content()
