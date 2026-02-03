local logger = require("logger")
local millennium = require("millennium")
local json = require("json")
local io = require("io")

-- Global cache for license data (indexed by Steam ID, then game name)
local GameLicenseCache = {}

-- Path to the cache file (primary)
local CACHE_FILE_PATH = millennium.steam_path() .. "/plugins/gratitude/gratitude_license_cache.json"

-- Fallback path in case folder is renamed
local CACHE_FILE_PATH_FALLBACK = millennium.steam_path() .. "/plugins/gratitude_license_cache.json"

-- Path to the consent file (primary)
local CONSENT_FILE_PATH = millennium.steam_path() .. "/plugins/gratitude/gratitude_consent.json"
-- Fallback path in case folder is renamed
local CONSENT_FILE_PATH_FALLBACK = millennium.steam_path() .. "/plugins/gratitude_consent.json"

-- Consent state (per Steam ID)
local consentState = {}

-- Helper function to count table entries
local function table_size(t)
    local count = 0
    for _ in pairs(t) do
        count = count + 1
    end
    return count
end

-- Helper function to try opening a file, with fallback path
-- While the folder from the release zip is "gratitude", some users may rename it
-- The fallback will work no matter what the folder is renamed to.
local function open_file_with_fallback(primary_path, fallback_path, mode)
    logger:info("Attempting to open file: " .. primary_path .. " with fallback: " .. fallback_path)
    local file, err = io.open(primary_path, mode)
    if file then
        return file, primary_path
    end
    logger:info("Failed to open primary path: " .. tostring(err))

    -- If opening primary path failed, try fallback
    file, err = io.open(fallback_path, mode)
    if file then
        logger:info("Using fallback path: " .. fallback_path)
        return file, fallback_path
    end

    return nil, nil -- Both failed
end

-- Helper function to get active path (primary or fallback)
local function get_active_path(primary_path, fallback_path)
    -- Check if fallback exists
    local fallback_file = io.open(fallback_path, "r")
    if fallback_file then
        fallback_file:close()
        -- Fallback exists, check if primary also exists
        local primary_file = io.open(primary_path, "r")
        if primary_file then
            primary_file:close()
            return primary_path -- Both exist, prefer primary
        end
        return fallback_path -- Only fallback exists, use it
    end

    -- Fallback doesn't exist, always use primary (whether it exists or not)
    return primary_path
end

-- Save cache to file
-- Uses atomic write (write to temp file, then rename) to avoid corruption if
-- Steam crashes or closes during write
local function save_cache_to_file()
    local targetPath = get_active_path(CACHE_FILE_PATH, CACHE_FILE_PATH_FALLBACK)
    local tempPath = targetPath .. ".tmp"

    local file, err = io.open(tempPath, "w")
    if not file then
        logger:error("Failed to open temp cache file for writing: " .. tostring(err))
        return false
    end

    file:write(json.encode(GameLicenseCache))
    file:close()

    os.rename(tempPath, targetPath)
    logger:info("Cache saved successfully")
    return true
end

-- Load cache from file
local function load_cache_from_file()
    local file, path = open_file_with_fallback(CACHE_FILE_PATH, CACHE_FILE_PATH_FALLBACK, "r")
    if not file then
        logger:info("Cache file doesn't exist yet (first run or no data cached)")
        return false
    end

    local content = file:read("*all")
    file:close()

    if content and #content > 0 then
        local ok, decoded = pcall(json.decode, content)
        if not ok then
            logger:error("Failed to decode cache file JSON: " .. tostring(decoded))
            return false
        end
        if decoded then
            GameLicenseCache = decoded
            logger:info("Cache loaded successfully from " .. path .. " with " .. tostring(table_size(GameLicenseCache)) .. " users")
            return true
        else
            logger:error("Failed to decode cache file JSON")
        end
    end

    return false
end

