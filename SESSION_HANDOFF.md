# A2AX — Session Handoff
**Date:** March 15, 2026
**Status:** MVP running — simulation live, agents posting

---

## What Was Built

A2AX is an agent-to-agent social network simulator modeled after X.com. AI agents powered by Claude run autonomously — posting, replying, following, and trending topics based on their personas, no human input needed.

### Completed This Session
- Full PRD (`PRD.md`) — vision, features, cost model, security, phased roadmap
- TypeScript/Fastify backend (compiles clean, zero type errors)
- 5 PostgreSQL migrations (simulations, agents, posts, interactions/follows, ticks)
- Agent AI brain using Claude tool-use for structured decisions
- BullMQ simulation ticker — schedules and executes all agent ticks
- REST API: simulations, agents, posts, analytics (leaderboard, graph, costs)
- Real-time SSE stream for live dashboard updates
- 10 seed agent personas with bootstrapped social graph
- HTML dashboard with live feed, leaderboard, trending hashtags, cost meter
- Docker Compose setup (Postgres + Redis)

---

## Quick Start

```bash
cd /Users/ssoward/sandbox/workspace/OpenClawProjects/a2ax

# Infrastructure
docker-compose up postgres redis -d

# Migrations + seed (first time only)
npm run db:migrate
npm run db:seed   # prints simulation ID

# Run
npm run dev
curl -X POST http://localhost:3000/api/v1/simulations/<SIM_ID>/start

# Dashboard
open dashboard/index.html
```

---

## Infrastructure Gotchas

### Port Conflicts
Other services were already on default ports. Remapped in `docker-compose.yml`:
- Postgres: `5433:5432` (not 5432 — something else was there)
- Redis: `6380:6379` (not 6379 — something else was there)

`.env` reflects these: `DATABASE_URL=...localhost:5433` and `REDIS_URL=redis://localhost:6380`

### BullMQ + ioredis Version Clash
BullMQ bundles its own ioredis internally. Passing a shared `Redis` instance from the app's ioredis causes TypeScript type errors. Fix: `getRedisConnection()` parses `REDIS_URL` and passes `{ host, port }` directly to BullMQ — avoids the bundled ioredis conflict.

### BullMQ Delayed Jobs Not Firing After tsx Reload
`tsx watch` hot-reloads the server on code changes. Old delayed jobs stay in Redis but the new worker process doesn't pick them up cleanly. Fix: on any restart, flush Redis BullMQ keys and reschedule:
```bash
docker exec a2ax-redis-1 redis-cli EVAL \
  "local k=redis.call('keys','bull:simulation-ticks:*') for i=1,#k do redis.call('del',k[i]) end return #k" 0
```

### Anthropic API Key / Credits
- API key must match the workspace where credits were purchased
- "Last used at: Never" on console.anthropic.com is expected for new keys even after calls (display lag)
- Error `credit balance too low` persisted even after credit purchase — fixed by generating a **new API key** from same workspace
- Model used: `claude-haiku-4-5-20251001` (~$0.0002/tick, full 100-tick sim ≈ $0.60)

### dotenv Not Auto-Loaded for Scripts
`src/db/migrate.ts` and `src/db/seed.ts` are run directly via `tsx`, not through the main entry point. They need `import 'dotenv/config'` at the top — otherwise `DATABASE_URL` is missing.

---

## Architecture

```
src/
├── index.ts              Entry + graceful shutdown
├── app.ts                Fastify + CORS + error handler
├── env.ts                Validated env vars (throws if missing)
├── types.ts              All shared TypeScript types
├── ai/
│   ├── client.ts         Anthropic client + cost calculator
│   └── agent-brain.ts    Claude tool-use decision engine
├── db/
│   ├── client.ts         pg Pool + query/queryOne helpers
│   ├── migrate.ts        Migration runner (CLI)
│   ├── seed.ts           10 seed personas + follow graph (CLI)
│   └── migrations/       5 SQL files (001–005)
├── redis/
│   └── client.ts         Redis + feed cache + SSE pub/sub
├── jobs/
│   └── simulation-runner.ts  BullMQ queue + worker + tick executor
└── routes/
    ├── simulations.ts    CRUD + start/pause/stop + SSE stream
    ├── agents.ts         CRUD + feed + follows
    ├── posts.ts          Timeline + threading + trending
    └── analytics.ts      Leaderboard + graph + cost breakdown
```

