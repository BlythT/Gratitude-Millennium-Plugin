-- Self-tests for tools/lua_test_support.lua
local lu = require("luaunit")
local support = require("lua_test_support")

TestLuaTestSupport = {}

function TestLuaTestSupport:setUp()
    self.env = support.new_env()
end

function TestLuaTestSupport:tearDown()
    self.env.cleanup()
end

function TestLuaTestSupport:test_temp_folder_exists_and_cleanup_removes_it()
    local dir = self.env.dir
    lu.assertStrMatches(dir, "/tmp/gratitude%-test%-.+")
    lu.assertTrue(require("fs").exists(dir))
    lu.assertEquals(require("utils").get_backend_path(), dir)

    self.env.cleanup()
    lu.assertFalse(require("fs").exists(dir))
end

function TestLuaTestSupport:test_prefix_names_the_temp_folder()
    self.env.cleanup()
    self.env = support.new_env({ prefix = "home-zebedee" })
    lu.assertStrContains(self.env.dir, "/tmp/home-zebedee-")
end

function TestLuaTestSupport:test_file_helpers_round_trip()
    self.env.write_file("a.json", "{}")
    lu.assertTrue(self.env.exists("a.json"))
    lu.assertEquals(self.env.read_file("a.json"), "{}")
    lu.assertEquals(self.env.list(), { "a.json" })
    lu.assertNil(self.env.read_file("missing.json"))
end

function TestLuaTestSupport:test_fail_close_closes_the_real_file_then_reports()
    local io = require("io")
    self.env.fail.close = "No space left on device"
    local file = io.open(self.env.dir .. "/a.json", "wb")
    lu.assertTrue(file:write("data") ~= nil)

    local ok, message = file:close()
    lu.assertNil(ok)
    lu.assertEquals(message, "No space left on device")
    lu.assertEquals(io.type(rawget(file, "_file")), "closed file")
    lu.assertEquals(self.env.read_file("a.json"), "data")
end

function TestLuaTestSupport:test_fail_write_and_open_switches()
    local io = require("io")
    local path = self.env.dir .. "/a.json"

    self.env.fail.write = "No space left on device"
    local file = io.open(path, "wb")
    local ok, message = file:write("data")
    lu.assertNil(ok)
    lu.assertEquals(message, "No space left on device")
    file:close()
    self.env.fail.write = nil

    self.env.fail.open_write = "Permission denied"
    local denied, openMessage = io.open(path, "w")
    lu.assertNil(denied)
    lu.assertStrContains(openMessage, "Permission denied")
    lu.assertEquals(self.env.opened_for_write, { path, path })
    self.env.fail.open_write = nil

    self.env.fail.open_read = "Permission denied"
    lu.assertNil(io.open(path, "r"))
    lu.assertNil(io.open(self.env.dir .. "/missing.json", "r"))
end

function TestLuaTestSupport:test_fail_read_returns_nil_and_message_for_matching_paths()
    local io = require("io")
    self.env.write_file("a.json", "data")
    self.env.write_file("a.json.tmp", "data")
    self.env.fail.read = "Lock violation"
    self.env.fail.only_path = "%.json$"

    local file = io.open(self.env.dir .. "/a.json", "r")
    lu.assertEquals({ file:read("*all") }, { nil, "Lock violation" })
    file:close()

    local other = io.open(self.env.dir .. "/a.json.tmp", "r")
    lu.assertEquals(other:read("*all"), "data")
    other:close()
end

function TestLuaTestSupport:test_fail_rename_count_fails_then_succeeds()
    local fs = require("fs")
    self.env.write_file("a.tmp", "new")
    self.env.fail.rename = { count = 2, message = "Access is denied" }
    local from, to = self.env.dir .. "/a.tmp", self.env.dir .. "/a.json"

    lu.assertEquals({ fs.rename(from, to) }, { nil, "Access is denied" })
    lu.assertEquals({ fs.rename(from, to) }, { nil, "Access is denied" })
    lu.assertTrue(fs.rename(from, to))
    lu.assertEquals(self.env.read_file("a.json"), "new")
    lu.assertFalse(self.env.exists("a.tmp"))
