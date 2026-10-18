-- Tests for gift records, consent and settings in millennium.config, across sessions that
-- share one fake config
local lu = require("luaunit")
local support = require("lua_test_support")
local json = require("cjson")

TestBackendConfig = {}

local GIVERS = "gratitude_givers.json"
local CONSENT = "gratitude_consent.json"
local SETTINGS = "gratitude_settings.json"
local RETIRE_TIME = 1792200000

local RECORD_220 = support.giver({ createdAt = 1, updatedAt = 1 })

function TestBackendConfig:setUp()
    self.env = support.new_env()
    self.config = support.new_fake_config()
    self.env.config = self.config
end

function TestBackendConfig:tearDown()
    self.env.cleanup()
end

-- A new Steam session: Millennium reloads config.json, then the backend starts
function TestBackendConfig:next_session()
    if self.env.config then
        self.env.config.restart()
    end
    return self.env.start_backend()
end

function TestBackendConfig:seed_files_for_111()
    self.env.write_file(GIVERS, json.encode({ ["111"] = { ["220"] = RECORD_220 } }))
    self.env.write_file(CONSENT, json.encode({ ["111"] = { allowed = true, timestamp = 1 } }))
    self.env.write_file(SETTINGS, json.encode({ ["111"] = { showFriendPickerSteamUrl = true } }))
end

local function assert_seeded_data_for_111()
    lu.assertEquals(json.decode(GetAllGiverData("111")), { ["220"] = RECORD_220 })
    lu.assertTrue(HasUserConsented("111"))
    lu.assertEquals(json.decode(GetUiSettings("111")), { showFriendPickerSteamUrl = true })
end

-- Two sessions: the first copies the files into config, the second retires them
function TestBackendConfig:migrate_seeded_files()
    self:seed_files_for_111()
    self:next_session()
    self:next_session()
end

function TestBackendConfig:test_files_move_into_config_and_are_retired_in_the_next_session()
    self:seed_files_for_111()

    self:next_session()
    assert_seeded_data_for_111()
    lu.assertEquals(self.config.get("givers.111"), { ["220"] = RECORD_220 })
    lu.assertEquals(self.config.get("consent.111"), { allowed = true, timestamp = 1 })
    lu.assertEquals(self.config.get("settings.111"), { showFriendPickerSteamUrl = true })
    lu.assertEquals(self.env.list(), { CONSENT, GIVERS, SETTINGS })

    self:next_session()
    assert_seeded_data_for_111()
    lu.assertEquals(self.config.set_calls, {})
    lu.assertEquals(self.env.list(), { CONSENT .. ".migrated", GIVERS .. ".migrated", SETTINGS .. ".migrated" })
end

function TestBackendConfig:test_without_config_the_files_are_used_and_never_retired()
    self.env.config = nil
    self:seed_files_for_111()

    self:next_session()
    assert_seeded_data_for_111()
    lu.assertTrue(UpsertGiverData(support.giver_payload({ licenseKey = "400" }), "111"))
    lu.assertTrue(SetConsent(false, "111"))
    lu.assertTrue(SetUiSettings(support.settings_payload(false)))

    lu.assertEquals(self.env.read_json(GIVERS)["111"]["400"].displayName, "Gifter")
    lu.assertFalse(self.env.read_json(CONSENT)["111"].allowed)
    lu.assertFalse(self.env.read_json(SETTINGS)["111"].showFriendPickerSteamUrl)
    self:next_session()
    lu.assertEquals(self.env.list(), { CONSENT, GIVERS, SETTINGS })
end

function TestBackendConfig:test_upsert_in_config_mode_sets_only_its_account_key()
    self.config.set("givers.222", { ["400"] = RECORD_220 })
    self:next_session()

    lu.assertTrue(UpsertGiverData(support.giver_payload(), "111"))

    lu.assertEquals(self.config.set_calls, { "givers.111" })
    lu.assertEquals(json.decode(GetGiverData("220", "111")).displayName, "Gifter")
    lu.assertEquals(self.config.get("givers.111")["220"].displayName, "Gifter")
    lu.assertEquals(self.config.get("givers.222"), { ["400"] = RECORD_220 })
    lu.assertEquals(self.env.writes_since(0, GIVERS), {})
end

function TestBackendConfig:test_consent_and_settings_save_to_their_account_keys()
    self:next_session()

    lu.assertTrue(SetConsent(false, "111"))
    lu.assertTrue(SetUiSettings(support.settings_payload(true)))

    lu.assertEquals(self.config.set_calls, { "consent.111", "settings.111" })
    lu.assertFalse(self.config.get("consent.111").allowed)
    lu.assertEquals(self.config.get("settings.111"), { showFriendPickerSteamUrl = true })
    lu.assertEquals(self.env.writes_since(0, CONSENT), {})
    lu.assertEquals(self.env.writes_since(0, SETTINGS), {})
