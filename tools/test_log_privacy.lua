-- Tests that backend logs carry no personal data and no full file paths
local lu = require("luaunit")
local support = require("lua_test_support")
local json = require("cjson")
local JsonStore = require("lib.JsonStore")

TestLogPrivacy = {}

local realPrint = print

local TEMP_FOLDER = "home-zebedee"
local ACCOUNT = "1234569341"
local MASKED_ACCOUNT = "****9341"
local APP_ID = "220"
local LEGACY_KEY = "Secret Game Title"
local MISSING_KEY = "Another Secret Game"
local LIBRARY_TITLE = "Secret Library Title"
local GIFTER = "Zebedee Gifter"
local GIFTER_STEAMID64 = "76561198011112222"
local NOTE = "private note text"
local PROFILE_URL = "https://steamcommunity.com/id/zebedee-profile"
local FRIEND = "Quentin Friend"
local FRIEND_ALIAS = "Quentin Alias"
local FRIEND_STEAMID64 = "76561198033334444"
local FRIEND_AVATAR = "https://avatars.example/quentin.jpg"
local STORE_FILE = "gratitude_givers.json"

local PRIVATE_VALUES = {
    TEMP_FOLDER, ACCOUNT, LEGACY_KEY, MISSING_KEY, LIBRARY_TITLE, GIFTER, GIFTER_STEAMID64, NOTE,
    PROFILE_URL, FRIEND, FRIEND_ALIAS, FRIEND_STEAMID64, FRIEND_AVATAR,
}

function TestLogPrivacy:setUp()
    self.env = support.new_env({ prefix = TEMP_FOLDER })
    self.printed = {}
    print = function(...)
        table.insert(self.printed, table.concat({ ... }, " "))
    end
end

function TestLogPrivacy:tearDown()
    print = realPrint
    self.env.cleanup()
end

local function messages(test)
    local all = {}
    for _, entry in ipairs(test.env.logs) do
        table.insert(all, entry.message)
    end
    for _, line in ipairs(test.printed) do
        table.insert(all, line)
    end
    return all
end

-- Lists every message that names a private value, so a failure shows all of them at once
local function private_values_logged(test, extraValues)
    local values = { test.env.dir }
    for _, value in ipairs(PRIVATE_VALUES) do
        table.insert(values, value)
    end
    for _, value in ipairs(extraValues or {}) do
        table.insert(values, value)
    end

    local found = {}
    for _, message in ipairs(messages(test)) do
        for _, value in ipairs(values) do
            if message:find(value, 1, true) then
                table.insert(found, value .. " in: " .. message)
            end
        end
    end
    return found
end

local function any_message_contains(test, text)
    for _, message in ipairs(messages(test)) do
        if message:find(text, 1, true) then
            return true
        end
    end
    return false
end

local function license_page()
    return json.encode({
        byAppId = { [APP_ID] = { acquisition = "Gift/Guest Pass", date = "Mar 5, 2025" } },
        byName = { [LEGACY_KEY] = { acquisition = "Gift/Guest Pass", date = "Mar 6, 2025" } },
        totalLicenses = 2,
    })
end

local function giver_payload(licenseKey, overrides)
    local payload = {
        licenseKey = licenseKey,
        libraryTitle = LIBRARY_TITLE,
        displayName = GIFTER,
        steamID64 = GIFTER_STEAMID64,
        profileUrl = PROFILE_URL,
        notes = NOTE,
        source = "manual",
    }
    for key, value in pairs(overrides or {}) do
        payload[key] = value
    end
    return json.encode(payload)
end

local function friends_payload()
    return json.encode({
        {
            steamID64 = FRIEND_STEAMID64,
            displayName = FRIEND,
            profileUrl = PROFILE_URL,
            nicknameOrAlias = FRIEND_ALIAS,
            avatarUrl = FRIEND_AVATAR,
        },
        { steamID64 = FRIEND_STEAMID64, profileUrl = PROFILE_URL },
    })
end

local function settings_payload()
    return json.encode({ steamUserID = ACCOUNT, settings = { showFriendPickerSteamUrl = true } })
end

