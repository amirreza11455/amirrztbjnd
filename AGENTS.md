# Tamga — Base44 Dev Environment

## Overview
Tamga is a **static vanilla-JS frontend** (no build step, no backend, no
package manager). It is served directly by `nginx:alpine` in
`docker-compose.base44.yml`.

## Directory layout
The HTML files (`index.html`, `tests.html`) reference assets from `css/` and
`js/` subdirectories. All source files live in those directories — do not
flatten them back to the repo root or the app will 404 its own assets.

- `css/`   — stylesheets (tokens, base, layout, home)
- `js/`    — application modules (config, util, store, timeline, slip, today,
             home, shell, plus legacy chart modules: ticker, hero-chart,
             memories, story)
- `js/tests/` — zero-dependency test suites (run via `tests.html`)

## Running
```
docker compose -f docker-compose.base44.yml up -d
```
The app is served on **port 3000**. Edits to HTML/CSS/JS are live on refresh
(nginx serves the bind-mount directly; no rebuild needed).

## No secrets required
The app is fully client-side with an in-memory store. No external credentials
are needed.
