import enum

from sqlalchemy import Boolean, Enum, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UpdateTimestampMixin


class InspectorRank(str, enum.Enum):
    INSPECTOR = "inspector"
    SENIOR = "senior"
    COMMANDANT = "commandant"


class Inspector(Base, UpdateTimestampMixin):
    __tablename__ = "inspectors"

    id: Mapped[int] = mapped_column(primary_key=True)
    callsign: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(128))
    rank: Mapped[InspectorRank] = mapped_column(
        Enum(InspectorRank), default=InspectorRank.INSPECTOR,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
