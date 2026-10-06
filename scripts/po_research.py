"""Profile every shape a purchase order takes in the live data.

Read-only. Produces the taxonomy the PO/VAT re-scoping has to handle,
with current figures — the ones in the markdown are stale.
"""

import asyncio
import os
import sys

from dotenv import dotenv_values

ROOT = "/Users/ram/Desktop/Projects/pw-plant-management-system/backend"
DB = os.environ.get("DATABASE_URL") or dotenv_values(f"{ROOT}/.env").get("DATABASE_URL")

# One CTE both reused everywhere: a PO is (number, date).
PO_CTE = """
WITH po AS (
  SELECT
    purchase_order_number                                       AS num,
    po_date,
    count(*)                                                    AS lines,
    count(*) FILTER (WHERE plant_id IS NOT NULL)                AS tagged,
    count(*) FILTER (WHERE plant_id IS NULL
                       AND shared_fleet_numbers IS NOT NULL)    AS untagged_shared,
    count(*) FILTER (WHERE plant_id IS NULL
                       AND shared_fleet_numbers IS NULL)        AS untagged_bare,
    count(DISTINCT plant_id)                                    AS plants,
    max(COALESCE(array_length(shared_fleet_numbers, 1), 0))     AS fleets_listed,
    count(DISTINCT cost_type)                                   AS cost_types,
    count(DISTINCT currency)                                    AS currencies,
    max(currency)                                               AS currency,
    count(DISTINCT supplier_id)                                 AS suppliers,
    count(DISTINCT location_id)                                 AS locations,
    count(DISTINCT submission_number)                           AS submissions,
    bool_or(is_workshop)                                        AS ws,
    bool_or(is_category)                                        AS cat,
    bool_or(COALESCE(is_po_overhead, false))                    AS overhead,
    sum(COALESCE(unit_cost,0) * COALESCE(quantity,1))           AS goods,
    sum(COALESCE(vat_amount, 0))                                AS vat,
    sum(COALESCE(discount_amount, 0))                           AS disc,
    sum(COALESCE(other_costs, 0))                               AS other,
    sum(total_cost)                                             AS all_in,
    sum(total_cost_ngn)                                         AS ngn
  FROM spare_parts
  GROUP BY 1, 2
)
"""

