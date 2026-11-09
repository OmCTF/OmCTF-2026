"""Квартира караульного: жалованье, лавка интенданта, знаки отличия, тайник.

Всё считается на сервере: штамп караульного сверяется с решением журнала в том же
запросе, где создаётся запись о проходе, поэтому заплатить дважды за одну запись нельзя.
"""

import hashlib
from datetime import datetime, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..exceptions import BadRequest, Conflict, Forbidden, NotFound, RateLimited
from ..models import Purse, PurseEntry, Shift, StashItem, Upgrade, Zone, ZoneStatus
from ..utils.security import generate_id, hash_password, verify_password
from .audit import record
from .rate_limits import rate_limit_check, rate_limit_clear
from .shifts import get_active_shift

STARTING_PURSE = 20

RATES = {
    "stamp_ok": 5,
    "stamp_miss": 5,
    "stamp_miss_tulup": 2,
    "samovar": 2,
    "streak": 5,
    "streak_every": 5,
    "wanted": 10,
    "bounty": 3,
    "bribe_min": 4,
    "bribe_max": 12,
    "bribe_seized": 15,
    "audit_from": 3,
    "audit": 10,
    "wage": 10,
    "wage_min_stamps": 5,
    "rent": 10,
    "wood": 5,
    "wood_stove": 3,
    "bread": 5,
}

# код: (название, цена, что даёт)
CATALOG: dict[str, tuple[str, int, str]] = {
    "rulebook": ("Свод правил в переплёте", 15,
                 "Требования места назначения видны прямо в досмотровом листе."),
    "wanted_copy": ("Розыскные листы под стеклом", 25,
                    "Имя посетителя само сверяется с розыском, едва он подойдёт к окну."),
    "magnifier": ("Увеличительное стекло", 30,
                  "Печать проверяется сама, как только бумага ляжет на стол."),
    "tulup": ("Овчинный тулуп", 30,
              "В тепле не ошибаются: замечание стоит 2 коп. вместо 5."),
    "samovar": ("Самовар в будке", 45,
                "Работа спорится: +2 коп. к каждому верному штампу."),
    "stove": ("Голландская печь", 45,
              "Дрова на квартиру обходятся в 3 коп. вместо 5."),
    "stash": ("Тайник под половицей", 40,
              "Место для бумаг, о которых никому знать не надо. Запирается на шифр."),
}

MEDALS = [
    ("vigilance", "За бдительность", "Задержать трёх разыскиваемых."),
    ("zeal", "За усердие", "Поставить десять верных штампов подряд."),
    ("incorruptible", "Неподкупный", "Двадцать верных штампов и ни одного подношения."),
    ("veteran", "Старожил", "Отстоять пять караулов."),
    ("thrifty", "Зажиточный", "Скопить рубль — сто копеек."),
]

STASH_LIMIT = 12
STASH_ATTEMPTS = 6
STASH_WINDOW = 300


# ---------- кошелёк ----------

async def get_purse(db: AsyncSession, inspector_id: int, lock: bool = False) -> Purse:
    q = select(Purse).where(Purse.inspector_id == inspector_id)
    if lock:
        q = q.with_for_update()
    purse = await db.scalar(q)
    if purse is None:
        created = await db.scalar(
            pg_insert(Purse)
            .values(
                inspector_id=inspector_id, balance=STARTING_PURSE, streak=0, best_streak=0,
                stamps_ok=0, stamps_miss=0, suspicion=0,
            )
            .on_conflict_do_nothing()
            .returning(Purse.inspector_id),
        )
        if created is not None:
            db.add(PurseEntry(
                inspector_id=inspector_id, amount=STARTING_PURSE,
                kind="start", memo="Подъёмные новобранцу",
            ))
        purse = await db.scalar(q)
    return purse


async def owned_upgrades(db: AsyncSession, inspector_id: int) -> set[str]:
    rows = await db.scalars(select(Upgrade.code).where(Upgrade.inspector_id == inspector_id))
    return set(rows.all())


async def bounty(db: AsyncSession) -> dict | None:
    """Приказ дня: одно место назначения, за верные штампы в которое доплачивают."""
    zones = (await db.scalars(
        select(Zone)
        .where(Zone.status != ZoneStatus.LOCKDOWN, Zone.min_level <= 1)
        .order_by(Zone.zone),
    )).all()
    if not zones:
        return None
    day = datetime.now(timezone.utc).date().isoformat()
    z = zones[int(hashlib.sha256(day.encode()).hexdigest(), 16) % len(zones)]
    return {"zone": z.zone, "zone_name": z.name, "bonus": RATES["bounty"]}


def _entry(purse: Purse, shift_id: int | None, amount: int, kind: str, memo: str) -> PurseEntry:
    purse.balance += amount
    return PurseEntry(
        inspector_id=purse.inspector_id, shift_id=shift_id,
        amount=amount, kind=kind, memo=memo[:256],
    )


