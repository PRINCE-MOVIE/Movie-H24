# Base44 Dev Environment

## Project
Single static HTML file (`index.html`, ~85KB) — a French streaming UI ("PRINCE MOVIE"). All CSS and JS are inline. No build step, no backend, no database.

## How it runs
Served as static files by `nginx:alpine` via `docker-compose.base44.yml` on host port 3000. The repo root is bind-mounted into the container, so edits to `index.html` appear on browser refresh (no live-reload server; call `reload_preview` after edits if needed).

## Gotchas
- The repo root must be world-readable (mode 755) and `index.html` readable (644); nginx's worker process is non-root and returns 403 otherwise. `chmod 755 . && chmod 644 index.html` fixes it.
- The app fetches data from an external API at `http://51.75.118.170:20041/api/v1` through public CORS proxies (allorigins / corsproxy / codetabs). No credentials are required; if content doesn't load, the external API or proxies are unreachable, not a local issue.

## Verify
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/` → 200.
