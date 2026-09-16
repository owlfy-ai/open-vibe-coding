# Cloudflare Worker Deployment

Deploy the current Web app to the `qidea` Cloudflare Worker:

```bash
pnpm deploy:cloudflare
```

The script runs `pnpm build`, checks `dist/index.html`, then deploys with Wrangler using `wrangler.jsonc`.

## Cloudflare Setup

Before deploying, authenticate Wrangler in one of these ways:

```bash
pnpm dlx wrangler@latest login
```

Or provide an API token:

```bash
export CLOUDFLARE_API_TOKEN=...
```

The token needs permission to deploy Workers and manage routes for the `qidea.ai` zone.

## Routes

`wrangler.jsonc` publishes the app to:

- `qidea.guijijike.workers.dev`
- `qidea.ai/*`
- `*.qidea.ai/*`

Keep the DNS records in Cloudflare proxied. The wildcard route is what makes subdomains such as `a.qidea.ai` reach the Worker.