end

-- An emptied account keeps its key as {}, so deleted gifts can't come back from a .migrated copy
function TestBackendConfig:test_deleting_the_last_gift_keeps_an_empty_key_so_it_never_comes_back()
    self:migrate_seeded_files()

    lu.assertTrue(DeleteGiverData("220", "111"))
    lu.assertEquals(self.config.get("givers.111"), {})
    lu.assertEquals(GetAllGiverData("111"), "{}")

    self:next_session()
    lu.assertTrue(self.env.exists(GIVERS .. ".migrated"))
    lu.assertEquals(GetAllGiverData("111"), "{}")
    lu.assertEquals(GetGiverData("220", "111"), "{}")
end

function TestBackendConfig:test_after_a_config_reset_gifts_and_settings_return_and_consent_is_asked_again()
    self:migrate_seeded_files()

    self.config = support.new_fake_config()
    self.env.config = self.config
    self:next_session()

    lu.assertEquals(json.decode(GetAllGiverData("111")), { ["220"] = RECORD_220 })
    lu.assertEquals(json.decode(GetUiSettings("111")), { showFriendPickerSteamUrl = true })
    lu.assertNil(HasUserConsented("111"))
    lu.assertEquals(self.config.get("givers.111"), { ["220"] = RECORD_220 })
    lu.assertNil(self.config.get("consent.111"))
end

-- Edits made without config go to a new file, retired later without replacing the older copy
function TestBackendConfig:test_downgrade_edits_go_to_a_file_that_is_retired_without_replacing_the_older_copy()
    self:migrate_seeded_files()
    local olderCopy = self.env.read_file(GIVERS .. ".migrated")

    self.env.config = nil
    self:next_session()
    lu.assertEquals(json.decode(GetAllGiverData("111")), { ["220"] = RECORD_220 })
    lu.assertEquals(json.decode(GetUiSettings("111")), { showFriendPickerSteamUrl = true })
    lu.assertNil(HasUserConsented("111"))
    lu.assertTrue(UpsertGiverData(support.giver_payload({ licenseKey = "400" }), "111"))
    lu.assertNotNil(self.env.read_json(GIVERS)["111"]["400"])

    self.env.config = self.config
    self.env.freeze_time(RETIRE_TIME)
    self:next_session()
    lu.assertEquals(json.decode(GetAllGiverData("111")), { ["220"] = RECORD_220 })
    lu.assertFalse(self.env.exists(GIVERS))
    lu.assertEquals(self.env.read_file(GIVERS .. ".migrated"), olderCopy)
    lu.assertNotNil(self.env.read_json(GIVERS .. ".migrated." .. RETIRE_TIME)["111"]["400"])
end

function TestBackendConfig:test_consent_from_config_still_filters_the_cache_file()
    self.config.set("consent.111", { allowed = true, timestamp = 1 })
    self.config.set("consent.333", { allowed = false, timestamp = 1 })
    self:next_session()

    lu.assertTrue(SetGameLicenseData(support.license_page(), "333"))
    lu.assertTrue(SetGameLicenseData(support.license_page(), "111"))

    local cached = self.env.read_json("gratitude_cache.json")
    lu.assertNotNil(cached["111"])
    lu.assertNil(cached["333"])
end

function TestBackendConfig:test_a_key_limit_refusal_is_undone_in_memory()
    self.config = support.new_fake_config({ key_limit = 1 })
    self.env.config = self.config
    self.config.set("settings.999", { showFriendPickerSteamUrl = false })
    self:next_session()

    lu.assertEquals(UpsertGiverData(support.giver_payload(), "111"), "save_failed")
    lu.assertFalse(SetConsent(true, "111"))
    lu.assertFalse(SetUiSettings(support.settings_payload(true)))

    lu.assertEquals(GetAllGiverData("111"), "{}")
    lu.assertNil(HasUserConsented("111"))
    lu.assertEquals(GetUiSettings("111"), "{}")
    lu.assertNil(self.config.get("givers.111"))
end

-- The shared undo helper puts the account back when a config save is refused
function TestBackendConfig:test_a_refused_config_delete_keeps_the_record()
    self:migrate_seeded_files()
    self.config.set = function()
        return false, "rpc failed"
    end

    lu.assertFalse(DeleteGiverData("220", "111"))

    lu.assertEquals(json.decode(GetAllGiverData("111")), { ["220"] = RECORD_220 })
