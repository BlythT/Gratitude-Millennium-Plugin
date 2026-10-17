local logger = require("logger")
local millennium = require("millennium")
local json = require("json")
local io = require("io")
local fs = require("fs")
local utils = require("utils")

local JsonStore = require("lib.JsonStore")
local cache_merger = require("lib.cache_merger")
local friends_compare = require("lib.friends_compare")
local log_redact = require("lib.log_redact")

local cacheStore = JsonStore.new("gratitude_cache.json", "Game license cache")
local consentStore = JsonStore.new("gratitude_consent.json", "Consent state")
local giverStore = JsonStore.new("gratitude_givers.json", "Giver store")
local friendsStore = JsonStore.new("gratitude_friends.json", "Friends cache")
local settingsStore = JsonStore.new("gratitude_settings.json", "Settings store")

-- Global caches (in-memory)
local GameLicenseCache = {}
local consentState = {}
local GiverStore = {}
local FriendsCacheStore = {}
local SettingsStore = {}

-- Helper function to count table entries
local function table_size(t)
    local count = 0
    for _ in pairs(t) do
        count = count + 1
    end
    return count
end

local function has_storage_consent(steamUserID)
    local consent = consentState[steamUserID]
    return type(consent) == "table" and consent.allowed == true
end

-- Shallow copy holding only consented accounts; unconsented data stays in memory for the session
local function consented_accounts(store)
    local filtered = {}
    for steamUserID, accountData in pairs(store) do
        if has_storage_consent(steamUserID) then
            filtered[steamUserID] = accountData
        end
    end
    return filtered
end

-- Consent that couldn't be read at load makes every account look unconsented, so saving would
-- drop them all from disk; the save is refused until a later session reads consent
local function save_consented_accounts(store, accounts)
    local consentUnknownReason = consentStore.save_blocked_reason
    if consentUnknownReason then
        local reason = "consent state is unknown: " .. consentUnknownReason
        logger:error(store.description .. " not saved, " .. reason)
        return false, reason
    end
    return store:save(consented_accounts(accounts))
end

local function save_cache_to_file()
    return save_consented_accounts(cacheStore, GameLicenseCache)
end

local function load_cache_from_file()
    local loadedCache = cacheStore:load(nil)
    if loadedCache and next(loadedCache) ~= nil then
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
    return false
end

local function save_consent_to_file()
    return consentStore:save(consentState)
end

local function load_consent_from_file()
    local loaded = consentStore:load(nil)
    if loaded and next(loaded) ~= nil then
        consentState = loaded
        return true
    end
    return false
end

local function save_givers_to_file()
    return giverStore:save(GiverStore)
end

local function load_givers_from_file()
    local loaded = giverStore:load(nil)
    if loaded and next(loaded) ~= nil then
        GiverStore = loaded
        return true
    end
    return false
end

local function save_friends_to_file()
    return save_consented_accounts(friendsStore, FriendsCacheStore)
end

local function load_friends_from_file()
    local loaded = friendsStore:load(nil)
    if loaded and next(loaded) ~= nil then
        FriendsCacheStore = loaded
        return true
    end
    return false
end

local function save_settings_to_file()
    return settingsStore:save(SettingsStore)
end

