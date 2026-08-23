# Execution Tracker

Track script executions across all your games and show them on a live,
auto-updating Discord message — without ever exposing the webhook URL to
anyone running your script.

## What it does

- **Monitors the Ouroboros games folder** on GitHub
  (`joustingmatch/Ouroboros/games`). The worker fetches the live folder listing
  every 30 minutes, so new folder files are resolved automatically once a
  loader reports them — no worker redeploy needed. A bundled snapshot of the
  folder ships with the worker as a fallback if the GitHub API is
  rate-limited or down, so script loading keeps working either way.
- **Only shows games that currently have executions.** A game with zero runs is
  never listed on Discord. A game stops appearing only if it is removed from
  the Ouroboros folder or its count is reset.
- Loaders POST to an API endpoint (not a raw webhook). The webhook URL stays
  hidden inside Cloudflare.
- A Discord message auto-refreshes every 10 seconds with every active game's
  count and the grand total (e.g. Grow A Garden 2 = 10k + Steal An Egg = 30k
  = 40k).
- New games are added automatically the first time they are reported.
- No caching of counts — counts are always read fresh from Cloudflare storage.
- Two display modes, chosen at setup:
  - **Long** — lists every active game with its count plus the total. Up to 250 games.
  - **Master** — one big grand-total number. Best for 200+ games.
- **Custom-generated icons** — the Discord message uses two icons
  (a bar-chart icon on the title section and a trophy icon on the top-game
  section), committed to the repo as `emoji_icon.png` and `emoji_top.png`.
- **Discord Components v2** — the Discord message is built with the
  Components v2 layout (Container + Section + TextDisplay + Thumbnail), so it
  renders as one clean, auto-updating component block that refreshes every 10
  seconds. Mentions are fully disabled so game names can never ping anyone.

> Optional: set a `GITHUB_TOKEN` secret (`npx wrangler secret put GITHUB_TOKEN`)
> to raise the GitHub API rate limit. Without it the worker uses the
> unauthenticated limit, which is plenty for a 30-minute refresh cycle.

## Requirements

- A Cloudflare account. The **free Workers plan is enough** (Durable Objects
  are free with the SQLite storage backend, which this project uses).
- Node.js 18 or newer.
- A Discord webhook URL. In Discord: Server Settings, Integrations, Webhooks,
  New Webhook, Copy Webhook URL.

## Setup

1. Get the code (clone the repo, or unzip the download).

```bash
git clone https://github.com/RedzZhub654/execution-tracker.git
cd execution-tracker
```

2. Log in to Cloudflare.

```bash
npx wrangler login
```

A browser opens. Approve access to your Cloudflare account.

3. Deploy the worker.

```bash
npx wrangler deploy
```

This prints your worker URL, for example:
`https://execution-tracker.<your-subdomain>.workers.dev`

4. Set the admin password (protects the settings page).

```bash
npx wrangler secret put ADMIN_PASSWORD
```

Type a strong password when prompted. It is stored encrypted, never in code.

5. Open the settings page.

Go to `https://execution-tracker.<your-subdomain>.workers.dev/settings`
and enter your admin password. Then:

- Paste your Discord webhook URL.
- Pick Long or Master mode.
- Click Save.

You will see the loader API endpoint and a secret token. The first Discord
message is created immediately and refreshes every 10 seconds from then on.

## Use it in your loader

The included `loader.lua` is table-less: it auto-detects the running game's
name from Roblox, asks the worker for that game's script, and runs it. **There
is no game list to maintain** — when a new game is added to the Ouroboros repo,
it works automatically the next time someone runs it (after the worker's
30-minute folder refresh). Just set `URL` and `SECRET` at the top of the file:

```lua
local URL = "https://execution-tracker.YOUR-SUBDOMAIN.workers.dev/api/script"
local SECRET = "YOUR-SECRET-TOKEN" -- from the /settings page
```

The worker matches names flexibly (case, spaces, and emojis are ignored), so
`Grow A Garden 2`, `grow a garden 2`, and `🌱 Grow a Garden 2` all resolve to the
same folder file. A game resolves automatically when its Roblox name matches
the repo file name after normalization; if a game does not resolve, the worker
logs the reported name in `/api/catalog` so you can add an alias.

`/api/script` (used above) resolves the game, fetches its script source from
GitHub, counts the execution, and returns the source for the loader to run.
`/api/report` is count-only — use it if you load scripts yourself and only want
to track executions.

If you only want to count executions (not load scripts), drop this snippet into
your existing loader instead:

