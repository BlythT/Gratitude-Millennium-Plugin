-- Tests for backend/lib/JsonStore.lua
local lu = require("luaunit")
local support = require("lua_test_support")
local JsonStore = require("lib.JsonStore")
local fs = require("fs")
local utils = require("utils")

local FILE_NAME = "gratitude_givers.json"

TestJsonStore = {}

function TestJsonStore:setUp()
    self.env = support.new_env()
    self.store = JsonStore.new(FILE_NAME, "Giver store")
end

function TestJsonStore:tearDown()
    self.env.cleanup()
end

-- Characterization: behavior that stays

function TestJsonStore:test_missing_file_loads_empty_table_or_default()
    lu.assertEquals(self.store:load(), {})
    lu.assertEquals(self.store:load({ fallback = true }), { fallback = true })
    lu.assertEquals(self.env.list(), {})
end

function TestJsonStore:test_empty_object_file_loads_and_is_not_renamed()
    self.env.write_file(FILE_NAME, "{}")

    lu.assertEquals(self.store:load({ fallback = true }), {})
    lu.assertEquals(self.env.list(), { FILE_NAME })
    lu.assertEquals(self.env.read_file(FILE_NAME), "{}")
end

function TestJsonStore:test_save_then_load_round_trips_nested_tables()
    local data = {
        ["1234569341"] = {
            ["220"] = { displayName = "Someone", source = "manual", nested = { deeper = { "a", "b" } } },
        },
        other = { flag = true, count = 3 },
    }

    lu.assertTrue(self.store:save(data))
    lu.assertEquals(JsonStore.new(FILE_NAME, "Giver store"):load(), data)
end

function TestJsonStore:test_unencodable_data_returns_false_and_leaves_file_unchanged()
    local original = '{"kept":true}'
    self.env.write_file(FILE_NAME, original)

    lu.assertFalse(self.store:save({ broken = function() end }))
    lu.assertEquals(self.env.read_file(FILE_NAME), original)
end

function TestJsonStore:test_path_joins_backend_path_and_file_name()
    lu.assertEquals(self.store.path, fs.join(utils.get_backend_path(), FILE_NAME))
end

-- Atomic, checked saves

local CONTENT_A = '{"version":"A"}'
local CONTENT_B = { version = "B" }

function TestJsonStore:assertSaveFailsKeepingA(expectedReason)
    self.env.write_file(FILE_NAME, CONTENT_A)

    local ok, reason = self.store:save(CONTENT_B)
    lu.assertFalse(ok)
    lu.assertStrContains(tostring(reason), expectedReason)
    lu.assertEquals(self.env.read_file(FILE_NAME), CONTENT_A)
    lu.assertFalse(self.env.exists(FILE_NAME .. ".tmp"))
    lu.assertNil(self.env.find_log("saved successfully"))
end

function TestJsonStore:test_close_failure_returns_reason_and_keeps_previous_file()
    self.env.fail.close = "No space left on device"
    self:assertSaveFailsKeepingA("No space left on device")
    lu.assertNotNil(self.env.find_log("No space left on device", "error"))
end

function TestJsonStore:test_write_failure_returns_reason_and_keeps_previous_file()
    self.env.fail.write = "No space left on device"
    self:assertSaveFailsKeepingA("No space left on device")
end

function TestJsonStore:test_open_failure_returns_reason_and_keeps_previous_file()
    self.env.fail.open_write = "Permission denied"
    self:assertSaveFailsKeepingA("Permission denied")
end

function TestJsonStore:test_save_writes_only_the_temporary_file()
    self.env.write_file(FILE_NAME, CONTENT_A)

    lu.assertTrue(self.store:save(CONTENT_B))
    lu.assertEquals(self.env.opened_for_write, { self.store.path .. ".tmp" })
end

function TestJsonStore:test_store_dir_is_the_backend_path()
    lu.assertEquals(self.store.dir, utils.get_backend_path())
end

function TestJsonStore:test_rename_retries_after_short_sleeps()
    self.env.write_file(FILE_NAME, CONTENT_A)
    self.env.fail.rename = { count = 2 }

    lu.assertTrue(self.store:save(CONTENT_B))
    lu.assertEquals(JsonStore.new(FILE_NAME, "Giver store"):load(), CONTENT_B)
    lu.assertEquals(self.env.sleeps, { 50, 50 })
    lu.assertFalse(self.env.exists(FILE_NAME .. ".tmp"))