def _entry_out(e: PurseEntry) -> dict:
    return {"amount": e.amount, "kind": e.kind, "memo": e.memo}


async def settle_stamp(
    db: AsyncSession, inspector_id: int, result: dict, stamp: str, bribe: bool,
) -> dict:
    """Сверяет штамп караульного с решением журнала и пишет расчёт."""
    purse = await get_purse(db, inspector_id, lock=True)
    owned = await owned_upgrades(db, inspector_id)
    shift = await get_active_shift(db, inspector_id)
    shift_id = shift.id if shift else None
    crossing_id = result["crossing_id"]
    traveler = result["traveler"]
    entries: list[PurseEntry] = []

    def add(amount: int, kind: str, memo: str):
        entries.append(_entry(purse, shift_id, amount, kind, memo))

    agree = (stamp == "admit") == result["granted"]
    if agree:
        purse.stamps_ok += 1
        purse.streak += 1
        purse.best_streak = max(purse.best_streak, purse.streak)
        add(RATES["stamp_ok"], "stamp_ok", f"Верный штамп · {crossing_id}")
        if "samovar" in owned:
            add(RATES["samovar"], "samovar", "Чай из самовара — работа спорится")
        if purse.streak % RATES["streak_every"] == 0:
            add(RATES["streak"], "streak", f"Премия за усердие: {purse.streak} верных подряд")
        if result["watchlist_hit"]:
            add(RATES["wanted"], "wanted", f"Награда за поимку: {traveler}")
        today = await bounty(db)
        if today and today["zone"] == result["zone"]:
            add(today["bonus"], "bounty", f"Приказ дня: {result['zone_name']}")
    else:
        purse.stamps_miss += 1
        purse.streak = 0
        fine = RATES["stamp_miss_tulup"] if "tulup" in owned else RATES["stamp_miss"]
        add(-fine, "stamp_miss", f"Замечание · {crossing_id}")

    if bribe:
        if result["watchlist_hit"]:
            add(-RATES["bribe_seized"], "bribe_seized", f"Подношение от разыскиваемого изъято: {traveler}")
        else:
            spread = RATES["bribe_max"] - RATES["bribe_min"] + 1
            amount = RATES["bribe_min"] + int(hashlib.sha256(crossing_id.encode()).hexdigest(), 16) % spread
            purse.suspicion += 1
            add(amount, "bribe", f"Подношение от {traveler}")

    db.add_all(entries)
    await db.commit()
    return {
        "delta": sum(e.amount for e in entries),
        "balance": purse.balance,
        "streak": purse.streak,
        "suspicion": purse.suspicion,
        "agree": agree,
        "entries": [_entry_out(e) for e in entries],
    }


async def settle_shift(db: AsyncSession, inspector_id: int, shift: Shift) -> list[dict]:
    """Расчёт при сдаче караула: казённое жалованье, квартира, ревизия. Коммитит вызывающий."""
    purse = await get_purse(db, inspector_id, lock=True)
    owned = await owned_upgrades(db, inspector_id)
    stamped = await db.scalar(
        select(func.count()).where(
            PurseEntry.shift_id == shift.id,
            PurseEntry.kind.in_(["stamp_ok", "stamp_miss"]),
        ),
    ) or 0
    entries: list[PurseEntry] = []

    def add(amount: int, kind: str, memo: str):
        entries.append(_entry(purse, shift.id, amount, kind, memo))

    if stamped >= RATES["wage_min_stamps"]:
        add(RATES["wage"], "wage", "Казённое жалованье за караул")
    add(-RATES["rent"], "rent", "Квартирные")
    add(-(RATES["wood_stove"] if "stove" in owned else RATES["wood"]), "wood", "Дрова")
    add(-RATES["bread"], "bread", "Хлеб и щи")
    if purse.suspicion >= RATES["audit_from"]:
        add(
            -RATES["audit"] * (purse.suspicion - RATES["audit_from"] + 1), "audit",
            f"Ревизия: {purse.suspicion} подношений за караул",
        )
    purse.suspicion = 0
    db.add_all(entries)
    return [_entry_out(e) for e in entries]


# ---------- квартира ----------

