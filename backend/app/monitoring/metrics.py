"""Metrics collection and reporting.

Collects application metrics and stores them in the database for analysis.
"""

import asyncio
from collections import defaultdict
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from app.config import get_settings


class MetricsCollector:
    """Collects and reports application metrics."""

    def __init__(self):
        self._counters: dict[str, int] = defaultdict(int)
        self._gauges: dict[str, float] = {}
        self._histograms: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()
        self._last_flush = datetime.now(timezone.utc)

    def increment(self, name: str, value: int = 1, labels: dict[str, str] | None = None) -> None:
        """Increment a counter metric.

        Args:
            name: Metric name.
            value: Value to increment by.
            labels: Optional labels for the metric.
        """
        key = self._make_key(name, labels)
        with self._lock:
            self._counters[key] += value

    def set_gauge(self, name: str, value: float, labels: dict[str, str] | None = None) -> None:
        """Set a gauge metric value.

        Args:
            name: Metric name.
            value: Current value.
            labels: Optional labels for the metric.
        """
        key = self._make_key(name, labels)
        with self._lock:
            self._gauges[key] = value

    def observe(self, name: str, value: float, labels: dict[str, str] | None = None) -> None:
        """Record an observation for a histogram metric.

        Args:
            name: Metric name.
            value: Observed value.
            labels: Optional labels for the metric.
        """
        key = self._make_key(name, labels)
        with self._lock:
            self._histograms[key].append(value)

    def _make_key(self, name: str, labels: dict[str, str] | None) -> str:
        """Create a unique key for a metric with labels."""
        if not labels:
            return name
        label_str = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
        return f"{name}{{{label_str}}}"

    def _parse_key(self, key: str) -> tuple[str, dict[str, str]]:
        """Parse a metric key back into name and labels."""
        if "{" not in key:
            return key, {}

        name, label_part = key.split("{", 1)
        label_str = label_part.rstrip("}")
        labels = {}
        for part in label_str.split(","):
            if "=" in part:
                k, v = part.split("=", 1)
                labels[k] = v
        return name, labels

    async def flush(self) -> None:
        """Flush collected metrics to the database."""
        settings = get_settings()
        if not settings.metrics_enabled:
            return

        from app.core.database import get_supabase_admin_client

        with self._lock:
            if not self._counters and not self._gauges and not self._histograms:
                return

            records = []
            timestamp = datetime.now(timezone.utc).isoformat()

            # Process counters
            for key, value in self._counters.items():
                name, labels = self._parse_key(key)
                records.append({
                    "timestamp": timestamp,
                    "metric_name": name,
                    "metric_type": "counter",
                    "metric_value": float(value),
                    "labels": labels or None,
                })

            # Process gauges
            for key, value in self._gauges.items():
                name, labels = self._parse_key(key)
                records.append({
                    "timestamp": timestamp,
                    "metric_name": name,
                    "metric_type": "gauge",
                    "metric_value": value,
                    "labels": labels or None,
                })

            # Process histograms (calculate percentiles)
            for key, values in self._histograms.items():
                if not values:
                    continue
                name, labels = self._parse_key(key)
                sorted_values = sorted(values)
                n = len(sorted_values)

                # Calculate percentiles
                for percentile in [50, 90, 95, 99]:
                    idx = int(n * percentile / 100)
                    p_labels = {**labels, "percentile": str(percentile)}
                    records.append({
                        "timestamp": timestamp,
                        "metric_name": f"{name}_p{percentile}",
                        "metric_type": "histogram",
                        "metric_value": sorted_values[min(idx, n - 1)],
                        "labels": p_labels,
                    })

                # Also record count and sum
                records.append({
                    "timestamp": timestamp,
                    "metric_name": f"{name}_count",
                    "metric_type": "histogram",
                    "metric_value": float(n),
                    "labels": labels or None,
                })
                records.append({
                    "timestamp": timestamp,
                    "metric_name": f"{name}_sum",
                    "metric_type": "histogram",
                    "metric_value": sum(sorted_values),
                    "labels": labels or None,
                })

            # Clear after collecting
            self._counters.clear()
            self._histograms.clear()
            # Don't clear gauges - they represent current state

        # Note: Database metrics storage is disabled for now.
        # Metrics are kept in-memory and available via /health/detailed endpoint.
        # To enable DB storage, use an RPC function or create table in public schema.
        #
        # if records:
        #     try:
        #         client = get_supabase_admin_client()
        #         client.rpc("insert_app_metrics", {"records": records}).execute()
        #     except Exception as e:
        #         import sys
        #         print(f"Failed to flush metrics to database: {e}", file=sys.stderr)
        pass

        self._last_flush = datetime.now(timezone.utc)

    def get_stats(self) -> dict[str, Any]:
        """Get current metrics snapshot for health check."""
        with self._lock:
            return {
                "counters": dict(self._counters),
                "gauges": dict(self._gauges),
                "histogram_counts": {k: len(v) for k, v in self._histograms.items()},
            }


# Singleton metrics collector
_metrics_collector: MetricsCollector | None = None


def get_metrics_collector() -> MetricsCollector:
    """Get the metrics collector singleton."""
    global _metrics_collector
    if _metrics_collector is None:
        _metrics_collector = MetricsCollector()
    return _metrics_collector


async def start_metrics_flush_task() -> None:
    """Start background task to periodically flush metrics."""
    settings = get_settings()
    collector = get_metrics_collector()

    while True:
        await asyncio.sleep(settings.metrics_flush_interval_seconds)
        await collector.flush()
