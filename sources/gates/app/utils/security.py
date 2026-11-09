import secrets

import bcrypt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def generate_token() -> str:
    return secrets.token_hex(24)


def generate_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(6).upper()}"
