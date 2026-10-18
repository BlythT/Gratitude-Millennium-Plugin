-- Reads and saves millennium.config (Millennium 3.0.0 and later). Each moved store keeps one key
-- per account, "<prefix>.<accountId>", so every account gets its own 256 KB value. Key names can
-- never change after release, or users lose their data on update.
local logger = require("logger")
local json = require("json")
local millennium = require("millennium")
local log_redact = require("lib.log_redact")

local config_store = {}

-- The prefix of each moved store's keys. Permanent: renaming one hides every user's data.
config_store.GIVERS = "givers"
config_store.CONSENT = "consent"
config_store.SETTINGS = "settings"

-- Millennium's per value limit, measured on the compact JSON (src/bindings/plugin_config.cc)
config_store.VALUE_LIMIT = 262144

-- Every key and value, or nil and the error. A failed read must never lead to retiring a file.
function config_store.snapshot()
    local config = millennium.config
    if not config then
        return nil, "unavailable"
    end
    return config.get_all()
end

-- { [accountId] = value } for every "<prefix>.<accountId>" key in a snapshot
function config_store.accounts(snapshot, prefix)
    local key_prefix = prefix .. "."
    local accounts = {}
    for key, value in pairs(snapshot) do
        if type(key) == "string" and key:sub(1, #key_prefix) == key_prefix then
            local accountId = key:sub(#key_prefix + 1)
            if accountId:match("^[^.]+$") then
                accounts[accountId] = value
            end
        end
    end
    return accounts
end

-- Returns true, or false and "size_limit" or "save_failed". True only means Millennium's memory took
-- the value: a failed disk write is silent, which is why files are retired a session later.
function config_store.save(prefix, accountId, value)
    local masked_key = prefix .. "." .. log_redact.mask_id(accountId)
    -- A Steam account ID is a 32-bit number. Anything else would make a key accounts() never reads
    -- back, using up the plugin's 256 keys.
    if type(accountId) ~= "string" or not accountId:match("^%d+$") or #accountId > 10 then
        logger:error("Config value " .. masked_key .. " not saved: not a Steam account ID")
        return false, "save_failed"
    end
    local key = prefix .. "." .. accountId

    -- lua-cjson escapes "/" as "\/", so this check is slightly stricter than Millennium's
    local encoded_ok, encoded = pcall(json.encode, value)
    if not encoded_ok then
        logger:error("Config value " .. masked_key .. " not saved: could not encode it")
        return false, "save_failed"
    end
    if #encoded > config_store.VALUE_LIMIT then
        logger:warn("Config value " .. masked_key .. " not saved: " .. #encoded .. " bytes is over the limit")
        return false, "size_limit"
    end

    local saved, err = millennium.config.set(key, value)
    if saved then
        return true
    end
    local message = log_redact.replace_literal(err, key, masked_key)
    logger:error("Config value " .. masked_key .. " not saved: " .. message)
    if message:find("too large", 1, true) then
        return false, "size_limit"
    end
    return false, "save_failed"
end

-- Adds each source account that has no config key to data and, when persist is true, copies it
-- into config. Returns how many accounts lacked a key and how many of those were copied.
local function copy_missing(prefix, source, from_config, data, persist)
    local missing, copied = 0, 0
    for accountId, value in pairs(source) do
        if from_config[accountId] == nil then
            missing = missing + 1
            data[accountId] = value
            if persist and config_store.save(prefix, accountId, value) then
                copied = copied + 1
            end
        end
    end
    return missing, copied
end

-- Loads one moved store and moves its file data into config. options: prefix, store (its
-- JsonStore), snapshot (nil when config is unavailable), fallback_to_migrated. Returns the
-- in-memory data, where saves go ("config" or "file"), and the accounts that may be saved this
-- session (nil means all). Per account, config's key wins; an account only in the store file, or
-- only in the newest .migrated copy when the store file is gone, is copied into config. The store
-- file is retired only when every account in it already had its key at startup: a Steam start
-- reloads config.json, which proves a copy reached disk. A plugin reload reruns this against
-- Millennium's memory instead; if that run's writes never reached disk, gift records and settings
-- come back from .migrated at the next Steam start, and consent is asked again (accepted).
--
-- When a source couldn't be read, any write would create the account's key, and config's key
-- then hides the unread data for good. So that session nothing is copied into config, and only
-- accounts keyed at startup may be saved. When config exists but couldn't be read, or there is no
-- config and a .migrated copy couldn't be read, nothing may be saved.
function config_store.migrate(options)
    local prefix, store = options.prefix, options.store
    local file_data = store:load({})
    local file_gone = not store:exists()
    -- A file that is there but couldn't be opened or read may be healthy, so it is left alone
    local file_loaded = not file_gone and not store.save_blocked_reason
    local source_unread = store.save_blocked_reason ~= nil

    if not options.snapshot then
        local editable = millennium.config and {} or nil
        if file_gone and options.fallback_to_migrated then
            local migrated, migrated_unread = store:load_newest_migrated()
            return migrated or {}, "file", migrated_unread and {} or editable
        end
        return file_data, "file", editable
    end

    local from_config = config_store.accounts(options.snapshot, prefix)
    local data = {}
    for accountId, value in pairs(from_config) do
        data[accountId] = value
    end

    local missing, copied = 0, 0
    if file_loaded then
        missing, copied = copy_missing(prefix, file_data, from_config, data, true)
        if missing == 0 then
            store:retire()
        end
    elseif file_gone and options.fallback_to_migrated then
        local migrated, migrated_unread = store:load_newest_migrated()
        source_unread = source_unread or migrated_unread
        if migrated then
            missing, copied = copy_missing(prefix, migrated, from_config, data, not source_unread)
        end
    end

    if missing > 0 and source_unread then
        logger:info("Showing " .. missing .. " " .. prefix .. " accounts from an older copy without copying them into config")
    elseif missing > 0 then
        logger:info("Copied " .. copied .. " of " .. missing .. " " .. prefix .. " accounts into config")
    end
    if not source_unread then
        return data, "config", nil
    end
    local editable = {}
    for accountId in pairs(from_config) do
        editable[accountId] = true
    end
    logger:warn("Some " .. prefix .. " data couldn't be read, so only accounts already in config can be saved this session")
    return data, "config", editable
end

return config_store
