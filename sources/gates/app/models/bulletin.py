import enum

from sqlalchemy import Boolean, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin


class BulletinPriority(str, enum.Enum):
    NORMAL = "normal"
    URGENT = "urgent"
    CRITICAL = "critical"


class Bulletin(Base, TimestampMixin):
    __tablename__ = "bulletins"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("inspectors.id"))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    rendered: Mapped[str] = mapped_column(Text)
    priority: Mapped[BulletinPriority] = mapped_column(
        Enum(BulletinPriority), default=BulletinPriority.NORMAL,
    )
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)

    author = relationship("Inspector", lazy="joined")
