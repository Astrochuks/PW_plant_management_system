# Fleet Operations Intelligence
## Turning P.W. Nigeria's Data Into Decisions

**Prepared by:** [Your Full Name] | Full Stack Data Analyst
**Date:** [Presentation Date]
**Confidential**

> This document is structured slide-by-slide for transfer to PowerPoint/Google Slides.
> Each section = one slide. Follow the layout notes.

---

## SLIDE 1 — Title

**Fleet Operations Intelligence**
Turning 1,615 Equipment Records Across 27 Sites Into Actionable Decisions

[Your Full Name] | Full Stack Data Analyst
[Date]

*Layout: Clean title slide. Company logo top-right. Subtitle centered.*

---

## SLIDE 2 — The Key Finding (Pyramid: Answer First)

### Only 51% of P.W. Nigeria's Fleet Is Currently Working

Out of **1,615** tracked plants and equipment:

| Status | Count | Share |
|--------|-------|-------|
| Working | 824 | 51.0% |
| Standby (idle) | 304 | 18.8% |
| Under Repair | 113 | 7.0% |
| Breakdown / Faulty | 140 | 8.7% |
| Missing | 145 | 9.0% |
| Scrap | 76 | 4.7% |

**Nearly half the fleet is not generating value today.**

*Layout: Large "51%" hero number top-left. Horizontal stacked bar chart showing the breakdown. One sentence takeaway at bottom.*

---

## SLIDE 3 — Where the Equipment Is

### 40% of All Equipment Sits at One Site — Abuja

| Site | Plants | Working | Utilization |
|------|--------|---------|-------------|
| **Abuja** | **660** | **99** | **15.0%** |
| BUA Cement-Okpella | 97 | 36 | 37.1% |
| Jos, Zaria Rd | 92 | 80 | 87.0% |
| Akwa Ibom | 77 | 40 | 51.9% |
| Maru-Lugga (Zamfara) | 76 | 71 | 93.4% |
| BUA-Lafiagi | 70 | 53 | 75.7% |
| Yola | 55 | 55 | 100.0% |

**Abuja holds 660 plants but only 99 are working** — the rest are standby (213), missing (136), scrap (72), under repair (57), or faulty/breakdown (72).

**Recommendation:** Conduct a physical audit of Abuja yard. Identify equipment fit for redeployment to high-utilization sites like Jos and Maru-Lugga. Dispose of confirmed scrap.

*Layout: Bar chart — sites on Y-axis, stacked bars showing working (green) vs standby (yellow) vs other (red). Abuja bar dramatically larger. Annotation callout.*

---

## SLIDE 4 — The Utilization Gap

### Some Sites Run at 100%. Others at 0%.

**Top Performing Sites:**

| Site | Plants | Working | Utilization |
|------|--------|---------|-------------|
| Yola | 55 | 55 | 100% |
| Jalingo | 42 | 42 | 100% |
| Serti | 43 | 43 | 100% |
| Kayarda Kaduna | 31 | 31 | 100% |
| Abeokuta-Shagamu | 47 | 47 | 100% |
| Taraku | 25 | 24 | 96% |
| Maru-Lugga | 76 | 71 | 93% |

**Underperforming Sites:**

| Site | Plants | Working | Utilization |
|------|--------|---------|-------------|
| Dansadau Zamfara | 40 | 0 | 0% |
| Abuja | 660 | 99 | 15% |
| BUA Cement-Okpella | 97 | 36 | 37% |
| Kwoi Kaduna | 36 | 15 | 42% |

**Dansadau has 40 plants — zero are working.** 39 are on standby. This is a fully idle site consuming storage and depreciation costs with no output.

**Recommendation:** Review Dansadau project status. If project is inactive, redeploy all 39 standby plants to active sites. Each idle excavator or truck costs the company money every day it sits unused.

*Layout: Two-column comparison. Left: "Top Sites" with green utilization bars at 90-100%. Right: "Bottom Sites" with red bars at 0-42%. Clear visual contrast.*

---

## SLIDE 5 — The Missing Equipment Problem

### 145 Plants Are Classified as "Missing" — 9% of the Fleet

| Site | Missing Plants |
|------|---------------|
| Abuja | 136 |
| Other sites | 9 |

**136 of 145 missing plants are at the Abuja yard.** These are equipment items that appeared in historical records but could not be physically verified in recent weekly reports.

This represents equipment worth potentially **hundreds of millions of naira** that the company cannot account for.

**Recommendation:** Prioritize a physical verification exercise at Abuja. Cross-reference the 136 missing fleet numbers against insurance records and asset registers. Determine which are genuinely lost vs. misclassified vs. already scrapped but not recorded.

*Layout: Single large number "145" in red. Pie chart: Abuja (136) vs Others (9). One-paragraph finding + recommendation.*

---

## SLIDE 6 — Fleet Composition

### What P.W. Nigeria's Fleet Looks Like

**Top 10 Equipment Categories:**

| Fleet Type | Count | Share |
|-----------|-------|-------|
| Trucks | 227 | 14.1% |
| Water Pumps | 198 | 12.3% |
| Generators | 140 | 8.7% |
| Vibrating Pockers | 135 | 8.4% |
| Pick-ups | 75 | 4.6% |
| Welders | 72 | 4.5% |
| Air Compressors | 68 | 4.2% |
| Excavators | 54 | 3.3% |
| Vibrating Rollers | 52 | 3.2% |
| Dump Trucks | 41 | 2.5% |

**Heavy machinery (excavators, dozers, graders, loaders)** totals ~130 units — these are the highest-value assets and should be prioritized in maintenance and tracking.

