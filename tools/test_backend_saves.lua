-- Tests for when backend/main.lua saves, what reaches disk, and undoing failed saves
local lu = require("luaunit")
local support = require("lua_test_support")
local json = require("cjson")

TestBackendSaves = {}

local DATA_FILES = {
    "gratitude_cache.json",
    "gratitude_consent.json",
    "gratitude_friends.json",
    "gratitude_givers.json",
    "gratitude_settings.json",
}

function TestBackendSaves:setUp()
    self.env = support.new_env()
end

function TestBackendSaves:tearDown()
    self.env.cleanup()
end

-- No shutdown save

function TestBackendSaves:test_unload_writes_no_data_files()
    local backend = self.env.start_backend()
    lu.assertTrue(SetConsent(true, "111"))
    lu.assertTrue(SetGameLicenseData(support.license_page(), "111"))
    lu.assertTrue(UpsertGiverData(support.giver_payload(), "111"))
    lu.assertTrue(SetFriendsCache(support.friends_payload(), "111"))
    lu.assertTrue(SetUiSettings(support.settings_payload(true)))
    for _, name in ipairs(DATA_FILES) do
        lu.assertTrue(self.env.exists(name), name)
        os.remove(self.env.dir .. "/" .. name)
    end

    backend.on_unload()

    lu.assertEquals(self.env.list(), {})
end

-- Only consented accounts reach disk. 111 consented, 222 has no consent record, 333 declined.

local UNCONSENTED = { "222", "333" }

local function record_consents()
    lu.assertTrue(SetConsent(true, "111"))
    lu.assertTrue(SetConsent(false, "333"))
end

function TestBackendSaves:test_license_save_writes_only_consented_accounts()
    self.env.start_backend()
    record_consents()

    for _, steamUserID in ipairs(UNCONSENTED) do
        lu.assertTrue(SetGameLicenseData(support.license_page(), steamUserID))
    end
    lu.assertTrue(SetGameLicenseData(support.license_page(), "111"))

    lu.assertEquals(support.sorted_keys(self.env.read_json("gratitude_cache.json")), { "111" })
    for _, steamUserID in ipairs(UNCONSENTED) do
        lu.assertTrue(IsGameLicenseCachePopulated(steamUserID), steamUserID)
    end
end

function TestBackendSaves:test_clear_cache_writes_no_unconsented_accounts()
    self.env.start_backend()
    record_consents()
    lu.assertTrue(SetGameLicenseData(support.license_page(), "111"))
    for _, steamUserID in ipairs(UNCONSENTED) do
        lu.assertTrue(SetGameLicenseData(support.license_page(), steamUserID))
    end

    lu.assertTrue(ClearCache("111"))

    lu.assertEquals(support.sorted_keys(self.env.read_json("gratitude_cache.json")), {})
    for _, steamUserID in ipairs(UNCONSENTED) do
        lu.assertTrue(IsGameLicenseCachePopulated(steamUserID), steamUserID)
    end
end

function TestBackendSaves:test_friends_for_an_unconsented_account_are_not_written()
    self.env.start_backend()
    record_consents()

    for _, steamUserID in ipairs(UNCONSENTED) do
        local openIndex = #self.env.opened_for_write
        lu.assertTrue(SetFriendsCache(support.friends_payload(), steamUserID))
        lu.assertEquals(self.env.writes_since(openIndex, "gratitude_friends"), {}, steamUserID)
        lu.assertEquals(json.decode(GetFriendsCache(steamUserID)).friends[1].displayName, "Friend One")
    end
    lu.assertEquals(support.sorted_keys(self.env.read_json("gratitude_friends.json")), {})
end

function TestBackendSaves:test_friends_save_writes_only_consented_accounts()
    self.env.start_backend()
    record_consents()

    for _, steamUserID in ipairs(UNCONSENTED) do
        lu.assertTrue(SetFriendsCache(support.friends_payload(), steamUserID))
    end
    lu.assertTrue(SetFriendsCache(support.friends_payload(), "111"))
    for _, steamUserID in ipairs(UNCONSENTED) do
        lu.assertTrue(SetFriendsCache(support.friends_payload({ displayName = "Renamed" }), steamUserID))
    end

    lu.assertEquals(support.sorted_keys(self.env.read_json("gratitude_friends.json")), { "111" })
    for _, steamUserID in ipairs(UNCONSENTED) do
        lu.assertTrue(HasFriendsCache(steamUserID), steamUserID)
    end
end

-- Failed saves of gift records, consent and settings are undone in memory.
-- env.fail.open_write fails a save with the old and the atomic JsonStore alike.

local T1 = 1700000000
local T2 = 1700000500
local T3 = 1700001000

