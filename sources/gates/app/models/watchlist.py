from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin


class WatchlistEntry(Base, TimestampMixin):
    __tablename__ = "watchlist"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    name_normalized: Mapped[str] = mapped_column(String(128), index=True)
    reason: Mapped[str] = mapped_column(Text)
    added_by_id: Mapped[int] = mapped_column(ForeignKey("inspectors.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    added_by = relationship("Inspector", lazy="joined")
