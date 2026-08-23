// Execution Tracker — Cloudflare Worker + Durable Object.
// Tracks per-game script executions and mirrors them to an auto-updating
// Discord webhook message. The webhook URL and counts live inside the
// Durable Object; loaders only ever see an API endpoint + a secret token.

const REFRESH_INTERVAL_MS = 10_000;
const MAX_FIELDS_PER_EMBED = 25;
const MAX_EMBEDS_PER_MSG = 10;
const MAX_LONG_GAMES = MAX_FIELDS_PER_EMBED * MAX_EMBEDS_PER_MSG; // 250
const MAX_GAME_NAME_LEN = 80;
const MAX_INCREMENT_PER_REQUEST = 1000;

// Custom-generated icon images, committed to the repo and served by GitHub raw.
// Used as the embed thumbnail and footer icon instead of standard emoji.
const EMOJI = {
  icon: 'https://raw.githubusercontent.com/RedzZhub654/execution-tracker/main/emoji_icon.png',
  top: 'https://raw.githubusercontent.com/RedzZhub654/execution-tracker/main/emoji_top.png',
};

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Execution Tracker</title>
<style>
  :root{
    --bg:#07080d; --panel:#0e1018; --panel2:#141723; --border:#22263840;
    --text:#e7e9f3; --muted:#8a8fa6; --accent:#8b5cf6; --accent2:#22d3ee;
    --green:#34d399; --red:#f87171;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{
    background:radial-gradient(1200px 600px at 80% -10%, #1b1140 0%, transparent 55%),
               radial-gradient(900px 500px at -10% 110%, #082233 0%, transparent 55%),
               var(--bg);
    color:var(--text); font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .wrap{max-width:1100px;margin:0 auto;padding:28px 20px 80px}
  header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .brand{display:flex;align-items:center;gap:14px}
  .logo{width:42px;height:42px;border-radius:11px;background:linear-gradient(135deg,var(--accent),var(--accent2));
        display:grid;place-items:center;box-shadow:0 8px 30px -8px #8b5cf688}
  .logo svg{width:24px;height:24px}
  h1{font-size:20px;margin:0;letter-spacing:-.02em;font-weight:700}
  .sub{color:var(--muted);font-size:13px;margin-top:2px}
  .live{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--green);
        background:#0b1410;border:1px solid #1f3a2b;padding:8px 13px;border-radius:999px}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--green);animation:pulse 1.6s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 #34d39970}70%{box-shadow:0 0 0 9px #34d39900}100%{box-shadow:0 0 0 0 #34d39900}}
  .hero{margin-top:26px;background:linear-gradient(180deg,var(--panel),var(--panel2));
        border:1px solid var(--border);border-radius:20px;padding:30px;position:relative;overflow:hidden}
  .hero::before{content:"";position:absolute;inset:0;background:radial-gradient(500px 200px at 20% 0%,#8b5cf622,transparent 70%)}
  .hero-label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.14em;font-weight:600;position:relative}
  .total{font-size:64px;line-height:1;margin:8px 0 4px;font-weight:800;letter-spacing:-.03em;
        font-variant-numeric:tabular-nums;position:relative;
        background:linear-gradient(90deg,#fff,#c7b8ff 60%,#7ee9ff);-webkit-background-clip:text;background-clip:text;color:transparent}
  .total-sub{color:var(--muted);font-size:14px;position:relative}
  .grid{margin-top:22px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:16px;transition:border-color .2s,transform .2s}
  .card:hover{border-color:#3a3f5c;transform:translateY(-2px)}
  .card .name{font-size:14px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .card .count{font-size:26px;font-weight:800;margin-top:6px;font-variant-numeric:tabular-nums;letter-spacing:-.02em;
        background:linear-gradient(90deg,#fff,#9ad8ff);-webkit-background-clip:text;background-clip:text;color:transparent}
  .empty{text-align:center;color:var(--muted);padding:70px 0;font-size:14px}
  .updated{margin-top:24px;color:var(--muted);font-size:12px;text-align:center}
  .foot{margin-top:34px;color:var(--muted);font-size:12px;text-align:center}
  a{color:var(--accent2);text-decoration:none}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand">
      <div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-5 4 4 8-8"/><path d="M17 8h4v4"/></svg></div>
      <div><h1>Execution Tracker</h1><div class="sub">Live game execution stats</div></div>
    </div>
    <div class="live"><span class="dot"></span> LIVE</div>
  </header>

  <div class="hero">
    <div class="hero-label">Total Executions</div>
    <div class="total" id="total">0</div>
    <div class="total-sub" id="gamesSub">across 0 games</div>
  </div>

  <div class="grid" id="grid"></div>
  <div class="updated" id="updated"></div>
  <div class="foot">Auto-refreshes every 10s · <a href="/settings">Settings</a></div>
</div>

<script>
const $=id=>document.getElementById(id);
function fmt(n){return (n||0).toLocaleString('en-US');}
async function load(){
  try{
    const r=await fetch('/api/stats',{cache:'no-store'});
    const d=await r.json();
    $('total').textContent=fmt(d.total);
    $('gamesSub').textContent='across '+fmt(d.gamesCount)+' game'+(d.gamesCount===1?'':'s');
    const g=$('grid');
    if(!d.games||!d.games.length){g.innerHTML='<div class="empty">No executions tracked yet. Run a script to get started.</div>';return;}
    g.innerHTML=d.games.map(x=>'<div class="card"><div class="name">'+esc(x.name)+'</div><div class="count">'+fmt(x.count)+'</div></div>').join('');
    $('updated').textContent='Updated '+(d.updatedAt?new Date(d.updatedAt).toLocaleTimeString():'');
  }catch(e){$('updated').textContent='Connecting...';}
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
load(); setInterval(load,10000);
</script>
</body>
</html>`;

const SETTINGS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Execution Tracker · Settings</title>
<style>
  :root{--bg:#07080d;--panel:#0e1018;--border:#22263840;--text:#e7e9f3;--muted:#8a8fa6;--accent:#8b5cf6;--accent2:#22d3ee;--green:#34d399;--red:#f87171}
  *{box-sizing:border-box}
  body{margin:0;min-height:100%;background:radial-gradient(1000px 500px at 80% -10%,#1b1140,transparent 55%),var(--bg);color:var(--text);font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:620px;margin:0 auto;padding:48px 20px}
  h1{font-size:22px;margin:0 0 4px;font-weight:700;letter-spacing:-.02em}
  .sub{color:var(--muted);font-size:13px;margin-bottom:28px}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:24px;margin-bottom:18px}
  label{display:block;font-size:13px;font-weight:600;color:var(--text);margin:0 0 7px}
  .hint{color:var(--muted);font-size:12px;margin:6px 0 0}
  input[type=text],input[type=password]{width:100%;background:#0b0d14;border:1px solid #2a2e42;border-radius:9px;padding:11px 12px;color:var(--text);font-size:14px;font-family:inherit;outline:none}
  input:focus{border-color:var(--accent)}
  .seg{display:flex;gap:8px}
  .seg label{flex:1;cursor:pointer;border:1px solid #2a2e42;border-radius:11px;padding:14px;margin:0;background:#0b0d14}
  .seg input{display:none}
  .seg .t{font-size:14px;font-weight:600}
  .seg .d{color:var(--muted);font-size:12px;margin-top:3px}
  .seg label.sel{border-color:var(--accent);background:linear-gradient(180deg,#1c1336,#140f24)}
  button{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#0a0a0f;border:0;border-radius:10px;padding:12px 18px;font-size:14px;font-weight:700;cursor:pointer;width:100%;margin-top:18px}
  button:disabled{opacity:.6;cursor:default}
  .out{margin-top:16px;background:#0b0d14;border:1px solid #2a2e42;border-radius:11px;padding:16px;font-size:13px;line-height:1.6;display:none}
  .out .k{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-top:12px}
  .out .v{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent2);word-break:break-all}
  .ok{color:var(--green);font-size:13px;margin-top:12px;display:none}
  .err{color:var(--red);font-size:13px;margin-top:12px;display:none}
  .pwrow{display:flex;gap:8px;align-items:center}
  .pwrow button{width:auto;margin:0;padding:10px 14px}
  a{color:var(--accent2);text-decoration:none}
</style>
</head>
<body>
<div class="wrap">
  <h1>Settings</h1>
  <div class="sub">Securely store your Discord webhook and choose a display mode.</div>

  <div class="card" id="pwCard">
    <label>Admin password</label>
    <div class="pwrow">
      <input type="password" id="pw" placeholder="The ADMIN_PASSWORD you set with wrangler secret">
      <button id="unlockBtn">Unlock</button>
    </div>
    <div class="err" id="pwErr">Wrong password.</div>
  </div>

  <div id="form" style="display:none">
    <div class="card">
      <label>Discord webhook URL</label>
      <input type="text" id="webhook" placeholder="https://discord.com/api/webhooks/...">
      <div class="hint">Stored inside Cloudflare — never returned to loaders or shown publicly.</div>
    </div>
    <div class="card">
      <label>Webhook display mode</label>
      <div class="seg" id="seg">
        <label data-mode="long"><input type="radio" name="mode" value="long" checked><div><div class="t">Long — list every game</div><div class="d">All games + counts + total. Best under 250 games.</div></div></label>
        <label data-mode="master"><input type="radio" name="mode" value="master"><div><div class="t">Master — grand total only</div><div class="d">One big number summing all games. Best for 200+ games.</div></div></label>
      </div>
    </div>
    <button id="save">Save &amp; activate webhook</button>
    <div class="ok" id="ok">Saved. The Discord message will auto-refresh every 10 seconds.</div>
    <div class="err" id="err"></div>

    <div class="out" id="out">
      <div class="k">Loader API endpoint (put this in your loader)</div>
      <div class="v" id="reportUrl"></div>
      <div class="k">Secret token (required by the endpoint)</div>
      <div class="v" id="secret"></div>
      <div class="hint" style="margin-top:14px">Never share the secret. The webhook URL itself stays hidden in Cloudflare.</div>
    </div>
  </div>
</div>
<script>
const $=id=>document.getElementById(id);
let pw='';
function segSelect(){
  document.querySelectorAll('#seg label').forEach(l=>l.classList.toggle('sel', l.querySelector('input').checked));
}
document.querySelectorAll('#seg input').forEach(i=>i.addEventListener('change',segSelect));
segSelect();
$('unlockBtn').onclick=async()=>{
  pw=$('pw').value;
  const r=await fetch('/api/settings',{headers:{'X-Admin-Password':pw}});
  if(r.status===401){$('pwErr').style.display='block';return;}
  if(r.status===503){$('pwErr').textContent='Admin password not set on the server. Run: wrangler secret put ADMIN_PASSWORD';$('pwErr').style.display='block';return;}
  $('pwErr').style.display='none';$('pwCard').style.display='none';$('form').style.display='block';
  const d=await r.json();
  if(d.webhookSet)$('webhook').value='(already stored — re-enter to change)';
  if(d.mode){document.querySelector('input[name=mode][value='+d.mode+']').checked=true;segSelect();}
};
$('save').onclick=async()=>{
  $('ok').style.display='none';$('err').style.display='none';$('save').disabled=true;
  let webhook=$('webhook').value.trim();
  if(webhook==='(already stored — re-enter to change)')webhook='';
  const mode=document.querySelector('input[name=mode]:checked').value;
  try{
    const r=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Password':pw},body:JSON.stringify({webhook,mode})});
    const d=await r.json();
    if(!r.ok){$('err').textContent=d.error||('Failed: '+r.status);$('err').style.display='block';return;}
    $('ok').style.display='block';
    $('reportUrl').textContent=d.reportUrl;
    $('secret').textContent=d.apiSecret;
    $('out').style.display='block';
  }catch(e){$('err').textContent=String(e);$('err').style.display='block';}
  finally{$('save').disabled=false;}
};
</script>
</body>
</html>`;

function sanitizeGameName(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.replace(/[\r\n\t]/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  s = s.replace(/\s+/g, ' ');
  if (s.length > MAX_GAME_NAME_LEN) s = s.slice(0, MAX_GAME_NAME_LEN);
  return s;
}

function formatNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function sortedGames(countsMap) {
  return [...countsMap.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function computeTotal(countsMap) {
  let t = 0;
  for (const v of countsMap.values()) t += v;
  return t;
}

function buildMasterEmbeds(countsMap) {
  const total = computeTotal(countsMap);
  const gamesCount = countsMap.size;
  return [{
    title: 'Execution Tracker',
    description: `### Total Executions\n# ${formatNum(total)}`,
    color: 0x34d399,
    thumbnail: { url: EMOJI.icon },
    timestamp: new Date().toISOString(),
    footer: { icon_url: EMOJI.top, text: `${gamesCount} game${gamesCount === 1 ? '' : 's'} tracked · auto-refresh 10s` },
  }];
}

function buildLongEmbeds(countsMap) {
  const games = sortedGames(countsMap);
  const total = computeTotal(countsMap);
  const capped = games.slice(0, MAX_LONG_GAMES);
  const embeds = [];
  for (let i = 0; i < capped.length; i += MAX_FIELDS_PER_EMBED) {
    const chunk = capped.slice(i, i + MAX_FIELDS_PER_EMBED);
    const fields = chunk.map(([name, count]) => ({
      name: name.slice(0, MAX_GAME_NAME_LEN),
      value: formatNum(count),
      inline: true,
    }));
    const embed = { color: 0x8b5cf6, fields };
    if (i === 0) {
      embed.title = 'Execution Tracker';
      embed.thumbnail = { url: EMOJI.icon };
      embed.description = `**Total Executions:** ${formatNum(total)}${games.length > capped.length ? ` (+${games.length - capped.length} more)` : ''}`;
      embed.timestamp = new Date().toISOString();
    }
    if (i + MAX_FIELDS_PER_EMBED >= capped.length) {
      embed.footer = { icon_url: EMOJI.top, text: `${games.length} games · auto-refresh 10s` };
    }
    embeds.push(embed);
  }
  if (embeds.length === 0) {
    embeds.push({
      title: 'Execution Tracker',
      thumbnail: { url: EMOJI.icon },
      description: `**Total Executions:** 0`,
      color: 0x8b5cf6,
      timestamp: new Date().toISOString(),
      footer: { icon_url: EMOJI.top, text: 'auto-refresh 10s' },
    });
  }
  return embeds;
}

function webhookFromUrl(url) {
  const m = /^https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/(\d+)\/([A-Za-z0-9_\-]+)/i.exec(url.trim());
  if (!m) return null;
  return { id: m[1], token: m[2], base: url.trim().replace(/\/$/, '') };
}

async function createDiscordMessage(wh, embeds) {
  const res = await fetch(`${wh.base}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds, username: 'Execution Tracker' }),
  });
  if (res.status === 429) return { error: 'rate_limited' };
  if (!res.ok) return { error: `create_${res.status}` };
  const data = await res.json();
  return { id: data.id };
}

async function editDiscordMessage(wh, messageId, embeds) {
  const res = await fetch(`${wh.base}/messages/${messageId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds, username: 'Execution Tracker' }),
  });
  if (res.status === 404 || res.status === 401) return { error: 'message_gone' };
  if (res.status === 429) return { error: 'rate_limited' };
  if (!res.ok) return { error: `edit_${res.status}` };
  return { ok: true };
}

export class TrackerDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.counts = null;
  }

  async load() {
    if (this.counts) return;
    this.counts = new Map();
    const list = await this.state.storage.list({ prefix: 'game:' });
    for (const [key, value] of list) {
      this.counts.set(key.slice(5), value);
    }
  }

  async getConfig() {
    const [webhook, mode, messageId, apiSecret] = await Promise.all([
      this.state.storage.get('cfg:webhook'),
      this.state.storage.get('cfg:mode'),
      this.state.storage.get('cfg:messageId'),
      this.state.storage.get('cfg:apiSecret'),
    ]);
    return { webhook, mode: mode || 'long', messageId, apiSecret };
  }

  async ensureAlarm() {
    const alarm = await this.state.storage.getAlarm();
    if (!alarm) await this.state.storage.setAlarm(Date.now() + REFRESH_INTERVAL_MS);
  }

  async report(gameName, increment, secret) {
    const cfg = await this.getConfig();
    if (!cfg.apiSecret || secret !== cfg.apiSecret) return { status: 401, json: { error: 'Invalid or missing secret' } };
    const game = sanitizeGameName(gameName);
    if (!game) return { status: 400, json: { error: 'Missing game name' } };
    const inc = Math.max(1, Math.min(MAX_INCREMENT_PER_REQUEST, Number(increment) || 1));

    await this.load();
    const next = (this.counts.get(game) || 0) + inc;
    this.counts.set(game, next);
    await this.state.storage.put('game:' + game, next);
    await this.ensureAlarm();
    return { status: 200, json: { ok: true, game, count: next } };
  }

  async stats() {
    await this.load();
    const games = sortedGames(this.counts).map(([name, count]) => ({ name, count }));
    return {
      status: 200,
      json: {
        total: computeTotal(this.counts),
        gamesCount: this.counts.size,
        games,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  async pushToDiscord(wh, embeds, messageId) {
    if (messageId) {
      const r = await editDiscordMessage(wh, messageId, embeds);
      if (r.error === 'message_gone') {
        const c = await createDiscordMessage(wh, embeds);
        return c.id ? { ok: true, messageId: c.id } : { ok: false, error: c.error };
      }
      if (r.error) return { ok: false, error: r.error };
      return { ok: true, messageId };
    }
    const c = await createDiscordMessage(wh, embeds);
    return c.id ? { ok: true, messageId: c.id } : { ok: false, error: c.error };
  }

  async refreshDiscord() {
    await this.load();
    const cfg = await this.getConfig();
    if (!cfg.webhook) return;
    const wh = webhookFromUrl(cfg.webhook);
    if (!wh) return;
    const embeds = cfg.mode === 'master' ? buildMasterEmbeds(this.counts) : buildLongEmbeds(this.counts);
    const r = await this.pushToDiscord(wh, embeds, cfg.messageId);
    if (r.messageId && r.messageId !== cfg.messageId) {
      await this.state.storage.put('cfg:messageId', r.messageId);
    }
  }

  async getSettings(password, origin) {
    if (!this.env.ADMIN_PASSWORD) return { status: 503, json: { error: 'ADMIN_PASSWORD not set' } };
    if (password !== this.env.ADMIN_PASSWORD) return { status: 401, json: { error: 'Unauthorized' } };
    const cfg = await this.getConfig();
    return {
      status: 200,
      json: {
        webhookSet: !!cfg.webhook,
        mode: cfg.mode,
        setupComplete: !!cfg.apiSecret,
        apiSecret: cfg.apiSecret || '',
        reportUrl: cfg.apiSecret ? `${origin}/api/report` : '',
      },
    };
  }

  async saveSettings(password, body, origin) {
    if (!this.env.ADMIN_PASSWORD) return { status: 503, json: { error: 'ADMIN_PASSWORD not set' } };
    if (password !== this.env.ADMIN_PASSWORD) return { status: 401, json: { error: 'Unauthorized' } };

    const cfg = await this.getConfig();
    let webhook = cfg.webhook;
    if (body.webhook && body.webhook.trim()) {
      if (!webhookFromUrl(body.webhook)) return { status: 400, json: { error: 'Invalid Discord webhook URL' } };
      webhook = body.webhook.trim();
    }
    if (!webhook) return { status: 400, json: { error: 'A Discord webhook URL is required' } };
    const mode = body.mode === 'master' ? 'master' : 'long';

    let apiSecret = cfg.apiSecret;
    if (!apiSecret) {
      apiSecret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    }

    await this.load();
    await this.state.storage.put('cfg:webhook', webhook);
    await this.state.storage.put('cfg:mode', mode);
    await this.state.storage.put('cfg:apiSecret', apiSecret);
    await this.state.storage.delete('cfg:messageId');
    await this.ensureAlarm();

    const wh = webhookFromUrl(webhook);
    const embeds = mode === 'master' ? buildMasterEmbeds(this.counts) : buildLongEmbeds(this.counts);
    const created = await createDiscordMessage(wh, embeds);
    if (!created.id) {
      return {
        status: 400,
        json: { error: 'Could not send to Discord. Check the webhook URL and channel permissions. (' + (created.error || 'unknown') + ')' },
      };
    }
    await this.state.storage.put('cfg:messageId', created.id);

    return {
      status: 200,
      json: {
        reportUrl: `${origin}/api/report`,
        apiSecret,
        mode,
      },
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = url.origin;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (path === '/internal/poke') {
      await this.ensureAlarm();
      return json(200, { ok: true });
    }

    if (path === '/' && request.method === 'GET') return html(DASHBOARD_HTML);
    if (path === '/settings' && request.method === 'GET') return html(SETTINGS_HTML);

    if (path === '/api/stats' && request.method === 'GET') {
      const r = await this.stats();
      return json(r.status, r.json);
    }

    if (path === '/api/report' && (request.method === 'POST' || request.method === 'GET')) {
      const body = await readReportInput(request, url);
      const result = await this.report(body.game, body.count, body.secret);
      return json(result.status, result.json);
    }

    if (path === '/api/settings') {
      const password = request.headers.get('X-Admin-Password') || '';
      if (request.method === 'GET') {
        const r = await this.getSettings(password, origin);
        return json(r.status, r.json);
      }
      if (request.method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch { body = {}; }
        const r = await this.saveSettings(password, body, origin);
        return json(r.status, r.json);
      }
    }

    return json(404, { error: 'Not found' });
  }

  async alarm() {
    try {
      await this.refreshDiscord();
    } catch (e) {
      // Swallow; the loop must continue.
    } finally {
      await this.state.storage.setAlarm(Date.now() + REFRESH_INTERVAL_MS);
    }
  }
}

async function readReportInput(request, url) {
  let game = url.searchParams.get('game') || '';
  let count = url.searchParams.get('count');
  let secret = url.searchParams.get('secret') || request.headers.get('X-API-Secret') || '';
  const auth = request.headers.get('Authorization') || '';
  if (!secret && auth.toLowerCase().startsWith('bearer ')) secret = auth.slice(7).trim();

  if (!game || request.method === 'POST') {
    const ct = request.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) {
      try {
        const b = await request.json();
        if (b && typeof b === 'object') {
          game = game || b.game || '';
          count = count ?? b.count;
          secret = secret || b.secret || '';
        }
      } catch { /* ignore */ }
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      try {
        const b = await request.formData();
        game = game || b.get('game') || '';
        count = count ?? b.get('count');
        secret = secret || b.get('secret') || '';
      } catch { /* ignore */ }
    }
  }
  return { game, count, secret };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Secret, X-Admin-Password, Authorization',
  };
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      ...corsHeaders(),
    },
  });
}

function html(content) {
  return new Response(content, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  });
}

export default {
  async fetch(request, env) {
    const id = env.TRACKER.idFromName('global');
    return env.TRACKER.get(id).fetch(request);
  },
  async scheduled(event, env) {
    const id = env.TRACKER.idFromName('global');
    await env.TRACKER.get(id).fetch(new Request('https://internal/internal/poke'));
  },
};
