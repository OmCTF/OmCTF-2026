from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin


class Crossing(Base, TimestampMixin):
    __tablename__ = "crossings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    inspector_id: Mapped[int] = mapped_column(ForeignKey("inspectors.id"), index=True)
    shift_id: Mapped[int] = mapped_column(ForeignKey("shifts.id"), index=True)
    traveler_name: Mapped[str] = mapped_column(String(128), index=True)
    document_level: Mapped[int] = mapped_column(Integer)
    zone: Mapped[int] = mapped_column(Integer, index=True)
    granted: Mapped[bool] = mapped_column(Boolean)
    deny_reason: Mapped[str | None] = mapped_column(String(256))
    notes: Mapped[str | None] = mapped_column(Text)
    watchlist_hit: Mapped[bool] = mapped_column(Boolean, default=False)

    inspector = relationship("Inspector", lazy="joined")
