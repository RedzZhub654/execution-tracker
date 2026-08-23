if not game:IsLoaded() then
    game.Loaded:Wait()
end


if identifyexecutor then
    local execName = tostring(identifyexecutor()):lower()
    if execName:find("solara") or execName:find("xeno") then
        game:GetService("Players").LocalPlayer:Kick("EXECUTOR NOT SUPPORTED[PLEASE DON'T GET MAD THIS IS SOLARA/XENO'S FAULT]")
        return
    end
end

-- ===== Execution Tracker (table-less, auto-discovering) =====
-- No game list to maintain. The worker resolves the running game to the
-- correct script file in the Ouroboros repo (github.com/joustingmatch/Ouroboros),
-- counts the execution, and returns the script source to run. New games added
-- to the repo are picked up automatically — you never edit this file.
local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")

local URL = "https://execution-tracker.YOUR-SUBDOMAIN.workers.dev/api/script"
local SECRET = "YOUR-SECRET-TOKEN" -- from the tracker's /settings page

-- Auto-detect the running game's name from Roblox (no manual names).
local function gameName()
    local name = game.Name
    local ok, info = pcall(function()
        return MarketplaceService:GetProductInfo(game.PlaceId)
    end)
    if ok and info and info.Name then name = info.Name end
    return name
end

local q = "?game=" .. HttpService:UrlEncode(gameName()) .. "&secret=" .. SECRET
local ok, content = pcall(function()
    return HttpService:GetAsync(URL .. q)
end)

if ok and type(content) == "string" and #content > 0 then
    local fn = loadstring(content)
    if fn then fn() end
end
