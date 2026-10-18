-- Tests for backend/lib/config_store.lua
local lu = require("luaunit")
local support = require("lua_test_support")

local VALUE_LIMIT = 262144
-- {"n":"..."} adds 8 bytes around the string
local function value_of_size(bytes)
    return { n = string.rep("x", bytes - 8) }
end

-- Shared by both test classes: a fresh folder, a fresh fake config and a fresh module
local function set_up(test)
    test.env = support.new_env()
    test.config = support.new_fake_config()
    test.env.config = test.config
    package.loaded["lib.config_store"] = nil
    test.config_store = require("lib.config_store")
end

local function tear_down(test)
    test.env.cleanup()
end

TestConfigStore = { setUp = set_up, tearDown = tear_down }

-- These become config key names in every user's config.json, so they can never change
function TestConfigStore:test_key_prefixes_never_change()
    lu.assertEquals(self.config_store.GIVERS, "givers")
    lu.assertEquals(self.config_store.CONSENT, "consent")
    lu.assertEquals(self.config_store.SETTINGS, "settings")
end

function TestConfigStore:test_accounts_picks_only_keys_with_the_prefix()
    local snapshot = {
        ["givers.111"] = { a = 1 },
        ["givers.222"] = { b = 2 },
        ["consent.111"] = { allowed = true, timestamp = 1 },
        ["giversx.1"] = { c = 3 },
        ["givers."] = { d = 4 },
        ["givers.111.extra"] = { e = 5 },
    }

    lu.assertEquals(self.config_store.accounts(snapshot, "givers"), { ["111"] = { a = 1 }, ["222"] = { b = 2 } })
    lu.assertEquals(self.config_store.accounts(snapshot, "settings"), {})
end

function TestConfigStore:test_save_sets_the_account_key()
    lu.assertTrue(self.config_store.save("givers", "111", { ["220"] = { displayName = "Gifter" } }))
    lu.assertEquals(self.config.get("givers.111"), { ["220"] = { displayName = "Gifter" } })
    lu.assertEquals(self.config.set_calls, { "givers.111" })
end

function TestConfigStore:test_save_at_the_limit_reaches_set()
    lu.assertEquals(VALUE_LIMIT, self.config_store.VALUE_LIMIT)
    lu.assertTrue(self.config_store.save("givers", "111", value_of_size(VALUE_LIMIT)))
    lu.assertEquals(self.config.set_calls, { "givers.111" })
end

function TestConfigStore:test_save_over_the_limit_is_refused_without_calling_set()
    lu.assertEquals({ self.config_store.save("givers", "111", value_of_size(VALUE_LIMIT + 1)) }, { false, "size_limit" })
    lu.assertEquals(self.config.set_calls, {})
end

function TestConfigStore:test_size_refusal_from_set_is_size_limit()
    self.config = support.new_fake_config({ value_limit = 1000 })
    self.env.config = self.config
    self.config.set("givers.111", { kept = true })

    lu.assertEquals({ self.config_store.save("givers", "111", value_of_size(2000)) }, { false, "size_limit" })
    lu.assertEquals(self.config.set_calls, { "givers.111", "givers.111" })
    lu.assertEquals(self.config.get("givers.111"), { kept = true })
end

function TestConfigStore:test_key_limit_refusal_is_save_failed_and_logged_with_a_masked_account()
    self.config = support.new_fake_config({ key_limit = 1 })
    self.env.config = self.config
    self.config.set("givers.111", {})

    lu.assertEquals({ self.config_store.save("givers", "1234569341", {}) }, { false, "save_failed" })

    local logged = self.env.find_log("key limit")
    lu.assertNotNil(logged)
    lu.assertStrContains(logged.message, "****9341")
    lu.assertNotStrContains(logged.message, "1234569341")
end

