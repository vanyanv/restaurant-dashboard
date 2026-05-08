"""Postgres connection + light helpers for the nightly ML pipeline.

Uses psycopg2 directly with the same DATABASE_URL the Next.js app uses,
so we don't need to redeclare the schema in Python. The pipeline ONLY
reads source tables (OtterDailySummary, OtterMenuItem, etc.) and writes
to forecast tables (ForecastDailyRevenue, ForecastMenuItem, AnomalyEvent,
MlTrainingRun). No migrations, no DDL.
"""
from __future__ import annotations

import os
import secrets
from contextlib import contextmanager
from typing import Iterator

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

# When run locally, pick up DATABASE_URL from .env.local. CI exposes it
# directly via the GitHub Actions `env:` block.
load_dotenv(".env.local")
load_dotenv(".env")


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is required for the ML pipeline")
    return url


@contextmanager
def connect() -> Iterator[psycopg2.extensions.connection]:
    """Open a single connection, commit on success, rollback on error."""
    conn = psycopg2.connect(database_url())
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def cuid_like() -> str:
    """ID generator compatible with Prisma `@default(cuid())` columns.

    Prisma's cuid is a 25-char alphanumeric. We don't need cuid's
    sortability guarantees — any unique string fits the TEXT column —
    so we use secrets.token_urlsafe(18) which yields ~24 url-safe chars.
    """
    return "py_" + secrets.token_urlsafe(18)
