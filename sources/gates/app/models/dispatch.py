from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class Dispatch(Base, TimestampMixin):
    __tablename__ = "dispatches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("inspectors.id", ondelete="CASCADE"), index=True,
    )
    content: Mapped[str] = mapped_column(Text)


class ReportHandoff(Base, TimestampMixin):
    """Short-lived receipt that lets a worker claim one accepted report."""

    __tablename__ = "report_handoffs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    incident_id: Mapped[str] = mapped_column(
        ForeignKey("incidents.id", ondelete="CASCADE"), index=True,
    )
