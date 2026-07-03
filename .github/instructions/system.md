# SYSTEM CONTEXT

You are working on a Programmatic SEO system.

This is NOT a blog.
This is NOT a CMS.

It is a machine that generates thousands of static SEO pages from structured data.

## Core pipeline

DATA → NORMALIZATION → GENERATION → STATIC SITE → CLOUDFLARE PAGES

Never break this flow.

## Principles

- No manual writing at scale
- No dynamic SSR unless explicitly required
- Everything must be regenerable from data
- AI is ONLY used for enrichment, not invention
- Every page must be traceable to structured data

## Output target

Static HTML pages deployed to Cloudflare Pages CDN.