end

function TestLuaTestSupport:test_only_path_limits_failures_to_matching_paths()
    local io = require("io")
    self.env.fail.open_write = "Permission denied"
    self.env.fail.only_path = "gratitude_cache"

    lu.assertNil(io.open(self.env.dir .. "/gratitude_cache.json", "w"))
    local other = io.open(self.env.dir .. "/gratitude_givers.json", "w")
    lu.assertNotNil(other)
    other:close()
end

function TestLuaTestSupport:test_logger_sleep_and_time_are_captured()
    require("logger"):info("hello")
    require("logger"):error("broken")
    require("utils").sleep(50)
    self.env.freeze_time(1700000000)

    lu.assertEquals(self.env.logs, {
        { level = "info", message = "hello" },
        { level = "error", message = "broken" },
    })
    lu.assertEquals(self.env.sleeps, { 50 })
    lu.assertEquals(os.time(), 1700000000)

    self.env.cleanup()
    lu.assertNotEquals(os.time(), 1700000000)
end

function TestLuaTestSupport:test_millennium_config_follows_env()
    local millennium = require("millennium")
    lu.assertNil(millennium.config)
    self.env.config = { marker = true }
    lu.assertEquals(millennium.config, { marker = true })
    self.env.config = nil
    lu.assertNil(millennium.config)
end

function TestLuaTestSupport:test_fake_config_get_returns_nil_for_a_missing_key_and_copies_values()
    local config = support.new_fake_config()
    lu.assertNil(config.get("givers.111"))

    local value = { ["220"] = { notes = "hello" } }
    lu.assertTrue(config.set("givers.111", value))
    local first = config.get("givers.111")
    lu.assertEquals(first, value)

    first["220"].notes = "changed"
    value["220"].notes = "changed too"
    lu.assertEquals(config.get("givers.111"), { ["220"] = { notes = "hello" } })
    lu.assertEquals(config.set_calls, { "givers.111" })
end

function TestLuaTestSupport:test_fake_config_integer_keys_come_back_as_strings()
    local config = support.new_fake_config()
    config.set("givers.111", { [220] = "half-life", [1361210] = "darktide" })
    lu.assertEquals(config.get("givers.111"), { ["220"] = "half-life", ["1361210"] = "darktide" })
    lu.assertEquals(config.get("givers.111")[220], nil)
end

function TestLuaTestSupport:test_fake_config_refuses_a_value_over_the_limit_and_keeps_the_old_one()
    local config = support.new_fake_config({ value_limit = 1000 })
    lu.assertTrue(config.set("givers.111", { note = "short" }))

    local ok, message = config.set("givers.111", { note = string.rep("x", 2000) })
    lu.assertFalse(ok)
    lu.assertEquals(message, "plugin config value too large (max 256KB)")
    lu.assertEquals(config.get("givers.111"), { note = "short" })
end

function TestLuaTestSupport:test_fake_config_key_limit_refuses_new_keys_only()
    local config = support.new_fake_config({ key_limit = 2 })
    lu.assertTrue(config.set("givers.111", {}))
    lu.assertTrue(config.set("givers.222", {}))

    local ok, message = config.set("givers.333", {})
    lu.assertFalse(ok)
    lu.assertEquals(message, "plugin config key limit exceeded (max 256)")
    lu.assertNil(config.get("givers.333"))

    lu.assertTrue(config.set("givers.111", { updated = true }))
    lu.assertEquals(config.get("givers.111"), { updated = true })
end

function TestLuaTestSupport:test_fake_config_restart_keeps_saved_writes()
    local config = support.new_fake_config()
    config.set("consent.111", { allowed = true, timestamp = 100 })
    config.set("settings.111", { showFriendPickerSteamUrl = true })
    lu.assertTrue(config.delete("settings.111"))

    config.restart()
    lu.assertEquals(config.get("consent.111"), { allowed = true, timestamp = 100 })
    lu.assertNil(config.get("settings.111"))
    lu.assertEquals(config.set_calls, {})
