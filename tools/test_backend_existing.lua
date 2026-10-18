-- Characterization tests for the backend callables in backend/main.lua: behavior that stays.
-- Behavior whose disk side depends on consent is asserted through the Get* callables.
local lu = require("luaunit")
local support = require("lua_test_support")
local json = require("cjson")

TestBackendExisting = {}

local T1 = 1700000000
local T2 = 1700000500

function TestBackendExisting:setUp()
    self.env = support.new_env()
end

function TestBackendExisting:tearDown()
    self.env.cleanup()
end

-- Consent checks

function TestBackendExisting:test_has_user_consented_is_nil_for_unknown_and_empty_accounts()
    self.env.start_backend()
    lu.assertNil(HasUserConsented("111"))
    lu.assertNil(HasUserConsented(""))
end

function TestBackendExisting:test_set_consent_records_the_decision()
    self.env.start_backend()
    lu.assertTrue(SetConsent(true, "111"))
    lu.assertTrue(HasUserConsented("111"))

    lu.assertTrue(SetConsent(false, "111"))
    lu.assertFalse(HasUserConsented("111"))
end

function TestBackendExisting:test_set_consent_without_account_returns_false()
    self.env.start_backend()
    lu.assertFalse(SetConsent(true, ""))
    lu.assertNil(HasUserConsented(""))
end

-- Licenses

function TestBackendExisting:test_licenses_without_consent_are_merged_in_memory_and_not_written()
    self.env.start_backend()
    lu.assertFalse(IsGameLicenseCachePopulated("111"))

    lu.assertTrue(SetGameLicenseData(support.license_page({ name = "Half-Life 2", totalLicenses = 2 }), "111"))
    lu.assertTrue(SetGameLicenseData(support.license_page({ appId = "400", name = "Portal", totalLicenses = 2 }), "111"))

    lu.assertFalse(self.env.exists("gratitude_cache.json"))
    local entry = { acquisition = "Gift/Guest Pass", date = "Mar 5, 2025" }
    lu.assertEquals(json.decode(GetGameLicenseData("111")), {
        byAppId = { ["220"] = entry, ["400"] = entry },
        byName = { ["Half-Life 2"] = entry, ["Portal"] = entry },
        totalLicenses = 2,
    })
    lu.assertTrue(IsGameLicenseCachePopulated("111"))
end

function TestBackendExisting:test_old_name_only_cache_file_loads_into_by_name()
    self.env.write_file("gratitude_cache.json",
        '{"111": {"Old Game": {"date": "Jan 1, 2020", "acquisition": "Gift/Guest Pass"}}}')
    self.env.start_backend()

    lu.assertEquals(json.decode(GetGameLicenseData("111")), {
        byAppId = {},
        byName = { ["Old Game"] = { date = "Jan 1, 2020", acquisition = "Gift/Guest Pass" } },
    })
    lu.assertTrue(IsGameLicenseCachePopulated("111"))
end

-- Giver payload validation

function TestBackendExisting:test_upsert_rejects_a_missing_required_field()
    self.env.start_backend()
    for _, fieldName in ipairs({ "licenseKey", "libraryTitle", "displayName", "source" }) do
        local fields = support.giver()
        fields[fieldName] = nil
        lu.assertEquals(UpsertGiverData(json.encode(fields), "111"), "invalid_payload", fieldName)
    end

    lu.assertEquals(GetAllGiverData("111"), "{}")
    lu.assertEquals(GetGiverData("220", "111"), "{}")
    lu.assertFalse(self.env.exists("gratitude_givers.json"))
end

function TestBackendExisting:test_upsert_rejects_an_unknown_source()
    self.env.start_backend()
    lu.assertEquals(UpsertGiverData(support.giver_payload({ source = "scraped" }), "111"), "invalid_payload")
    lu.assertEquals(GetAllGiverData("111"), "{}")
end

function TestBackendExisting:test_upsert_keeps_non_empty_optional_strings_and_drops_empty_ones()
    self.env.start_backend()
    local filled = support.giver_payload({
        steamID64 = "76561197960265729",
        profileUrl = "https://steamcommunity.com/id/gifter",
        notes = "Thanks!",
    })
    local empty = support.giver_payload({ licenseKey = "400", steamID64 = "", profileUrl = "", notes = "" })

    lu.assertTrue(UpsertGiverData(filled, "111"))
    lu.assertTrue(UpsertGiverData(empty, "111"))

    local kept = json.decode(GetGiverData("220", "111"))
    lu.assertEquals(kept.steamID64, "76561197960265729")
    lu.assertEquals(kept.profileUrl, "https://steamcommunity.com/id/gifter")
    lu.assertEquals(kept.notes, "Thanks!")

    local dropped = json.decode(GetGiverData("400", "111"))
    lu.assertNil(dropped.steamID64)
    lu.assertNil(dropped.profileUrl)
    lu.assertNil(dropped.notes)
end

