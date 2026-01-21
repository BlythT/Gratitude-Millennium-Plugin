local logger = require("logger")
local millennium = require("millennium")
local json = require("json")

function test_frontend_message_callback(message, status, count)
    logger:info("test_frontend_message_callback called")
    logger:info("Received args: " .. table.concat({message, tostring(status), tostring(count)}, ", "))

    return "Response from backend"
end

-- Global cache for license data (indexed by game name)
GameLicenseCache = {}

-- Function to be called from frontend to set license data
function SetGameLicenseData(licenseData)
    -- licenseData is a JSON string, []{date, item, acquisition}
    logger:info("SetGameLicenseData called with license data: " .. licenseData)

    local decodedData = json.decode(licenseData)
    if decodedData then
        -- Convert array to hash map indexed by game name for O(1) lookups
        GameLicenseCache = {}
        for _, license in ipairs(decodedData) do
            if license.item then
                GameLicenseCache[license.item] = {
                    date = license.date,
                    acquisition = license.acquisition
                }
            end
        end

        logger:info(string.format("Cached %d license entries", #decodedData))
    else
        logger:error("Failed to decode license data JSON")
        return false, "Failed to decode license data JSON"
    end

    return true
end

-- Retrieve license data for a specific game as JSON
function GetGameLicense(gameName)
    logger:info("GetGameLicense called for game: " .. gameName)

    if GameLicenseCache[gameName] == nil then
        logger:info("No license data found for game: " .. gameName)
        return "{}"
    end
    return json.encode(GameLicenseCache[gameName])
end

-- Retrieve entire license cache as JSON
function GetGameLicenseData()
    logger:info("GetGameLicenseData called")
    if not IsGameLicenseCachePopulated() then
        logger:info("GameLicenseCache is empty")
        return "{}"
    end

    return json.encode(GameLicenseCache)
end

-- Check if the license cache is populated
-- Used by frontend to distinguish between empty cache and cache misses
function IsGameLicenseCachePopulated()
    logger:info("IsGameLicenseCachePopulated called")
    if next(GameLicenseCache) ~= nil then
        logger:info("GameLicenseCache is populated")
        return true
    end
    logger:info("GameLicenseCache is empty")
    return false
end

local function on_load()
    print("Gratitude plugin loaded")
    logger:info("Comparing millennium version: " .. millennium.cmp_version(millennium.version(), "2.29.3"))

    logger:info("Gratitude plugin loaded with Millennium version " .. millennium.version())
    millennium.ready()
end

-- Called when your plugin is unloaded. This happens when the plugin is disabled or Steam is shutting down.
-- NOTE: If Steam crashes or is force closed by task manager, this function may not be called -- so don't rely on it for critical cleanup.
local function on_unload()
    logger:info("Plugin unloaded")
end

-- Called when the Steam UI has fully loaded.
local function on_frontend_loaded()
    logger:info("Frontend loaded")
    logger:info(result)
end

return {
    on_frontend_loaded = on_frontend_loaded,
    on_load = on_load,
    on_unload = on_unload
}
