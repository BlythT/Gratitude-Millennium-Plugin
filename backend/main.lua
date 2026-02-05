local logger = require("logger")
local millennium = require("millennium")
local json = require("json")
local io = require("io")
local fs = require("fs")
local utils = require("utils")

local CACHE_FILE_PATH = fs.join(utils.get_backend_path(), "gratitude_cache.json")
local CONSENT_FILE_PATH = fs.join(utils.get_backend_path(), "gratitude_consent.json")

-- Global cache for license data (indexed by Steam ID, then game name)
-- Structure: { [steamUserID] = { [gameName] = { date, acquisition }, [gameName2] = { ... } }, ... }    
local GameLicenseCache = {}

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

local function save_json(path, data, description)
    if not path then
        logger:error("No valid path provided for " .. description .. " file")
        return false
    end

    if fs.exists(path) then
        logger:info(description .. " file already exists at " .. path .. ", overwriting")
    else
        logger:info("Saving " .. description .. " to new file at " .. path)
    end

    -- Encode first - if this fails, we haven't touched the file yet
    local success, encoded = pcall(json.encode, data)
    if not success then
        logger:error("Failed to encode " .. description .. " data: " .. tostring(encoded))
        return false
    end

    local file, err = io.open(path, "w")
    if not file then
        logger:error("Failed to open " .. description .. " file for writing: " .. tostring(err))
        return false
    end

    -- Write the data and explicitly check for errors
    local write_success, write_err = pcall(function()
        file:write(encoded)
    end)

    file:close()

    if not write_success then
        logger:error("Failed to write " .. description .. " file: " .. tostring(write_err))
        return false
    end

    logger:info(description .. " saved successfully")
    return true
end

local function load_json(path, description)
    if not path then
        logger:error("No valid path provided for " .. description .. " file")
        return nil
    end

    if not fs.exists(path) then
        logger:info(description .. " file doesn't exist at " .. path)
        return nil
    end

    local file, err = io.open(path, "r")
    if not file then
        logger:error("Failed to open " .. description .. " file for reading: " .. tostring(err))
        return nil
    end

    local content = file:read("*all")
    file:close()

    if content and #content > 0 then
        local success, decoded = pcall(json.decode, content)
        if success then
            logger:info(description .. " loaded successfully from " .. path)
            return decoded
        else
            logger:error("Failed to decode " .. description .. " JSON: " .. tostring(decoded))
            return nil
        end
    else
        logger:info(description .. " file is empty at " .. path)
        return nil
    end
end

local function save_cache_to_file()
    return save_json(CACHE_FILE_PATH, GameLicenseCache, "Game license cache")
end

local function load_cache_from_file()
    local loadedCache = load_json(CACHE_FILE_PATH, "Game license cache")
    if loadedCache then
        logger:info("Game license cache loaded successfully from file")
        GameLicenseCache = loadedCache
        return true
    end
    logger:info("Load failed or no existing game license cache found, starting with empty cache")
    return false
end

local function save_consent_to_file()
    return save_json(CONSENT_FILE_PATH, consentState, "Consent state")
end

local function load_consent_from_file()
    local loadedConsent = load_json(CONSENT_FILE_PATH, "Consent state")
    if loadedConsent then
        logger:info("Consent state loaded successfully from file")
        consentState = loadedConsent
        return true
    end
    logger:info("Load failed or no existing consent state found, starting with empty consent state")
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

    logger:info("SetGameLicenseData called with data length: " ..
        tostring(#licenseData) .. " for Steam ID: " .. steamUserID)

    local success, decodedData = pcall(json.decode, licenseData)
    if not success then
        logger:error("Failed to decode license data JSON: " .. tostring(decodedData))
        return false, "Failed to decode license data JSON"
    end

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
        logger:info("HasUserConsented called for user " ..
            steamUserID .. ", returning: " .. tostring(consentState[steamUserID].allowed))
        return consentState[steamUserID].allowed
    end

    return false
end

local function on_load()
    print("Gratitude plugin loaded")
    logger:info("Comparing millennium version: " .. millennium.cmp_version(millennium.version(), "2.29.3"))

    -- Load existing cache and consent data from disk
    load_cache_from_file()
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
