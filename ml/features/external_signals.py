"""Weather and event signal normalization + feature loaders.

The sync jobs write compact StoreWeatherSignal / StoreEventSignal rows. These
helpers deliberately return zero-filled feature frames when signals are absent
or tables are not migrated yet so baseline training remains available.
"""
from __future__ import annotations

import datetime as dt
import math
from typing import Any, Iterable

import numpy as np
import pandas as pd

from ml.db import connect


WEATHER_HOURLY_COLUMNS = [
    "weather_temp_c",
    "weather_apparent_temp_c",
    "weather_precip_mm",
    "weather_precip_probability_pct",
    "weather_wind_speed_kph",
    "weather_relative_humidity_pct",
    "weather_code",
    "has_weather_signal",
]

WEATHER_DAILY_COLUMNS = [
    "weather_avg_temp_c",
    "weather_max_temp_c",
    "weather_min_temp_c",
    "weather_precip_mm_sum",
    "weather_precip_probability_pct_max",
    "weather_wind_speed_kph_max",
    "weather_humidity_pct_avg",
    "weather_rain_hours",
    "weather_storm_hours",
    "has_weather_signal",
]

EVENT_DAILY_COLUMNS = [
    "event_hospitality_impact",
    "event_hospitality_spend",
    "event_attendance",
    "event_total_count",
    "event_sports_count",
    "event_concerts_count",
    "event_festivals_count",
    "event_performing_arts_count",
    "event_community_count",
    "event_conferences_count",
    "event_expos_count",
    "event_radius_miles",
    "event_top_rank",
    "event_top_local_rank",
    "event_top_attendance",
    "event_top_distance_miles",
    "event_major_count",
    "event_high_local_rank_count",
    "has_event_signal",
]


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _num(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def normalize_open_meteo_hourly(payload: dict[str, Any]) -> pd.DataFrame:
    """Normalize Open-Meteo hourly JSON to one row per local date-hour."""
    hourly = payload.get("hourly") or {}
    times = _as_list(hourly.get("time"))
    rows: list[dict[str, Any]] = []
    for idx, raw_time in enumerate(times):
        ts = pd.to_datetime(raw_time)
        rows.append(
            {
                "date": ts.normalize(),
                "hour": int(ts.hour),
                "weather_temp_c": _num(_at(hourly, "temperature_2m", idx), np.nan),
                "weather_apparent_temp_c": _num(_at(hourly, "apparent_temperature", idx), np.nan),
                "weather_precip_mm": _num(_at(hourly, "precipitation", idx)),
                "weather_precip_probability_pct": _num(_at(hourly, "precipitation_probability", idx), np.nan),
                "weather_wind_speed_kph": _num(_at(hourly, "wind_speed_10m", idx), np.nan),
                "weather_relative_humidity_pct": _num(_at(hourly, "relative_humidity_2m", idx), np.nan),
                "weather_code": _num(_at(hourly, "weather_code", idx), np.nan),
                "has_weather_signal": 1.0,
            }
        )
    return fill_weather_hourly_defaults(pd.DataFrame(rows))


def normalize_predicthq_features(
    payload: dict[str, Any],
    *,
    radius_miles: float | None = None,
) -> pd.DataFrame:
    """Normalize PredictHQ Features-like JSON to one row per date.

    The API shape varies by requested feature set. This accepts either a
    top-level `results` / `features` array or a mapping keyed by date, then
    looks for the canonical names used by our sync and common PredictHQ
    aliases such as `phq_attendance` and `demand.spend`.
    """
    raw_rows: Iterable[Any]
    if isinstance(payload.get("results"), list):
        raw_rows = payload["results"]
    elif isinstance(payload.get("features"), list):
        raw_rows = payload["features"]
    elif isinstance(payload.get("data"), list):
        raw_rows = payload["data"]
    else:
        raw_rows = [
            {"date": key, **value}
            for key, value in payload.items()
            if isinstance(value, dict) and _looks_like_date(key)
        ]

    rows: list[dict[str, Any]] = []
    for item in raw_rows:
        if not isinstance(item, dict):
            continue
        date_value = item.get("date") or item.get("day") or item.get("active_date")
        if not date_value:
            continue
        features = item.get("features") if isinstance(item.get("features"), dict) else item
        categories = features.get("categories") if isinstance(features.get("categories"), dict) else features
        category_counts = {
            "sports": _feature_stat(features, "phq_attendance_sports", "count"),
            "concerts": _feature_stat(features, "phq_attendance_concerts", "count"),
            "festivals": _feature_stat(features, "phq_attendance_festivals", "count"),
            "performing_arts": _feature_stat(features, "phq_attendance_performing_arts", "count"),
            "community": _feature_stat(features, "phq_attendance_community", "count"),
            "conferences": _feature_stat(features, "phq_attendance_conferences", "count"),
            "expos": _feature_stat(features, "phq_attendance_expos", "count"),
        }
        attendance = sum(
            _feature_stat(features, feature, "sum")
            for feature in (
                "phq_attendance_sports",
                "phq_attendance_concerts",
                "phq_attendance_festivals",
                "phq_attendance_performing_arts",
                "phq_attendance_community",
                "phq_attendance_conferences",
                "phq_attendance_expos",
            )
        )
        hospitality_impact = sum(
            _feature_stat(features, feature, "sum")
            for feature in (
                "phq_attendance_sports_hospitality",
                "phq_attendance_concerts_hospitality",
                "phq_attendance_festivals_hospitality",
                "phq_attendance_performing_arts_hospitality",
                "phq_attendance_community_hospitality",
                "phq_attendance_conferences_hospitality",
                "phq_attendance_expos_hospitality",
            )
        )
        explicit_attendance = _first_num(features, "attendance", "phq_attendance")
        explicit_impact = _first_num(features, "hospitality_impact", "hospitalityImpact", "impact")
        rows.append(
            {
                "date": pd.to_datetime(date_value).normalize(),
                "event_hospitality_impact": explicit_impact or hospitality_impact,
                "event_hospitality_spend": _first_num(features, "hospitality_spend", "hospitalitySpend", "demand.spend", "spend"),
                "event_attendance": explicit_attendance or attendance,
                "event_total_count": int(_first_num(features, "event_count", "eventCount", "count") or sum(category_counts.values())),
                "event_sports_count": int(_first_num(categories, "sports", "sports_count", "sportsCount") or category_counts["sports"]),
                "event_concerts_count": int(_first_num(categories, "concerts", "concerts_count", "concertsCount") or category_counts["concerts"]),
                "event_festivals_count": int(_first_num(categories, "festivals", "festivals_count", "festivalsCount") or category_counts["festivals"]),
                "event_performing_arts_count": int(_first_num(categories, "performing_arts", "performingArts", "performing_arts_count") or category_counts["performing_arts"]),
                "event_community_count": int(_first_num(categories, "community", "community_count", "communityCount") or category_counts["community"]),
                "event_conferences_count": int(_first_num(categories, "conferences", "conferences_count", "conferencesCount") or category_counts["conferences"]),
                "event_expos_count": int(_first_num(categories, "expos", "expos_count", "exposCount") or category_counts["expos"]),
                "event_radius_miles": _num(features.get("radius_miles") or features.get("radiusMiles"), radius_miles or 0.0),
                "has_event_signal": 1.0,
            }
        )
    return fill_event_daily_defaults(pd.DataFrame(rows))


def normalize_predicthq_events(
    payload: dict[str, Any],
    *,
    store_lat: float | None = None,
    store_lon: float | None = None,
) -> pd.DataFrame:
    """Normalize PredictHQ Events API JSON to bounded event detail rows."""
    raw_rows = payload.get("results") if isinstance(payload.get("results"), list) else []
    rows: list[dict[str, Any]] = []
    for item in raw_rows:
        if not isinstance(item, dict):
            continue
        event_id = item.get("id")
        if not event_id:
            continue
        starts_at = _parse_ts(item.get("start") or item.get("predicted_start"))
        ends_at = _parse_ts(item.get("end") or item.get("predicted_end"))
        date_value = starts_at or _parse_ts(item.get("active", {}).get("start") if isinstance(item.get("active"), dict) else None)
        if date_value is None:
            continue
        venue = _first_mapping(_as_list(item.get("entities")), "venue")
        rows.append(
            {
                "provider_event_id": str(event_id),
                "date": pd.Timestamp(date_value).normalize(),
                "starts_at": date_value,
                "ends_at": ends_at,
                "title": item.get("title"),
                "category": item.get("category"),
                "labels": _as_list(item.get("labels")),
                "rank": _first_num(item, "rank"),
                "local_rank": _first_num(item, "local_rank"),
                "attendance": _first_num(item, "phq_attendance", "predicted_attendance", "attendance"),
                "distance_miles": _event_distance_miles(item, store_lat, store_lon),
                "venue_name": venue.get("name") if venue else None,
                "venue_id": venue.get("entity_id") if venue else None,
                "raw": item,
            }
        )
    return pd.DataFrame(rows)


def load_daily_external_signals(
    store_id: str,
    start_date: dt.date | None = None,
    end_date: dt.date | None = None,
) -> pd.DataFrame:
    weather = _load_daily_weather(store_id, start_date, end_date)
    events = _load_daily_events(store_id, start_date, end_date)
    if weather.empty and events.empty:
        return pd.DataFrame(columns=["date", *WEATHER_DAILY_COLUMNS, *EVENT_DAILY_COLUMNS])
    if weather.empty:
        out = events
        out = fill_weather_daily_defaults(out)
    elif events.empty:
        out = weather
        out = fill_event_daily_defaults(out)
    else:
        out = weather.merge(events, on="date", how="outer")
    return fill_event_daily_defaults(fill_weather_daily_defaults(out)).sort_values("date").reset_index(drop=True)


def load_hourly_external_signals(
    store_id: str,
    start_date: dt.date | None = None,
    end_date: dt.date | None = None,
) -> pd.DataFrame:
    weather = _load_hourly_weather(store_id, start_date, end_date)
    events = _load_daily_events(store_id, start_date, end_date)
    if weather.empty and events.empty:
        return pd.DataFrame(columns=["date", "hour", *WEATHER_HOURLY_COLUMNS, *EVENT_DAILY_COLUMNS])
    if weather.empty:
        dates = events["date"].drop_duplicates()
        grid = pd.MultiIndex.from_product([dates, range(24)], names=["date", "hour"]).to_frame(index=False)
        out = grid.merge(events, on="date", how="left")
        out = fill_weather_hourly_defaults(out)
    else:
        out = weather
        if not events.empty:
            out = out.merge(events, on="date", how="left")
        out = fill_event_daily_defaults(out)
    return fill_event_daily_defaults(fill_weather_hourly_defaults(out)).sort_values(["date", "hour"]).reset_index(drop=True)


def external_signal_coverage(df: pd.DataFrame) -> float:
    if df.empty:
        return 0.0
    signal_cols = [c for c in ("has_weather_signal", "has_event_signal") if c in df]
    if not signal_cols:
        return 0.0
    has_any = df[signal_cols].fillna(0).max(axis=1)
    return float(has_any.mean())


def earliest_otter_history_date(store_id: str) -> dt.date | None:
    sql = """
        SELECT MIN(date)::date
        FROM (
          SELECT MIN(date) AS date FROM "OtterDailySummary" WHERE "storeId" = %s
          UNION ALL
          SELECT MIN(date) AS date FROM "OtterHourlySummary" WHERE "storeId" = %s
        ) x
    """
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (store_id, store_id))
            row = cur.fetchone()
            return row[0] if row and row[0] else None


