-- Test suite for backend/lib/browser_hooks.lua
local browser_hooks = require("backend.lib.browser_hooks")

local function assert_equal(expected, actual, message)
    if expected ~= actual then
        error(message .. " (Expected: " .. tostring(expected) .. ", Got: " .. tostring(actual) .. ")", 2)
    end
end

-- A stand-in for the millennium module: version() returns `version`, and cmp_version returns
-- `cmp_result` (or throws when it is "error"), recording what it was asked to compare.
local function fake_millennium(version, cmp_result)
    local fake = { compared = nil }
    function fake.version()
        return version
    end
    function fake.cmp_version(a, b)
        fake.compared = { a, b }
        if cmp_result == "error" then
            error("cannot compare")
        end
        return cmp_result
    end
    return fake
end

local function run_tests()
    print("Running Lua browser_hooks tests...")

    local current = fake_millennium("v3.6.1", 1)
    assert_equal(false, browser_hooks.needs_browser_hooks(current), "3.6.1 injects into Steam pages itself")
    assert_equal("3.6.1", current.compared[1], "The running version is compared without its v prefix")
    assert_equal("3.3.0", current.compared[2], "against 3.3.0")

    assert_equal(false, browser_hooks.needs_browser_hooks(fake_millennium("v3.3.0", 0)), "3.3.0 injects into Steam pages itself")
    assert_equal(true, browser_hooks.needs_browser_hooks(fake_millennium("v3.2.0", -1)), "3.2.0 needs the hooks")
    assert_equal(true, browser_hooks.needs_browser_hooks(fake_millennium("garbage", -2)), "An unparseable version keeps the hooks")
    local plain = fake_millennium("3.6.1", 1)
    browser_hooks.needs_browser_hooks(plain)
    assert_equal("3.6.1", plain.compared[1], "A version without a v prefix is compared as is")
    assert_equal(true, browser_hooks.needs_browser_hooks(fake_millennium("v3.6.1", "error")), "A failed comparison keeps the hooks")
    assert_equal(true, browser_hooks.needs_browser_hooks(fake_millennium("v3.6.1", nil)), "A non-number comparison keeps the hooks")

    print("All tests passed successfully!")
end

run_tests()
