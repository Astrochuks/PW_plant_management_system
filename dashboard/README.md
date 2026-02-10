# Database Monitoring Dashboard

A real-time monitoring dashboard for the Plant Management System database.

## Features

- **Health Overview**: Database size, cache hit ratio, index usage, dead tuples
- **Table Statistics**: Row counts, sizes, dead tuple percentages
- **Query Performance**: Slow query tracking with execution times
- **Index Usage**: Active, unused, and rarely-used indexes
- **Connection Monitoring**: Active, idle, and total connections
- **Auto-Refresh**: Updates every 30 seconds

## Quick Start

### Option 1: Open directly in browser

Simply open `index.html` in your web browser. The dashboard will connect directly to Supabase.

```bash
open index.html  # macOS
# or
xdg-open index.html  # Linux
# or
start index.html  # Windows
```

### Option 2: Use Python server (for development)

```bash
cd dashboard
python server.py
# Open http://localhost:8080
```

### Option 3: Use any static file server

```bash
# Using Python
python -m http.server 8080

# Using Node.js
npx serve .

# Using PHP
php -S localhost:8080
```

## Architecture

The dashboard fetches live data from Supabase using these RPC functions:

- `get_monitoring_dashboard()` - Health metrics and overview
- `get_monitoring_tables()` - Table statistics
- `get_monitoring_queries()` - Slow query logs
- `get_monitoring_indexes()` - Index usage stats
- `get_monitoring_connections()` - Connection info

All functions are read-only and use `SECURITY DEFINER` with restricted search paths.

## Metrics Explained

### Health Indicators

| Status | Meaning |
|--------|---------|
| GOOD | Healthy, no action needed |
| WARNING | Needs attention soon |
| CRITICAL | Immediate action required |
| INFO | Informational only |

### Key Metrics

- **Cache Hit Ratio**: Should be >95%. Lower values mean too many disk reads.
- **Index Hit Ratio**: Should be >95%. Lower values mean table scans.
- **Dead Tuples**: Should be <10%. Higher values mean VACUUM needed.
- **Active Connections**: Monitor for connection leaks.

## Customization

Edit `index.html` to:
- Change the refresh interval (default: 30 seconds)
- Modify thresholds for status indicators
- Adjust styling/colors
