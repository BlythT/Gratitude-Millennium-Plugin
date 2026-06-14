local logger = require("logger")
local millennium = require("millennium")
local json = require("json")
local io = require("io")
local fs = require("fs")
local utils = require("utils")

local CACHE_FILE_PATH = fs.join(utils.get_backend_path(), "gratitude_cache.json")
local CONSENT_FILE_PATH = fs.join(utils.get_backend_path(), "gratitude_consent.json")
local GIVER_FILE_PATH = fs.join(utils.get_backend_path(), "gratitude_givers.json")
local FRIENDS_FILE_PATH = fs.join(utils.get_backend_path(), "gratitude_friends.json")
local SETTINGS_FILE_PATH = fs.join(utils.get_backend_path(), "gratitude_settings.json")

-- Global cache for license data (indexed by Steam ID, then game name)
-- Structure: { [steamUserID] = { [gameName] = { date, acquisition }, [gameName2] = { ... } }, ... }    
local GameLicenseCache = {}

-- Consent state (per Steam ID)
local consentState = {}

-- Giver metadata keyed by Steam ID, then license key
local GiverStore = {}

-- Cached Steam friends keyed by Steam ID
local FriendsCacheStore = {}

-- UI settings keyed by Steam ID
local SettingsStore = {}

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
        -- Migrate to new structure if needed
        GameLicenseCache = {}
        for steamUserID, userCache in pairs(loadedCache) do
            if type(userCache) == "table" then
                if userCache.byAppId or userCache.byName then
                    GameLicenseCache[steamUserID] = {
                        byAppId = userCache.byAppId or {},
                        byName = userCache.byName or {}
                    }
                else
                    -- Migrate old name-only cache
                    GameLicenseCache[steamUserID] = {
                        byAppId = {},
                        byName = userCache
                    }
                end
            end
        end
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

local function save_givers_to_file()
    return save_json(GIVER_FILE_PATH, GiverStore, "Giver store")
end

local function load_givers_from_file()
    local loadedGivers = load_json(GIVER_FILE_PATH, "Giver store")
    if loadedGivers then
        logger:info("Giver store loaded successfully from file")
        GiverStore = loadedGivers
        return true
    end
    logger:info("Load failed or no existing giver store found, starting with empty giver store")
    return false
end

local function save_friends_to_file()
    return save_json(FRIENDS_FILE_PATH, FriendsCacheStore, "Friends cache")
end

local function load_friends_from_file()
    local loadedFriends = load_json(FRIENDS_FILE_PATH, "Friends cache")
    if loadedFriends then
        logger:info("Friends cache loaded successfully from file")
        FriendsCacheStore = loadedFriends
        return true
    end
    logger:info("Load failed or no existing friends cache found, starting with empty friends cache")
    return false
end

local function save_settings_to_file()
    return save_json(SETTINGS_FILE_PATH, SettingsStore, "Settings store")
end

local function load_settings_from_file()
    local loadedSettings = load_json(SETTINGS_FILE_PATH, "Settings store")
    if loadedSettings then
        logger:info("Settings store loaded successfully from file")
        SettingsStore = loadedSettings
        return true
    end
    logger:info("Load failed or no existing settings store found, starting with empty settings store")
    return false
end

local function ensure_account_store(store, steamUserID)
    if not store[steamUserID] then
        store[steamUserID] = {}
    end

    return store[steamUserID]
end

local function validate_required_string(value, fieldName)
    if type(value) ~= "string" or value == "" then
        return false, fieldName .. " must be a non-empty string"
    end

    return true
end