```lua
local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")

local URL = "https://execution-tracker.YOUR-SUBDOMAIN.workers.dev/api/report"
local SECRET = "YOUR-SECRET-TOKEN"   -- from the /settings page

-- Auto-detect the game name. You never type game names.
local function reportExecution()
    local name = game.Name
    local ok, info = pcall(function()
        return MarketplaceService:GetProductInfo(game.PlaceId)
    end)
    if ok and info and info.Name then name = info.Name end
    local q = "?game=" .. HttpService:UrlEncode(name) .. "&secret=" .. SECRET
    pcall(function()
        HttpService:PostAsync(URL .. q, "")
    end)
end

reportExecution()
```

JavaScript:

```js
const URL = "https://execution-tracker.YOUR-SUBDOMAIN.workers.dev/api/report";
const SECRET = "YOUR-SECRET-TOKEN";

await fetch(`${URL}?game=${encodeURIComponent("Grow A Garden 2")}&secret=${SECRET}`, {
  method: "POST",
});
```

Plain HTTP (any language):

```
POST /api/report?game=Grow%20A%20Garden%202&secret=YOURSECRET
Host: execution-tracker.YOUR-SUBDOMAIN.workers.dev
```

The endpoint also accepts JSON (`{"game":"NAME","secret":"SECRET"}`) and
form-encoded bodies. An optional `count` parameter is capped at 1000 per
request for batching.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/` | none | Live dashboard, refreshes every 10s |
| GET | `/settings` | admin password | Configure webhook and mode |
| POST | `/api/report` | API secret | Loader reports an execution (count only) |
| GET | `/api/script` | API secret | Resolves the game, counts it, and returns the script source to run |
| GET | `/api/stats` | none | JSON stats for the dashboard (active games only) |
| GET | `/api/catalog` | none | Folder-monitor status |
| GET | `/api/settings` | admin password | Read current config and secret |
| POST | `/api/settings` | admin password | Save webhook URL and mode |

The dashboard at `/` is safe to share — it shows counts only, no secrets.

## Security

- The Discord webhook URL is stored only inside the Durable Object. It is
  never returned by `/api/report`, `/api/stats`, or the dashboard.
- The API secret protects `/api/report` so strangers cannot post fake counts.
  Keep it out of public repos.
- Game names are sanitized (trimmed, capped to 80 characters, control
  characters removed).
- Each report's increment is capped at 1000.

## Free plan limits

Cloudflare free gives 100,000 requests/day, 5 million storage reads/day, and
100,000 storage writes/day. The 10-second refresh uses about 8,640 writes/day
on its own, so you have room for roughly 90,000 tracked executions per day. If
you outgrow that, the Workers Paid plan is $5/month and removes the caps.

## Files

- `worker.js` — the whole app: Worker, Durable Object, dashboard, settings page,
  folder monitor, and script-serving endpoint.
- `wrangler.toml` — Cloudflare config.
- `emoji_icon.png`, `emoji_top.png` — custom icons used in the Discord message.
- `loader.lua` — table-less drop-in loader: auto-detects the game and loads its
  script from the worker (no game list to maintain).
- `README.md` — this file.

## Troubleshooting

- **Settings says "Admin password not set"** — run
  `npx wrangler secret put ADMIN_PASSWORD`, then reload `/settings`.
- **Discord message not updating** — check the webhook URL and that the channel
  still exists. Re-save settings to recreate the message.
- **Counts not increasing** — a 401 means the secret is wrong; a 400 means the
  game name is missing or invalid. A game that reports but never appears on
  Discord is not in the Ouroboros `games/` folder; check `/api/catalog`.
- **"using cache" on the dashboard** — GitHub was unreachable when the folder
  listing last refreshed; the worker is using the cached copy. It will retry
  on the next 30-minute cycle.
- **`wrangler deploy` fails on migrations** — the first deploy needs the
  `[[migrations]]` block with `new_sqlite_classes` (already included). Keep it.

## How games are filtered

The Discord message and dashboard list a game only when **both** are true:

1. The game exists as a file in the Ouroboros `games/` folder (`.lua`, `.lu`, or
   an extensionless game file).
2. The game has at least one reported execution.

Game names are derived from the file name the same way on both sides
(`grow-a-garden-2.lua` becomes `Grow A Garden 2`; `slapacumslut` becomes
`Slapacumslut`), so the loader and the worker always agree. If GitHub is
unreachable, the worker falls back to the last known folder listing (shown as
"using cache" on the dashboard) and retries on the next 30-minute cycle.

> Note: the worker catalog auto-discovers new folder files, but a game only
> gets an execution once a loader reports it. The loader still needs a
> `CreatorId → file` mapping for each game; see `loader.lua`.

## Notes on Components v2

This project sends Discord Components v2 payloads (the `IS_COMPONENTS_V2`
flag, `Container`, `Section`, `TextDisplay`, `Thumbnail` components) to the
webhook, with `allowed_mentions` set to parse nothing. If a future Discord
change rejects the v2 layout, the `pushToDiscord` path will surface the error
in `/settings` ("Last Discord error") instead of failing silently.