function TestBackendSaves:test_failed_giver_edit_keeps_the_previous_record()
    self.env.freeze_time(T1)
    self.env.start_backend()
    lu.assertTrue(UpsertGiverData(support.giver_payload(), "111"))
    local saved = GetGiverData("220", "111")

    self.env.freeze_time(T2)
    self.env.fail.open_write = "Permission denied"
    lu.assertEquals(UpsertGiverData(support.giver_payload({ displayName = "Another Gifter" }), "111"), "save_failed")

    lu.assertEquals(json.decode(GetGiverData("220", "111")), json.decode(saved))
end

function TestBackendSaves:test_failed_giver_save_for_a_new_account_leaves_no_account_behind()
    self.env.start_backend()
    lu.assertTrue(UpsertGiverData(support.giver_payload(), "111"))

    self.env.fail.open_write = "Permission denied"
    lu.assertEquals(UpsertGiverData(support.giver_payload(), "444"), "save_failed")
    self.env.fail.open_write = nil
    lu.assertTrue(UpsertGiverData(support.giver_payload({ displayName = "Another Gifter" }), "111"))

    lu.assertEquals(support.sorted_keys(self.env.read_json("gratitude_givers.json")), { "111" })
    lu.assertEquals(GetAllGiverData("444"), "{}")
end

function TestBackendSaves:test_failed_giver_delete_keeps_the_record()
    self.env.start_backend()
    lu.assertTrue(UpsertGiverData(support.giver_payload(), "111"))
    lu.assertTrue(UpsertGiverData(support.giver_payload({ licenseKey = "400" }), "111"))
    local saved = GetGiverData("220", "111")

    self.env.fail.open_write = "Permission denied"
    lu.assertFalse(DeleteGiverData("220", "111"))

    lu.assertEquals(GetGiverData("220", "111"), saved)
    lu.assertEquals(support.sorted_keys(json.decode(GetAllGiverData("111"))), { "220", "400" })
end

function TestBackendSaves:test_failed_giver_delete_of_the_last_record_keeps_the_account()
    self.env.start_backend()
    lu.assertTrue(UpsertGiverData(support.giver_payload(), "111"))
    local saved = GetGiverData("220", "111")

    self.env.fail.open_write = "Permission denied"
    lu.assertFalse(DeleteGiverData("220", "111"))

    lu.assertEquals(GetGiverData("220", "111"), saved)
    lu.assertEquals(support.sorted_keys(json.decode(GetAllGiverData("111"))), { "220" })
    self.env.fail.open_write = nil
    lu.assertTrue(DeleteGiverData("220", "111"))
    lu.assertEquals(GetAllGiverData("111"), "{}")
end

function TestBackendSaves:test_failed_consent_save_without_a_prior_record_leaves_none()
    self.env.start_backend()
    lu.assertTrue(SetConsent(true, "111"))

    self.env.fail.open_write = "Permission denied"
    lu.assertFalse(SetConsent(true, "555"))
    lu.assertNil(HasUserConsented("555"))

    self.env.fail.open_write = nil
    lu.assertTrue(SetConsent(true, "111"))
    lu.assertEquals(support.sorted_keys(self.env.read_json("gratitude_consent.json")), { "111" })
end

function TestBackendSaves:test_failed_consent_save_restores_the_prior_record_and_timestamp()
    self.env.freeze_time(T1)
    self.env.start_backend()
    lu.assertTrue(SetConsent(false, "555"))

    self.env.freeze_time(T2)
    self.env.fail.open_write = "Permission denied"
    lu.assertFalse(SetConsent(true, "555"))
    lu.assertFalse(HasUserConsented("555"))

    self.env.freeze_time(T3)
    self.env.fail.open_write = nil
    lu.assertTrue(SetConsent(true, "111"))
    lu.assertEquals(self.env.read_json("gratitude_consent.json")["555"], { allowed = false, timestamp = T1 })
end

function TestBackendSaves:test_failed_settings_save_keeps_the_previous_settings()
    self.env.start_backend()
    lu.assertTrue(SetUiSettings(support.settings_payload(true)))

    self.env.fail.open_write = "Permission denied"
    lu.assertFalse(SetUiSettings(support.settings_payload(false)))
    lu.assertFalse(SetUiSettings(support.settings_payload(true, "222")))

    lu.assertEquals(json.decode(GetUiSettings("111")), { showFriendPickerSteamUrl = true })
    lu.assertEquals(GetUiSettings("222"), "{}")
end

-- Characterization: the license cache keeps its in-memory data when a save fails
function TestBackendSaves:test_failed_license_save_keeps_the_page_in_memory()
    self.env.start_backend()
    lu.assertTrue(SetConsent(true, "111"))

    self.env.fail.open_write = "Permission denied"
    lu.assertTrue(SetGameLicenseData(support.license_page(), "111"))

    lu.assertEquals(json.decode(GetGameLicenseData("111")).byAppId["220"].acquisition, "Gift/Guest Pass")
    lu.assertTrue(IsGameLicenseCachePopulated("111"))
