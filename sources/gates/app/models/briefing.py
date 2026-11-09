from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UpdateTimestampMixin


class BriefingArtifact(Base, UpdateTimestampMixin):
    """Persistent operational briefing records stored in PostgreSQL."""

    __tablename__ = "briefing_artifacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("inspectors.id", ondelete="CASCADE"), index=True,
    )
    content: Mapped[str] = mapped_column(Text)