local function call_every_callable()
    HasUserConsented(ACCOUNT)
    SetGameLicenseData(license_page(), ACCOUNT)
    GetGameLicenseData(ACCOUNT)
    IsGameLicenseCachePopulated(ACCOUNT)
    UpsertGiverData(giver_payload(LEGACY_KEY), ACCOUNT)
    UpsertGiverData(giver_payload(APP_ID), ACCOUNT)
    GetGiverData(LEGACY_KEY, ACCOUNT)
    GetGiverData(MISSING_KEY, ACCOUNT)
    GetAllGiverData(ACCOUNT)
    SetFriendsCache(friends_payload(), ACCOUNT)
    GetFriendsCache(ACCOUNT)
    HasFriendsCache(ACCOUNT)
    SetUiSettings(settings_payload())
    GetUiSettings(ACCOUNT)
    DeleteGiverData(LEGACY_KEY, ACCOUNT)
    DeleteGiverData(APP_ID, ACCOUNT)
    ClearFriendsCache(ACCOUNT)
    ClearCache(ACCOUNT)
end

function TestLogPrivacy:test_callables_mask_accounts_and_drop_names()
    local backend = self.env.load_backend()
    backend.on_load()

    -- Before consent: license and friends data stay in memory and their saves are skipped
    SetGameLicenseData(license_page(), ACCOUNT)
    SetFriendsCache(friends_payload(), ACCOUNT)
    lu.assertTrue(SetConsent(true, ACCOUNT))
    call_every_callable()

    -- Error paths
    SetConsent(true, "")
    HasUserConsented("")
    SetGameLicenseData("", ACCOUNT)
    SetGameLicenseData(license_page(), "")
    SetGameLicenseData("{" .. LEGACY_KEY, ACCOUNT)
    UpsertGiverData(giver_payload(LEGACY_KEY, { source = "unknown" }), ACCOUNT)
    UpsertGiverData("{" .. GIFTER, ACCOUNT)
    UpsertGiverData(giver_payload(LEGACY_KEY), "")
    GetGiverData(LEGACY_KEY, "")
    DeleteGiverData(LEGACY_KEY, "")
    SetFriendsCache("{" .. FRIEND, ACCOUNT)
    SetFriendsCache(json.encode(FRIEND), ACCOUNT)
    SetUiSettings("{" .. ACCOUNT)
    SetUiSettings(json.encode({ settings = {} }))

    -- Failed saves, whose reasons reach the logs
    self.env.fail.open_write = "Permission denied"
    lu.assertFalse(SetConsent(false, ACCOUNT))
    lu.assertEquals(UpsertGiverData(giver_payload(LEGACY_KEY), ACCOUNT), "save_failed")
    lu.assertFalse(SetUiSettings(settings_payload()))
    lu.assertFalse(ClearFriendsCache(ACCOUNT))
    SetGameLicenseData(license_page(), ACCOUNT)
    self.env.fail.open_write = nil

    backend.on_unload()

    lu.assertEquals(private_values_logged(self), {})
    lu.assertTrue(any_message_contains(self, MASKED_ACCOUNT), "masked account ID logged")
    lu.assertTrue(any_message_contains(self, "license " .. APP_ID), "app ID logged as it is")
end

function TestLogPrivacy:test_unreadable_files_at_load_log_no_paths()
    self.env.write_file("gratitude_consent.json", '{"' .. ACCOUNT .. '":')
    self.env.write_file("gratitude_settings.json", "  ")
    self.env.write_file(STORE_FILE .. ".tmp", "{")
    self.env.write_file(STORE_FILE, json.encode({ [ACCOUNT] = { [APP_ID] = { displayName = GIFTER } } }))
    self.env.fail.open_read = "Permission denied"
    self.env.fail.only_path = "gratitude_friends"
    self.env.write_file("gratitude_friends.json", "{}")

    local backend = self.env.load_backend()
    backend.on_load()

    lu.assertEquals(private_values_logged(self), {})
    lu.assertTrue(any_message_contains(self, "gratitude_consent.json"), "store file named")
end