end

-- Granting consent saves both caches

local function scrape_into_memory(steamUserID)
    lu.assertTrue(SetGameLicenseData(support.license_page(), steamUserID))
    lu.assertTrue(SetFriendsCache(support.friends_payload(), steamUserID))
end

function TestBackendSaves:test_granting_consent_saves_both_caches()
    self.env.start_backend()
    scrape_into_memory("222")
    lu.assertFalse(self.env.exists("gratitude_cache.json"))
    lu.assertFalse(self.env.exists("gratitude_friends.json"))

    lu.assertTrue(SetConsent(true, "222"))

    lu.assertEquals(support.sorted_keys(self.env.read_json("gratitude_cache.json")), { "222" })
    lu.assertEquals(support.sorted_keys(self.env.read_json("gratitude_friends.json")), { "222" })
end

function TestBackendSaves:test_cache_save_failure_after_granting_consent_is_logged_not_returned()
    self.env.start_backend()
    scrape_into_memory("222")
    self.env.fail.only_path = "gratitude_cache"
    self.env.fail.open_write = "Permission denied"
    local logIndex = #self.env.logs

    lu.assertTrue(SetConsent(true, "222"))

    local failureLogged = self.env.find_log("", "error", logIndex) or self.env.find_log("", "warn", logIndex)
    lu.assertNotNil(failureLogged, "expected the cache save failure to be logged")
    lu.assertTrue(HasUserConsented("222"))
    lu.assertEquals(support.sorted_keys(self.env.read_json("gratitude_friends.json")), { "222" })
end

function TestBackendSaves:test_declining_consent_opens_no_cache_file()
    self.env.start_backend()
    scrape_into_memory("222")
    local openIndex = #self.env.opened_for_write

    lu.assertTrue(SetConsent(false, "222"))

    lu.assertEquals(self.env.writes_since(openIndex, "gratitude_cache"), {})
    lu.assertEquals(self.env.writes_since(openIndex, "gratitude_friends"), {})
end

-- An unchanged friends list is not saved again

local function two_friends(firstAvatarUrl)
    return {
        {
            steamID64 = "76561197960265729",
            displayName = "Friend One",
            profileUrl = "https://steamcommunity.com/id/one",
            nicknameOrAlias = "One",
            avatarUrl = firstAvatarUrl or "https://avatars.example/one.jpg",
        },
        { steamID64 = "76561197960265730", displayName = "Friend Two", avatarUrl = "https://avatars.example/two.jpg" },
    }
end

local function assert_friends_updated_at(snapshot, expected)
    lu.assertEquals(snapshot.updatedAt, expected)
    for _, friend in ipairs(snapshot.friends) do
        lu.assertEquals(friend.updatedAt, expected, friend.steamID64)
    end
end

function TestBackendSaves:test_unchanged_friends_list_is_not_saved_again()
    self.env.freeze_time(T1)
    self.env.start_backend()
    lu.assertTrue(SetConsent(true, "111"))
    local openIndex = #self.env.opened_for_write
    lu.assertTrue(SetFriendsCache(json.encode(two_friends()), "111"))
    lu.assertNotEquals(self.env.writes_since(openIndex, "gratitude_friends"), {})

    self.env.freeze_time(T2)
    local reordered = two_friends()
    reordered[1], reordered[2] = reordered[2], reordered[1]
    openIndex = #self.env.opened_for_write
    lu.assertTrue(SetFriendsCache(json.encode(reordered), "111"))

    lu.assertEquals(self.env.writes_since(openIndex, "gratitude_friends"), {})
    assert_friends_updated_at(json.decode(GetFriendsCache("111")), T1)
    assert_friends_updated_at(self.env.read_json("gratitude_friends.json")["111"], T1)

    openIndex = #self.env.opened_for_write
    lu.assertTrue(SetFriendsCache(json.encode(two_friends("https://avatars.example/new.jpg")), "111"))

    lu.assertNotEquals(self.env.writes_since(openIndex, "gratitude_friends"), {})
    local saved = self.env.read_json("gratitude_friends.json")["111"]
    assert_friends_updated_at(saved, T2)
    lu.assertEquals(saved.friends[1].avatarUrl, "https://avatars.example/new.jpg")
    assert_friends_updated_at(json.decode(GetFriendsCache("111")), T2)
end

-- One consent check, and caches wait while consent is unknown

