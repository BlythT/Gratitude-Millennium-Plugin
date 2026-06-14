local logger = require("logger")
local millennium = require("millennium")
local json = require("json")
local io = require("io")
local fs = require("fs")
local utils = require("utils")

local StoreManager = require("lib.framework.StoreManager")

local stores = {
    licenses = StoreManager.new("gratitude_cache.json", "Game license cache", true),
    consent = StoreManager.new("gratitude_consent.json", "Consent state", true),
    givers = StoreManager.new("gratitude_givers.json", "Giver store", true),
    friends = StoreManager.new("gratitude_friends.json", "Friends cache", true),
    settings = StoreManager.new("gratitude_settings.json", "Settings store", true)
}

function GetStoreData(steamUserID, storeName)
    assert(type(storeName) == "string", "storeName must be a string")
    assert(type(steamUserID) == "string", "steamUserID must be a string")
    
    local store = stores[storeName]
    if not store then
        logger:error("Invalid store name: " .. storeName)
        return "{}"
    end
    
    if steamUserID == "" then
        logger:info("No Steam ID provided for " .. storeName)
        return "{}"
    end
    
    local data = store:get(steamUserID)
    if not data then
        return "{}"
    end
    
    return json.encode(data)
end

function SetStoreData(payloadJson, steamUserID, storeName)
    assert(type(storeName) == "string", "storeName must be a string")
    assert(type(payloadJson) == "string", "payloadJson must be a string")
    assert(type(steamUserID) == "string", "steamUserID must be a string")
    
    local store = stores[storeName]
    if not store then
        logger:error("Invalid store name: " .. storeName)
        return false, "Invalid store name"
    end
    
    if steamUserID == "" then
        logger:error("No Steam ID provided")
        return false, "Steam ID not provided"
    end
    
    local success, decodedData = pcall(json.decode, payloadJson)
    if not success then
        logger:error("Failed to decode payload JSON for " .. storeName)
        return false, "Failed to decode JSON"
    end
    
    return store:set(steamUserID, decodedData)
end

function HasStoreData(steamUserID, storeName)
    assert(type(storeName) == "string", "storeName must be a string")
    assert(type(steamUserID) == "string", "steamUserID must be a string")
    
    local store = stores[storeName]
    if not store then
        logger:error("Invalid store name: " .. storeName)
        return false
    end
    
    if steamUserID == "" then
        return false
    end
    
    local data = store:get(steamUserID)
    -- If it's a boolean (like consent), return true if it's not nil
    if type(data) == "boolean" then
        return true
    end
    
    -- If it's a table, check if it has items
    if type(data) == "table" and next(data) ~= nil then
        return true
    end
    
    -- Other types (if any), return true
    if data ~= nil and type(data) ~= "table" then
        return true
    end
    
    return false
end

function ClearStoreData(steamUserID, storeName)
    assert(type(storeName) == "string", "storeName must be a string")
    assert(type(steamUserID) == "string", "steamUserID must be a string")
    
    local store = stores[storeName]
    if not store then
        logger:error("Invalid store name: " .. storeName)
        return false
    end
    
    if steamUserID == "" then
        return false
    end
    
    return store:clear(steamUserID)
end

local function on_load()
    print("Gratitude plugin loaded")
    logger:info("Comparing millennium version: " .. millennium.cmp_version(millennium.version(), "2.29.3"))

    -- Data migration logic
    local cacheData = gameLicenseStore:get()
    if cacheData and next(cacheData) ~= nil then
        for steamUserID, userCache in pairs(cacheData) do
            if type(userCache) == "table" then
                if not (userCache.byAppId or userCache.byName) then
                    -- Migrate old name-only cache
                    gameLicenseStore:set(steamUserID, {
                        byAppId = {},
                        byName = userCache
                    })
                end
            end
        end
    end

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
-- NOTE: If Steam crashes or is force closed by task manager, this function may not be called -- so don't rely on it for critical cleanup.
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
