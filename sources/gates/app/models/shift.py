from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class Shift(Base):
    __tablename__ = "shifts"

    id: Mapped[int] = mapped_column(primary_key=True)
    inspector_id: Mapped[int] = mapped_column(ForeignKey("inspectors.id"), index=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        index=True,
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    handoff_notes: Mapped[str | None] = mapped_column(Text)
    crossings_granted: Mapped[int] = mapped_column(Integer, default=0)
    crossings_denied: Mapped[int] = mapped_column(Integer, default=0)
    incidents_count: Mapped[int] = mapped_column(Integer, default=0)

    inspector = relationship("Inspector", lazy="joined")