SECTIONS: list[tuple[str, str, list[str]]] = [

 ("1. HEADLINE", """
  SELECT 'line items'        AS metric, count(*)::text AS value FROM spare_parts
  UNION ALL SELECT 'purchase orders (number+date)',
         count(DISTINCT (purchase_order_number, po_date))::text FROM spare_parts
  UNION ALL SELECT 'distinct PO numbers',
         count(DISTINCT purchase_order_number)::text FROM spare_parts
  UNION ALL SELECT 'total spend (NGN, all time)',
         to_char(sum(total_cost_ngn),'FM999,999,999,990.00') FROM spare_parts
  UNION ALL SELECT 'earliest po_date', min(po_date)::text FROM spare_parts
  UNION ALL SELECT 'latest po_date',   max(po_date)::text FROM spare_parts
  UNION ALL SELECT 'rows with NULL po_date',
         count(*)::text FROM spare_parts WHERE po_date IS NULL
 """, ["metric", "value"]),

 ("2. SPEND BY YEAR", """
  SELECT COALESCE(year::text,'(null)') AS yr,
         count(*)::text AS lines,
         count(DISTINCT (purchase_order_number, po_date))::text AS pos,
         to_char(sum(total_cost_ngn),'FM999,999,999,990.00') AS ngn
  FROM spare_parts GROUP BY year ORDER BY year
 """, ["yr", "lines", "pos", "ngn"]),

 ("3. ATTRIBUTION SHAPE  (who the money can be pinned to)", PO_CTE + """
  SELECT CASE
    WHEN ws OR cat                            THEN 'D  workshop / category (no plant)'
    WHEN untagged_bare > 0 AND plants = 0     THEN 'F  untagged, no fleet list at all'
    WHEN untagged_shared > 0 AND fleets_listed > 1 THEN 'C  multi-plant, lines UNTAGGED'
    WHEN untagged_shared > 0 AND fleets_listed = 1 THEN 'C- single fleet, lines untagged'
    WHEN tagged = lines AND plants > 1        THEN 'B  multi-plant, every line tagged'
    WHEN tagged = lines AND plants = 1        THEN 'A  single plant, fully tagged'
    ELSE 'E  mixed (some tagged, some not)' END AS bucket,
    count(*)::text AS pos, sum(lines)::text AS lines,
    to_char(sum(ngn),'FM999,999,999,990.00') AS ngn,
    (round(100.0*sum(ngn)/NULLIF(sum(sum(ngn)) OVER (),0),1))::text AS pct
  FROM po GROUP BY 1 ORDER BY 1
 """, ["bucket", "pos", "lines", "ngn", "pct"]),

 ("4. OVERHEADS  (what actually sits on top of goods)", PO_CTE + """
  SELECT CASE
    WHEN vat > 0 AND disc > 0 THEN 'VAT + discount'
    WHEN vat > 0 AND other > 0 THEN 'VAT + other costs'
    WHEN vat > 0  THEN 'VAT only'
    WHEN disc > 0 THEN 'discount only'
    WHEN other > 0 THEN 'other costs only'
    ELSE 'none (goods only)' END AS kind,
    count(*)::text AS pos,
    to_char(sum(goods),'FM999,999,999,990.00') AS goods,
    to_char(sum(vat),'FM999,999,999,990.00')   AS vat,
    to_char(sum(disc),'FM999,999,990.00')      AS discount,
    to_char(sum(other),'FM999,999,990.00')     AS other
  FROM po GROUP BY 1 ORDER BY count(*) DESC
 """, ["kind", "pos", "goods", "vat", "discount", "other"]),

 ("5. THE ROUNDING DRIFT  (goods+VAT-disc+other vs stored total)", PO_CTE + """
  SELECT CASE
      WHEN abs((goods+vat-disc+other) - all_in) < 0.005          THEN 'exact'
      WHEN abs((goods+vat-disc+other) - all_in) < 0.01*lines     THEN 'within 1 kobo/line'
      ELSE 'DRIFTS MORE THAN A KOBO PER LINE' END                AS band,
    count(*)::text AS pos,
    to_char(sum(abs((goods+vat-disc+other) - all_in)),'FM999,990.0000') AS total_drift
  FROM po GROUP BY 1 ORDER BY 1
 """, ["band", "pos", "total_drift"]),

 ("6. VAT SPLIT ACROSS LINES  (how many lines each VAT is divided over)", PO_CTE + """
  SELECT CASE WHEN lines = 1 THEN '1 line (no split)'
              WHEN lines <= 3 THEN '2-3 lines'
              WHEN lines <= 6 THEN '4-6 lines'
              ELSE '7+ lines' END AS split_over,
    count(*)::text AS pos_with_vat,
    to_char(sum(vat),'FM999,999,999,990.00') AS vat_at_risk
  FROM po WHERE vat > 0 GROUP BY 1 ORDER BY 1
 """, ["split_over", "pos_with_vat", "vat_at_risk"]),

 ("7. PO NUMBER REUSE  (why identity is number+date)", """
  SELECT dates_used::text AS dates_per_number,
         count(*)::text AS po_numbers,
         to_char(sum(ngn),'FM999,999,999,990.00') AS ngn
  FROM (SELECT purchase_order_number,
               count(DISTINCT po_date) AS dates_used,
               sum(total_cost_ngn) AS ngn
        FROM spare_parts GROUP BY 1) t
  GROUP BY 1 ORDER BY 1
 """, ["dates_per_number", "po_numbers", "ngn"]),

 ("8. CURRENCY", PO_CTE + """
  SELECT COALESCE(currency,'(null)') AS currency,
         count(*)::text AS pos,
         count(*) FILTER (WHERE currencies > 1)::text AS mixed_currency_pos,
         to_char(sum(goods),'FM999,999,999,990.00') AS goods_raw,
         to_char(sum(ngn),'FM999,999,999,990.00')   AS ngn
  FROM po GROUP BY 1 ORDER BY sum(ngn) DESC
 """, ["currency", "pos", "mixed_currency_pos", "goods_raw", "ngn"]),

 ("9. PO-LEVEL CONSISTENCY  (does one PO mean one supplier/site/date?)", PO_CTE + """
  SELECT 'more than one supplier on a PO' AS anomaly, count(*)::text AS pos FROM po WHERE suppliers > 1
  UNION ALL SELECT 'more than one location on a PO', count(*)::text FROM po WHERE locations > 1
  UNION ALL SELECT 'more than one cost_type on a PO', count(*)::text FROM po WHERE cost_types > 1
  UNION ALL SELECT 'more than one currency on a PO', count(*)::text FROM po WHERE currencies > 1
  UNION ALL SELECT 'entered more than once (submissions)', count(*)::text FROM po WHERE submissions > 1
  UNION ALL SELECT 'has a PO-overhead row', count(*)::text FROM po WHERE overhead
 """, ["anomaly", "pos"]),

 ("10. DATA HEALTH  (things that would break a migration)", """
  SELECT 'lines with NULL unit_cost' AS issue, count(*)::text AS rows FROM spare_parts WHERE unit_cost IS NULL
  UNION ALL SELECT 'lines with unit_cost = 0', count(*)::text FROM spare_parts WHERE unit_cost = 0
  UNION ALL SELECT 'lines with negative unit_cost', count(*)::text FROM spare_parts WHERE unit_cost < 0
  UNION ALL SELECT 'lines with NULL/0 quantity', count(*)::text FROM spare_parts WHERE quantity IS NULL OR quantity = 0
  UNION ALL SELECT 'lines with NULL total_cost', count(*)::text FROM spare_parts WHERE total_cost IS NULL
  UNION ALL SELECT 'shared rows with plant_id SET (contradiction)', count(*)::text
         FROM spare_parts WHERE cost_type='shared' AND plant_id IS NOT NULL
  UNION ALL SELECT 'direct rows with a fleet ARRAY (contradiction)', count(*)::text
         FROM spare_parts WHERE cost_type='direct' AND shared_fleet_numbers IS NOT NULL
  UNION ALL SELECT 'fleet array naming an unknown fleet_number', count(*)::text FROM (
         SELECT DISTINCT f FROM spare_parts sp, unnest(sp.shared_fleet_numbers) f
         WHERE NOT EXISTS (SELECT 1 FROM plants_master pm WHERE pm.fleet_number = f)) x
 """, ["issue", "rows"]),
]


async def main() -> None:
    import asyncpg
    conn = await asyncpg.connect(DB, statement_cache_size=0, timeout=120,
                                 command_timeout=300)
    try:
        for title, sql, cols in SECTIONS:
            print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")
            try:
                rows = await conn.fetch(sql)
            except Exception as exc:
                print(f"  !! {type(exc).__name__}: {exc}")
                continue
            if not rows:
                print("  (no rows)")
                continue
            widths = [max(len(c), max(len(str(r[c] or '')) for r in rows)) for c in cols]
            print("  " + "  ".join(c.upper().ljust(w) for c, w in zip(cols, widths)))
            print("  " + "  ".join("-" * w for w in widths))
            for r in rows:
                print("  " + "  ".join(str(r[c] if r[c] is not None else '')
                                       .ljust(w) for c, w in zip(cols, widths)))
    finally:
        await conn.close()


asyncio.run(main())