function TestBackendExisting:test_update_keeps_created_at_and_refreshes_updated_at()
    self.env.start_backend()
    self.env.freeze_time(T1)
    lu.assertTrue(UpsertGiverData(support.giver_payload(), "111"))

    self.env.freeze_time(T2)
    lu.assertTrue(UpsertGiverData(support.giver_payload({ displayName = "Another Gifter" }), "111"))

    lu.assertEquals(json.decode(GetGiverData("220", "111")), {
        licenseKey = "220",
        libraryTitle = "Half-Life 2",
        displayName = "Another Gifter",
        source = "manual",
        createdAt = T1,
        updatedAt = T2,
    })
end

function TestBackendExisting:test_get_all_giver_data_returns_the_account_map()
    self.env.freeze_time(T1)
    self.env.start_backend()
    lu.assertTrue(UpsertGiverData(support.giver_payload(), "111"))
    lu.assertTrue(UpsertGiverData(support.giver_payload({ licenseKey = "400", source = "friend-cache" }), "111"))

    local all = json.decode(GetAllGiverData("111"))
    lu.assertEquals(all["220"].displayName, "Gifter")
    lu.assertEquals(all["400"].source, "friend-cache")
    lu.assertEquals(GetAllGiverData("222"), "{}")
end

function TestBackendExisting:test_deleting_the_last_record_empties_the_account()
    self.env.start_backend()
    lu.assertTrue(UpsertGiverData(support.giver_payload(), "111"))

    lu.assertTrue(DeleteGiverData("220", "111"))
    lu.assertEquals(GetAllGiverData("111"), "{}")
    lu.assertEquals(GetGiverData("220", "111"), "{}")
end

function TestBackendExisting:test_get_giver_data_with_empty_arguments_returns_empty_object()
    self.env.start_backend()
    lu.assertTrue(UpsertGiverData(support.giver_payload(), "111"))

    lu.assertEquals(GetGiverData("", "111"), "{}")
    lu.assertEquals(GetGiverData("220", ""), "{}")
end

-- Friends normalization

function TestBackendExisting:test_friend_rows_are_normalized()
    self.env.freeze_time(T1)
    self.env.start_backend()
    local friends = {
        {
            steamID64 = "76561197960265729",
            displayName = "Friend One",
            profileUrl = "https://steamcommunity.com/id/one",
            nicknameOrAlias = "One",
            avatarUrl = "https://avatars.example/one.jpg",
        },
        { steamID64 = "76561197960265730", displayName = "Friend Two", profileUrl = "", nicknameOrAlias = "", avatarUrl = "" },
        { displayName = "No Id" },
        { steamID64 = "76561197960265731" },
        { steamID64 = "", displayName = "Empty Id" },
    }

    lu.assertFalse(HasFriendsCache("111"))
    lu.assertTrue(SetFriendsCache(json.encode(friends), "111"))

    lu.assertEquals(json.decode(GetFriendsCache("111")), {
        updatedAt = T1,
        friends = {
            {
                steamID64 = "76561197960265729",
                displayName = "Friend One",
                profileUrl = "https://steamcommunity.com/id/one",
                nicknameOrAlias = "One",
                avatarUrl = "https://avatars.example/one.jpg",
                updatedAt = T1,
            },
            { steamID64 = "76561197960265730", displayName = "Friend Two", updatedAt = T1 },
        },
    })
    lu.assertEquals(self.env.count_logs("error"), 3)
    lu.assertTrue(HasFriendsCache("111"))
end

function TestBackendExisting:test_clear_friends_cache_empties_the_account()
    self.env.start_backend()
    lu.assertTrue(SetFriendsCache(support.friends_payload(), "111"))

    lu.assertTrue(ClearFriendsCache("111"))
    lu.assertEquals(GetFriendsCache("111"), "{}")
    lu.assertFalse(HasFriendsCache("111"))
end

function TestBackendExisting:test_friends_payload_that_is_not_json_returns_false()
    self.env.start_backend()
    lu.assertFalse(SetFriendsCache("not json", "111"))
    lu.assertEquals(GetFriendsCache("111"), "{}")
end

-- Settings

function TestBackendExisting:test_show_friend_picker_url_is_stored_true_only_for_boolean_true()
    self.env.start_backend()
    local function set_picker_url(value)
        return SetUiSettings(support.settings_payload(value))
    end

    lu.assertTrue(set_picker_url(true))
    lu.assertEquals(json.decode(GetUiSettings("111")), { showFriendPickerSteamUrl = true })

    for _, value in ipairs({ "true", 1 }) do
        lu.assertTrue(set_picker_url(value))
        lu.assertEquals(json.decode(GetUiSettings("111")), { showFriendPickerSteamUrl = false }, tostring(value))
    end
end

function TestBackendExisting:test_settings_payload_without_account_returns_false()
    self.env.start_backend()
    lu.assertFalse(SetUiSettings(json.encode({ settings = { showFriendPickerSteamUrl = true } })))
    lu.assertFalse(self.env.exists("gratitude_settings.json"))
end

function TestBackendExisting:test_get_ui_settings_for_an_unknown_account_returns_empty_object()
    self.env.start_backend()
    lu.assertEquals(GetUiSettings("111"), "{}")
    lu.assertEquals(GetUiSettings(""), "{}")
end