def fill_weather_hourly_defaults(df: pd.DataFrame) -> pd.DataFrame:
    out = _date_col(df)
    if "hour" not in out:
        out["hour"] = 0
    for col in WEATHER_HOURLY_COLUMNS:
        if col not in out:
            out[col] = 0.0
        out[col] = out[col].fillna(0.0).astype(float)
    out["hour"] = out["hour"].fillna(0).astype(int)
    return out


def fill_weather_daily_defaults(df: pd.DataFrame) -> pd.DataFrame:
    out = _date_col(df)
    for col in WEATHER_DAILY_COLUMNS:
        if col not in out:
            out[col] = 0.0
        out[col] = out[col].fillna(0.0).astype(float)
    return out


def fill_event_daily_defaults(df: pd.DataFrame) -> pd.DataFrame:
    out = _date_col(df)
    for col in EVENT_DAILY_COLUMNS:
        if col not in out:
            out[col] = 0.0
        out[col] = out[col].fillna(0.0).astype(float)
    return out


def daily_signal_feature_columns() -> list[str]:
    return [*WEATHER_DAILY_COLUMNS, *EVENT_DAILY_COLUMNS]


def hourly_signal_feature_columns() -> list[str]:
    return [*WEATHER_HOURLY_COLUMNS, *EVENT_DAILY_COLUMNS]