function TestLogPrivacy:test_store_logs_file_names_not_paths()
    self.env.freeze_time(1760000000)
    local store = JsonStore.new(STORE_FILE, "Giver store")

    store:load()
    lu.assertTrue(store:save({ a = 1 }))
    lu.assertTrue(store:save({ a = 2 }))
    store:load()
    self.env.write_file(STORE_FILE .. ".tmp", "{")
    self.env.write_file(STORE_FILE, "")
    store:load()
    self.env.write_file(STORE_FILE, '{"a":')
    JsonStore.new(STORE_FILE, "Giver store"):load()

    lu.assertEquals(private_values_logged(self), {})
    lu.assertTrue(any_message_contains(self, STORE_FILE), "store file named")
    lu.assertTrue(any_message_contains(self, STORE_FILE .. ".corrupted.1760000000"), "set-aside file named")
end

function TestLogPrivacy:test_failed_save_reasons_carry_no_paths()
    local store = JsonStore.new(STORE_FILE, "Giver store")
    local reasons = {}

    self.env.fail.open_write = "Permission denied"
    local saved, reason = store:save({ a = 1 })
    lu.assertFalse(saved)
    table.insert(reasons, reason)
    self.env.fail.open_write = nil

    self.env.fail.write = "No space left on device"
    saved, reason = store:save({ a = 1 })
    lu.assertFalse(saved)
    table.insert(reasons, reason)
    self.env.fail.write = nil

    self.env.fail.rename = { count = math.huge, message = "Access is denied" }
    saved, reason = store:save({ a = 1 })
    lu.assertFalse(saved)
    table.insert(reasons, reason)
    self.env.fail.rename = nil

    for _, text in ipairs(reasons) do
        table.insert(self.printed, text)
    end
    lu.assertEquals(private_values_logged(self), {})
    lu.assertStrContains(reasons[1], "Permission denied")
    lu.assertStrContains(reasons[1], STORE_FILE .. ".tmp")
end

-- The same promise with gift records, consent and settings in millennium.config: through the
-- migration, a key move from a title key, the note cap, refused saves and an unreadable config
function TestLogPrivacy:test_config_mode_logs_no_personal_data()
    local legacyRecord = {
        licenseKey = LEGACY_KEY, libraryTitle = LIBRARY_TITLE, displayName = GIFTER, notes = NOTE,
        profileUrl = PROFILE_URL, steamID64 = GIFTER_STEAMID64, source = "manual", createdAt = 1, updatedAt = 1,
    }
    local function start_session()
        local backend = self.env.load_backend()
        backend.on_load()
    end

    -- Copied into config, then retired in the next session
    self.env.config = support.new_fake_config()
    self.env.write_file(STORE_FILE, json.encode({ [ACCOUNT] = { [LEGACY_KEY] = legacyRecord } }))
    self.env.write_file("gratitude_consent.json", json.encode({ [ACCOUNT] = { allowed = true, timestamp = 1 } }))
    start_session()
    self.env.config.restart()
    start_session()
    UpsertGiverData(giver_payload(APP_ID, { replacesLicenseKey = LEGACY_KEY }), ACCOUNT)
    UpsertGiverData(giver_payload(APP_ID, { notes = string.rep(NOTE, 200) }), ACCOUNT)
    SetUiSettings(settings_payload())
    SetFriendsCache(friends_payload(), ACCOUNT)
    DeleteGiverData(APP_ID, ACCOUNT)
    self.env.config.set = function(key)
        return false, "rpc failed for " .. key
    end
    UpsertGiverData(giver_payload(APP_ID), ACCOUNT)

    -- A gift file that couldn't be read, so saves for an unkeyed account are refused
    self.env.config = support.new_fake_config()
    self.env.write_file(STORE_FILE, json.encode({ [ACCOUNT] = { [LEGACY_KEY] = legacyRecord } }))
    self.env.fail.open_read = "Permission denied"
    self.env.fail.only_path = "gratitude_givers%.json$"
    start_session()
    UpsertGiverData(giver_payload(APP_ID), ACCOUNT)
    self.env.fail.open_read = nil

    -- Config that couldn't be read, with error text quoting a note
    self.env.config = support.new_fake_config()
    self.env.config.fail_get_all = "parse error: last read: '" .. NOTE
    start_session()
    UpsertGiverData(giver_payload(APP_ID), ACCOUNT)
    ClearCache(ACCOUNT)

    lu.assertEquals(private_values_logged(self), {})
    lu.assertTrue(any_message_contains(self, MASKED_ACCOUNT), "masked account ID logged")
end
