"""US holidays that matter to a restaurant, including the ones that move.

The previous implementation was a dict of seven fixed (month, day) pairs. It
carried a comment saying the moving-date holidays were included; none of them
were. Mother's Day — routinely the single highest-revenue day of a restaurant's
year — had no representation in the feature matrix.

Hand-rolled rather than taking a dependency: the whole US calendar is not
needed, the eight or so dates that move follow two rules (nth weekday of a
month, and Easter), and both are short and exactly testable.

Holidays are classified rather than merely flagged. A binary `is_holiday`
conflates Mother's Day with Christmas, which move demand hard in opposite
directions. Two pooled classes — days people go out, days the store is quiet or
shut — give each class several observations across eighteen months of history,
where a per-holiday categorical would give one or two.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Holiday:
    name: str
    #: People book tables. Demand up, often sharply.
    is_dining: bool
    #: Store closed, or everyone is eating at home. Demand down.
    is_closure: bool


def easter_sunday(year: int) -> dt.date:
    """Anonymous Gregorian algorithm (Meeus/Jones/Butcher)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    lam = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * lam) // 451
    month, day = divmod(h + lam - 7 * m + 114, 31)
    return dt.date(year, month, day + 1)


def nth_weekday(year: int, month: int, *, weekday: int, n: int) -> dt.date:
    """The nth `weekday` of a month. Monday is 0, Sunday is 6.

    `n=1` is the first, `n=-1` the last.
    """
    if n > 0:
        first = dt.date(year, month, 1)
        offset = (weekday - first.weekday()) % 7
        return first + dt.timedelta(days=offset + 7 * (n - 1))

    if month == 12:
        last = dt.date(year, 12, 31)
    else:
        last = dt.date(year, month + 1, 1) - dt.timedelta(days=1)
    offset = (last.weekday() - weekday) % 7
    return last - dt.timedelta(days=offset + 7 * (-n - 1))


#: Fixed calendar dates. (month, day) -> Holiday.
_FIXED: dict[tuple[int, int], Holiday] = {
    (1, 1):   Holiday("new_years", is_dining=False, is_closure=True),
    (2, 14):  Holiday("valentines", is_dining=True, is_closure=False),
    (7, 4):   Holiday("july_4th", is_dining=False, is_closure=True),
    (10, 31): Holiday("halloween", is_dining=False, is_closure=False),
    (11, 11): Holiday("veterans", is_dining=False, is_closure=False),
    (12, 24): Holiday("christmas_eve", is_dining=False, is_closure=True),
    (12, 25): Holiday("christmas", is_dining=False, is_closure=True),
    (12, 31): Holiday("new_years_eve", is_dining=True, is_closure=False),
}


@lru_cache(maxsize=64)
def _moving_holidays(year: int) -> dict[dt.date, Holiday]:
    """Holidays whose date is computed, keyed by the date they land on."""
    return {
        # Super Bowl Sunday — second Sunday of February since the 2022 season.
        nth_weekday(year, 2, weekday=6, n=2):
            Holiday("super_bowl", is_dining=False, is_closure=False),
        easter_sunday(year):
            Holiday("easter", is_dining=True, is_closure=False),
        nth_weekday(year, 5, weekday=6, n=2):
            Holiday("mothers_day", is_dining=True, is_closure=False),
        nth_weekday(year, 5, weekday=0, n=-1):
            Holiday("memorial_day", is_dining=False, is_closure=False),
        nth_weekday(year, 6, weekday=6, n=3):
            Holiday("fathers_day", is_dining=True, is_closure=False),
        nth_weekday(year, 9, weekday=0, n=1):
            Holiday("labor_day", is_dining=False, is_closure=False),
        nth_weekday(year, 11, weekday=3, n=4):
            Holiday("thanksgiving", is_dining=False, is_closure=True),
    }


def classify_holiday(d: dt.date) -> Holiday | None:
    """The holiday falling on `d`, or None.

    Moving dates win ties — Easter can land on a fixed date, and the moving
    entry is the more specific fact.
    """
    moving = _moving_holidays(d.year).get(d)
    if moving is not None:
        return moving
    return _FIXED.get((d.month, d.day))


def is_holiday(d: dt.date) -> bool:
    return classify_holiday(d) is not None