-- Function to be called from frontend to set license data
-- @param licenseData string - JSON string of license data array ([]{date, item, acquisition})
-- @param steamUserID string - Steam ID of the user
function SetGameLicenseData(licenseData, steamUserID)
    assert(type(licenseData) == "string", "licenseData must be a string")
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if #licenseData == 0 then
        logger:error("No license data provided")
        return false, "No license data provided"
    end

    if steamUserID == "" then
        logger:error("No Steam ID provided")
        return false, "Steam ID not provided"
    end

    logger:info("SetGameLicenseData called with data length: " .. tostring(#licenseData) .. " for Steam ID: " .. steamUserID)

    local decodedData = json.decode(licenseData)
    if decodedData then
        -- Convert array to hash map indexed by game name for O(1) lookups
        GameLicenseCache[steamUserID] = {}
        for _, license in ipairs(decodedData) do
            if license.item then
                GameLicenseCache[steamUserID][license.item] = {
                    date = license.date,
                    acquisition = license.acquisition
                }
            end
        end

        logger:info(string.format("Cached %d license entries for user %s", #decodedData, steamUserID))

        -- Only save if user has consented
        if consentState[steamUserID] and consentState[steamUserID].allowed then
            save_cache_to_file()
        else
            logger:info("User " .. steamUserID .. " has not given consent, skipping cache save")
        end
    else
        logger:error("Failed to decode license data JSON")
        return false, "Failed to decode license data JSON"
    end

    return true
end

-- Retrieve entire license cache as JSON (for specific user)
function GetGameLicenseData(steamUserID)
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if steamUserID == "" or not GameLicenseCache[steamUserID] then
        logger:info("GameLicenseCache is empty for Steam ID " .. steamUserID)
        return "{}"
    end

    logger:info("Returning " .. table_size(GameLicenseCache[steamUserID]) .. " entries for Steam ID " .. steamUserID)
    return json.encode(GameLicenseCache[steamUserID])
end

-- Check if the license cache is populated (for specific user)
-- Used by frontend to distinguish between empty cache and cache misses
function IsGameLicenseCachePopulated(steamUserID)
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if steamUserID == "" then
        logger:info("No Steam ID provided")
        return false
    end

    if GameLicenseCache[steamUserID] and next(GameLicenseCache[steamUserID]) ~= nil then
        logger:info("GameLicenseCache is populated for Steam ID " .. steamUserID)
        return true
    end
    logger:info("GameLicenseCache is empty for Steam ID " .. steamUserID)
    return false
end

-- Clear cache entries for a specific user (both in-memory and on disk)
function ClearCache(steamUserID)
    assert(type(steamUserID) == "string", "steamUserID must be a string")
    logger:info("ClearCache called for Steam ID: " .. steamUserID)

    GameLicenseCache[steamUserID] = nil
    save_cache_to_file()

    logger:info("Cache cleared for Steam ID: " .. steamUserID)
    return true
end

-- Save consent state to file
-- Uses atomic write (write to temp file, then rename) to avoid corruption if
-- Steam crashes or closes during write
local function save_consent_to_file()
    local targetPath = get_active_path(CONSENT_FILE_PATH, CONSENT_FILE_PATH_FALLBACK)
    local tempPath = targetPath .. ".tmp"

    local file, err = io.open(tempPath, "w")
    if not file then
        logger:error("Failed to open temp consent file for writing: " .. tostring(err))
        return false
    end

    file:write(json.encode(consentState))
    file:close()

    os.rename(tempPath, targetPath)
    logger:info("Consent state saved successfully")
    return true
end

-- Load consent state from file
local function load_consent_from_file()
    local file, path = open_file_with_fallback(CONSENT_FILE_PATH, CONSENT_FILE_PATH_FALLBACK, "r")
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
            logger:info("Consent state loaded from " .. path)
            return true
        else
            logger:error("Failed to decode consent file JSON")
        end
    end

    return false
end

-- Store user consent decision (called from frontend)
function SetConsent(consent, steamUserID)
    assert(type(consent) == "boolean", "consent must be a boolean")
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if steamUserID == "" then
        logger:error("No Steam ID provided")
        return false
    end

    logger:info("SetConsent called for user " .. steamUserID .. " with allowed=" .. tostring(consent))

    if not consentState[steamUserID] then
        consentState[steamUserID] = {}
    end

    consentState[steamUserID].allowed = consent
    consentState[steamUserID].timestamp = os.time()
    save_consent_to_file()
    return true
end

-- Check if user has already given consent
-- Returns nil if user hasn't been asked yet, true/false if they have
function HasUserConsented(steamUserID)
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if steamUserID == "" then
        logger:info("Cannot check consent: No Steam ID provided")
        return nil
    end

    if consentState[steamUserID] then
        logger:info("HasUserConsented called for user " .. steamUserID .. ", returning: " .. tostring(consentState[steamUserID].allowed))
        return consentState[steamUserID].allowed
    end

    return false
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