def _load_hourly_weather(store_id: str, start_date: dt.date | None, end_date: dt.date | None) -> pd.DataFrame:
    where, params = _date_where(start_date, end_date)
    sql = f"""
        SELECT date::date AS date,
               hour,
               "temperatureC" AS weather_temp_c,
               "apparentTemperatureC" AS weather_apparent_temp_c,
               "precipitationMm" AS weather_precip_mm,
               "precipitationProbabilityPct" AS weather_precip_probability_pct,
               "windSpeedKph" AS weather_wind_speed_kph,
               "relativeHumidityPct" AS weather_relative_humidity_pct,
               "weatherCode" AS weather_code,
               1.0 AS has_weather_signal
        FROM "StoreWeatherSignal"
        WHERE "storeId" = %s {where}
        ORDER BY date, hour
    """
    try:
        with connect() as conn:
            df = pd.read_sql_query(sql, conn, params=(store_id, *params))
    except Exception:
        return pd.DataFrame()
    return fill_weather_hourly_defaults(df)


def _load_daily_weather(store_id: str, start_date: dt.date | None, end_date: dt.date | None) -> pd.DataFrame:
    hourly = _load_hourly_weather(store_id, start_date, end_date)
    if hourly.empty:
        return pd.DataFrame()
    grouped = hourly.groupby("date", as_index=False).agg(
        weather_avg_temp_c=("weather_temp_c", "mean"),
        weather_max_temp_c=("weather_temp_c", "max"),
        weather_min_temp_c=("weather_temp_c", "min"),
        weather_precip_mm_sum=("weather_precip_mm", "sum"),
        weather_precip_probability_pct_max=("weather_precip_probability_pct", "max"),
        weather_wind_speed_kph_max=("weather_wind_speed_kph", "max"),
        weather_humidity_pct_avg=("weather_relative_humidity_pct", "mean"),
        weather_rain_hours=("weather_precip_mm", lambda s: float((s > 0.2).sum())),
        weather_storm_hours=("weather_code", lambda s: float(s.isin([95, 96, 99]).sum())),
        has_weather_signal=("has_weather_signal", "max"),
    )
    return fill_weather_daily_defaults(grouped)


