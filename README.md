# Execution Tracker

Track script executions across all your games and show them on a live,
auto-refreshing **Discord webhook message** — without ever exposing the
webhook URL to anyone running your script.

- **Secure webhook storage** — your Discord webhook URL is stored inside
  Cloudflare (Durable Object storage). Loaders never see it; they only talk to
  an API endpoint protected by a secret token.
- **Live, no caching** — counts are read fresh from Cloudflare storage every
  refresh. There is no cache to max out, so the site never "goes down" the way
  it did on Vercel edge functions.
- **10-second auto-refresh** — the Discord message (and the dashboard) rebuild
  every 10 seconds using a Durable Object alarm.
- **Auto-adds new games** — the first time a new game name arrives via the API,
  it appears in the list automatically.
- **Two display modes** (chosen at setup):
  - **Long** — lists every game with its count, plus the grand total.
    Fits up to 250 games (10 embeds × 25 fields). Use **Master** beyond that.
  - **Master** — one big grand-total number summing all games. Best when you
    support 200+ games and a long list would be too big.
- **Single code file** — everything lives in `worker.js`.

---

## How it works

```
Loader / script  --(POST /api/report?game=...&secret=...)-->  Cloudflare Worker
                                                                   |
                                                  Durable Object stores counts
                                                  (in-memory map + per-game keys)
                                                                   |
                                              Alarm every 10s rebuilds embeds
                                                                   |
                                              PATCH /webhooks/.../messages/<id>
                                                                   |
                                                          Discord webhook message
                                                          (auto-updates forever)

Dashboard (GET /)  --(poll /api/stats every 10s)-->  live total + per-game grid
```

The Discord webhook URL, the API secret, the message ID, and all counts are
stored **inside the Durable Object** — never in the loader, never in frontend
JavaScript, never returned by a public endpoint.

---

## Prerequisites

- A Cloudflare account (the **Workers Free plan is enough** — Durable Objects
  are free when using the SQLite storage backend, which this project does).
- Node.js 18+ installed.
- A Discord webhook URL (Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL).

> Note on "Component v2": this project builds **auto-updating Discord embeds**
> — the standard, reliable way for a webhook to show rich, self-refreshing
> content. Discord's bot-only "Components v2" container system is not available
> to plain webhooks, so embeds are used instead. The result is the same: one
> message that updates every 10 seconds with all games + the grand total.

---

## Setup (5 steps)

### 1. Install Wrangler (Cloudflare's CLI)

```bash
npm install -g wrangler
# or use it without installing:  npx wrangler ...
```

### 2. Log in to Cloudflare

```bash
wrangler login
```

This opens a browser — approve access to your Cloudflare account.

### 3. Set your admin password (as a secret)

Deploy once first so the Worker + Durable Object exist, then set the admin
password as an encrypted secret:

```bash
cd execution-tracker
wrangler deploy            # first deploy — creates the Durable Object
wrangler secret put ADMIN_PASSWORD
```

When prompted, paste a strong, secret password. This protects the `/settings`
page. (Never put a real password in `wrangler.toml` — secrets are the secure
way.) After setting it, redeploy is not required; the secret is live
immediately.

### 4. Deploy

```bash
cd execution-tracker
wrangler deploy
```

If you skipped the first deploy in step 3, run `wrangler deploy` now.

Wrangler prints your Worker URL, e.g. `https://execution-tracker.<your-subdomain>.workers.dev`.

### 5. Configure the webhook

1. Open `https://execution-tracker.<your-subdomain>.workers.dev/settings`
2. Enter the admin password you set in step 3 → **Unlock**.
3. Paste your **Discord webhook URL**.
4. Choose a mode:
   - **Long** — list every game + counts + total (best under 250 games).
   - **Master** — grand total only (best for 200+ games).
5. Click **Save & activate webhook**.

You'll see:
- **Loader API endpoint** — e.g. `https://execution-tracker.<your-subdomain>.workers.dev/api/report`
- **Secret token** — a long random string.

The first Discord message is created immediately and will auto-refresh every
10 seconds from then on.

---

## Using it in your loader / script

Call the API endpoint with the game name and your secret. Each call = +1
execution for that game (a new game is added automatically the first time it's
seen).

### Roblox Lua (HttpService)

```lua
local HttpService = game:GetService("HttpService")
local URL = "https://execution-tracker.<your-subdomain>.workers.dev/api/report"
local SECRET = "paste-your-secret-token-here"

local function reportExecution(gameName)
    local q = "?game=" .. HttpService:UrlEncode(gameName) .. "&secret=" .. SECRET
    pcall(function()
        HttpService:PostAsync(URL .. q, "")
    end)
end

reportExecution("Grow A Garden 2")
```