local function normalize_giver_payload(payload, steamUserID)
    if type(payload) ~= "table" then
        return nil, "giver payload must decode to a table"
    end

    local requiredFields = { "licenseKey", "libraryTitle", "displayName", "source" }
    for _, fieldName in ipairs(requiredFields) do
        local ok, message = validate_required_string(payload[fieldName], fieldName)
        if not ok then
            return nil, message
        end
    end

    if payload.source ~= "manual" and payload.source ~= "friend-cache" then
        return nil, "source must be manual or friend-cache"
    end

    local accountStore = ensure_account_store(GiverStore, steamUserID)
    local existingRecord = accountStore[payload.licenseKey]
    local now = os.time()

    local normalized = {
        licenseKey = payload.licenseKey,
        libraryTitle = payload.libraryTitle,
        displayName = payload.displayName,
        source = payload.source,
        createdAt = existingRecord and existingRecord.createdAt or now,
        updatedAt = now,
    }

    if type(payload.steamID64) == "string" and payload.steamID64 ~= "" then
        normalized.steamID64 = payload.steamID64
    end

    if type(payload.profileUrl) == "string" and payload.profileUrl ~= "" then
        normalized.profileUrl = payload.profileUrl
    end

    if type(payload.notes) == "string" and payload.notes ~= "" then
        normalized.notes = payload.notes
    end

    return normalized
end

local function normalize_friend_rows(decodedFriends)
    if type(decodedFriends) ~= "table" then
        return nil, "friends payload must decode to an array"
    end

    local normalizedFriends = {}
    local now = os.time()

    for _, friend in ipairs(decodedFriends) do
        if type(friend) == "table" and type(friend.steamID64) == "string" and friend.steamID64 ~= "" and
            type(friend.displayName) == "string" and friend.displayName ~= "" then
            local normalizedFriend = {
                steamID64 = friend.steamID64,
                displayName = friend.displayName,
                updatedAt = now,
            }

            if type(friend.profileUrl) == "string" and friend.profileUrl ~= "" then
                normalizedFriend.profileUrl = friend.profileUrl
            end

            if type(friend.nicknameOrAlias) == "string" and friend.nicknameOrAlias ~= "" then
                normalizedFriend.nicknameOrAlias = friend.nicknameOrAlias
            end

            if type(friend.avatarUrl) == "string" and friend.avatarUrl ~= "" then
                normalizedFriend.avatarUrl = friend.avatarUrl
            end

            table.insert(normalizedFriends, normalizedFriend)
        else
            logger:error("Skipping invalid friend record in SetFriendsCache")
        end
    end

    return normalizedFriends
end

local function normalize_settings_payload(decodedPayload)
    if type(decodedPayload) ~= "table" then
        return nil, "settings payload must decode to a table"
    end

    local ok, message = validate_required_string(decodedPayload.steamUserID, "steamUserID")
    if not ok then
        return nil, message
    end

    if type(decodedPayload.settings) ~= "table" then
        return nil, "settings must be a table"
    end

    local normalized = {
        showFriendPickerSteamUrl = decodedPayload.settings.showFriendPickerSteamUrl == true
    }

    return decodedPayload.steamUserID, normalized
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
        if type(decodedData) == "table" and (decodedData.byAppId or decodedData.byName) then
            GameLicenseCache[steamUserID] = {
                byAppId = decodedData.byAppId or {},
                byName = decodedData.byName or {}
            }
            local byAppIdSize = table_size(GameLicenseCache[steamUserID].byAppId)
            local byNameSize = table_size(GameLicenseCache[steamUserID].byName)
            logger:info(string.format("Cached %d byAppId and %d byName license entries for user %s", byAppIdSize, byNameSize, steamUserID))
        else
            -- Fallback for old format (flat array)
            GameLicenseCache[steamUserID] = {
                byAppId = {},
                byName = {}
            }
            for _, license in ipairs(decodedData) do
                if license.item then
                    GameLicenseCache[steamUserID].byName[license.item] = {
                        date = license.date,
                        acquisition = license.acquisition
                    }
                end
            end
            local byNameSize = table_size(GameLicenseCache[steamUserID].byName)
            logger:info(string.format("Cached %d license entries in legacy format for user %s", byNameSize, steamUserID))
        end

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

    local cache = GameLicenseCache[steamUserID]
    if cache then
        local hasAppIds = cache.byAppId and next(cache.byAppId) ~= nil
        local hasNames = cache.byName and next(cache.byName) ~= nil
        if hasAppIds or hasNames then
            logger:info("GameLicenseCache is populated for Steam ID " .. steamUserID)
            return true
        end
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

