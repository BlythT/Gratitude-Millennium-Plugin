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
end

function TestLuaTestSupport:test_load_backend_defines_callables()
    local backend = self.env.load_backend()
    lu.assertEquals(type(SetConsent), "function")
    lu.assertEquals(type(backend), "table")
    lu.assertEquals(type(backend.on_load), "function")
end