end

function TestJsonStore:test_rename_gives_up_after_five_attempts()
    self.env.fail.rename = { count = math.huge, message = "Access is denied" }
    self:assertSaveFailsKeepingA("Access is denied")
    lu.assertEquals(self.env.sleeps, { 50, 50, 50, 50 })
end

-- Leftover temporary file

function TestJsonStore:test_load_removes_leftover_temporary_file()
    self.env.write_file(FILE_NAME, CONTENT_A)
    self.env.write_file(FILE_NAME .. ".tmp", '{"version":"B", "cut')

    lu.assertEquals(self.store:load(), { version = "A" })
    lu.assertFalse(self.env.exists(FILE_NAME .. ".tmp"))
    lu.assertEquals(self.env.list(), { FILE_NAME })
end

-- The store file is the last completed save, so it wins over even a valid leftover
function TestJsonStore:test_store_file_wins_over_a_valid_leftover_temporary_file()
    self.env.write_file(FILE_NAME, CONTENT_A)
    self.env.write_file(FILE_NAME .. ".tmp", '{"version":"B"}')

    lu.assertEquals(self.store:load(), { version = "A" })
    lu.assertEquals(self.env.list(), { FILE_NAME })
end

-- A first ever save killed between close and rename leaves the only copy in the temporary file
function TestJsonStore:test_valid_leftover_is_promoted_when_no_store_file_exists()
    self.env.write_file(FILE_NAME .. ".tmp", '{"version":"B"}')

    lu.assertEquals(self.store:load(), { version = "B" })
    lu.assertEquals(self.env.list(), { FILE_NAME })
    lu.assertEquals(self.env.read_file(FILE_NAME), '{"version":"B"}')
    local logged = self.env.find_log("Promoted leftover")
    lu.assertNotNil(logged, "expected a log naming the promoted file")
    lu.assertStrContains(logged.message, FILE_NAME)
end

function TestJsonStore:test_broken_leftover_is_removed_when_no_store_file_exists()
    self.env.write_file(FILE_NAME .. ".tmp", '{"version":"B", "cut')

    lu.assertEquals(self.store:load(), {})
    lu.assertEquals(self.env.list(), {})
end

-- Setting aside unreadable files

local FROZEN_TIME = 1700000000
local CORRUPTED_NAME = FILE_NAME .. ".corrupted." .. FROZEN_TIME

function TestJsonStore:assertSetAside(content)
    self.env.freeze_time(FROZEN_TIME)
    self.env.write_file(FILE_NAME, content)

    local loaded = self.store:load({ fallback = true })

    lu.assertTrue(self.env.exists(CORRUPTED_NAME))
    lu.assertEquals(self.env.read_file(CORRUPTED_NAME), content)
    lu.assertFalse(self.env.exists(FILE_NAME))
    lu.assertEquals(loaded, { fallback = true })
    local logged = self.env.find_log(CORRUPTED_NAME, "error")
    lu.assertNotNil(logged)
    lu.assertNotStrContains(logged.message, self.env.dir)

    lu.assertTrue(self.store:save({ fresh = true }))
    lu.assertEquals(self.env.read_file(FILE_NAME), '{"fresh":true}')
end

function TestJsonStore:test_zero_byte_file_is_set_aside()
    self:assertSetAside("")
end

function TestJsonStore:test_whitespace_only_file_is_set_aside()
    self:assertSetAside("  \n\t ")
end

function TestJsonStore:test_truncated_json_file_is_set_aside()
    self:assertSetAside('{"a":')
end

function TestJsonStore:test_null_file_is_set_aside()
    self:assertSetAside("null")
end

function TestJsonStore:test_number_file_is_set_aside()
    self:assertSetAside("42")
end

function TestJsonStore:test_string_file_is_set_aside()
    self:assertSetAside('"text"')
end

function TestJsonStore:test_boolean_file_is_set_aside()
    self:assertSetAside("true")
end

function TestJsonStore:test_empty_array_file_loads_and_is_not_renamed()
    self.env.write_file(FILE_NAME, "[]")

    lu.assertEquals(self.store:load({ fallback = true }), {})
    lu.assertEquals(self.env.list(), { FILE_NAME })
    lu.assertEquals(self.env.read_file(FILE_NAME), "[]")
end

-- Refusing saves when a file can't be safely replaced

local UNREADABLE = '{"a":'

