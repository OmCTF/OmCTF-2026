from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UpdateTimestampMixin


class Purse(Base, UpdateTimestampMixin):
    """Жалованье караульного и всё, что к нему прилагается."""

    __tablename__ = "purses"

    inspector_id: Mapped[int] = mapped_column(ForeignKey("inspectors.id"), primary_key=True)
    balance: Mapped[int] = mapped_column(Integer, default=0)
    streak: Mapped[int] = mapped_column(Integer, default=0)
    best_streak: Mapped[int] = mapped_column(Integer, default=0)
    stamps_ok: Mapped[int] = mapped_column(Integer, default=0)
    stamps_miss: Mapped[int] = mapped_column(Integer, default=0)
    suspicion: Mapped[int] = mapped_column(Integer, default=0)
    stash_code_hash: Mapped[str | None] = mapped_column(String(128))


class PurseEntry(Base, TimestampMixin):
    """Строка расчётной книжки."""

    __tablename__ = "purse_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    inspector_id: Mapped[int] = mapped_column(ForeignKey("inspectors.id"), index=True)
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("shifts.id"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    memo: Mapped[str] = mapped_column(String(256))


class Upgrade(Base, TimestampMixin):
    """Покупка из лавки интенданта."""

    __tablename__ = "upgrades"

    inspector_id: Mapped[int] = mapped_column(ForeignKey("inspectors.id"), primary_key=True)
    code: Mapped[str] = mapped_column(String(32), primary_key=True)


class StashItem(Base, TimestampMixin):
    """Бумага в тайнике под половицей. Видна только хозяину и только по шифру."""

    __tablename__ = "stash_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    inspector_id: Mapped[int] = mapped_column(ForeignKey("inspectors.id"), index=True)
    label: Mapped[str] = mapped_column(String(64))
    content: Mapped[str] = mapped_column(Text)