function TestConfigStore:test_a_failure_message_naming_the_key_is_logged_with_the_account_masked()
    self.config.set = function(key)
        return false, "rpc failed for " .. key
    end

    lu.assertEquals({ self.config_store.save("givers", "1234569341", {}) }, { false, "save_failed" })

    lu.assertStrContains(self.env.logs[#self.env.logs].message, "givers.****9341")
    for _, entry in ipairs(self.env.logs) do
        lu.assertNotStrContains(entry.message, "1234569341")
    end
end

-- Only a Steam account ID (digits, at most 10: a 32-bit number) may become a config key
function TestConfigStore:test_save_refuses_ids_that_are_not_steam_account_ids()
    for _, accountId in ipairs({ "1.2", "abc", "", "12345678901", "-1", "1 2" }) do
        lu.assertEquals({ self.config_store.save("givers", accountId, {}) }, { false, "save_failed" }, accountId)
    end
    lu.assertEquals(self.config.set_calls, {})
    lu.assertTrue(self.config_store.save("givers", "4294967295", {}))
end

function TestConfigStore:test_snapshot_returns_every_key_or_the_error()
    self.config.set("givers.111", { a = 1 })
    lu.assertEquals(self.config_store.snapshot(), { ["givers.111"] = { a = 1 } })

    self.config.fail_get_all = "IPC frame too large"
    lu.assertEquals({ self.config_store.snapshot() }, { nil, "IPC frame too large" })
end

function TestConfigStore:test_snapshot_without_config_is_unavailable()
    self.env.config = nil
    lu.assertEquals({ self.config_store.snapshot() }, { nil, "unavailable" })
end

-- The migration rule, each test a series of sessions with config.restart() between them

local JsonStore = require("lib.JsonStore")
local json = require("cjson")

local FILE = "gratitude_givers.json"
local MIGRATED = FILE .. ".migrated"
local GIFTS_111 = { ["220"] = { displayName = "Gifter" } }
local GIFTS_222 = { ["400"] = { displayName = "Another Gifter" } }

TestConfigMigration = { setUp = set_up, tearDown = tear_down }

-- A fresh store and one snapshot, as on_load takes them
function TestConfigMigration:session(fallback)
    local snapshot = self.config_store.snapshot()
    return self.config_store.migrate({
        prefix = "givers",
        store = JsonStore.new(FILE, "Giver store"),
        snapshot = snapshot,
        fallback_to_migrated = fallback ~= false,
    })
end

function TestConfigMigration:seed_config(accounts)
    for accountId, value in pairs(accounts) do
        self.config.set("givers." .. accountId, value)
    end
    self.config.restart()
end

function TestConfigMigration:sorted_set_calls()
    local calls = {}
    for _, key in ipairs(self.config.set_calls) do
        table.insert(calls, key)
    end
    table.sort(calls)
    return calls
end

function TestConfigMigration:test_file_accounts_are_copied_then_the_file_is_retired_next_session()
    self.env.write_file(FILE, json.encode({ ["111"] = GIFTS_111, ["222"] = GIFTS_222 }))

    local data, mode = self:session()
    lu.assertEquals(mode, "config")
    lu.assertEquals(data, { ["111"] = GIFTS_111, ["222"] = GIFTS_222 })
    lu.assertEquals(self:sorted_set_calls(), { "givers.111", "givers.222" })
    lu.assertEquals(self.env.list(), { FILE })

    self.config.restart()
    data, mode = self:session()
    lu.assertEquals(mode, "config")
    lu.assertEquals(data, { ["111"] = GIFTS_111, ["222"] = GIFTS_222 })
    lu.assertEquals(self.config.set_calls, {})
    lu.assertEquals(self.env.list(), { MIGRATED })
end

function TestConfigMigration:test_writes_lost_with_saving_disabled_are_copied_again_before_retiring()
    self.env.write_file(FILE, json.encode({ ["111"] = GIFTS_111, ["222"] = GIFTS_222 }))
    self.config.saving_disabled = true
    self:session()

    self.config.restart()
    local data = self:session()
    lu.assertEquals(data, { ["111"] = GIFTS_111, ["222"] = GIFTS_222 })
    lu.assertEquals(self:sorted_set_calls(), { "givers.111", "givers.222" })
    lu.assertEquals(self.env.list(), { FILE })

    self.config.restart()
    self:session()
    lu.assertEquals(self.config.set_calls, {})
    lu.assertEquals(self.env.list(), { MIGRATED })
end

function TestConfigMigration:test_only_accounts_missing_from_config_are_copied()
    self:seed_config({ ["111"] = GIFTS_111 })
    self.env.write_file(FILE, json.encode({ ["111"] = GIFTS_111, ["222"] = GIFTS_222 }))

    self:session()
    lu.assertEquals(self.config.set_calls, { "givers.222" })
    lu.assertEquals(self.env.list(), { FILE })

    self.config.restart()
    self:session()
    lu.assertEquals(self.env.list(), { MIGRATED })
end

function TestConfigMigration:test_config_wins_over_the_file()
    local edited = { ["220"] = { displayName = "Edited in config" } }
    self:seed_config({ ["111"] = edited })
    self.env.write_file(FILE, json.encode({ ["111"] = GIFTS_111 }))

    local data = self:session()

    lu.assertEquals(data, { ["111"] = edited })
    lu.assertEquals(self.config.set_calls, {})
    lu.assertEquals(self.config.get("givers.111"), edited)
end

function TestConfigMigration:test_a_file_with_no_accounts_is_retired_at_the_first_startup()
    self.env.write_file(FILE, "{}")

    local data, mode = self:session()

    lu.assertEquals(mode, "config")
    lu.assertEquals(data, {})
    lu.assertEquals(self.config.set_calls, {})
    lu.assertEquals(self.env.list(), { MIGRATED })
end

function TestConfigMigration:test_migrated_copy_fills_missing_accounts_only_with_fallback_on()
    self:seed_config({ ["111"] = GIFTS_111 })
    self.env.write_file(MIGRATED, json.encode({ ["111"] = { stale = true }, ["222"] = GIFTS_222 }))
    local before = self.env.snapshot_files()

    local data, mode = self:session(true)
    lu.assertEquals(mode, "config")
    lu.assertEquals(data, { ["111"] = GIFTS_111, ["222"] = GIFTS_222 })
    lu.assertEquals(self.config.set_calls, { "givers.222" })
    lu.assertEquals(self.env.snapshot_files(), before)

    self.config = support.new_fake_config()
    self.env.config = self.config
    data = self:session(false)
    lu.assertEquals(data, {})
    lu.assertEquals(self.config.set_calls, {})
    lu.assertEquals(self.env.snapshot_files(), before)
end

function TestConfigMigration:test_without_config_the_file_or_its_migrated_copy_is_used()
    self.env.config = nil
    self.env.write_file(MIGRATED, json.encode({ ["111"] = GIFTS_111 }))

    local data, mode = self:session(true)
    lu.assertEquals(mode, "file")
    lu.assertEquals(data, { ["111"] = GIFTS_111 })

    data, mode = self:session(false)
    lu.assertEquals(mode, "file")
    lu.assertEquals(data, {})

    self.env.write_file(FILE, json.encode({ ["222"] = GIFTS_222 }))
    data, mode = self:session(true)
    lu.assertEquals(mode, "file")
    lu.assertEquals(data, { ["222"] = GIFTS_222 })
    lu.assertEquals(self.env.list(), { FILE, MIGRATED })
end

function TestConfigMigration:test_a_failed_snapshot_uses_files_and_copies_nothing()
    self.env.write_file(FILE, json.encode({ ["111"] = GIFTS_111 }))
    self.config.fail_get_all = "IPC frame too large"

    local data, mode = self:session()

    lu.assertEquals(mode, "file")
    lu.assertEquals(data, { ["111"] = GIFTS_111 })
    lu.assertEquals(self.config.set_calls, {})
    lu.assertEquals(self.env.list(), { FILE })
end

function TestConfigMigration:test_an_unreadable_file_is_set_aside_not_retired_and_fallback_applies()
    self.env.freeze_time(1792200000)
    self.env.write_file(FILE, '{"111": {"cut off')
    self.env.write_file(MIGRATED, json.encode({ ["111"] = GIFTS_111 }))

    local data, mode = self:session()

    lu.assertEquals(mode, "config")
    lu.assertEquals(data, { ["111"] = GIFTS_111 })
    lu.assertEquals(self.config.set_calls, { "givers.111" })
    lu.assertEquals(self.env.list(), { FILE .. ".corrupted.1792200000", MIGRATED })
end

function TestConfigMigration:test_steady_state_sets_nothing_and_touches_no_file()
    self:seed_config({ ["111"] = GIFTS_111, ["222"] = GIFTS_222 })
    self.env.write_file(MIGRATED, json.encode({ ["111"] = { stale = true } }))
    local before = self.env.snapshot_files()

    local data = self:session()

    lu.assertEquals(data, { ["111"] = GIFTS_111, ["222"] = GIFTS_222 })
    lu.assertEquals(self.config.set_calls, {})
    lu.assertEquals(self.env.snapshot_files(), before)
end

-- A file that can't be opened may be healthy, so it is kept and nothing is copied from it
function TestConfigMigration:test_a_file_that_cannot_be_opened_is_kept_and_config_alone_is_used()
    self:seed_config({ ["111"] = GIFTS_111 })
    self.env.write_file(FILE, json.encode({ ["111"] = { stale = true }, ["222"] = GIFTS_222 }))
    self.env.write_file(MIGRATED, json.encode({ ["333"] = GIFTS_222 }))
    self.env.fail.open_read = "Permission denied"
    self.env.fail.only_path = "%.json$"
    local before = self.env.snapshot_files()

    local data, mode = self:session()

    lu.assertEquals(mode, "config")
    lu.assertEquals(data, { ["111"] = GIFTS_111 })
    lu.assertEquals(self.config.set_calls, {})
    lu.assertEquals(self.env.snapshot_files(), before)
end

-- When the source couldn't be read, only accounts keyed at startup may be saved

function TestConfigMigration:test_every_account_is_editable_when_the_source_was_read()
    self:seed_config({ ["111"] = GIFTS_111 })
    self.env.write_file(FILE, json.encode({ ["222"] = GIFTS_222 }))

    local _, _, editable = self:session()

    lu.assertNil(editable)
end

function TestConfigMigration:test_an_unreadable_store_file_limits_saves_to_accounts_keyed_at_startup()
    self:seed_config({ ["111"] = GIFTS_111 })
    self.env.write_file(FILE, json.encode({ ["222"] = GIFTS_222 }))
    self.env.fail.open_read = "Permission denied"
    self.env.fail.only_path = "%.json$"

    local _, mode, editable = self:session()

    lu.assertEquals(mode, "config")
    lu.assertEquals(editable, { ["111"] = true })
end

function TestConfigMigration:test_unreadable_migrated_copies_limit_saves_to_accounts_keyed_at_startup()
    self:seed_config({ ["111"] = GIFTS_111 })
    self.env.write_file(MIGRATED, json.encode({ ["222"] = GIFTS_222 }))
    self.env.fail.open_read = "Permission denied"
    self.env.fail.only_path = "%.migrated$"

    local data, _, editable = self:session()

    lu.assertEquals(data, { ["111"] = GIFTS_111 })
    lu.assertEquals(editable, { ["111"] = true })
end

function TestConfigMigration:test_a_failed_snapshot_with_config_present_makes_the_session_read_only()
    self.env.write_file(FILE, json.encode({ ["111"] = GIFTS_111 }))
    self.config.fail_get_all = "IPC frame too large"

    local data, mode, editable = self:session()

    lu.assertEquals(mode, "file")
    lu.assertEquals(data, { ["111"] = GIFTS_111 })
    lu.assertEquals(editable, {})
end

function TestConfigMigration:test_without_config_file_mode_saves_are_not_limited()
    self.env.config = nil
    self.env.write_file(FILE, json.encode({ ["111"] = GIFTS_111 }))

    local _, mode, editable = self:session()

    lu.assertEquals(mode, "file")
    lu.assertNil(editable)
end

-- A copy config refuses stays in memory and the file is kept, every session
function TestConfigMigration:test_a_refused_copy_keeps_the_account_in_memory_and_the_file()
    self.config = support.new_fake_config({ value_limit = 1000 })
    self.env.config = self.config
    local big = { ["220"] = { notes = string.rep("n", 1500) } }
    self.env.write_file(FILE, json.encode({ ["111"] = big }))

    for _ = 1, 2 do
        local data, mode = self:session()
        lu.assertEquals(mode, "config")
        lu.assertEquals(data, { ["111"] = big })
        lu.assertEquals(self.config.set_calls, { "givers.111" })
        lu.assertEquals(self.env.list(), { FILE })
        self.config.restart()
    end
    lu.assertNotNil(self.env.find_log("Copied 0 of 1 givers"))
end

-- A plugin reload reruns migrate against Millennium's memory, so it retires the file
-- even when that Steam run's config writes never reached disk; the next Steam start recovers the
-- gift records from .migrated
function TestConfigMigration:test_a_plugin_reload_retires_the_file_and_a_steam_restart_recovers_it()
    self.env.write_file(FILE, json.encode({ ["111"] = GIFTS_111 }))
    self.config.saving_disabled = true
    self:session()

    self:session()
    lu.assertEquals(self.env.list(), { MIGRATED })

    self.config.restart()
    lu.assertNil(self.config.get("givers.111"))
    local data = self:session()
    lu.assertEquals(data, { ["111"] = GIFTS_111 })
    lu.assertEquals(self.config.set_calls, { "givers.111" })
end

-- While a newer source is unread, an older one is shown but never copied into config

local OLD_GIFTS = { ["220"] = { displayName = "Old" } }
local NEW_GIFTS = { ["220"] = { displayName = "New" } }

function TestConfigMigration:test_an_older_copy_is_shown_but_not_copied_while_a_newer_one_is_unread()
    self.env.write_file(MIGRATED, json.encode({ ["111"] = OLD_GIFTS }))
    self.env.write_file(MIGRATED .. ".400", json.encode({ ["111"] = NEW_GIFTS }))
    self.env.fail.open_read = "Permission denied"
    self.env.fail.only_path = "%.migrated%.400$"

    local data, _, editable = self:session()
    lu.assertEquals(data, { ["111"] = OLD_GIFTS })
    lu.assertEquals(self.config.set_calls, {})
    lu.assertEquals(editable, {})

    self.env.fail.open_read = nil
    self.config.restart()
    data = self:session()
    lu.assertEquals(data, { ["111"] = NEW_GIFTS })
    lu.assertEquals(self.config.set_calls, { "givers.111" })
end

function TestConfigMigration:test_a_migrated_copy_is_not_copied_while_a_leftover_temporary_file_is_unread()
    self.env.write_file(FILE .. ".tmp", json.encode({ ["222"] = NEW_GIFTS }))
    self.env.write_file(MIGRATED, json.encode({ ["222"] = OLD_GIFTS }))
    self.env.fail.open_read = "Permission denied"
    self.env.fail.only_path = "%.tmp$"

    self:session()
    lu.assertEquals(self.config.set_calls, {})

    self.env.fail.open_read = nil
    self.config.restart()
    local data = self:session()
    lu.assertEquals(data, { ["222"] = NEW_GIFTS })
end

function TestConfigMigration:test_without_config_an_unread_newer_copy_makes_the_store_read_only()
    self.env.config = nil
    self.env.write_file(MIGRATED, json.encode({ ["111"] = OLD_GIFTS }))
    self.env.write_file(MIGRATED .. ".400", json.encode({ ["111"] = NEW_GIFTS }))
    self.env.fail.open_read = "Permission denied"
    self.env.fail.only_path = "%.migrated%.400$"

    local data, mode, editable = self:session()

    lu.assertEquals(mode, "file")
    lu.assertEquals(data, { ["111"] = OLD_GIFTS })
    lu.assertEquals(editable, {})
end