-- Saves after load return false without opening anything; the reason was logged once, at load.
-- name is the file that must keep its original content, the store file by default.
function TestJsonStore:assertSavesRefused(original, name)
    local logCountAfterLoad = #self.env.logs

    local ok, reason = self.store:save(CONTENT_B)
    lu.assertFalse(ok)
    lu.assertEquals({ self.store:save(CONTENT_B) }, { false, reason })
    lu.assertEquals(self.env.opened_for_write, {})
    lu.assertEquals(self.env.read_file(name or FILE_NAME), original)
    lu.assertEquals(#self.env.logs, logCountAfterLoad)
    lu.assertNotNil(self.env.find_log(tostring(reason), "error"))
    lu.assertNotStrContains(tostring(reason), self.env.dir)
end

function TestJsonStore:test_existing_set_aside_name_refuses_saves()
    self.env.freeze_time(FROZEN_TIME)
    self.env.write_file(FILE_NAME, UNREADABLE)
    self.env.write_file(CORRUPTED_NAME, "earlier copy")

    lu.assertEquals(self.store:load({ fallback = true }), { fallback = true })
    lu.assertEquals(self.env.read_file(FILE_NAME), UNREADABLE)
    lu.assertEquals(self.env.read_file(CORRUPTED_NAME), "earlier copy")
    self:assertSavesRefused(UNREADABLE)
end

function TestJsonStore:test_failed_set_aside_refuses_saves()
    self.env.freeze_time(FROZEN_TIME)
    self.env.write_file(FILE_NAME, UNREADABLE)
    self.env.fail.rename = { count = math.huge }

    lu.assertEquals(self.store:load({ fallback = true }), { fallback = true })
    lu.assertEquals(self.env.list(), { FILE_NAME })
    lu.assertEquals(self.env.read_file(FILE_NAME), UNREADABLE)
    lu.assertEquals(self.env.sleeps, { 50, 50, 50, 50 })

    -- the lock clearing later in the session doesn't make overwriting safe
    self.env.fail.rename = nil
    self:assertSavesRefused(UNREADABLE)
end

function TestJsonStore:test_unopenable_file_is_left_in_place_and_refuses_saves()
    self.env.write_file(FILE_NAME, CONTENT_A)
    self.env.fail.open_read = "Permission denied"

    lu.assertEquals(self.store:load({ fallback = true }), { fallback = true })
    lu.assertEquals(self.env.list(), { FILE_NAME })

    self.env.fail.open_read = nil
    self:assertSavesRefused(CONTENT_A)
end

-- Keeping a leftover temporary file that can't be promoted or checked. Without a store file
-- it may be the only copy of a first save, and a save would write over it.

local LEFTOVER_NAME = FILE_NAME .. ".tmp"
local LEFTOVER = '{"version":"B"}'

function TestJsonStore:test_valid_leftover_is_kept_when_promotion_fails()
    self.env.write_file(LEFTOVER_NAME, LEFTOVER)
    self.env.fail.rename = { count = math.huge }

    lu.assertEquals(self.store:load({ fallback = true }), { fallback = true })
    lu.assertEquals(self.env.list(), { LEFTOVER_NAME })
    lu.assertNil(self.env.find_log("Removed leftover"))

    -- the lock clearing later in the session doesn't make writing over the leftover safe
    self.env.fail.rename = nil
    self:assertSavesRefused(LEFTOVER, LEFTOVER_NAME)
end

function TestJsonStore:test_unopenable_leftover_is_kept_and_refuses_saves()
    self.env.write_file(LEFTOVER_NAME, LEFTOVER)
    self.env.fail.open_read = "Permission denied"
    self.env.fail.only_path = "%.tmp$"

    lu.assertEquals(self.store:load({ fallback = true }), { fallback = true })
    lu.assertEquals(self.env.list(), { LEFTOVER_NAME })
    local logged = self.env.find_log("Permission denied", "error")
    lu.assertNotNil(logged)
    lu.assertNotStrContains(logged.message, self.env.dir)

    self.env.fail.open_read = nil
    self:assertSavesRefused(LEFTOVER, LEFTOVER_NAME)
end

function TestJsonStore:test_unreadable_leftover_is_kept_and_refuses_saves()
    self.env.write_file(LEFTOVER_NAME, LEFTOVER)
    self.env.fail.read = "Lock violation"
    self.env.fail.only_path = "%.tmp$"

    lu.assertEquals(self.store:load({ fallback = true }), { fallback = true })
    lu.assertEquals(self.env.list(), { LEFTOVER_NAME })

    self.env.fail.read = nil
    self:assertSavesRefused(LEFTOVER, LEFTOVER_NAME)
end

-- os.remove can't delete a folder that has a file in it, which stands in for a locked file
function TestJsonStore:test_failed_leftover_removal_is_not_logged_as_removed()
    self.env.write_file(FILE_NAME, CONTENT_A)
    os.execute("mkdir '" .. self.env.dir .. "/" .. LEFTOVER_NAME .. "'")
    self.env.write_file(LEFTOVER_NAME .. "/inner", "x")

    lu.assertEquals(self.store:load(), { version = "A" })
    lu.assertTrue(self.env.exists(LEFTOVER_NAME))
    lu.assertNil(self.env.find_log("Removed leftover"))
    local logged = self.env.find_log(LEFTOVER_NAME, "warn")
    lu.assertNotNil(logged)
    lu.assertNotStrContains(logged.message, self.env.dir)
end

-- A read error is treated like an open failure, not an empty file

function TestJsonStore:test_read_error_leaves_file_in_place_and_refuses_saves()
    self.env.write_file(FILE_NAME, CONTENT_A)
    self.env.fail.read = "Lock violation"

    lu.assertEquals(self.store:load({ fallback = true }), { fallback = true })
    lu.assertEquals(self.env.list(), { FILE_NAME })
    local logged = self.env.find_log("Lock violation", "error")
    lu.assertNotNil(logged)
    lu.assertNotStrContains(logged.message, self.env.dir)

    self.env.fail.read = nil
    self:assertSavesRefused(CONTENT_A)
end

-- Retiring store files and reading .migrated copies, which are never replaced

local MIGRATED = FILE_NAME .. ".migrated"
local RETIRE_TIME = 1792200000

function TestJsonStore:test_exists_reports_whether_the_store_file_is_present()
    lu.assertFalse(self.store:exists())
    self.env.write_file(FILE_NAME, CONTENT_A)
    lu.assertTrue(self.store:exists())
end

function TestJsonStore:test_retire_renames_the_file_to_migrated()
    self.env.write_file(FILE_NAME, CONTENT_A)

    lu.assertEquals(self.store:retire(), self.store.path .. ".migrated")
    lu.assertEquals(self.env.list(), { MIGRATED })
    lu.assertEquals(self.env.read_file(MIGRATED), CONTENT_A)
end

function TestJsonStore:test_retire_uses_a_timestamped_name_when_migrated_exists()
    self.env.freeze_time(RETIRE_TIME)
    self.env.write_file(MIGRATED, '{"older":true}')
    self.env.write_file(FILE_NAME, CONTENT_A)

    lu.assertEquals(self.store:retire(), self.store.path .. ".migrated." .. RETIRE_TIME)
    lu.assertEquals(self.env.read_file(MIGRATED), '{"older":true}')
    lu.assertEquals(self.env.read_file(MIGRATED .. "." .. RETIRE_TIME), CONTENT_A)
    lu.assertFalse(self.env.exists(FILE_NAME))
    local logged = self.env.find_log(MIGRATED .. "." .. RETIRE_TIME)
    lu.assertNotNil(logged)
    lu.assertNotStrContains(logged.message, self.env.dir)
end

function TestJsonStore:test_retire_refuses_when_both_names_exist()
    self.env.freeze_time(RETIRE_TIME)
    self.env.write_file(MIGRATED, '{"older":true}')
    self.env.write_file(MIGRATED .. "." .. RETIRE_TIME, '{"newer":true}')
    self.env.write_file(FILE_NAME, CONTENT_A)
    local before = self.env.snapshot_files()

    local retired, reason = self.store:retire()

    lu.assertNil(retired)
    lu.assertStrContains(reason, "already exists")
    lu.assertNotStrContains(reason, self.env.dir)
    lu.assertEquals(self.env.snapshot_files(), before)
end

function TestJsonStore:test_retire_reports_a_failed_rename_and_keeps_the_file()
    self.env.write_file(FILE_NAME, CONTENT_A)
    self.env.fail.rename = { count = math.huge, message = "Access is denied" }

    local retired, reason = self.store:retire()

    lu.assertNil(retired)
    lu.assertStrContains(reason, "Access is denied")
    lu.assertEquals(self.env.list(), { FILE_NAME })
end

function TestJsonStore:test_load_newest_migrated_picks_the_highest_timestamp()
    self.env.write_file(MIGRATED, '{"copy":"plain"}')
    self.env.write_file(MIGRATED .. ".200", '{"copy":"200"}')
    self.env.write_file(MIGRATED .. ".1000", '{"copy":"1000"}')
    -- Names a match must ignore
    self.env.write_file(MIGRATED .. ".abc", '{"copy":"abc"}')
    self.env.write_file(FILE_NAME .. ".corrupted.5000", '{"copy":"corrupted"}')
    self.env.write_file("gratitude_consent.json.migrated.9000", '{"copy":"consent"}')
    self.env.write_file("x" .. MIGRATED .. ".9000", '{"copy":"prefixed"}')
    local before = self.env.snapshot_files()

    lu.assertEquals(self.store:load_newest_migrated(), { copy = "1000" })
    lu.assertEquals(self.env.snapshot_files(), before)
end

function TestJsonStore:test_load_newest_migrated_reads_plain_migrated_when_it_is_the_only_copy()
    self.env.write_file(MIGRATED, '{"copy":"plain"}')
    lu.assertEquals(self.store:load_newest_migrated(), { copy = "plain" })
end

function TestJsonStore:test_load_newest_migrated_returns_nil_without_copies()
    self.env.write_file(FILE_NAME, CONTENT_A)
    lu.assertNil(self.store:load_newest_migrated())
end

function TestJsonStore:test_load_newest_migrated_skips_unreadable_copies_and_changes_nothing()
    self.env.write_file(MIGRATED, '{"copy":"plain"}')
    self.env.write_file(MIGRATED .. ".100", '{"copy":"100"}')
    self.env.write_file(MIGRATED .. ".200", "null")
    self.env.write_file(MIGRATED .. ".300", '{"cut off')
    self.env.write_file(MIGRATED .. ".400", '{"copy":"400"}')
    self.env.fail.open_read = "Permission denied"
    self.env.fail.only_path = "%.migrated%.400$"
    local before = self.env.snapshot_files()

    lu.assertEquals(self.store:load_newest_migrated(), { copy = "100" })

    lu.assertEquals(self.env.snapshot_files(), before)
    for _, skipped in ipairs({ ".400", ".300", ".200" }) do
        local logged = self.env.find_log(MIGRATED .. skipped)
        lu.assertNotNil(logged, skipped)
        lu.assertNotStrContains(logged.message, self.env.dir)
    end
end

-- Copies that exist but couldn't be read are reported, so callers don't save over them

function TestJsonStore:test_load_newest_migrated_reports_copies_it_could_not_read()
    self.env.write_file(MIGRATED, '{"copy":"plain"}')
    self.env.write_file(MIGRATED .. ".300", '{"cut off')
    lu.assertEquals({ self.store:load_newest_migrated() }, { { copy = "plain" }, false })

    self.env.write_file(MIGRATED .. ".400", '{"copy":"400"}')
    self.env.fail.open_read = "Permission denied"
    self.env.fail.only_path = "%.migrated%.400$"
    lu.assertEquals({ self.store:load_newest_migrated() }, { { copy = "plain" }, true })

    self.env.fail.only_path = "%.migrated"
    lu.assertEquals({ self.store:load_newest_migrated() }, { nil, true })
end

function TestJsonStore:test_load_newest_migrated_without_copies_reports_nothing_unread()
    lu.assertEquals({ self.store:load_newest_migrated() }, { nil, false })
end

-- A folder that can't be listed counts as copies that couldn't be read
function TestJsonStore:test_load_newest_migrated_treats_a_failed_listing_as_unread()
    self.env.write_file(MIGRATED, '{"copy":"plain"}')
    self.env.fail.list = "Permission denied"

    lu.assertEquals({ self.store:load_newest_migrated() }, { nil, true })
    local logged = self.env.find_log("Permission denied", "warn")
    lu.assertNotNil(logged)
    lu.assertNotStrContains(logged.message, self.env.dir)
end

-- fs.exists reports false on any stat error, so a file that can still be opened counts as present
function TestJsonStore:test_a_file_stat_cannot_see_but_open_can_read_still_loads()
    self.env.write_file(FILE_NAME, CONTENT_A)
    self.env.fail.exists = "stat failed"
    self.env.fail.only_path = "%.json$"

    lu.assertEquals(self.store:load(), { version = "A" })
    lu.assertTrue(self.store:exists())
    lu.assertNil(self.env.find_log("doesn't exist"))
end