end

-- UpsertGiverData returns true or an error code

local CJK = "\230\151\165"

function TestBackendConfig:test_invalid_payloads_return_invalid_payload()
    self:next_session()

    lu.assertEquals(UpsertGiverData("{not json", "111"), "invalid_payload")
    lu.assertEquals(UpsertGiverData("", "111"), "invalid_payload")
    lu.assertEquals(UpsertGiverData(support.giver_payload(), ""), "invalid_payload")
    lu.assertEquals(self.config.set_calls, {})
end

function TestBackendConfig:assert_long_note_refused()
    local openedBefore = #self.env.opened_for_write

    lu.assertEquals(UpsertGiverData(support.giver_payload({ notes = string.rep("a", 2001) }), "111"), "note_too_long")

    lu.assertEquals(GetAllGiverData("111"), "{}")
    lu.assertEquals(#self.env.opened_for_write, openedBefore)
end

function TestBackendConfig:test_a_note_over_2000_characters_is_refused_in_config_mode()
    self:next_session()
    self:assert_long_note_refused()
    lu.assertEquals(self.config.set_calls, {})
end

function TestBackendConfig:test_a_note_over_2000_characters_is_refused_in_file_mode()
    self.env.config = nil
    self:next_session()
    self:assert_long_note_refused()
    lu.assertFalse(self.env.exists(GIVERS))
end

function TestBackendConfig:test_a_2000_character_note_in_three_byte_characters_saves()
    self:next_session()

    local result = UpsertGiverData(support.giver_payload({ notes = string.rep(CJK, 2000) }), "111")

    lu.assertIs(result, true)
    lu.assertEquals(#self.config.get("givers.111")["220"].notes, 6000)
end

-- Records with 2,000 character notes, as many as fit within Millennium's limit, so one more record
-- of that size can't
local function nearly_full_account()
    local account = { ["220"] = RECORD_220 }
    local index = 1000
    while true do
        local record = {
            licenseKey = tostring(index),
            libraryTitle = "Game",
            displayName = "Gifter",
            source = "manual",
            createdAt = 1,
            updatedAt = 1,
            notes = string.rep("n", 2000),
        }
        account[tostring(index)] = record
        if #json.encode(account) > 262144 then
            account[tostring(index)] = nil
            return account
        end
        index = index + 1
    end
end

function TestBackendConfig:test_an_account_pushed_past_the_size_limit_returns_size_limit_and_keeps_the_previous_state()
    local account = nearly_full_account()
    self.config.set("givers.111", account)
    self:next_session()
    local openedBefore = #self.env.opened_for_write

    local result = UpsertGiverData(support.giver_payload({ licenseKey = "9999", notes = string.rep("x", 2000) }), "111")

    lu.assertEquals(result, "size_limit")
    lu.assertEquals(GetGiverData("9999", "111"), "{}")
    lu.assertEquals(json.decode(GetGiverData("220", "111")), RECORD_220)
    lu.assertEquals(self.config.get("givers.111"), account)
    lu.assertEquals(self.config.set_calls, {})
    lu.assertEquals(#self.env.opened_for_write, openedBefore)
end

function TestBackendConfig:test_a_size_refusal_from_millennium_returns_size_limit()
    self.config = support.new_fake_config({ value_limit = 1000 })
    self.env.config = self.config
    self:next_session()

    lu.assertEquals(UpsertGiverData(support.giver_payload({ notes = string.rep("x", 1500) }), "111"), "size_limit")
    lu.assertEquals(GetAllGiverData("111"), "{}")
end

function TestBackendConfig:test_a_failed_file_save_returns_save_failed()
    self.env.config = nil
    self:next_session()
    self.env.fail.open_write = "Permission denied"

    lu.assertEquals(UpsertGiverData(support.giver_payload(), "111"), "save_failed")
end

-- A gift stored under an older key moves to its new key in one save

local LEGACY_RECORD = support.giver({ licenseKey = "Half-Life 2", notes = "old note", createdAt = 1, updatedAt = 1 })

local function move_payload()
    return support.giver_payload({ replacesLicenseKey = "Half-Life 2", notes = "new note" })
end

function TestBackendConfig:test_a_gift_moves_to_its_new_key_in_one_config_save()
    self.config.set("givers.111", { ["Half-Life 2"] = LEGACY_RECORD })
    self:next_session()

    lu.assertIs(UpsertGiverData(move_payload(), "111"), true)

    lu.assertEquals(self.config.set_calls, { "givers.111" })
    local saved = self.config.get("givers.111")
    lu.assertEquals(support.sorted_keys(saved), { "220" })
    lu.assertEquals(saved["220"].notes, "new note")
    lu.assertNil(saved["220"].replacesLicenseKey)
end

function TestBackendConfig:test_a_gift_moves_to_its_new_key_in_one_file_save()
    self.env.config = nil
    self.env.write_file(GIVERS, json.encode({ ["111"] = { ["Half-Life 2"] = LEGACY_RECORD } }))
    self:next_session()
    local openedBefore = #self.env.opened_for_write

    lu.assertIs(UpsertGiverData(move_payload(), "111"), true)

    lu.assertEquals(#self.env.opened_for_write, openedBefore + 1)
    lu.assertEquals(support.sorted_keys(self.env.read_json(GIVERS)["111"]), { "220" })
end

function TestBackendConfig:test_a_failed_move_leaves_the_gift_under_its_old_key_only()
    self.config.set("givers.111", { ["Half-Life 2"] = LEGACY_RECORD })
    self:next_session()
    self.config.set = function()
        return false, "rpc failed"
    end

    lu.assertEquals(UpsertGiverData(move_payload(), "111"), "save_failed")

    lu.assertEquals(json.decode(GetAllGiverData("111")), { ["Half-Life 2"] = LEGACY_RECORD })
end

-- A save while the source couldn't be read must not hide the unread gifts

local GIFT_400 = support.giver({ licenseKey = "400", libraryTitle = "Portal", createdAt = 1, updatedAt = 1 })

function TestBackendConfig:test_a_locked_givers_file_refuses_saves_until_its_gifts_are_read()
    self.config.set("givers.222", { ["220"] = RECORD_220 })
    self.env.write_file(GIVERS, json.encode({ ["111"] = { ["220"] = RECORD_220, ["400"] = GIFT_400 }, ["222"] = { ["220"] = RECORD_220 } }))
    self.env.fail.open_read = "Permission denied"
    self.env.fail.only_path = "gratitude_givers%.json$"
    self:next_session()

    lu.assertEquals(UpsertGiverData(support.giver_payload({ licenseKey = "500" }), "111"), "read_only")
    lu.assertIs(UpsertGiverData(support.giver_payload({ licenseKey = "500" }), "222"), true)
    lu.assertNil(self.config.get("givers.111"))

    self.env.fail.open_read = nil
    self:next_session()
    lu.assertEquals(support.sorted_keys(json.decode(GetAllGiverData("111"))), { "220", "400" })
    lu.assertTrue(self.env.exists(GIVERS))
end

function TestBackendConfig:test_locked_migrated_copies_refuse_saves_until_their_gifts_are_read()
    self.env.write_file(GIVERS .. ".migrated", json.encode({ ["111"] = { ["220"] = RECORD_220, ["400"] = GIFT_400 } }))
    self.env.fail.open_read = "Permission denied"
    self.env.fail.only_path = "%.migrated$"
    self:next_session()

    lu.assertEquals(UpsertGiverData(support.giver_payload({ licenseKey = "500" }), "111"), "read_only")
    lu.assertNil(self.config.get("givers.111"))

    self.env.fail.open_read = nil
    self:next_session()
    lu.assertEquals(support.sorted_keys(json.decode(GetAllGiverData("111"))), { "220", "400" })
end

-- When config exists but couldn't be read, nothing is saved over newer config data
function TestBackendConfig:test_a_failed_snapshot_shows_the_file_and_refuses_saves()
    self.env.write_file(GIVERS, json.encode({ ["111"] = { ["220"] = RECORD_220 } }))
    self.config.set("givers.111", { ["220"] = RECORD_220, ["400"] = GIFT_400 })
    self.config.restart()
    self.config.fail_get_all = "IPC frame too large"
    self.env.start_backend()
    local before = self.env.read_file(GIVERS)

    lu.assertEquals(support.sorted_keys(json.decode(GetAllGiverData("111"))), { "220" })
    lu.assertEquals(UpsertGiverData(support.giver_payload({ licenseKey = "500" }), "111"), "read_only")
    lu.assertFalse(SetUiSettings(support.settings_payload(true)))
    lu.assertEquals(self.env.read_file(GIVERS), before)
    lu.assertEquals(self.config.set_calls, {})
end

-- The plugin still loads when its data folder can't be listed
function TestBackendConfig:test_a_failed_folder_listing_still_loads_the_plugin()
    self.env.fail.list = "Permission denied"

    local started = pcall(self.env.start_backend)

    lu.assertTrue(started)
    lu.assertEquals(GetAllGiverData("111"), "{}")
    lu.assertEquals(UpsertGiverData(support.giver_payload(), "111"), "read_only")
end

-- The same reload loses consent, which never falls back, so the user is asked again
function TestBackendConfig:test_a_plugin_reload_after_lost_config_writes_asks_for_consent_again()
    self:seed_files_for_111()
    self.config.saving_disabled = true
    self.env.start_backend()

    self.env.start_backend()
    lu.assertEquals(self.env.list(), { CONSENT .. ".migrated", GIVERS .. ".migrated", SETTINGS .. ".migrated" })

    self:next_session()
    lu.assertNil(HasUserConsented("111"))
    lu.assertEquals(json.decode(GetAllGiverData("111")), { ["220"] = RECORD_220 })
    lu.assertEquals(json.decode(GetUiSettings("111")), { showFriendPickerSteamUrl = true })
end

-- With config unreadable, consent is unknown, so clearing one cache must not drop the rest
function TestBackendConfig:test_clearing_caches_while_config_is_unreadable_keeps_other_accounts()
    local cached = { byAppId = { ["220"] = { acquisition = "Gift/Guest Pass", date = "Mar 5, 2025" } }, byName = {} }
    local friends = { friends = { { steamID64 = "76561197960265729", displayName = "Friend One", updatedAt = 1 } }, updatedAt = 1 }
    self.env.write_file("gratitude_cache.json", json.encode({ ["111"] = cached, ["222"] = cached }))
    self.env.write_file("gratitude_friends.json", json.encode({ ["111"] = friends, ["222"] = friends }))
    self.config.set("consent.111", { allowed = true, timestamp = 1 })
    self.config.set("consent.222", { allowed = true, timestamp = 1 })
    self.config.restart()
    self.config.fail_get_all = "IPC frame too large"
    self.env.start_backend()

    lu.assertFalse(ClearCache("111"))
    lu.assertFalse(ClearFriendsCache("111"))

    lu.assertEquals(support.sorted_keys(self.env.read_json("gratitude_cache.json")), { "111", "222" })
    lu.assertEquals(support.sorted_keys(self.env.read_json("gratitude_friends.json")), { "111", "222" })
end

-- A failed read of every config value could quote one, so its text never reaches the log
function TestBackendConfig:test_a_failed_snapshot_logs_a_fixed_reason_not_the_error_text()
    self.config.fail_get_all = "parse error at byte 40: last read: '{\"notes\":\"private note text"
    self.env.start_backend()

    lu.assertNotNil(self.env.find_log("millennium.config couldn't be read"))
    lu.assertNil(self.env.find_log("private note text"))
end

-- A store file that stat can't see but open can read must not lose to an older .migrated copy
function TestBackendConfig:test_a_file_stat_cannot_see_is_still_migrated_ahead_of_an_older_copy()
    self.env.write_file(GIVERS, json.encode({ ["222"] = { ["220"] = support.giver({ displayName = "From the store file" }) } }))
    self.env.write_file(GIVERS .. ".migrated", json.encode({ ["222"] = { ["220"] = support.giver({ displayName = "From an older copy" }) } }))
    self.env.fail.exists = "stat failed"
    self.env.fail.only_path = "gratitude_givers%.json$"

    self:next_session()

    lu.assertEquals(self.config.get("givers.222")["220"].displayName, "From the store file")
end

-- Without config, a store file that couldn't be read refuses saves with the restart message's code
function TestBackendConfig:test_without_config_an_unreadable_store_file_refuses_saves_as_read_only()
    self.env.config = nil
    self.env.write_file(GIVERS, json.encode({ ["111"] = { ["220"] = RECORD_220 } }))
    self.env.fail.open_read = "Permission denied"
    self.env.fail.only_path = "gratitude_givers%.json$"
    self:next_session()

    lu.assertEquals(UpsertGiverData(support.giver_payload({ licenseKey = "400" }), "111"), "read_only")
end

-- Deleting from an account with no gift records has nothing to save, so it uses no config key
function TestBackendConfig:test_deleting_from_an_account_with_no_records_writes_nothing()
    self:next_session()

    lu.assertTrue(DeleteGiverData("220", "555"))

    lu.assertEquals(self.config.set_calls, {})
    lu.assertNil(self.config.get("givers.555"))
end

function TestBackendConfig:test_deleting_from_an_account_with_no_records_writes_no_file()
    self.env.config = nil
    self:next_session()

    lu.assertTrue(DeleteGiverData("220", "555"))

    lu.assertEquals(self.env.writes_since(0, GIVERS), {})
end
