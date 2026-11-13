-- Test suite for backend/lib/cache_merger.lua
local cache_merger = require("backend.lib.cache_merger")

local function assert_equal(expected, actual, message)
    if expected ~= actual then
        error(message .. " (Expected: " .. tostring(expected) .. ", Got: " .. tostring(actual) .. ")", 2)
    end
end

local function assert_type(expected_type, val, message)
    if type(val) ~= expected_type then
        error(message .. " (Expected type: " .. expected_type .. ", Got: " .. type(val) .. ")", 2)
    end
end

local function run_tests()
    print("Running Lua cache_merger tests...")

    -- Test 1: Initializing empty cache
    local cache1, byAppIdSize1, byNameSize1, isNewFormat1 = cache_merger.merge_license_page(nil, {
        byAppId = { ["123"] = { acquisition = "Gift", date = "Jan 1, 2023" } },
        byName = { ["Test Game"] = { acquisition = "Gift", date = "Jan 1, 2023" } },
        totalLicenses = 100
    })

    assert_equal(1, byAppIdSize1, "byAppId should have 1 entry")
    assert_equal(1, byNameSize1, "byName should have 1 entry")
    -- The old count isn't trusted: a sync that stopped part way could have sent it
    assert_equal(nil, cache1.totalLicenses, "totalLicenses from a page is ignored")
    assert_equal(true, isNewFormat1, "should detect new format")

    -- Test 2: Appending to existing cache (ensuring no overwrites of unrelated keys)
    local incomingPage2 = {
        byAppId = { ["456"] = { acquisition = "Purchase", date = "Feb 2, 2023" } },
        byName = { ["Another Game"] = { acquisition = "Purchase", date = "Feb 2, 2023" } }
    }
    
    local cache2, byAppIdSize2, byNameSize2, isNewFormat2 = cache_merger.merge_license_page(cache1, incomingPage2)
    
    assert_equal(2, byAppIdSize2, "byAppId should have 2 entries after merge")
    assert_equal(2, byNameSize2, "byName should have 2 entries after merge")
    assert_equal("Gift", cache2.byAppId["123"].acquisition, "Original data should be preserved")
    assert_equal("Purchase", cache2.byAppId["456"].acquisition, "New data should be merged")
    
    -- Test 3: Legacy format fallback
    local legacyIncoming = {
        { item = "Legacy Game", acquisition = "Gift", date = "Mar 3, 2023" }
    }
    
    local cache3, byAppIdSize3, byNameSize3, isNewFormat3 = cache_merger.merge_license_page(cache2, legacyIncoming)
    
    assert_equal(false, isNewFormat3, "should detect legacy format")
    assert_equal(2, byAppIdSize3, "byAppId should still have 2 entries")
    assert_equal(3, byNameSize3, "byName should have 3 entries (added legacy game)")
    assert_equal("Gift", cache3.byName["Legacy Game"].acquisition, "Legacy item should be added correctly")

    -- Test 4: Nil incoming data (should return current cache unmodified)
    local cache4, byAppIdSize4, byNameSize4, isNewFormat4 = cache_merger.merge_license_page(cache3, nil)
    assert_equal(2, byAppIdSize4, "byAppId size should remain 2")
    assert_equal(3, byNameSize4, "byName size should remain 3")
    assert_equal(nil, isNewFormat4, "isNewFormat should be nil for nil incoming data")

    -- Test 5: Bad data types (e.g. string or number instead of table)
    local cache5, byAppIdSize5, byNameSize5, isNewFormat5 = cache_merger.merge_license_page(cache4, "this is not a table")
    assert_equal(2, byAppIdSize5, "Bad string data: byAppId size should remain 2")
    assert_equal(3, byNameSize5, "Bad string data: byName size should remain 3")
    assert_equal(false, isNewFormat5, "Bad string data: should not detect as new format")

    local cache6, byAppIdSize6, byNameSize6, isNewFormat6 = cache_merger.merge_license_page(cache5, 12345)
    assert_equal(2, byAppIdSize6, "Bad number data: byAppId size should remain 2")
    assert_equal(3, byNameSize6, "Bad number data: byName size should remain 3")
    assert_equal(false, isNewFormat6, "Bad number data: should not detect as new format")

    -- Test 6: Overwriting existing keys
    -- If a game license is fetched again, the newer data overwrites the old data in the cache dictionary.
    local overwriteIncoming = {
        byAppId = { ["123"] = { acquisition = "Retail", date = "Jan 2, 2023" } }, -- 123 was Gift previously
    }
    local cache7, byAppIdSize7, byNameSize7, isNewFormat7 = cache_merger.merge_license_page(cache6, overwriteIncoming)
    assert_equal(2, byAppIdSize7, "byAppId size should remain 2 after overwrite")
    assert_equal("Retail", cache7.byAppId["123"].acquisition, "Existing key should be overwritten")

    -- Test 7: Malformed legacy array (missing item name)
    local malformedLegacy = {
        { acquisition = "Gift", date = "Apr 4, 2023" }, -- missing item name
        { item = "Valid Legacy", acquisition = "Store", date = "Apr 5, 2023" }
    }
    local cache8, byAppIdSize8, byNameSize8, isNewFormat8 = cache_merger.merge_license_page(cache7, malformedLegacy)
    assert_equal(4, byNameSize8, "Only the valid legacy item should be added")
    assert_type("table", cache8.byName["Valid Legacy"], "Valid legacy item was added")
    assert_equal("Store", cache8.byName["Valid Legacy"].acquisition, "Valid legacy item data is correct")

    -- Test 8: The completed sync count is stored only when a page carries it
    local cache9 = cache_merger.merge_license_page(nil, {
        byName = { ["Page One Game"] = { acquisition = "Gift", date = "May 1, 2023" } },
    })
    assert_equal(nil, cache9.completedLicenseCount, "A page without a completed count must not set one")
    local cache10 = cache_merger.merge_license_page(cache9, {
        byName = { ["Last Page Game"] = { acquisition = "Gift", date = "May 2, 2023" } },
        completedLicenseCount = 2,
    })
    assert_equal(2, cache10.completedLicenseCount, "The last page of a finished sync sets the completed count")
    local cache11 = cache_merger.merge_license_page(cache10, {
        byName = { ["Next Sync Page One"] = { acquisition = "Gift", date = "May 3, 2023" } },
    })
    assert_equal(2, cache11.completedLicenseCount, "A later page without a count keeps the previous completed count")

    -- Test 9: Loading from disk keeps the completed count, so an unchanged library isn't re-synced
    local loaded = cache_merger.normalize_loaded_cache({
        ["111"] = {
            byAppId = { ["10"] = { acquisition = "Gift", date = "Jun 1, 2023" } },
            byName = {},
            completedLicenseCount = 42,
            totalLicenses = 42,
        },
        ["222"] = { ["Old Name Only"] = { acquisition = "Gift", date = "Jun 2, 2023" } },
        ["333"] = { byName = {}, completedLicenseCount = "42" },
        ["444"] = "not a table",
    })
    assert_equal(42, loaded["111"].completedLicenseCount, "completedLicenseCount should survive a load")
    assert_equal(nil, loaded["111"].totalLicenses, "The old count, which a partial sync could have set, is dropped")
    assert_equal("Gift", loaded["111"].byAppId["10"].acquisition, "byAppId should survive a load")
    assert_equal("Gift", loaded["222"].byName["Old Name Only"].acquisition, "A name-only cache is migrated to byName")
    assert_type("table", loaded["222"].byAppId, "A migrated cache gets an empty byAppId")
    assert_equal(nil, loaded["333"].completedLicenseCount, "A count that isn't a number is dropped")
    assert_equal(nil, loaded["444"], "An account whose cache isn't a table is dropped")
    assert_equal(nil, next(cache_merger.normalize_loaded_cache(nil) or {}), "A missing file loads as an empty cache")

    -- Test 10: Only accounts that allowed local storage are written to disk
    local saved = cache_merger.consented_only({
        ["1"] = { byName = {} },
        ["2"] = { byName = {} },
        ["3"] = { byName = {} },
        ["4"] = { byName = {} },
    }, {
        ["1"] = { allowed = true },
        ["2"] = { allowed = false },
        ["4"] = "not a table",
    })
    assert_type("table", saved["1"], "An account that allowed storage is saved")
    assert_equal(nil, saved["2"], "An account that denied storage is not saved")
    assert_equal(nil, saved["3"], "An account that was never asked is not saved")
    assert_equal(nil, saved["4"], "An account with malformed consent is not saved")
    assert_equal(nil, next(cache_merger.consented_only({ ["1"] = {} }, nil)), "No consent state saves nothing")

    print("All tests passed successfully!")
end

run_tests()
