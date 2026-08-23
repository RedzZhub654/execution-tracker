# Execution Tracker

Track script executions across all your games and show them on a live,
auto-updating Discord message — without ever exposing the webhook URL to
anyone running your script.

## What it does

- Loaders POST to an API endpoint (not a raw webhook). The webhook URL stays
  hidden inside Cloudflare.
- A Discord message auto-refreshes every 10 seconds with every game's count
  and the grand total (e.g. Grow A Garden 2 = 10k + Steal An Egg = 30k = 40k).
- New games are added automatically the first time they are reported.
- No caching anywhere — counts are always read fresh from Cloudflare storage.
- Two display modes, chosen at setup:
  - **Long** — lists every game with its count plus the total. Up to 250 games.
  - **Master** — one big grand-total number. Best for 200+ games.
- **Custom-generated icons** — the Discord message uses two icons I generated
  (a bar-chart icon on the title section and a trophy icon on the top-game
  section), committed to the repo as `emoji_icon.png` and `emoji_top.png`.
  No standard Unicode emoji are used.
- **Discord Components v2** — the Discord message is built with the new
  Components v2 layout (Container + Section + TextDisplay + Thumbnail), so it
  renders as one clean, auto-updating component block that refreshes every 10
  seconds.

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

Call the API endpoint whenever a player runs your script. Send the game name
and your secret — each call adds one execution for that game. The name
`Grow A Garden 2` below is only an example; replace it with the real name of
your game or script. The first time a name is reported, it is added to the
list automatically.

If your loader already maps each game to a file name (like the Ouroboros loader
at `https://github.com/joustingmatch/Ouroboros`), you do **not** need to type
game names at all — use the file name as the game name. An example `loader.lua`
is included in this repo that does this automatically: it cleans each file name
(e.g. `grow-a-garden-2.lua` becomes `Grow A Garden 2`) and reports it before
the game loads. Just set `TRACKER_URL` and `TRACKER_SECRET` at the top of that
file and replace the friend's current loader with it.

Roblox Lua (put this near the top of your script):

```lua
local HttpService = game:GetService("HttpService")

-- Replace these two values with your own:
local URL = "https://execution-tracker.YOUR-SUBDOMAIN.workers.dev/api/report"
local SECRET = "YOUR-SECRET-TOKEN"   -- from the /settings page

-- Call this with the game's name every time a player runs your script.
local function reportExecution(gameName)
    local q = "?game=" .. HttpService:UrlEncode(gameName) .. "&secret=" .. SECRET
    pcall(function()
        HttpService:PostAsync(URL .. q, "")
    end)
end

-- Example: a player ran your script for the game "Grow A Garden 2".
reportExecution("Grow A Garden 2")
```

So if you have three games, you'd call `reportExecution("Game One")`,
`reportExecution("Game Two")`, and `reportExecution("Game Three")` from each
game's loader. Always use the same name for the same game so its counts add up
together.

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
| POST | `/api/report` | API secret | Loader reports an execution |
| GET | `/api/stats` | none | JSON stats for the dashboard |
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

- `worker.js` — the whole app: Worker, Durable Object, dashboard, settings page.
- `wrangler.toml` — Cloudflare config.
- `emoji_icon.png`, `emoji_top.png` — custom icons used in the Discord message.
- `loader.lua` — drop-in Ouroboros-style loader with the tracker built in (auto game names).
- `README.md` — this file.

## Troubleshooting

- **Settings says "Admin password not set"** — run
  `npx wrangler secret put ADMIN_PASSWORD`, then reload `/settings`.
- **Discord message not updating** — check the webhook URL and that the channel
  still exists. Re-save settings to recreate the message.
- **Counts not increasing** — a 401 means the secret is wrong; a 400 means the
  game name is missing or invalid.
- **`wrangler deploy` fails on migrations** — the first deploy needs the
  `[[migrations]]` block with `new_sqlite_classes` (already included). Keep it.

## Notes on "Component v2"

This project uses auto-updating Discord embeds — the standard, reliable way
for a webhook to show rich, self-refreshing content. Discord's bot-only
"Components v2" container system is not available to plain webhooks, so embeds
are used instead. The result is the same: one message that updates every 10
seconds with all games and the grand total.
