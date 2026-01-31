local logger = require("logger")
local millennium = require("millennium")
local json = require("json")
local io = require("io")

-- Global cache for license data (indexed by game name)
GameLicenseCache = {}

-- Path to the cache file
local CACHE_FILE_PATH = millennium.steam_path() .. "/config/gratitude_license_cache.json"

-- Path to the consent file
local CONSENT_FILE_PATH = millennium.steam_path() .. "/config/gratitude_consent.json"

-- Consent state
local consentState = {
    allowed = false,
    timestamp = nil
}

-- Helper function to count table entries
local function table_size(t)
    local count = 0
    for _ in pairs(t) do count = count + 1 end
    return count
end

-- Save cache to file
local function save_cache_to_file()
    if not consentState.allowed then
        logger:info("User has not given consent, skipping cache save")
        return false
    end

    logger:info("Saving cache to file: " .. CACHE_FILE_PATH)

    local file, err = io.open(CACHE_FILE_PATH, "w")
    if not file then
        logger:error("Failed to open cache file for writing: " .. tostring(err))
        return false
    end
    
    local encoded = json.encode(GameLicenseCache)
    file:write(encoded)
    file:close()
    
    logger:info("Cache saved successfully")
    return true
end

-- Load cache from file
local function load_cache_from_file()
    logger:info("Loading cache from file: " .. CACHE_FILE_PATH)
    
    local file, err = io.open(CACHE_FILE_PATH, "r")
    if not file then
        logger:info("Cache file doesn't exist yet (first run or no data cached)")
        return false
    end
    
    local content = file:read("*all")
    file:close()
    
    if content and #content > 0 then
        local decoded = json.decode(content)
        if decoded then
            GameLicenseCache = decoded
            local count = 0
            for _ in pairs(GameLicenseCache) do count = count + 1 end
            logger:info("Cache loaded successfully with " .. tostring(count) .. " entries")
            return true
        else
            logger:error("Failed to decode cache file JSON")
        end
    end
    
    return false
end

-- Function to be called from frontend to set license data
function SetGameLicenseData(licenseData)
    -- licenseData is a JSON string, []{date, item, acquisition}
    logger:info("SetGameLicenseData called with data length: " .. tostring(#licenseData))

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

        save_cache_to_file()
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

-- Get the number of entries in the cache
function GetCacheEntryCount()
    logger:info("GetCacheEntryCount called")
    local count = 0
    for _ in pairs(GameLicenseCache) do
        count = count + 1
    end
    logger:info("Cache has " .. count .. " entries")
    return count
end

-- Clear all entries from the cache
function ClearCache()
    logger:info("ClearCache called")
    GameLicenseCache = {}
    
    -- Delete the cache file
    local success = os.remove(CACHE_FILE_PATH)
    if success then
        logger:info("Cache file deleted successfully")
    else
        logger:info("Cache file not found or already deleted")
    end
    
    logger:info("Cache cleared successfully")
    return true
end

-- Save consent state to file
local function save_consent_to_file()
    logger:info("Saving consent state to file: " .. CONSENT_FILE_PATH)

    local file, err = io.open(CONSENT_FILE_PATH, "w")
    if not file then
        logger:error("Failed to open consent file for writing: " .. tostring(err))
        return false
    end
    
    local encoded = json.encode(consentState)
    file:write(encoded)
    file:close()
    
    logger:info("Consent state saved successfully")
    return true
end

-- Load consent state from file
local function load_consent_from_file()
    logger:info("Loading consent state from file: " .. CONSENT_FILE_PATH)
    
    local file, err = io.open(CONSENT_FILE_PATH, "r")
    if not file then
        logger:info("Consent file doesn't exist yet (user hasn't answered)")
        return false
    end
    
    local content = file:read("*all")
    file:close()
    
    if content and #content > 0 then
        local decoded = json.decode(content)
        if decoded then
            consentState = decoded
            logger:info("Consent state loaded: allowed=" .. tostring(consentState.allowed))
            return true
        else
            logger:error("Failed to decode consent file JSON")
        end
    end
    
    return false
end

-- Store user consent decision (called from frontend)
function SetConsent(allowed)
    logger:info("SetConsent called with allowed=" .. tostring(allowed))
    consentState.allowed = allowed
    consentState.timestamp = os.time()
    save_consent_to_file()
    return true
end

-- Check if user has already given consent
function HasUserConsented()
    logger:info("HasUserConsented called, returning: " .. tostring(consentState.allowed))
    return consentState.allowed
end

local function on_load()
    print("Gratitude plugin loaded")
    logger:info("Comparing millennium version: " .. millennium.cmp_version(millennium.version(), "2.29.3"))

    -- Load cached data from file on startup
    load_cache_from_file()
    
    -- Load consent state from file on startup
    load_consent_from_file()

    logger:info("Gratitude plugin loaded with Millennium version " .. millennium.version())
    millennium.ready()
end

-- Called when your plugin is unloaded. This happens when the plugin is disabled or Steam is shutting down.
-- NOTE: If Steam crashes or is force closed by task manager, this function may not be called -- so don't rely on it for critical cleanup.
local function on_unload()
    logger:info("Plugin unloaded")

    -- Save cache and consent one last time before unloading
    save_cache_to_file()
    save_consent_to_file()
end

-- Called when the Steam UI has fully loaded.
local function on_frontend_loaded()
    logger:info("Frontend loaded")
end

return {
    on_frontend_loaded = on_frontend_loaded,
    on_load = on_load,
    on_unload = on_unload
}