function TestBackendSaves:test_license_save_is_skipped_unless_consent_is_exactly_true()
    self.env.write_file("gratitude_consent.json", '{"111":{"allowed":"true","timestamp":1}}')
    self.env.start_backend()
    local openIndex = #self.env.opened_for_write
    local logIndex = #self.env.logs

    lu.assertTrue(SetGameLicenseData(support.license_page(), "111"))

    lu.assertTrue(self.env.find_log("skipping cache save", nil, logIndex) ~= nil, "expected the skipped save to be logged")
    lu.assertEquals(self.env.writes_since(openIndex, "gratitude_cache"), {})
    lu.assertTrue(IsGameLicenseCachePopulated("111"))
end

-- The UI must agree with the save filter, so a non-boolean allowed reports as not consented
function TestBackendSaves:test_has_user_consented_reports_only_exactly_true_as_consent()
    self.env.write_file("gratitude_consent.json",
        '{"111":{"allowed":"true","timestamp":1},"222":{"allowed":true,"timestamp":1},"333":{"allowed":false,"timestamp":1}}')
    self.env.start_backend()

    lu.assertEquals(HasUserConsented("111"), false)
    lu.assertEquals(HasUserConsented("222"), true)
    lu.assertEquals(HasUserConsented("333"), false)
    lu.assertNil(HasUserConsented("444"))
end

-- With consent unreadable every account looks unconsented, so a filtered save would drop them all
local function start_with_consent_unreadable(env)
    env.write_file("gratitude_consent.json", '{"111":{"allowed":true,"timestamp":1},"222":{"allowed":true,"timestamp":1}}')
    env.fail.only_path = "gratitude_consent"
    env.fail.open_read = "Permission denied"
    env.start_backend()
    env.fail.only_path = nil
    env.fail.open_read = nil
end

function TestBackendSaves:test_clear_cache_keeps_other_accounts_while_consent_is_unknown()
    local cached = { byAppId = { ["220"] = { acquisition = "Gift/Guest Pass", date = "Mar 5, 2025" } }, byName = {} }
    self.env.write_file("gratitude_cache.json", json.encode({ ["111"] = cached, ["222"] = cached }))
    start_with_consent_unreadable(self.env)
    local logIndex = #self.env.logs

    lu.assertFalse(ClearCache("111"))

    lu.assertEquals(support.sorted_keys(self.env.read_json("gratitude_cache.json")), { "111", "222" })
    lu.assertTrue(self.env.find_log("Game license cache not saved", nil, logIndex) ~= nil, "expected the refused save to be logged")
end

function TestBackendSaves:test_clear_friends_cache_keeps_other_accounts_while_consent_is_unknown()
    local snapshot = { friends = { { steamID64 = "76561197960265729", displayName = "Friend One", updatedAt = 1 } }, updatedAt = 1 }
    self.env.write_file("gratitude_friends.json", json.encode({ ["111"] = snapshot, ["222"] = snapshot }))
    start_with_consent_unreadable(self.env)
    local logIndex = #self.env.logs

    lu.assertFalse(ClearFriendsCache("111"))

    lu.assertEquals(support.sorted_keys(self.env.read_json("gratitude_friends.json")), { "111", "222" })
    lu.assertTrue(self.env.find_log("Friends cache not saved", nil, logIndex) ~= nil, "expected the refused save to be logged")
end

-- ClearCache returns its save result

function TestBackendSaves:test_failed_clear_cache_returns_false()
    self.env.start_backend()
    lu.assertTrue(SetConsent(true, "111"))
    lu.assertTrue(SetGameLicenseData(support.license_page(), "111"))

    self.env.fail.open_write = "Permission denied"
    lu.assertFalse(ClearCache("111"))

    -- A clear that didn't reach disk is undone in memory, so the backend agrees with the disk
    -- and with the frontend, which keeps its copy when a clear fails
    lu.assertTrue(IsGameLicenseCachePopulated("111"))
    lu.assertEquals(support.sorted_keys(self.env.read_json("gratitude_cache.json")), { "111" })
end

function TestBackendSaves:test_failed_clear_friends_cache_is_undone_in_memory()
    self.env.start_backend()
    lu.assertTrue(SetConsent(true, "111"))
    lu.assertTrue(SetFriendsCache(support.friends_payload(), "111"))

    self.env.fail.open_write = "Permission denied"
    lu.assertFalse(ClearFriendsCache("111"))

    lu.assertTrue(HasFriendsCache("111"))
    lu.assertEquals(#json.decode(GetFriendsCache("111")).friends, 1)
end

-- A failed consent save keeps the caches off disk

function TestBackendSaves:test_failed_consent_save_writes_no_cache()
    self.env.start_backend()
    scrape_into_memory("222")
    self.env.fail.only_path = "gratitude_consent"
    self.env.fail.open_write = "Permission denied"
    local openIndex = #self.env.opened_for_write

    lu.assertFalse(SetConsent(true, "222"))

    lu.assertEquals(self.env.writes_since(openIndex, "gratitude_cache"), {})
    lu.assertEquals(self.env.writes_since(openIndex, "gratitude_friends"), {})
end
