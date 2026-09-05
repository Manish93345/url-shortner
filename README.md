<div align="center">

# 🔗 Shortr

**A horizontally scalable URL shortener with real-time click analytics.**

Node.js · Fastify · Redis · PostgreSQL · Docker · AWS

![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-v5-000000?logo=fastify&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-compose-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

<!-- Uncomment after CI is wired up (Phase 8)
![CI](https://github.com/<your-username>/url-shortener/actions/workflows/ci.yml/badge.svg)
-->

</div>

---

## ✨ Highlights

- ⚡ **45K+ req/s redirect throughput (target)** — Base62 codes from a block-allocated distributed counter service, Redis cache-aside with negative caching and stampede protection
- 🚦 **Sliding-window rate limiting** — 1000 req/min per API key, enforced by an atomic Lua script over Redis sorted sets, with plan tiers
- 📊 **Real-time analytics** — click events flow through Redis Streams to a batch worker (clicks, geolocation, referrer, device) while the redirect path stays sub-15ms p99
- 🔐 **JWT + API-key auth** — argon2id password hashing, SHA-256-hashed API keys (plaintext shown exactly once)
- 🚀 **Zero-downtime deploys** — blue-green rollouts on EC2 behind Nginx, health-gated cutover with automatic rollback, driven by GitHub Actions
- 🖥️ **Dashboard UI** — dependency health badge, live click polling, QR codes, cache-invalidating deletes

## 🏗 Architecture

~~~
                     ┌─────────────────────────────────────────┐
                     │        Nginx (reverse proxy, TLS)       │
                     │     keepalive upstream · gzip · TLS     │
                     └───────────────────┬─────────────────────┘
                                         │
                ┌────────────────────────▼────────────────────────┐
                │      Node.js API — Fastify, cluster mode        │
                │   auth · rate limit · redirect · URL CRUD       │
                └────────┬───────────────────────┬────────────────┘
                         │                       │
          ┌──────────────▼──────────┐  ┌─────────▼──────────────┐
          │          Redis          │  │       PostgreSQL       │
          │  url cache (24h TTL)    │  │  users · api_keys      │
          │  negative cache (60s)   │  │  urls · ID counter     │
          │  rate-limit ZSETs       │  │  clicks (click events) │
          │  click-event Stream     │  └─────────▲──────────────┘
          └──────────────┬──────────┘            │ batch INSERT
                         │ XREADGROUP            │
          ┌──────────────▼──────────┐            │
          │    Worker container     │────────────┘
          │  geo lookup · batching  │
          └─────────────────────────┘
~~~

**Redirect request flow** (`GET /:code`):

1. Nginx → Node (one cluster worker per vCPU)
2. Single Redis `MGET` checks the URL key **and** the negative-cache key in one round trip
3. Hit → `302` immediately · negative hit → `404` · miss → Postgres lookup, cache backfill, respond
4. Concurrent misses for the same code collapse into **one** Postgres query (in-flight dedupe)
5. The click event is emitted fire-and-forget to a Redis Stream and a live counter — **never** on the response path
6. The worker consumes the stream, enriches events with geolocation/referrer/device, and batch-inserts into Postgres

## 🔧 Design Decisions

**Block allocation instead of Snowflake / Redis INCR.**
Each API process claims a block of 100K IDs in one atomic `UPDATE counter SET value = value + $1 RETURNING value - $1 AS start`, then serves IDs from memory: no per-request coordination, no cross-process collisions, no clock-skew concerns. Postgres is the single source of truth, so ID generation survives a Redis outage. Unused block tails are discarded on restart — gaps are accepted because uniqueness matters, not density.

**302, never 301.**
`301` is cached permanently by browsers: once cached, users never touch our servers again and click analytics silently die. `302` keeps every click observable. The cost — slightly worse client-side caching — is the correct tradeoff for an analytics product.

**Negative caching + stampede protection.**
Unknown codes are cached for 60s, defeating cache-penetration scans of random codes. An in-flight promise map collapses N concurrent cold-key misses into exactly one Postgres query — enforced by a test that fires 50 concurrent requests and asserts a single `SELECT`.

**Bounded Redis latency (war story).**
ioredis has no per-command timeout. When a Redis container dies without closing TCP cleanly, its socket black-holes commands until the OS retransmit timeout — we measured redirects stalling for **~72 seconds**. Fixed with `enableOfflineQueue: false` plus a `Promise.race` timeout wrapper (~100ms) on every request-path Redis call: worst case is a ~100ms detour to Postgres instead of a hung request. Outages now degrade to "slower," never "down."

**Atomic sliding-window limiter in Lua.**
Prune expired entries, count, and add happen in a single script — concurrent requests cannot race past the limit the way they can with separate check-then-add commands. The window clock comes from `redis.call('TIME')`, giving every app instance one authoritative clock. On limiter failure the API **fails open** (documented tradeoff: a paid-quota API might fail closed).

## 📊 Performance

| Scenario | Target | Measured |
|---|---|---|
| Redirect — cache hit | ≥ 45,000 req/s · p99 < 15 ms | TBD |
| Redirect — cache miss | — | TBD |
| Create short URL | — | TBD |
| Rate-limited request | — | TBD |

**Preliminary (dev laptop, single process, tsx, no Nginx):** ~31K req/s with 5ms p99 on the cached redirect path via `autocannon` — well ahead of pace for the target hardware.

**Methodology (final benchmarks):** k6 running from a separate EC2 instance in the same AZ/VPC; warm cache; Zipfian distribution of codes (realistic hot-key skew); a dedicated benchmark API key on an unlimited plan so load tests don't trip the product's own limiter; results measured through Nginx. Scripts and raw results are committed under [`load-test/`](./load-test).

## 🔌 API

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | — | Create account → JWT |
| `POST` | `/auth/login` | — | Sign in → JWT |
| `POST` | `/auth/api-keys` | JWT | Mint an API key (plaintext returned once) |
| `POST` | `/api/urls` | API key / JWT · rate-limited | Create a short URL |
| `GET` | `/api/urls` | API key / JWT | List own URLs with live click counts |
| `DELETE` | `/api/urls/:code` | API key / JWT | Delete + cache invalidation |
| `GET` | `/api/stats/:code` | API key / JWT | Clicks, referrers, countries, timeseries — *planned* |
| `GET` | `/:code` | public | `302` redirect + click event |
| `GET` | `/health/live` | public | Liveness (no dependency checks) |
| `GET` | `/health/ready` | public | Readiness (Postgres + Redis probes) — polled by deploys |

~~~bash
curl -X POST http://localhost:3000/api/urls \
  -H "Content-Type: application/json" \
  -H "X-API-Key: us_..." \
  -d '{"url":"https://github.com/fastify/fastify"}'
~~~

~~~json
{
  "shortCode": "4c92",
  "originalUrl": "https://github.com/fastify/fastify",
  "createdAt": "2026-09-04T14:57:10.291Z",
  "shortUrl": "http://localhost:3000/4c92"
}
~~~

Rate-limited responses carry standard headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After` on `429`).

## 🗃 Data Model

| Table | Purpose |
|---|---|
| `counter` | Single row; source of block-allocated ID ranges |
| `urls` | Short code ↔ destination, owner, optional expiry |
| `users` / `api_keys` | Accounts, plans, SHA-256-hashed API keys |
| `clicks` | Click events: code, timestamp, referrer, country, city, device |

## 🚀 Getting Started

~~~bash
git clone https://github.com/<your-username>/url-shortener.git
cd url-shortener

cp .env.example .env
npm install
docker compose up -d        # Postgres 16 + Redis 7
npm run migrate
npm run dev
~~~

Open **http://localhost:3000/app/** for the dashboard. The API serves on `:3000`.

| Env var | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `NODE_ENV` | `development` | `production` refuses the dev JWT secret |
| `LOG_LEVEL` | `info` | pino levels |
| `DATABASE_URL` | `postgres://urlshort:urlshort@localhost:5432/urlshort` | |
| `REDIS_URL` | `redis://localhost:6379` | |
| `JWT_SECRET` | dev default | ≥ 32 chars |
| `BASE_URL` | `http://localhost:3000` | Public base used to build short URLs |

## 🧪 Testing

~~~bash
npm test        # vitest — unit + integration
~~~

Covers: Base62 round-trips including values beyond `Number.MAX_SAFE_INTEGER` (BigInt-safe), cache `MISS → HIT` and negative-cache behavior, the stampede-collapse guarantee, auth flows (401/409, hashed keys, duplicate emails), and limiter semantics (limit → deny with `Retry-After`, per-subject isolation, unlimited plans bypassing Redis).

<!-- Uncomment after capturing screenshots
## 🖼 Demo

![Dashboard](docs/screenshots/dashboard.png)
![Create](docs/screenshots/create.png)
-->

## 🔁 CI/CD & Zero-Downtime Deploys (planned)

GitHub Actions on every push to `main`: **lint → unit + integration tests → build & push image (tagged with git SHA) → deploy**.

Deploy is blue-green on a single EC2 instance:

1. Pull the new image; start the **green** container alongside live **blue**
2. Poll green's `/health/ready` until 200 — on timeout, abort with blue untouched (automatic rollback)
3. Flip the Nginx upstream port and `nginx -s reload`
4. Drain and stop blue; roles swap on the next deploy

Combined with the app's graceful shutdown (stop accepting, drain in-flight requests, then close Postgres/Redis), rollouts are verified zero-downtime by running k6 through the cutover and asserting zero failures.

## 🗺 Roadmap

- ✅ Service scaffold — validated config (zod), structured logging, graceful shutdown, liveness/readiness probes
- ✅ Core shortener — BigInt-safe Base62, block-allocated counter service, create + redirect
- ✅ Redis cache-aside — positive + negative caching, stampede collapse, bounded-latency ops, Postgres fallback on outage
- ✅ Auth — argon2id, JWT sessions, hashed API keys
- ✅ Sliding-window rate limiting — atomic Lua, plan tiers, standard headers
- ✅ Dashboard UI — live clicks, QR, delete with cache invalidation
- ⬜ Analytics pipeline — Redis Streams → worker → batched inserts, GeoLite2 geolocation, referrer/device parsing, `GET /api/stats/:code`
- ⬜ Production packaging — multi-stage Docker image, prod compose, Nginx
- ⬜ Benchmarks — k6 on EC2, tuning to targets, published results
- ⬜ Blue-green deploy script + AWS deployment (EC2, TLS)
- ⬜ CI/CD — GitHub Actions, GHCR, automated rollouts
- ⬜ Polish — Swagger docs, screenshots, demo video

## 📄 License

MIT — see [LICENSE](./LICENSE).