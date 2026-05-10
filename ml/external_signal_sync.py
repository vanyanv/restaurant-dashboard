"""Backfill and refresh external weather/event signals.

Usage:
  python -m ml.external_signal_sync --provider all --future-days 14
  python -m ml.external_signal_sync --provider weather --store-id store_123

Reads active stores with latitude/longitude, chooses each store's earliest
Otter history date as the backfill start, and writes compact rows used by ML
and dashboards. No dashboard request path calls these providers.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

import psycopg2.extras

from ml.db import connect, cuid_like
from ml.features.external_signals import (
    earliest_otter_history_date,
    normalize_open_meteo_hourly,
    normalize_predicthq_events,
    normalize_predicthq_features,
)

DEFAULT_RADIUS_MILES = 3.0
TIMEZONE = "America/Los_Angeles"


def main() -> int:
    args = parse_args()
    today = dt.date.today()
    end_date = today + dt.timedelta(days=args.future_days)
    stores = list_stores(args.store_id)
    missing = [s for s in stores if s["latitude"] is None or s["longitude"] is None]
    for store in missing:
        print({"store_id": store["id"], "provider": args.provider, "skipped": "missing_coordinates"})
    stores = [s for s in stores if s["latitude"] is not None and s["longitude"] is not None]

    failures = 0
    for store in stores:
        start_date = args.start_date or earliest_otter_history_date(store["id"])
        if start_date is None:
            print({"store_id": store["id"], "skipped": "no_otter_history"})
            continue
        if args.end_date:
            end = args.end_date
        else:
            end = end_date
        if args.provider in ("weather", "all"):
            failures += 0 if sync_weather(store, start_date, end, args.triggered_by) else 1
        if args.provider in ("predicthq", "events", "all"):
            failures += 0 if sync_predicthq(store, start_date, end, args.triggered_by) else 1
    return 0 if failures == 0 else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", choices=["weather", "predicthq", "events", "all"], default="all")
    parser.add_argument("--store-id")
    parser.add_argument("--future-days", type=int, default=14)
    parser.add_argument("--start-date", type=dt.date.fromisoformat)
    parser.add_argument("--end-date", type=dt.date.fromisoformat)
    parser.add_argument("--triggered-by", default="manual")
    return parser.parse_args()


def list_stores(store_id: str | None = None) -> list[dict[str, Any]]:
    sql = """
        SELECT id, name, latitude, longitude, "eventSignalRadiusMiles",
               "eventSignalRadiusProvider", "eventSignalRadiusUpdatedAt"
        FROM "Store"
        WHERE "isActive" = true
    """
    params: tuple[Any, ...] = ()
    if store_id:
        sql += " AND id = %s"
        params = (store_id,)
    sql += ' ORDER BY "createdAt"'
    with connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(row) for row in cur.fetchall()]


def sync_weather(store: dict[str, Any], start_date: dt.date, end_date: dt.date, triggered_by: str) -> bool:
    run_id = open_run("open-meteo", store["id"], start_date, end_date, triggered_by)
    started = time.perf_counter()
    rows_written = 0
    try:
        payload = fetch_open_meteo(
            float(store["latitude"]),
            float(store["longitude"]),
            start_date,
            end_date,
        )
        df = normalize_open_meteo_hourly(payload)
        rows = [
            (
                cuid_like(),
                store["id"],
                row.date.date(),
                int(row.hour),
                none_if_nan(row.weather_temp_c),
                none_if_nan(row.weather_apparent_temp_c),
                none_if_nan(row.weather_precip_mm),
                none_if_nan(row.weather_precip_probability_pct),
                none_if_nan(row.weather_wind_speed_kph),
                none_if_nan(row.weather_relative_humidity_pct),
                int(row.weather_code) if row.weather_code == row.weather_code else None,
            )
            for row in df.itertuples(index=False)
        ]
        rows_written = upsert_weather(rows)
        close_run(run_id, "SUCCESS", rows_written, started)
        print({"provider": "open-meteo", "store_id": store["id"], "rows": rows_written})
        return True
    except Exception as exc:  # pylint: disable=broad-except
        close_run(run_id, "FAILURE", rows_written, started, str(exc))
        print({"provider": "open-meteo", "store_id": store["id"], "error": str(exc)})
        return False


def sync_predicthq(store: dict[str, Any], start_date: dt.date, end_date: dt.date, triggered_by: str) -> bool:
    token = os.environ.get("PREDICTHQ_API_TOKEN") or os.environ.get("PREDICTHQ_TOKEN")
    if not token:
        print({"provider": "predicthq", "store_id": store["id"], "skipped": "missing_token"})
        return True
    lat = float(store["latitude"])
    lon = float(store["longitude"])
    run_id = open_run("predicthq", store["id"], start_date, end_date, triggered_by)
    started = time.perf_counter()
    rows_written = 0
    try:
        radius = resolve_predicthq_radius(token, store, lat, lon)
        try:
            payload = fetch_predicthq_features(
                token,
                lat,
                lon,
                radius,
                start_date,
                end_date,
            )
        except RuntimeError as exc:
            clamped_start = predicthq_allowed_earliest_date(exc)
            if clamped_start is None or clamped_start >= end_date:
                raise
            start_date = max(start_date, clamped_start)
            payload = fetch_predicthq_features(
                token,
                lat,
                lon,
                radius,
                start_date,
                end_date,
            )
        event_payload = fetch_predicthq_events(
            token,
            lat,
            lon,
            radius,
            start_date,
            end_date,
        )
        df = normalize_predicthq_features(payload, radius_miles=radius)
        detail_df = normalize_predicthq_events(event_payload, store_lat=lat, store_lon=lon)
        detail_rows = event_detail_rows(store["id"], detail_df)
        detail_count = upsert_event_details(detail_rows)
        aggregates = event_detail_aggregates(detail_df)
        rows = [
            (
                cuid_like(),
                store["id"],
                row.date.date(),
                none_if_nan(row.event_radius_miles),
                none_if_nan(row.event_hospitality_impact),
                none_if_nan(row.event_hospitality_spend),
                none_if_nan(row.event_attendance),
                int(row.event_total_count),
                int(row.event_sports_count),
                int(row.event_concerts_count),
                int(row.event_festivals_count),
                int(row.event_performing_arts_count),
                int(row.event_community_count),
                int(row.event_conferences_count),
                int(row.event_expos_count),
                *_aggregate_tuple(aggregates.get(row.date.date())),
                psycopg2.extras.Json(payload),
            )
            for row in df.itertuples(index=False)
        ]
        feature_dates = {row[2] for row in rows}
        for event_date, aggregate in aggregates.items():
            if event_date in feature_dates:
                continue
            rows.append(
                (
                    cuid_like(),
                    store["id"],
                    event_date,
                    radius,
                    None,
                    None,
                    None,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    *_aggregate_tuple(aggregate),
                    psycopg2.extras.Json({"events": "raw_event_only"}),
                )
            )
        rows_written = upsert_events(rows)
        rows_written += detail_count
        close_run(run_id, "SUCCESS", rows_written, started)
        print({"provider": "predicthq", "store_id": store["id"], "rows": rows_written})
        return True
    except Exception as exc:  # pylint: disable=broad-except
        close_run(run_id, "FAILURE", rows_written, started, str(exc))
        print({"provider": "predicthq", "store_id": store["id"], "error": str(exc)})
        return False


def fetch_open_meteo(lat: float, lon: float, start_date: dt.date, end_date: dt.date) -> dict[str, Any]:
    today = dt.date.today()
    payloads: list[dict[str, Any]] = []
    if start_date < today:
        archive_end = min(end_date, today - dt.timedelta(days=1))
        if archive_end >= start_date:
            payloads.append(
                fetch_open_meteo_range(
                    "https://archive-api.open-meteo.com/v1/archive",
                    lat,
                    lon,
                    start_date,
                    archive_end,
                )
            )
    if end_date >= today:
        forecast_start = max(start_date, today)
        payloads.append(
            fetch_open_meteo_range(
                "https://api.open-meteo.com/v1/forecast",
                lat,
                lon,
                forecast_start,
                end_date,
            )
        )
    return merge_open_meteo_payloads(payloads)


def fetch_open_meteo_range(
    endpoint: str,
    lat: float,
    lon: float,
    start_date: dt.date,
    end_date: dt.date,
) -> dict[str, Any]:
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "timezone": TIMEZONE,
        "hourly": ",".join(
            [
                "temperature_2m",
                "apparent_temperature",
                "precipitation",
                "precipitation_probability",
                "wind_speed_10m",
                "relative_humidity_2m",
                "weather_code",
            ]
        ),
    }
    return http_json(f"{endpoint}?{urllib.parse.urlencode(params)}")


def merge_open_meteo_payloads(payloads: list[dict[str, Any]]) -> dict[str, Any]:
    merged: dict[str, Any] = {"hourly": {}}
    for payload in payloads:
        hourly = payload.get("hourly") or {}
        for key, values in hourly.items():
            bucket = merged["hourly"].setdefault(key, [])
            bucket.extend(values if isinstance(values, list) else [values])
    return merged


def fetch_predicthq_features(
    token: str,
    lat: float,
    lon: float,
    radius_miles: float,
    start_date: dt.date,
    end_date: dt.date,
) -> dict[str, Any]:
    attendance_feature = {"stats": ["count", "sum"]}
    hospitality_feature = {"stats": ["count", "sum", "max"]}
    body = {
        "location": {
            "geo": {
                "lat": lat,
                "lon": lon,
                "radius": f"{radius_miles:.2f}mi",
            }
        },
        "active": {"gte": start_date.isoformat(), "lte": end_date.isoformat()},
        "interval": "day",
        "phq_attendance_sports": attendance_feature,
        "phq_attendance_concerts": attendance_feature,
        "phq_attendance_festivals": attendance_feature,
        "phq_attendance_performing_arts": attendance_feature,
        "phq_attendance_community": attendance_feature,
        "phq_attendance_conferences": attendance_feature,
        "phq_attendance_expos": attendance_feature,
        "phq_attendance_sports_hospitality": hospitality_feature,
        "phq_attendance_concerts_hospitality": hospitality_feature,
        "phq_attendance_festivals_hospitality": hospitality_feature,
        "phq_attendance_performing_arts_hospitality": hospitality_feature,
        "phq_attendance_community_hospitality": hospitality_feature,
        "phq_attendance_conferences_hospitality": hospitality_feature,
        "phq_attendance_expos_hospitality": hospitality_feature,
    }
    return http_json(
        "https://api.predicthq.com/v1/features/",
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body=json.dumps(body).encode("utf-8"),
    )


def fetch_predicthq_suggested_radius(token: str, lat: float, lon: float) -> dict[str, Any]:
    params = {
        "location.origin": f"{lat:.6f},{lon:.6f}",
        "industry": "restaurants",
        "radius_unit": "mi",
    }
    return http_json(
        f"https://api.predicthq.com/v1/suggested-radius/?{urllib.parse.urlencode(params)}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )


def fetch_predicthq_events(
    token: str,
    lat: float,
    lon: float,
    radius_miles: float,
    start_date: dt.date,
    end_date: dt.date,
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    params = {
        "active.gte": start_date.isoformat(),
        "active.lte": end_date.isoformat(),
        "active.tz": TIMEZONE,
        "category": "sports,concerts,festivals,performing-arts,community,conferences,expos",
        "within": f"{max(radius_miles, 0.1):.2f}mi@{lat:.6f},{lon:.6f}",
        "sort": "-local_rank,-rank",
        "limit": 500,
    }
    url = f"https://api.predicthq.com/v1/events/?{urllib.parse.urlencode(params)}"
    combined: dict[str, Any] = {"count": 0, "overflow": False, "results": []}
    pages = 0
    while url and pages < 10:
        payload = http_json(url, headers=headers)
        combined["count"] = max(int(combined.get("count") or 0), int(payload.get("count") or 0))
        combined["overflow"] = bool(combined.get("overflow")) or bool(payload.get("overflow"))
        combined["results"].extend(payload.get("results") or [])
        url = payload.get("next")
        pages += 1
    return combined


def resolve_predicthq_radius(token: str, store: dict[str, Any], lat: float, lon: float) -> float:
    existing = store.get("eventSignalRadiusMiles")
    updated_at = store.get("eventSignalRadiusUpdatedAt")
    if existing is not None and updated_at is not None:
        age_days = (dt.datetime.now(dt.timezone.utc) - _aware_dt(updated_at)).days
        if age_days < 30:
            return float(existing)
    try:
        payload = fetch_predicthq_suggested_radius(token, lat, lon)
        radius = float(payload.get("radius") or 0)
        if radius <= 0:
            raise ValueError(f"invalid radius: {payload!r}")
        update_store_radius(store["id"], radius, "predicthq-suggested-radius")
        return radius
    except Exception as exc:  # pylint: disable=broad-except
        radius = float(existing or DEFAULT_RADIUS_MILES)
        if existing is None:
            update_store_radius(store["id"], radius, "default-fallback")
        print({"provider": "predicthq", "store_id": store["id"], "radius_fallback": radius, "error": str(exc)})
        return radius


def update_store_radius(store_id: str, radius_miles: float, provider: str) -> None:
    sql = """
        UPDATE "Store"
        SET "eventSignalRadiusMiles" = %s,
            "eventSignalRadiusProvider" = %s,
            "eventSignalRadiusUpdatedAt" = CURRENT_TIMESTAMP
        WHERE id = %s
    """
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (radius_miles, provider, store_id))


def predicthq_allowed_earliest_date(exc: Exception) -> dt.date | None:
    match = re.search(r"Allowed earliest date:\s*(\d{4}-\d{2}-\d{2})", str(exc))
    if not match:
        return None
    return dt.date.fromisoformat(match.group(1))


def http_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
) -> dict[str, Any]:
    req = urllib.request.Request(url, method=method, headers=headers or {}, data=body)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:  # nosec B310 - controlled provider URLs
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail[:1000]}") from exc


def upsert_weather(rows: list[tuple[Any, ...]]) -> int:
    if not rows:
        return 0
    sql = """
        INSERT INTO "StoreWeatherSignal"
          (id, "storeId", date, hour, "temperatureC", "apparentTemperatureC",
           "precipitationMm", "precipitationProbabilityPct", "windSpeedKph",
           "relativeHumidityPct", "weatherCode")
        VALUES %s
        ON CONFLICT ("storeId", date, hour) DO UPDATE SET
          "temperatureC" = EXCLUDED."temperatureC",
          "apparentTemperatureC" = EXCLUDED."apparentTemperatureC",
          "precipitationMm" = EXCLUDED."precipitationMm",
          "precipitationProbabilityPct" = EXCLUDED."precipitationProbabilityPct",
          "windSpeedKph" = EXCLUDED."windSpeedKph",
          "relativeHumidityPct" = EXCLUDED."relativeHumidityPct",
          "weatherCode" = EXCLUDED."weatherCode",
          "syncedAt" = CURRENT_TIMESTAMP
    """
    with connect() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows, page_size=500)
    return len(rows)


def upsert_events(rows: list[tuple[Any, ...]]) -> int:
    if not rows:
        return 0
    sql = """
        INSERT INTO "StoreEventSignal"
          (id, "storeId", date, "radiusMiles", "hospitalityImpact",
           "hospitalitySpend", attendance, "eventCount", "sportsCount",
           "concertsCount", "festivalsCount", "performingArtsCount",
           "communityCount", "conferencesCount", "exposCount",
           "topEventTitle", "topEventCategory", "topEventStartsAt",
           "topEventRank", "topEventLocalRank", "topEventAttendance",
           "topEventDistanceMiles", "majorEventCount", "highLocalRankEventCount",
           raw)
        VALUES %s
        ON CONFLICT ("storeId", date) DO UPDATE SET
          "radiusMiles" = EXCLUDED."radiusMiles",
          "hospitalityImpact" = EXCLUDED."hospitalityImpact",
          "hospitalitySpend" = EXCLUDED."hospitalitySpend",
          attendance = EXCLUDED.attendance,
          "eventCount" = EXCLUDED."eventCount",
          "sportsCount" = EXCLUDED."sportsCount",
          "concertsCount" = EXCLUDED."concertsCount",
          "festivalsCount" = EXCLUDED."festivalsCount",
          "performingArtsCount" = EXCLUDED."performingArtsCount",
          "communityCount" = EXCLUDED."communityCount",
          "conferencesCount" = EXCLUDED."conferencesCount",
          "exposCount" = EXCLUDED."exposCount",
          "topEventTitle" = EXCLUDED."topEventTitle",
          "topEventCategory" = EXCLUDED."topEventCategory",
          "topEventStartsAt" = EXCLUDED."topEventStartsAt",
          "topEventRank" = EXCLUDED."topEventRank",
          "topEventLocalRank" = EXCLUDED."topEventLocalRank",
          "topEventAttendance" = EXCLUDED."topEventAttendance",
          "topEventDistanceMiles" = EXCLUDED."topEventDistanceMiles",
          "majorEventCount" = EXCLUDED."majorEventCount",
          "highLocalRankEventCount" = EXCLUDED."highLocalRankEventCount",
          raw = EXCLUDED.raw,
          "syncedAt" = CURRENT_TIMESTAMP
    """
    with connect() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows, page_size=500)
    return len(rows)


def upsert_event_details(rows: list[tuple[Any, ...]]) -> int:
    if not rows:
        return 0
    sql = """
        INSERT INTO "StoreEventDetailSignal"
          (id, "storeId", "providerEventId", date, "startsAt", "endsAt",
           title, category, labels, rank, "localRank", attendance,
           "distanceMiles", "venueName", "venueId", raw)
        VALUES %s
        ON CONFLICT ("storeId", "providerEventId") DO UPDATE SET
          date = EXCLUDED.date,
          "startsAt" = EXCLUDED."startsAt",
          "endsAt" = EXCLUDED."endsAt",
          title = EXCLUDED.title,
          category = EXCLUDED.category,
          labels = EXCLUDED.labels,
          rank = EXCLUDED.rank,
          "localRank" = EXCLUDED."localRank",
          attendance = EXCLUDED.attendance,
          "distanceMiles" = EXCLUDED."distanceMiles",
          "venueName" = EXCLUDED."venueName",
          "venueId" = EXCLUDED."venueId",
          raw = EXCLUDED.raw,
          "syncedAt" = CURRENT_TIMESTAMP
    """
    with connect() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows, page_size=500)
    return len(rows)


def event_detail_rows(store_id: str, df: Any) -> list[tuple[Any, ...]]:
    if df.empty:
        return []
    rows: list[tuple[Any, ...]] = []
    for row in df.itertuples(index=False):
        labels = getattr(row, "labels", None)
        raw = getattr(row, "raw", None)
        rows.append(
            (
                cuid_like(),
                store_id,
                row.provider_event_id,
                row.date.date(),
                _py_datetime(getattr(row, "starts_at", None)),
                _py_datetime(getattr(row, "ends_at", None)),
                getattr(row, "title", None),
                getattr(row, "category", None),
                psycopg2.extras.Json(labels) if labels else None,
                none_if_nan(getattr(row, "rank", None)),
                none_if_nan(getattr(row, "local_rank", None)),
                none_if_nan(getattr(row, "attendance", None)),
                none_if_nan(getattr(row, "distance_miles", None)),
                getattr(row, "venue_name", None),
                getattr(row, "venue_id", None),
                psycopg2.extras.Json(raw) if raw else None,
            )
        )
    return rows


def event_detail_aggregates(df: Any) -> dict[dt.date, dict[str, Any]]:
    if df.empty:
        return {}
    aggregates: dict[dt.date, dict[str, Any]] = {}
    for date_value, group in df.groupby("date"):
        sorted_group = group.assign(
            _local_rank=group["local_rank"].fillna(0),
            _rank=group["rank"].fillna(0),
            _attendance=group["attendance"].fillna(0),
        ).sort_values(["_local_rank", "_rank", "_attendance"], ascending=False)
        top = sorted_group.iloc[0]
        major = group[
            (group["local_rank"].fillna(0) >= 81)
            | (group["rank"].fillna(0) >= 81)
            | (group["attendance"].fillna(0) >= 10000)
        ]
        high_local = group[group["local_rank"].fillna(0) >= 70]
        aggregates[pd_date(date_value)] = {
            "top_title": top.get("title"),
            "top_category": top.get("category"),
            "top_starts_at": _py_datetime(top.get("starts_at")),
            "top_rank": none_if_nan(top.get("rank")),
            "top_local_rank": none_if_nan(top.get("local_rank")),
            "top_attendance": none_if_nan(top.get("attendance")),
            "top_distance_miles": none_if_nan(top.get("distance_miles")),
            "major_event_count": int(len(major)),
            "high_local_rank_event_count": int(len(high_local)),
        }
    return aggregates


def _aggregate_tuple(aggregate: dict[str, Any] | None) -> tuple[Any, ...]:
    if not aggregate:
        return (None, None, None, None, None, None, None, 0, 0)
    return (
        aggregate.get("top_title"),
        aggregate.get("top_category"),
        aggregate.get("top_starts_at"),
        aggregate.get("top_rank"),
        aggregate.get("top_local_rank"),
        aggregate.get("top_attendance"),
        aggregate.get("top_distance_miles"),
        aggregate.get("major_event_count", 0),
        aggregate.get("high_local_rank_event_count", 0),
    )


def open_run(provider: str, store_id: str, start_date: dt.date, end_date: dt.date, triggered_by: str) -> str:
    run_id = cuid_like()
    sql = """
        INSERT INTO "ExternalSignalSyncRun"
          (id, provider, "storeId", "startDate", "endDate", status, "triggeredBy")
        VALUES (%s, %s, %s, %s, %s, 'RUNNING', %s)
    """
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (run_id, provider, store_id, start_date, end_date, triggered_by))
    return run_id


def close_run(
    run_id: str,
    status: str,
    rows_written: int,
    started: float,
    error: str | None = None,
) -> None:
    sql = """
        UPDATE "ExternalSignalSyncRun"
        SET status = %s,
            "rowsWritten" = %s,
            "durationMs" = %s,
            error = %s,
            "completedAt" = CURRENT_TIMESTAMP
        WHERE id = %s
    """
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (status, rows_written, round((time.perf_counter() - started) * 1000), error, run_id))


def _aware_dt(value: Any) -> dt.datetime:
    if isinstance(value, dt.datetime):
        out = value
    else:
        out = dt.datetime.fromisoformat(str(value))
    if out.tzinfo is None:
        return out.replace(tzinfo=dt.timezone.utc)
    return out.astimezone(dt.timezone.utc)


def _py_datetime(value: Any) -> dt.datetime | None:
    if value is None:
        return None
    if hasattr(value, "to_pydatetime"):
        value = value.to_pydatetime()
    if isinstance(value, dt.datetime):
        if value.tzinfo is not None:
            return value.astimezone(dt.timezone.utc).replace(tzinfo=None)
        return value
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(dt.timezone.utc).replace(tzinfo=None)
    except (TypeError, ValueError):
        return None


def pd_date(value: Any) -> dt.date:
    if hasattr(value, "date"):
        return value.date()
    return dt.date.fromisoformat(str(value)[:10])


def none_if_nan(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return None if number != number else number


if __name__ == "__main__":
    raise SystemExit(main())
