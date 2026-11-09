import os
import secrets
import sys
from pathlib import Path


def ensure_master_key() -> None:
    if os.environ.get("KPP_MASTER_KEY"):
        return

    key_file = os.environ.get("KPP_RUNTIME_KEY_FILE")
    if not key_file:
        os.environ["KPP_MASTER_KEY"] = secrets.token_urlsafe(32)
        return

    target = Path(key_file)
    target.parent.mkdir(parents=True, exist_ok=True)
    candidate = target.with_name(
        f"{target.name}.{os.getpid()}.{secrets.token_hex(4)}",
    )
    candidate.write_text(secrets.token_urlsafe(32), encoding="ascii")
    candidate.chmod(0o600)
    try:
        os.link(candidate, target)
    except FileExistsError:
        pass
    finally:
        candidate.unlink(missing_ok=True)
    os.environ["KPP_MASTER_KEY"] = target.read_text(encoding="ascii").strip()

if __name__ == "__main__":
    ensure_master_key()

    if sys.argv[1:] == ["worker"]:
        from app.workers.celery_tasks import worker_main
        worker_main()
    else:
        from app.runtime_secrets import initialize_runtime_secrets

        initialize_runtime_secrets()
        import uvicorn

        uvicorn.run(
            "app.main:app",
            host="0.0.0.0",
            port=int(os.environ.get("KPP_PORT", "8000")),
            reload=False,
        )