end

function TestLuaTestSupport:test_fake_config_saving_disabled_loses_the_session_writes_on_restart()
    local config = support.new_fake_config()
    config.set("consent.111", { allowed = false, timestamp = 1 })
    config.saving_disabled = true

    lu.assertTrue(config.set("consent.111", { allowed = true, timestamp = 2 }))
    lu.assertTrue(config.set("givers.111", {}))
    lu.assertEquals(config.get("consent.111"), { allowed = true, timestamp = 2 })

    config.restart()
    lu.assertEquals(config.get("consent.111"), { allowed = false, timestamp = 1 })
    lu.assertNil(config.get("givers.111"))
    lu.assertFalse(config.saving_disabled)
end

function TestLuaTestSupport:test_fake_config_get_all_returns_copies_or_the_injected_error()
    local config = support.new_fake_config()
    config.set("givers.111", { a = 1 })
    config.set("consent.111", { allowed = true, timestamp = 1 })

    local all = config.get_all()
    lu.assertEquals(all, { ["givers.111"] = { a = 1 }, ["consent.111"] = { allowed = true, timestamp = 1 } })
    all["givers.111"].a = 2
    lu.assertEquals(config.get("givers.111"), { a = 1 })

    config.fail_get_all = "IPC frame too large"
    lu.assertEquals({ config.get_all() }, { nil, "IPC frame too large" })
end

function TestLuaTestSupport:test_start_backend_silences_print_until_cleanup()
    local before = print
    local backend = self.env.start_backend()
    lu.assertEquals(type(backend.on_unload), "function")
    lu.assertNotIs(print, before)

    self.env.cleanup()
    lu.assertIs(print, before)
end

function TestLuaTestSupport:test_payload_builders_apply_overrides_to_defaults()
    local json = require("cjson")
    lu.assertEquals(json.decode(support.giver_payload({ licenseKey = "400" })), {
        licenseKey = "400",
        libraryTitle = "Half-Life 2",
        displayName = "Gifter",
        source = "manual",
    })
    local entry = { acquisition = "Gift/Guest Pass", date = "Mar 5, 2025" }
    lu.assertEquals(json.decode(support.license_page()), { byAppId = { ["220"] = entry }, byName = {}, totalLicenses = 1 })
    lu.assertEquals(json.decode(support.license_page({ appId = "400", name = "Portal", totalLicenses = 2 })),
        { byAppId = { ["400"] = entry }, byName = { Portal = entry }, totalLicenses = 2 })
    lu.assertEquals(json.decode(support.friends_payload({ displayName = "Renamed" })),
        { { steamID64 = "76561197960265729", displayName = "Renamed" } })
    lu.assertEquals(json.decode(support.settings_payload(true)),
        { steamUserID = "111", settings = { showFriendPickerSteamUrl = true } })
    lu.assertEquals(json.decode(support.settings_payload(false, "222")).steamUserID, "222")
end

function TestLuaTestSupport:test_load_backend_defines_callables()
    local backend = self.env.load_backend()
    lu.assertEquals(type(SetConsent), "function")
    lu.assertEquals(type(backend), "table")
    lu.assertEquals(type(backend.on_load), "function")
end

function TestLuaTestSupport:test_fail_list_makes_fs_list_return_nil_and_the_message()
    self.env.fail.list = "Permission denied"
    lu.assertEquals({ require("fs").list(self.env.dir) }, { nil, "Permission denied" })
end

-- Millennium's validate_limits checks the key length, then the key limit, then the value size
function TestLuaTestSupport:test_fake_config_checks_key_length_and_limit_before_size()
    local config = support.new_fake_config({ key_limit = 1, value_limit = 10 })
    lu.assertEquals({ config.set(string.rep("k", 513), { note = string.rep("x", 50) }) },
        { false, "config key too long (max 512 bytes)" })
    lu.assertTrue(config.set("givers.111", {}))

    lu.assertEquals({ config.set("givers.222", { note = string.rep("x", 50) }) },
        { false, "plugin config key limit exceeded (max 256)" })
end