def _load_daily_events(store_id: str, start_date: dt.date | None, end_date: dt.date | None) -> pd.DataFrame:
    where, params = _date_where(start_date, end_date)
    sql = f"""
        SELECT date::date AS date,
               "hospitalityImpact" AS event_hospitality_impact,
               "hospitalitySpend" AS event_hospitality_spend,
               attendance AS event_attendance,
               "eventCount" AS event_total_count,
               "sportsCount" AS event_sports_count,
               "concertsCount" AS event_concerts_count,
               "festivalsCount" AS event_festivals_count,
               "performingArtsCount" AS event_performing_arts_count,
               "communityCount" AS event_community_count,
               "conferencesCount" AS event_conferences_count,
               "exposCount" AS event_expos_count,
               "radiusMiles" AS event_radius_miles,
               "topEventRank" AS event_top_rank,
               "topEventLocalRank" AS event_top_local_rank,
               "topEventAttendance" AS event_top_attendance,
               "topEventDistanceMiles" AS event_top_distance_miles,
               "majorEventCount" AS event_major_count,
               "highLocalRankEventCount" AS event_high_local_rank_count,
               1.0 AS has_event_signal
        FROM "StoreEventSignal"
        WHERE "storeId" = %s {where}
        ORDER BY date
    """
    try:
        with connect() as conn:
            df = pd.read_sql_query(sql, conn, params=(store_id, *params))
    except Exception:
        return pd.DataFrame()
    return fill_event_daily_defaults(df)