function GetGiverData(licenseKey, steamUserID)
    assert(type(licenseKey) == "string", "licenseKey must be a string")
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if steamUserID == "" or licenseKey == "" then
        logger:info("Cannot get giver data without Steam ID and license key")
        return "{}"
    end

    local accountStore = GiverStore[steamUserID]
    if not accountStore or not accountStore[licenseKey] then
        logger:info("No giver record found for user " .. steamUserID .. " and license " .. licenseKey)
        return "{}"
    end

    return json.encode(accountStore[licenseKey])
end

function GetAllGiverData(steamUserID)
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if steamUserID == "" or not GiverStore[steamUserID] then
        logger:info("No giver records found for Steam ID " .. steamUserID)
        return "{}"
    end

    logger:info("Returning " .. tostring(table_size(GiverStore[steamUserID])) .. " giver records for Steam ID " .. steamUserID)
    return json.encode(GiverStore[steamUserID])
end

function UpsertGiverData(payloadJson, steamUserID)
    assert(type(payloadJson) == "string", "payloadJson must be a string")
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if payloadJson == "" then
        logger:error("No giver payload provided")
        return false, "No giver payload provided"
    end

    if steamUserID == "" then
        logger:error("No Steam ID provided for giver upsert")
        return false, "Steam ID not provided"
    end

    local success, decodedPayload = pcall(json.decode, payloadJson)
    if not success then
        logger:error("Failed to decode giver payload JSON: " .. tostring(decodedPayload))
        return false, "Failed to decode giver payload JSON"
    end

    local normalizedPayload, errorMessage = normalize_giver_payload(decodedPayload, steamUserID)
    if not normalizedPayload then
        logger:error("Invalid giver payload: " .. tostring(errorMessage))
        return false, errorMessage
    end

    local accountStore = ensure_account_store(GiverStore, steamUserID)
    accountStore[normalizedPayload.licenseKey] = normalizedPayload

    if not save_givers_to_file() then
        return false, "Failed to save giver store"
    end

    logger:info("Upserted giver record for user " .. steamUserID .. " and license " .. normalizedPayload.licenseKey)
    return true
end

function DeleteGiverData(licenseKey, steamUserID)
    assert(type(licenseKey) == "string", "licenseKey must be a string")
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if steamUserID == "" or licenseKey == "" then
        logger:error("Steam ID and license key are required to delete giver data")
        return false
    end

    logger:info("DeleteGiverData called for user " .. steamUserID .. " and license " .. licenseKey)

    local accountStore = GiverStore[steamUserID]
    logger:info("Current giver store account exists before delete=" .. tostring(accountStore ~= nil))
    if accountStore then
        logger:info("Current giver store entry count before delete=" .. tostring(table_size(accountStore)))
    end

    local hadRecord = GiverStore[steamUserID] and GiverStore[steamUserID][licenseKey] ~= nil
    if GiverStore[steamUserID] then
        GiverStore[steamUserID][licenseKey] = nil
        if next(GiverStore[steamUserID]) == nil then
            GiverStore[steamUserID] = nil
        end
    end

    if not save_givers_to_file() then
        return false
    end

    local stillExists = GiverStore[steamUserID] and GiverStore[steamUserID][licenseKey] ~= nil
    local remainingCount = GiverStore[steamUserID] and table_size(GiverStore[steamUserID]) or 0

    logger:info("Deleted giver record for user " .. steamUserID .. " and license " .. licenseKey ..
        ", existed before delete=" .. tostring(hadRecord) ..
        ", still exists after delete=" .. tostring(stillExists) ..
        ", remaining account entries=" .. tostring(remainingCount))
    return true
