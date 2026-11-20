"""PredictHQ opt-in gate and weather NULL handling (2026-11-20)."""
from __future__ import annotations

import math

import pytest

from ml import external_signal_sync as sync
from ml.features.external_signals import normalize_open_meteo_hourly


@pytest.mark.parametrize(
    "token,flag,expected",
    [
        (None, None, False),
        ("tok", None, False),  # a leftover token alone must not spend money
        (None, "1", False),
        ("tok", "0", False),
        ("tok", "1", True),
    ],
)
def test_predicthq_needs_token_and_opt_in(monkeypatch, token, flag, expected):
    for name in ("PREDICTHQ_API_TOKEN", "PREDICTHQ_TOKEN", "EVENTS_PROVIDER_ENABLED"):
        monkeypatch.delenv(name, raising=False)
    if token:
        monkeypatch.setenv("PREDICTHQ_API_TOKEN", token)
    if flag:
        monkeypatch.setenv("EVENTS_PROVIDER_ENABLED", flag)
    assert sync.predicthq_enabled() is expected


def test_main_skips_predicthq_when_not_enabled(monkeypatch):
    monkeypatch.delenv("EVENTS_PROVIDER_ENABLED", raising=False)
    monkeypatch.setenv("PREDICTHQ_API_TOKEN", "tok")
    monkeypatch.setattr("sys.argv", ["x", "--provider", "all"])
    store = {"id": "s1", "latitude": 34.0, "longitude": -118.3}
    monkeypatch.setattr(sync, "list_stores", lambda _id=None: [store])
    monkeypatch.setattr(sync, "earliest_otter_history_date", lambda _id: sync.dt.date(2026, 1, 1))
    called = {"weather": 0, "predicthq": 0}
    monkeypatch.setattr(sync, "sync_weather", lambda *a: called.__setitem__("weather", 1) or True)
    monkeypatch.setattr(sync, "sync_predicthq", lambda *a: called.__setitem__("predicthq", 1) or False)
    assert sync.main() == 0
    assert called == {"weather": 1, "predicthq": 0}


def test_missing_weather_values_stay_missing():
    payload = {
        "hourly": {
            "time": ["2026-11-01T10:00", "2026-11-01T11:00"],
            "temperature_2m": [12.5, None],
            "precipitation": [None, 0.4],
            "weather_code": [3, None],
        }
    }
    df = normalize_open_meteo_hourly(payload)
    assert df.loc[0, "weather_temp_c"] == 12.5
    assert math.isnan(df.loc[1, "weather_temp_c"])
    assert math.isnan(df.loc[0, "weather_precip_mm"])
    assert df.loc[1, "weather_precip_mm"] == pytest.approx(0.4)
    # The sync's own conversion must therefore store NULL, not 0.
    assert sync.none_if_nan(df.loc[1, "weather_temp_c"]) is None
    assert sync.none_if_nan(df.loc[0, "weather_precip_mm"]) is None