**Support equipment (pumps, generators, welders)** makes up the bulk — 410+ units. High volume, lower unit cost, but collectively significant.

*Layout: Horizontal bar chart, sorted by count. Color-code by category: heavy machinery (blue), support equipment (gray), vehicles (green).*

---

## SLIDE 7 — Automated Intelligence: What the Platform Detects

### The System Doesn't Just Store Data — It Finds Patterns

From just **13 weekly report submissions** covering **6 sites** and **957 plants**, the platform automatically detected:

| Event Type | Count | What It Means |
|-----------|-------|---------------|
| Equipment Movements | 35 | Plants that appeared at a different site than previous week |
| Returns | 9 | Equipment returned to a previous location |
| Missing Flags | 8 | Plants reported previously but absent from latest report |
| New Plants | 7 | Equipment appearing in the system for the first time |

**None of this was manually entered.** The ETL pipeline parsed raw Excel uploads, compared against historical records, and surfaced these events automatically.

**At scale (all 27 sites reporting weekly):** expect 100-200+ events per week — movements, anomalies, and trends that would be invisible in manual spreadsheets.

*Layout: Four icon cards across the top (movement arrow, return arrow, warning triangle, plus sign) with counts. Timeline visual below showing detection flow: Upload → Parse → Compare → Alert.*

---

## SLIDE 8 — Project Portfolio

### N466 Billion in Contracts — 218 Projects on Record

| Metric | Value |
|--------|-------|
| Total Projects | 218 |
| Active Status | 101 |
| Completed | 81 |
| Total Contract Value | N466.4 Billion |
| Sites Tracked | 27 |

The platform now links **project sites to their contracts** — enabling analysis of equipment cost per project, equipment allocation per contract value, and project-level performance tracking.

**Next insight to unlock:** Which projects are consuming the most equipment resources relative to their contract value? Which projects have the highest maintenance burden?

*Layout: Summary metrics across top. Simple bar chart of projects by status. Callout box for "Coming Next" insight.*

---

## SLIDE 9 — The Reporting Transformation

### From 30 Hours/Week Manual → Automated in Minutes

**Before (Manual Process):**
1. 27+ site officers write weekly Excel reports → varying formats, quality
2. Reports emailed/WhatsApp'd to HQ → some late, some missing
3. HQ staff manually opens each file, reconciles data → **20-30 hours/week**
4. Errors go unnoticed. Movements undetected. Data is outdated by the time it's compiled.
5. Management asks a question → "We'll check and get back to you" → **days**

**After (Platform):**
1. Site officers upload Excel to platform → instant processing
2. System validates, extracts, normalizes **1,353+ records** automatically
3. Movements, anomalies, and missing plants detected in seconds
4. Dashboard updates immediately → management has current data
5. Management asks a question → **answered in seconds**

**Estimated reporting time reduction: ~70%**
**Annual hours saved: ~800-1,000 hours**

*Layout: Before/After two-column. Left column in red/gray (slow, manual). Right column in green/blue (fast, automated). Large "70%" in center.*

---

## SLIDE 10 — What This Means for Decision-Making

### Every Dashboard Metric Is a Business Decision Waiting to Be Made

| The Data Shows | The Decision It Enables |
|----------------|------------------------|
| 304 plants on standby across all sites | Redeploy idle equipment → reduce external hire costs |
| 145 plants classified as missing | Physical audit → recover assets or write off and update insurance |
| 76 plants marked as scrap | Disposal program → recover salvage value, reduce storage costs |
| Abuja at 15% utilization vs Yola at 100% | Rebalance fleet allocation to match project demand |
| Dansadau: 40 plants, 0% utilization | Project review → redeploy or demobilize |
| 35 equipment movements detected automatically | Transfer accountability → no more "lost" equipment |
| 614 spare parts records tracked | Supplier benchmarking → negotiate better rates |

**Data analytics is decision support.** The platform doesn't just show numbers — it shows what to do next and what it's worth.

*Layout: Two-column table. Left = "What We See" (data). Right = "What To Do" (decision). Each row is a discrete, actionable recommendation.*

---

## SLIDE 11 — Recommendations Summary

### Three Actions That Could Save Tens of Millions

**1. Abuja Fleet Audit** (Immediate)
- Physical verification of 660 plants, especially 136 missing + 72 scrap
- Expected outcome: Recover misclassified assets, dispose of confirmed scrap, redeploy standby equipment
- Estimated impact: Asset recovery + reduced idle costs

**2. Fleet Rebalancing** (30 days)
- Move standby equipment from low-utilization sites (Abuja, Dansadau, Kwoi) to high-demand sites
- 304 standby plants = massive redeployment opportunity
- Estimated impact: Reduced external hire costs at active sites

**3. Full Platform Rollout** (60 days)
- Onboard all 27 sites to weekly automated reporting
- Currently 6 of 27 sites reporting — expanding to all sites multiplies intelligence 4x
- Estimated impact: Complete fleet visibility, early anomaly detection, data-driven maintenance planning

*Layout: Three numbered recommendation cards. Each has: title, one-line description, expected impact. Green "Do Now" / Yellow "Next 30 Days" / Blue "Next 60 Days" color coding.*

---

## SLIDE 12 — Close

### The Data Exists. The Platform Is Built. The Insights Are Ready.

**1,615 plants. 27 sites. 218 projects. N466B in contracts.**

The question is not whether P.W. Nigeria needs data-driven decision-making.
The question is how much longer decisions will be made without it.

[Your Full Name]
Full Stack Data Analyst
[Contact Details]

*Layout: Clean closing slide. Key numbers large and centered. Single closing statement. Contact details at bottom.*
