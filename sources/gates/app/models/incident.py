import enum

from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UpdateTimestampMixin


class IncidentStatus(str, enum.Enum):
    OPEN = "open"
    INVESTIGATING = "investigating"
    RESOLVED = "resolved"
    CLOSED = "closed"


class IncidentPriority(str, enum.Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


class Incident(Base, UpdateTimestampMixin):
    __tablename__ = "incidents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("inspectors.id"))
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("inspectors.id"))
    crossing_id: Mapped[str | None] = mapped_column(ForeignKey("crossings.id"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[IncidentStatus] = mapped_column(
        Enum(IncidentStatus), default=IncidentStatus.OPEN, index=True,
    )
    priority: Mapped[IncidentPriority] = mapped_column(
        Enum(IncidentPriority), default=IncidentPriority.NORMAL,
    )
    resolution_notes: Mapped[str | None] = mapped_column(Text)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    reporter = relationship("Inspector", foreign_keys=[reporter_id], lazy="joined")
    assignee = relationship("Inspector", foreign_keys=[assignee_id], lazy="joined")
    notes = relationship("IncidentNote", back_populates="incident", lazy="selectin")


class IncidentNote(Base, TimestampMixin):
    __tablename__ = "incident_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    incident_id: Mapped[str] = mapped_column(
        ForeignKey("incidents.id"), index=True,
    )
    author_id: Mapped[int] = mapped_column(ForeignKey("inspectors.id"))
    content: Mapped[str] = mapped_column(Text)

    incident = relationship("Incident", back_populates="notes")
    author = relationship("Inspector", lazy="joined")
