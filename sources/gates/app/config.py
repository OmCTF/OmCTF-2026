import secrets

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://kpp7@localhost:5432/kpp7"
    redis_url: str = "redis://localhost:6379/0"
    registry_url_prefix: str = "http://web"
    master_key: str = Field(default_factory=lambda: secrets.token_urlsafe(32))

    checkpoint_name: str = "Тобольские ворота · Омская крепость"
    version: str = "3.0.0"

    session_ttl: int = 14400
    rate_limit_window: int = 60
    rate_limit_max: int = 10

    model_config = {
        "env_prefix": "KPP_",
        "env_file": ".env",
        "env_ignore_empty": True,
    }


settings = Settings()

ZONES: dict[int, dict] = {
    0: {"name": "Соборная площадь", "min_level": 0},
    1: {"name": "Офицерская слобода", "min_level": 1},
    2: {"name": "Гостиный двор", "min_level": 1},
    3: {"name": "Арсенал и мастерские", "min_level": 1},
    4: {"name": "Пересыльный острог", "min_level": 0},
    5: {"name": "Канцелярия крепости", "min_level": 9},
    9: {"name": "Кабинет коменданта", "min_level": 9},
}

DIRECTIVES = [
    "Все транзитные документы должны содержать действующую криптографическую печать.",
    "Отказывать во въезде лицам с истекшими временными рамками.",
    "Проверять поле эмитента на соответствие уполномоченному органу.",
    "Для зон 5 и 9 требуется допуск уровня «комендант».",
    "О подозрительных документах немедленно докладывать старшему смены.",
    "Изъятые документы фиксировать в журнале пересечений.",
]