> Enable `HttpService.HttpRequests` in your game settings and make sure
> `LoadStringEnabled` / executor HTTP is allowed.

### JavaScript / Node

```js
const URL = "https://execution-tracker.<your-subdomain>.workers.dev/api/report";
const SECRET = "paste-your-secret-token-here";

await fetch(`${URL}?game=${encodeURIComponent("Grow A Garden 2")}&secret=${SECRET}`, {
  method: "POST",
});
```

### Plain HTTP (any language)

```
POST /api/report?game=Grow%20A%20Garden%202&secret=YOURSECRET HTTP/1.1
Host: execution-tracker.<your-subdomain>.workers.dev
```

### Alternative input formats

The endpoint is flexible — any of these work:

- Query string: `POST /api/report?game=NAME&secret=SECRET`
- JSON body: `POST /api/report` with header `X-API-Secret: SECRET`
  and body `{"game":"NAME"}` (or include `"secret"` in the body)
- Form-encoded body: `game=NAME&secret=SECRET`

Optional `count` parameter (capped at 1000 per request) to report batches:
`?game=NAME&secret=SECRET&count=5`.

---

## Endpoints

| Method | Path            | Auth                | Purpose                                   |
|--------|-----------------|---------------------|-------------------------------------------|
| GET    | `/`             | none                | Live dashboard (auto-refreshes 10s)       |
| GET    | `/settings`     | admin password      | Configure webhook + mode, view endpoint  |
| POST   | `/api/report`   | API secret          | Loader reports an execution              |
| GET    | `/api/stats`    | none                | JSON stats for the dashboard             |
| GET    | `/api/settings` | admin password      | Read current config (mode, setup state)  |
| POST   | `/api/settings` | admin password      | Save webhook URL + mode, (re)create msg  |

---

## Dashboard

Visit `https://execution-tracker.<your-subdomain>.workers.dev/` — a live
dashboard showing the grand total and every game's count, sorted by most
executed. It polls `/api/stats` every 10 seconds. No secrets are exposed on
this page (it is safe to share publicly if you want to show off your stats).

---

## Security notes

- The **Discord webhook URL** is stored only inside the Durable Object and is
  never returned by `/api/report`, `/api/stats`, or embedded in the dashboard.
- The **API secret** protects `/api/report` so strangers can't post fake
  executions. Keep it out of public repos. If it leaks, regenerate it by
  re-saving settings (a new secret is issued on first setup; to rotate later,
  delete the Durable Object storage or redeploy after clearing `cfg:apiSecret`).
- Game names are sanitized (trimmed, capped to 80 chars, control characters
  stripped) so they can't break the Discord embed.
- Each report's increment is capped at 1000 to prevent count inflation abuse.

---

## Limits & behavior

- **Refresh cadence:** every 10 seconds (Durable Object alarm). A 1-minute
  Cloudflare cron also pings the object as a safety net so the loop can't
  die silently.
- **Long mode:** up to 250 games (Discord's 10-embed × 25-field cap). Beyond
  that, extra games are truncated and noted; switch to **Master** mode.
- **Master mode:** no game-count limit — it only shows the grand total.
- **Rate limits:** ~6 Discord message edits per minute — well within Discord's
  webhook limits.
- **No caching anywhere:** counts are always read live from Cloudflare storage.

---

## Files

| File           | What it is                                                |
|----------------|-----------------------------------------------------------|
| `worker.js`    | The entire app: Worker + Durable Object + dashboard HTML. |
| `wrangler.toml`| Cloudflare config (name, bindings, admin password, cron). |
| `README.md`    | This file.                                                |

---

## Troubleshooting

- **Settings page says "Admin password not set"** — you haven't run
  `wrangler secret put ADMIN_PASSWORD` yet. Run it, then reload `/settings`.
- **Discord message not updating** — check the webhook URL is correct and the
  channel still exists. Re-save settings to recreate the message.
- **Counts not increasing** — make sure the loader is sending the correct
  `secret` and a non-empty `game` name. A 401 means the secret is wrong.
- **`wrangler deploy` fails on migrations** — on the very first deploy the
  `[[migrations]]` block is required (it's included). If you removed it,
  add it back.

---

## Redeploying after edits

Edit `worker.js` (and/or `wrangler.toml`), then:

```bash
wrangler deploy
```

The Durable Object keeps its stored counts across deploys, so you won't lose
your execution totals.
