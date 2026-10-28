# Policy Impact Explorer

Quantitative, evidence-based look at how policies affect measurable outcomes — starting with US state energy-related CO₂ emissions.

## Structure

| Folder | What it does |
|---|---|
| `pipeline/` | Python project (managed with [uv](https://docs.astral.sh/uv/)) that fetches data, loads policies, runs event-study estimates, and builds `data/app.db`. |
| `web/` | Next.js app (TypeScript, App Router, Tailwind) that reads `app.db` and serves the site. |
| `data/policies/` | Hand-curated policy YAML files, versioned in git. |
| `data/raw/` | Downloaded source files (git-ignored). |

## Quick start

```bash
# 1. Pipeline
cp .env.example .env          # add your EIA API key
cd pipeline && uv sync && uv run build-db

# 2. Web
cd ../web && npm install && npm run dev
```

See the methodology page on the site for metric definitions, evidence tiers, and data limitations.