end

function GetFriendsCache(steamUserID)
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if steamUserID == "" or not FriendsCacheStore[steamUserID] then
        logger:info("No friends cache found for Steam ID " .. steamUserID)
        return "{}"
    end

    return json.encode(FriendsCacheStore[steamUserID])
end

function HasFriendsCache(steamUserID)
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if steamUserID == "" then
        logger:info("Cannot check friends cache without Steam ID")
        return false
    end

    return FriendsCacheStore[steamUserID] ~= nil
end

function SetFriendsCache(friendsJson, steamUserID)
    assert(type(friendsJson) == "string", "friendsJson must be a string")
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if friendsJson == "" then
        logger:error("No friends payload provided")
        return false, "No friends payload provided"
    end

    if steamUserID == "" then
        logger:error("No Steam ID provided for friends cache")
        return false, "Steam ID not provided"
    end

    local success, decodedFriends = pcall(json.decode, friendsJson)
    if not success then
        logger:error("Failed to decode friends payload JSON: " .. tostring(decodedFriends))
        return false, "Failed to decode friends payload JSON"
    end

    local normalizedFriends, errorMessage = normalize_friend_rows(decodedFriends)
    if not normalizedFriends then
        logger:error("Invalid friends payload: " .. tostring(errorMessage))
        return false, errorMessage
    end

    FriendsCacheStore[steamUserID] = {
        friends = normalizedFriends,
        updatedAt = os.time(),
    }

    if not save_friends_to_file() then
        return false, "Failed to save friends cache"
    end

    logger:info("Stored " .. tostring(#normalizedFriends) .. " friends for user " .. steamUserID)
    return true
end

function ClearFriendsCache(steamUserID)
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if steamUserID == "" then
        logger:error("No Steam ID provided for ClearFriendsCache")
        return false
    end

    FriendsCacheStore[steamUserID] = nil

    if not save_friends_to_file() then
        return false
    end

    logger:info("Cleared friends cache for Steam ID: " .. steamUserID)
    return true
end

function GetUiSettings(steamUserID)
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if steamUserID == "" then
        logger:info("No UI settings found without Steam ID")
        return "{}"
    end

    return json.encode(SettingsStore[steamUserID] or {})
end

function SetUiSettings(payloadJson)
    assert(type(payloadJson) == "string", "payloadJson must be a string")

    if payloadJson == "" then
        logger:error("No settings payload provided")
        return false, "No settings payload provided"
    end

    local success, decodedPayload = pcall(json.decode, payloadJson)
    if not success then
        logger:error("Failed to decode settings payload JSON: " .. tostring(decodedPayload))
        return false, "Failed to decode settings payload JSON"
    end

    local steamUserID, normalizedSettingsOrError = normalize_settings_payload(decodedPayload)
    if not steamUserID then
        logger:error("Invalid settings payload: " .. tostring(normalizedSettingsOrError))
        return false, normalizedSettingsOrError
    end

    SettingsStore[steamUserID] = normalizedSettingsOrError

    if not save_settings_to_file() then
        return false, "Failed to save settings store"
    end

    logger:info("Saved UI settings for Steam ID " .. steamUserID)
    return true
end

local function on_load()
    print("Gratitude plugin loaded")
    logger:info("Comparing millennium version: " .. millennium.cmp_version(millennium.version(), "2.29.3"))

    -- Load existing cache and consent data from disk
    load_cache_from_file()
    load_consent_from_file()
    load_givers_from_file()
    load_friends_from_file()
    load_settings_from_file()

    -- Millennium requires at least one network hook to inject webkit.js into a Target
    -- Register empty scripts for Store and Community pages so our Webkit script gets loaded
    -- millennium.add_browser_js("", ".*store\\.steampowered\\.com.*")
    -- millennium.add_browser_js("", ".*steamcommunity\\.com.*")

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
    save_givers_to_file()
    save_friends_to_file()
    save_settings_to_file()
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