def _date_where(start_date: dt.date | None, end_date: dt.date | None) -> tuple[str, tuple[dt.date, ...]]:
    parts: list[str] = []
    params: list[dt.date] = []
    if start_date is not None:
        parts.append("AND date >= %s")
        params.append(start_date)
    if end_date is not None:
        parts.append("AND date <= %s")
        params.append(end_date)
    return " ".join(parts), tuple(params)


def _date_col(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    if "date" in out:
        out["date"] = pd.to_datetime(out["date"])
    return out


def _at(mapping: dict[str, Any], key: str, idx: int) -> Any:
    values = _as_list(mapping.get(key))
    return values[idx] if idx < len(values) else None


def _first_num(mapping: dict[str, Any], *keys: str) -> float:
    for key in keys:
        if key in mapping:
            return _num(mapping.get(key))
        if "." in key:
            cur: Any = mapping
            for part in key.split("."):
                if not isinstance(cur, dict) or part not in cur:
                    cur = None
                    break
                cur = cur[part]
            if cur is not None:
                return _num(cur)
    return 0.0


def _parse_ts(value: Any) -> pd.Timestamp | None:
    if not value:
        return None
    try:
        ts = pd.to_datetime(value, utc=True)
        if pd.isna(ts):
            return None
        return ts.to_pydatetime()
    except (TypeError, ValueError):
        return None


def _first_mapping(items: list[Any], expected_type: str) -> dict[str, Any] | None:
    for item in items:
        if isinstance(item, dict) and item.get("type") == expected_type:
            return item
    return None


def _event_distance_miles(item: dict[str, Any], store_lat: float | None, store_lon: float | None) -> float | None:
    geo = item.get("geo")
    if isinstance(geo, dict):
        distance = geo.get("distance")
        if isinstance(distance, (int, float)):
            return float(distance)
        geometry = geo.get("geometry")
        if isinstance(geometry, dict) and geometry.get("type") == "Point":
            coords = geometry.get("coordinates")
            if (
                store_lat is not None
                and store_lon is not None
                and isinstance(coords, list)
                and len(coords) >= 2
            ):
                return _haversine_miles(store_lat, store_lon, _num(coords[1]), _num(coords[0]))
    location = item.get("location")
    if isinstance(location, list) and store_lat is not None and store_lon is not None and len(location) >= 2:
        return _haversine_miles(store_lat, store_lon, _num(location[1]), _num(location[0]))
    return None


def _haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_miles = 3958.8
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * radius_miles * math.asin(min(1.0, math.sqrt(a)))


def _feature_stat(mapping: dict[str, Any], feature: str, stat: str) -> float:
    value = mapping.get(feature)
    if not isinstance(value, dict):
        return 0.0
    stats = value.get("stats")
    if not isinstance(stats, dict):
        return 0.0
    return _num(stats.get(stat))


def _looks_like_date(value: str) -> bool:
    try:
        dt.date.fromisoformat(value[:10])
        return True
    except ValueError:
        return False