local function load_settings_from_file()
    local loaded = settingsStore:load(nil)
    if loaded and next(loaded) ~= nil then
        SettingsStore = loaded
        return true
    end
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

    local existingRecord = GiverStore[steamUserID] and GiverStore[steamUserID][payload.licenseKey]
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

    logger:info("SetGameLicenseData called with data length: " .. -- log-privacy: allow=licenseData #licenseData is a length
        tostring(#licenseData) .. " for Steam ID: " .. log_redact.mask_id(steamUserID))

    local success, decodedData = pcall(json.decode, licenseData)
    if not success then
        logger:error("Failed to decode license data JSON: " .. tostring(decodedData))
        return false, "Failed to decode license data JSON"
    end

    if decodedData then
        local currentCache = GameLicenseCache[steamUserID]
        local updatedCache, byAppIdSize, byNameSize, isNewFormat = cache_merger.merge_license_page(currentCache, decodedData)
        GameLicenseCache[steamUserID] = updatedCache
        
        if isNewFormat then
            logger:info(string.format("Cached %d byAppId and %d byName license entries for user %s", byAppIdSize, byNameSize, log_redact.mask_id(steamUserID)))
        else
            logger:info(string.format("Cached %d license entries in legacy format for user %s", byNameSize, log_redact.mask_id(steamUserID)))
        end

        -- Only save if user has consented
        if has_storage_consent(steamUserID) then
            save_cache_to_file()
        else
            logger:info("User " .. log_redact.mask_id(steamUserID) .. " has not given consent, skipping cache save")
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
        logger:info("GameLicenseCache is empty for Steam ID " .. log_redact.mask_id(steamUserID))
        return "{}"
    end

    logger:info("Returning " .. table_size(GameLicenseCache[steamUserID]) .. " entries for Steam ID " .. log_redact.mask_id(steamUserID)) -- log-privacy: allow=steamUserID,GameLicenseCache the lookup only counts entries
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
            logger:info("GameLicenseCache is populated for Steam ID " .. log_redact.mask_id(steamUserID))
            return true
        end
    end
    logger:info("GameLicenseCache is empty for Steam ID " .. log_redact.mask_id(steamUserID))
    return false
end

-- Clear cache entries for a specific user (both in-memory and on disk)
function ClearCache(steamUserID)
    assert(type(steamUserID) == "string", "steamUserID must be a string")
    logger:info("ClearCache called for Steam ID: " .. log_redact.mask_id(steamUserID))

    -- A clear that didn't reach disk is undone, so memory matches the disk and the frontend, which
    -- keeps its copy when a clear fails
    local previousCache = GameLicenseCache[steamUserID]
    GameLicenseCache[steamUserID] = nil
    if not save_cache_to_file() then
        GameLicenseCache[steamUserID] = previousCache
        return false
    end

    logger:info("Cache cleared for Steam ID: " .. log_redact.mask_id(steamUserID))
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

    logger:info("SetConsent called for user " .. log_redact.mask_id(steamUserID) .. " with allowed=" .. tostring(consent))

    local previousConsent = consentState[steamUserID]
    consentState[steamUserID] = {
        allowed = consent,
        timestamp = os.time(),
    }

    if not save_consent_to_file() then
        consentState[steamUserID] = previousConsent
        return false
    end

    -- Persist what was scraped before consent; failures are logged by the store and don't change the result
    if consent then
        save_cache_to_file()
        save_friends_to_file()
    end

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
        local consented = has_storage_consent(steamUserID)
        logger:info("HasUserConsented called for user " .. log_redact.mask_id(steamUserID) .. ", returning: " .. tostring(consented))
        return consented
    end

    return nil
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
        logger:info("No giver record found for user " .. log_redact.mask_id(steamUserID) .. " and license " .. log_redact.safe_license_key(licenseKey))
        return "{}"
    end

    return json.encode(accountStore[licenseKey])
end

function GetAllGiverData(steamUserID)
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if steamUserID == "" or not GiverStore[steamUserID] then
        logger:info("No giver records found for Steam ID " .. log_redact.mask_id(steamUserID))
        return "{}"
    end

    logger:info("Returning " .. tostring(table_size(GiverStore[steamUserID])) .. " giver records for Steam ID " .. log_redact.mask_id(steamUserID)) -- log-privacy: allow=steamUserID,GiverStore the lookup only counts entries
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
        logger:error("Failed to decode giver payload JSON: " .. tostring(decodedPayload)) -- log-privacy: allow=decodedPayload holds cjson error text, which gives a position, not the input
        return false, "Failed to decode giver payload JSON"
    end

    local normalizedPayload, errorMessage = normalize_giver_payload(decodedPayload, steamUserID)
    if not normalizedPayload then
        logger:error("Invalid giver payload: " .. tostring(errorMessage))
        return false, errorMessage
    end

    local accountExisted = GiverStore[steamUserID] ~= nil
    local accountStore = ensure_account_store(GiverStore, steamUserID)
    local previousRecord = accountStore[normalizedPayload.licenseKey]
    accountStore[normalizedPayload.licenseKey] = normalizedPayload

    if not save_givers_to_file() then
        accountStore[normalizedPayload.licenseKey] = previousRecord
        if not accountExisted then
            GiverStore[steamUserID] = nil
        end
        return false, "Failed to save giver store"
    end

    logger:info("Upserted giver record for user " .. log_redact.mask_id(steamUserID) .. " and license " .. log_redact.safe_license_key(normalizedPayload.licenseKey))
    return true
end

function DeleteGiverData(licenseKey, steamUserID)
    assert(type(licenseKey) == "string", "licenseKey must be a string")
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if steamUserID == "" or licenseKey == "" then
        logger:error("Steam ID and license key are required to delete giver data")
        return false
    end

    logger:info("DeleteGiverData called for user " .. log_redact.mask_id(steamUserID) .. " and license " .. log_redact.safe_license_key(licenseKey))

    local accountStore = GiverStore[steamUserID]
    logger:info("Current giver store account exists before delete=" .. tostring(accountStore ~= nil)) -- log-privacy: allow=accountStore logs only whether it exists
    if accountStore then
        logger:info("Current giver store entry count before delete=" .. tostring(table_size(accountStore))) -- log-privacy: allow=accountStore logs only a count
    end

    local hadRecord = GiverStore[steamUserID] and GiverStore[steamUserID][licenseKey] ~= nil
    local previousRecord = accountStore and accountStore[licenseKey]
    if GiverStore[steamUserID] then
        GiverStore[steamUserID][licenseKey] = nil
        if next(GiverStore[steamUserID]) == nil then
            GiverStore[steamUserID] = nil
        end
    end

    if not save_givers_to_file() then
        if accountStore then
            accountStore[licenseKey] = previousRecord
            GiverStore[steamUserID] = accountStore
        end
        return false
    end

    local stillExists = GiverStore[steamUserID] and GiverStore[steamUserID][licenseKey] ~= nil
    local remainingCount = GiverStore[steamUserID] and table_size(GiverStore[steamUserID]) or 0

    logger:info("Deleted giver record for user " .. log_redact.mask_id(steamUserID) .. " and license " .. log_redact.safe_license_key(licenseKey) ..
        ", existed before delete=" .. tostring(hadRecord) ..
        ", still exists after delete=" .. tostring(stillExists) ..
        ", remaining account entries=" .. tostring(remainingCount))
    return true
end

function GetFriendsCache(steamUserID)
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if steamUserID == "" or not FriendsCacheStore[steamUserID] then
        logger:info("No friends cache found for Steam ID " .. log_redact.mask_id(steamUserID))
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
        logger:error("Failed to decode friends payload JSON: " .. tostring(decodedFriends)) -- log-privacy: allow=decodedFriends holds cjson error text, which gives a position, not the input
        return false, "Failed to decode friends payload JSON"
    end

    local normalizedFriends, errorMessage = normalize_friend_rows(decodedFriends)
    if not normalizedFriends then
        logger:error("Invalid friends payload: " .. tostring(errorMessage))
        return false, errorMessage
    end

    -- Accepted trade-off: if the last friends save failed, memory already holds this list, so an
    -- unchanged sync skips the retry. The next friends save of any kind, or the next session,
    -- catches up, and the friends cache can always be rebuilt from Steam Community.
    local existing = FriendsCacheStore[steamUserID]
    if existing and friends_compare.same_friends(existing.friends, normalizedFriends) then
        logger:info("Friends list unchanged, skipping friends cache save")
        return true
    end

    FriendsCacheStore[steamUserID] = {
        friends = normalizedFriends,
        updatedAt = os.time(),
    }

    if not has_storage_consent(steamUserID) then
        logger:info("Account has not given storage consent, skipping friends cache save")
        return true
    end

    if not save_friends_to_file() then
        return false, "Failed to save friends cache"
    end

    logger:info("Stored " .. tostring(#normalizedFriends) .. " friends for user " .. log_redact.mask_id(steamUserID)) -- log-privacy: allow=normalizedFriends logs only a count
    return true
end

function ClearFriendsCache(steamUserID)
    assert(type(steamUserID) == "string", "steamUserID must be a string")

    if steamUserID == "" then
        logger:error("No Steam ID provided for ClearFriendsCache")
        return false
    end

    -- Undone on a failed save, as in ClearCache
    local previousFriends = FriendsCacheStore[steamUserID]
    FriendsCacheStore[steamUserID] = nil

    if not save_friends_to_file() then
        FriendsCacheStore[steamUserID] = previousFriends
        return false
    end

    logger:info("Cleared friends cache for Steam ID: " .. log_redact.mask_id(steamUserID))
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
        logger:error("Failed to decode settings payload JSON: " .. tostring(decodedPayload)) -- log-privacy: allow=decodedPayload holds cjson error text, which gives a position, not the input
        return false, "Failed to decode settings payload JSON"
    end

    local steamUserID, normalizedSettingsOrError = normalize_settings_payload(decodedPayload)
    if not steamUserID then
        logger:error("Invalid settings payload: " .. tostring(normalizedSettingsOrError))
        return false, normalizedSettingsOrError
    end

    local previousSettings = SettingsStore[steamUserID]
    SettingsStore[steamUserID] = normalizedSettingsOrError

    if not save_settings_to_file() then
        SettingsStore[steamUserID] = previousSettings
        return false, "Failed to save settings store"
    end

    logger:info("Saved UI settings for Steam ID " .. log_redact.mask_id(steamUserID))
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

    -- TODO: Remove these manual hooks once Millennium commit 84d912263ba08f07b101957481c98cb5ff7ffbb4 is released.
    -- An earlier Millennium update unintentionally broke automatic WebKit injection for Steam URLs by excluding 
    -- them from `is_valid_target_url`. Until the upstream fix is released, we must manually hook the Store and 
    -- Community pages to ensure our WebKit scripts are loaded.
    millennium.add_browser_js("", ".*store\\.steampowered\\.com.*")
    millennium.add_browser_js("", ".*steamcommunity\\.com.*")

    logger:info("Gratitude plugin loaded with Millennium version " .. millennium.version())
    millennium.ready()
end

-- Called when your plugin is unloaded. This happens when the plugin is disabled or Steam is shutting down.
-- Deliberately no save here: Millennium also calls this when Steam's process dies, while the Lua host
-- is being killed, and every change is already saved when it is made.
local function on_unload()
    logger:info("Plugin unloaded")
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
