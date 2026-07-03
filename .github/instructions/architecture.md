# ARCHITECTURE

## Layers

1. DATA LAYER
- JSON / CSV / Postgres
- source of truth

2. GENERATION LAYER
- converts data → pages
- deterministic logic preferred

3. AI ENRICHMENT LAYER (optional)
- adds:
  - descriptions
  - FAQs
- MUST NOT invent facts

4. FRONTEND LAYER
- Astro static site
- no runtime dependencies required

5. DEPLOYMENT LAYER
- GitHub Actions
- Cloudflare Pages

## Rule

Frontend is disposable.
Data is permanent.
Generator is core logic.