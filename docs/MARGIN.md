# Profit and margin (internal)

Every sale carries an **internal cost**; nothing here is printed on an invoice, PDF, WhatsApp message or the public verify page.

- **Invoice form → "Internal cost & margin"** (people with finance access): a cost per unit for each line, pre-filled from *Settings → Services → Cost / unit*. Saving without a cost asks for confirmation.
- **Accounting → Spend**: link an expense to an *invoice* (direct cost such as ads spend or a freelancer) or to a *project*. Expenses with no link are **overhead** (rent, salaries, general ads).
- **Projects**: *Expected cost* gives an expected profit before any expense is recorded.

**How cost is counted per sale:** the larger of *planned* (sum of qty × cost per unit) and *actual* (expenses linked to the invoice plus its revenue-weighted share of its project's expenses and team rates). Revenue is net of tax.

**Reports → Profit & Margin**: per category (and per service line) revenue, cost, profit and margin; overhead; net after overhead; where the money was spent; every sale's margin; AI notes (weakest / best category, loss-making sales, actual above planned, sales without a cost, overhead pressure, and the unit price needed for the target margin, default 25% — `settings.minMarginPct`). Sales with no cost are flagged and left out of the "best / worst" ranking because they would look 100% profitable. Excel and PDF export are included. The dashboard shows the month's sales margin and the weakest category.
