# Mohamed Sabry Portfolio — API

Node.js + Express + MongoDB backend for [Mohamed Sabry's portfolio](https://github.com/MohamedSabry000/mohamed-sabry-portfolio) ([live site](https://mohamedsabry000.github.io/mohamed-sabry-portfolio/)).

It stores all portfolio content, contact messages, visitor chat logs and admin accounts in MongoDB, exposes CRUD endpoints for every collection, proxies AI chat to OpenAI (optional) and serves the assistant content from Sanity.

## Tech stack

- Node.js 22+, Express 5, TypeScript (run directly with `tsx`)
- MongoDB with Mongoose
- bcryptjs (password hashes) + jsonwebtoken (8-hour admin sessions)
- `@sanity/client` for the AI assistant's settings and knowledge (project `rdln7m0z`)

## Getting started

```bash
npm install
docker compose up -d        # local MongoDB on port 27017 (or use a MongoDB Atlas URI)
cp .env.example .env        # set MONGODB_URI, JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD
npm run dev                 # http://localhost:8787 with auto-reload
```

| Script | Description |
| --- | --- |
| `npm run dev` | Start with file watching |
| `npm start` | Start the server (production) |
| `npm run typecheck` | TypeScript check |
| `npm test` | Vitest |
| `npm run lint` | oxlint |

Run the front end with `npm run dev` in the portfolio repo; its Vite dev server proxies `/api` to `http://localhost:8787`.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `MONGODB_URI` | yes | MongoDB connection string. Without it the content endpoints return `503` |
| `JWT_SECRET` | yes in production | Long random string used to sign admin tokens |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | first start | Creates the first admin account (defaults `admin` / `admin123`, change it) |
| `CORS_ORIGINS` | no | Comma-separated front-end origins (default `https://mohamedsabry000.github.io,http://localhost:5173`) |
| `PORT` | no | Defaults to `8787` |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | no | Enables AI answers; otherwise the front end uses its built-in engine |
| `CHAT_RATE_LIMIT` | no | Chat requests per minute per IP (default 20) |
| `SANITY_PROJECT_ID`, `SANITY_DATASET` | no | Assistant content from Sanity (`rdln7m0z` / `production`) |
| `SANITY_READ_TOKEN` / `SANITY_WRITE_TOKEN` | no | Read token for a private dataset; Editor token to save visitor chats to Sanity |
| `SANITY_CACHE_SECONDS` | no | How long Sanity content is cached (default 60) |

Never commit `.env`.

## Data

| Collection | What it stores |
| --- | --- |
| `experiences`, `projects`, `skillgroups`, `education`, `certificates`, `languages`, `blog`, `faqs` | One document per item (`_id` = item id, `order` = position) |
| `site` | Single values: `profile`, `softSkills`, `sections` (visibility) |
| `messages` | Contact-form messages |
| `chatlogs` | Visitor questions and assistant answers |
| `admins` | Admin accounts (bcrypt-hashed passwords) |

On first start an empty database is seeded from `seed/portfolio.json` (the CV content). To refresh that file from the front end's `src/data`, export it from admin → Settings → Export JSON, or regenerate it with `tsx` from the portfolio repo.

## Endpoints

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /api/health` | – | Status of MongoDB, Sanity and the LLM |
| `GET /api/assistant` | – | Assistant settings and knowledge from Sanity |
| `POST /api/chat` | – | AI chat (streams when OpenAI is configured) |
| `POST /api/chat/log` | – | Save a visitor question/answer |
| `POST /api/auth/login` | – | Get a JWT |
| `GET /api/auth/me` | admin | Current admin |
| `PUT /api/auth/credentials` | admin | Change username/password |
| `GET /api/portfolio` | – | All portfolio content in one response |
| `POST /api/portfolio/import` | admin | Replace all content (JSON import / reset) |
| `GET /api/profile`, `/api/softSkills`, `/api/sections` | – | Read a single value |
| `PUT /api/profile`, `/api/softSkills`, `/api/sections` | admin | Replace a single value |
| `GET /api/:collection` | – | List items in order (`experiences`, `projects`, `skillGroups`, `education`, `certificates`, `languages`, `blog`, `faqs`) |
| `GET /api/:collection/:id` | – | One item |
| `POST /api/:collection` | admin | Create an item (409 if the id exists) |
| `PUT /api/:collection/:id` | admin | Create or replace an item |
| `DELETE /api/:collection/:id` | admin | Delete an item |
| `PUT /api/:collection/order` | admin | Reorder: `{ "ids": [...] }` |
| `POST /api/messages` | – | Send a contact message |
| `GET /api/messages` | admin | List messages |
| `PATCH /api/messages/:id` / `DELETE /api/messages/:id` | admin | Mark read / delete |
| `GET /api/chat-logs` | admin | Visitor chat logs |

Authenticated requests send `Authorization: Bearer <token>` from `POST /api/auth/login`.

## Project structure

```
src/
  index.ts          Express app: CORS, health, assistant/chat endpoints, startup
  routes.ts         REST routes (auth, portfolio CRUD, messages, chat logs)
  portfolioStore.ts One Mongoose model per portfolio collection + seeding/import
  db.ts             MongoDB connection, message/chat-log/admin models
  auth.ts           Login, JWT middleware, credential changes
  sanity.ts         Reads assistant content from Sanity, logs chats
  sanityShared.ts   GROQ query and normalisation shared with the front end
seed/portfolio.json Initial portfolio content
render.yaml         Render Blueprint
```

## Deploy

GitHub Pages only serves static files, so this API needs a Node host. Any host that runs `npm start` works.

**Render (free tier):** New → Blueprint → pick this repo. `render.yaml` sets the build (`npm ci`), start (`npm start`) and health check. Fill in `MONGODB_URI` and `ADMIN_PASSWORD`; `JWT_SECRET` is generated. The free service sleeps when idle, so the first request takes about 30–60 s.

**Railway:** New project → Deploy from GitHub repo, then add the same variables.

Then:

1. In MongoDB Atlas → Network Access, allow the host (or `0.0.0.0/0`).
2. Build the front end with the API URL and redeploy GitHub Pages:
   ```bash
   VITE_API_URL=https://<your-api-host> npm run build:pages
   ```
