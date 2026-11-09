import enum

from sqlalchemy import Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UpdateTimestampMixin


class ZoneStatus(str, enum.Enum):
    OPEN = "open"
    RESTRICTED = "restricted"
    LOCKDOWN = "lockdown"


class Zone(Base, UpdateTimestampMixin):
    __tablename__ = "zones"

    zone: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    min_level: Mapped[int] = mapped_column(Integer)
    status: Mapped[ZoneStatus] = mapped_column(
        Enum(ZoneStatus), default=ZoneStatus.OPEN,
    )
    capacity: Mapped[int | None] = mapped_column(Integer)
    current_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("inspectors.id"))
