from pydantic import BaseModel


class CheckpointStatsOut(BaseModel):
    inspectors_registered: int
    active_shifts: int
    crossings_total: int
    crossings_granted: int
    crossings_denied: int
    denial_rate: float
    watchlist_hits: int
    watchlist_entries: int
    open_incidents: int


class ZoneStatsOut(BaseModel):
    zone: int
    name: str
    status: str
    capacity: int | None
    current_count: int
    crossings_total: int
    crossings_granted: int
    crossings_denied: int