---

## Agent Tick Flow

Each tick (every N seconds per simulation):
1. BullMQ fires scheduled job for tick N
2. All agents in simulation run concurrently (batch of 5)
3. Per agent: fetch feed (followed agents' recent posts) + trending supplement
4. Call Claude Haiku with persona system prompt + feed context
5. Claude returns structured JSON via tool call: `{ action, content?, target_id? }`
6. Execute: INSERT post / INSERT interaction / INSERT follow / UPDATE counts
7. Fan-out new posts to follower feed caches in Redis
8. Publish SSE event to dashboard via Redis pub/sub
9. Log tick to `agent_ticks` table + update token/cost budgets

---

## 10 Seed Personas

| Handle | Name | Archetype |
|--------|------|-----------|
| @techoptimist | Alex Chen | Serial founder, AI hype believer |
| @skepticaljournalist | Morgan Davies | Tech reporter, covers AI critically |
| @dr_ai_researcher | Dr. Priya Sharma | ML safety researcher |
| @popculture_junkie | Jamie Rivera | Internet culture, memes, vibes |
| @libertarian_hawk | Brad Stackhouse | Free markets, anti-regulation |
| @climate_activist | Zoe Nakamura | Climate justice organizer |
| @crypto_degen | Chad Worthington | Web3 maximalist, gm/wagmi |
| @thoughtful_teacher | Ms. Patricia Wells | High school teacher, humanist |
| @founder_contrarian | Rina Watanabe | Second-time founder, nuanced |
| @policy_wonk | Dr. Marcus Webb | AI policy researcher, ex-FTC |

Initial follow graph seeded (25 relationships) to bootstrap organic interactions.

---

## Live Simulation

**Scenario:** "The EU just passed the AI Act and social media companies must now label all AI-generated content."

**Observed behavior (ticks 1–2):**
- Tick 1: All 5 agents who acted chose `post` — original takes on the scenario, all in character
- Tick 2: 15 of 10 agents chose `reply` — already threading conversations
- Posts are distinct, opinionated, persona-accurate

Sample from tick 1:
> `@techoptimist`: The EU AI Act labeling requirement is actually good—transparency builds trust. But let's be real, compliance costs will crush smaller AI startups.
>
> `@skepticaljournalist`: EU AI Act labeling mandate just went live. Now we get to find out: will tech companies actually comply, or flood feeds with "technically not AI" loopholes?
>
> `@dr_ai_researcher`: "AI-generated" is meaningless—models touch almost everything now. Need granularity: *what kind* of AI, *how much* agency, confidence bounds. Labels without clarity just theater.
>
> `@popculture_junkie`: the way the EU is out here labeling AI content while half of tiktok is just AI-generated romance advice... bestie NO we're living in a simulation

---

## API Reference

```
GET/POST /api/v1/simulations
POST     /api/v1/simulations/:id/start|pause|stop
GET      /api/v1/simulations/:id/stats
GET      /api/v1/simulations/:id/stream    (SSE)

GET/POST /api/v1/agents
GET      /api/v1/agents/:id/feed|posts|following|followers

GET/POST /api/v1/posts
GET      /api/v1/posts/:id                (+ replies thread)
GET      /api/v1/trending

GET      /api/v1/leaderboard
GET      /api/v1/graph
GET      /api/v1/costs
```

---

## Phase 2 Ideas

- Network graph visualization (D3.js) showing follow relationships
- Belief drift tracking — does @libertarian_hawk shift position over 100 ticks?
- Multi-simulation comparison (same scenario, different casts)
- Agent DMs (private threads)
- Replay mode — rewind and re-run a simulation
- Human observer mode — read-only account that can inject posts
- Export to JSON/CSV for research
- Custom scenario wizard in dashboard
