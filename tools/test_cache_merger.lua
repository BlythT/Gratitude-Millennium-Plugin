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
    assert_equal(100, cache1.totalLicenses, "totalLicenses should be set")
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
    assert_equal(100, cache2.totalLicenses, "totalLicenses should be preserved if missing in incoming")
    
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
        totalLicenses = 101 -- updated total
    }
    local cache7, byAppIdSize7, byNameSize7, isNewFormat7 = cache_merger.merge_license_page(cache6, overwriteIncoming)
    assert_equal(2, byAppIdSize7, "byAppId size should remain 2 after overwrite")
    assert_equal("Retail", cache7.byAppId["123"].acquisition, "Existing key should be overwritten")
    assert_equal(101, cache7.totalLicenses, "totalLicenses should be updated")

    -- Test 7: Malformed legacy array (missing item name)
    local malformedLegacy = {
        { acquisition = "Gift", date = "Apr 4, 2023" }, -- missing item name
        { item = "Valid Legacy", acquisition = "Store", date = "Apr 5, 2023" }
    }
    local cache8, byAppIdSize8, byNameSize8, isNewFormat8 = cache_merger.merge_license_page(cache7, malformedLegacy)
    assert_equal(4, byNameSize8, "Only the valid legacy item should be added")
    assert_type("table", cache8.byName["Valid Legacy"], "Valid legacy item was added")
    assert_equal("Store", cache8.byName["Valid Legacy"].acquisition, "Valid legacy item data is correct")

    print("All tests passed successfully!")
end

run_tests()