async def summary(db: AsyncSession, inspector_id: int) -> dict:
    purse = await get_purse(db, inspector_id)
    owned = await owned_upgrades(db, inspector_id)
    kinds = dict((await db.execute(
        select(PurseEntry.kind, func.count())
        .where(PurseEntry.inspector_id == inspector_id)
        .group_by(PurseEntry.kind),
    )).all())
    completed = await db.scalar(
        select(func.count()).where(Shift.inspector_id == inspector_id, Shift.ended_at.is_not(None)),
    ) or 0
    stash_items = await db.scalar(
        select(func.count()).where(StashItem.inspector_id == inspector_id),
    ) or 0
    earned = {
        "vigilance": kinds.get("wanted", 0) >= 3,
        "zeal": purse.best_streak >= 10,
        "incorruptible": purse.stamps_ok >= 20 and not kinds.get("bribe") and not kinds.get("bribe_seized"),
        "veteran": completed >= 5,
        "thrifty": purse.balance >= 100,
    }
    data = {
        "balance": purse.balance,
        "streak": purse.streak,
        "best_streak": purse.best_streak,
        "stamps_ok": purse.stamps_ok,
        "stamps_miss": purse.stamps_miss,
        "suspicion": purse.suspicion,
        "rates": RATES,
        "bounty": await bounty(db),
        "catalog": [
            {"code": code, "name": name, "price": price, "description": desc, "owned": code in owned}
            for code, (name, price, desc) in CATALOG.items()
        ],
        "medals": [
            {"code": code, "name": name, "description": desc, "earned": earned[code]}
            for code, name, desc in MEDALS
        ],
        "stash": {
            "owned": "stash" in owned,
            "locked": purse.stash_code_hash is not None,
            "items": stash_items,
        },
    }
    await db.commit()
    return data


async def ledger(
    db: AsyncSession, inspector_id: int, shift_id: int | None = None,
    offset: int = 0, limit: int = 50,
) -> tuple[list[PurseEntry], int]:
    base = select(PurseEntry).where(PurseEntry.inspector_id == inspector_id)
    if shift_id is not None:
        base = base.where(PurseEntry.shift_id == shift_id)
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    q = base.order_by(PurseEntry.id.desc()).offset(offset).limit(limit)
    return list((await db.scalars(q)).all()), total


async def buy(db: AsyncSession, inspector_id: int, callsign: str, code: str) -> dict:
    item = CATALOG.get(code)
    if item is None:
        raise NotFound("Такого товара в лавке нет.")
    name, price, _ = item
    purse = await get_purse(db, inspector_id, lock=True)
    if code in await owned_upgrades(db, inspector_id):
        raise Conflict("Это уже куплено.")
    if purse.balance < price:
        raise BadRequest(f"Не хватает {price - purse.balance} коп.")

    db.add(_entry(purse, None, -price, "purchase", f"Лавка интенданта: {name}"))
    db.add(Upgrade(inspector_id=inspector_id, code=code))
    await record(db, inspector_id, callsign, "quarters.buy", "upgrade", code, {"price": price})
    await db.commit()
    return await summary(db, inspector_id)


# ---------- тайник ----------

async def _stash_purse(db: AsyncSession, inspector_id: int, lock: bool = False) -> Purse:
    if "stash" not in await owned_upgrades(db, inspector_id):
        raise Forbidden("Тайника нет — его продают в лавке интенданта.")
    return await get_purse(db, inspector_id, lock=lock)


async def _check_code(db: AsyncSession, purse: Purse, code: str):
    if purse.stash_code_hash is None:
        raise BadRequest("Шифр ещё не задан.")
    key = f"stash:fail:{purse.inspector_id}"
    if not await rate_limit_check(db, key, STASH_ATTEMPTS, STASH_WINDOW):
        raise RateLimited(STASH_WINDOW)
    if not verify_password(code, purse.stash_code_hash):
        raise Forbidden("Шифр не подходит.")
    await rate_limit_clear(db, key)


async def set_stash_code(
    db: AsyncSession, inspector_id: int, callsign: str, code: str, old_code: str | None,
):
    purse = await _stash_purse(db, inspector_id, lock=True)
    if purse.stash_code_hash is not None:
        if not old_code:
            raise BadRequest("Назовите прежний шифр.")
        await _check_code(db, purse, old_code)
    purse.stash_code_hash = hash_password(code)
    await record(db, inspector_id, callsign, "stash.code", "stash", None, {})
    await db.commit()


async def open_stash(db: AsyncSession, inspector_id: int, code: str) -> list[StashItem]:
    await _check_code(db, await _stash_purse(db, inspector_id), code)
    q = (
        select(StashItem)
        .where(StashItem.inspector_id == inspector_id)
        .order_by(StashItem.created_at.desc())
    )
    return list((await db.scalars(q)).all())


async def put_into_stash(
    db: AsyncSession, inspector_id: int, code: str, label: str, content: str,
) -> StashItem:
    await _check_code(await _stash_purse(db, inspector_id), code)
    count = await db.scalar(
        select(func.count()).where(StashItem.inspector_id == inspector_id),
    ) or 0
    if count >= STASH_LIMIT:
        raise BadRequest("Под половицей больше ничего не помещается.")
    item = StashItem(
        id=generate_id("TNK"), inspector_id=inspector_id, label=label, content=content,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def take_from_stash(db: AsyncSession, inspector_id: int, code: str, item_id: str):
    await _check_code(await _stash_purse(db, inspector_id), code)
    res = await db.execute(
        delete(StashItem).where(
            StashItem.id == item_id, StashItem.inspector_id == inspector_id,
        ),
    )
    if res.rowcount == 0:
        raise NotFound("Такой бумаги в тайнике нет.")
    await db.commit()
