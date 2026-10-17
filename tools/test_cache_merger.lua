-- Test suite for backend/lib/cache_merger.lua
local lu = require("luaunit")
local cache_merger = require("backend.lib.cache_merger")

TestCacheMerger = {}

-- One method: each scenario feeds its cache into the next
function TestCacheMerger:test_merge_sequence()
    -- Test 1: Initializing empty cache
    local cache1, byAppIdSize1, byNameSize1, isNewFormat1 = cache_merger.merge_license_page(nil, {
        byAppId = { ["123"] = { acquisition = "Gift", date = "Jan 1, 2023" } },
        byName = { ["Test Game"] = { acquisition = "Gift", date = "Jan 1, 2023" } },
        totalLicenses = 100
    })

    lu.assertEquals(byAppIdSize1, 1, "byAppId should have 1 entry")
    lu.assertEquals(byNameSize1, 1, "byName should have 1 entry")
    lu.assertEquals(cache1.totalLicenses, 100, "totalLicenses should be set")
    lu.assertEquals(isNewFormat1, true, "should detect new format")

    -- Test 2: Appending to existing cache (ensuring no overwrites of unrelated keys)
    local incomingPage2 = {
        byAppId = { ["456"] = { acquisition = "Purchase", date = "Feb 2, 2023" } },
        byName = { ["Another Game"] = { acquisition = "Purchase", date = "Feb 2, 2023" } }
    }

    local cache2, byAppIdSize2, byNameSize2, isNewFormat2 = cache_merger.merge_license_page(cache1, incomingPage2)

    lu.assertEquals(byAppIdSize2, 2, "byAppId should have 2 entries after merge")
    lu.assertEquals(byNameSize2, 2, "byName should have 2 entries after merge")
    lu.assertEquals(cache2.byAppId["123"].acquisition, "Gift", "Original data should be preserved")
    lu.assertEquals(cache2.byAppId["456"].acquisition, "Purchase", "New data should be merged")
    lu.assertEquals(cache2.totalLicenses, 100, "totalLicenses should be preserved if missing in incoming")

    -- Test 3: Legacy format fallback
    local legacyIncoming = {
        { item = "Legacy Game", acquisition = "Gift", date = "Mar 3, 2023" }
    }

    local cache3, byAppIdSize3, byNameSize3, isNewFormat3 = cache_merger.merge_license_page(cache2, legacyIncoming)

    lu.assertEquals(isNewFormat3, false, "should detect legacy format")
    lu.assertEquals(byAppIdSize3, 2, "byAppId should still have 2 entries")
    lu.assertEquals(byNameSize3, 3, "byName should have 3 entries (added legacy game)")
    lu.assertEquals(cache3.byName["Legacy Game"].acquisition, "Gift", "Legacy item should be added correctly")

    -- Test 4: Nil incoming data (should return current cache unmodified)
    local cache4, byAppIdSize4, byNameSize4, isNewFormat4 = cache_merger.merge_license_page(cache3, nil)
    lu.assertEquals(byAppIdSize4, 2, "byAppId size should remain 2")
    lu.assertEquals(byNameSize4, 3, "byName size should remain 3")
    lu.assertNil(isNewFormat4, "isNewFormat should be nil for nil incoming data")

    -- Test 5: Bad data types (e.g. string or number instead of table)
    local cache5, byAppIdSize5, byNameSize5, isNewFormat5 = cache_merger.merge_license_page(cache4, "this is not a table")
    lu.assertEquals(byAppIdSize5, 2, "Bad string data: byAppId size should remain 2")
    lu.assertEquals(byNameSize5, 3, "Bad string data: byName size should remain 3")
    lu.assertEquals(isNewFormat5, false, "Bad string data: should not detect as new format")

    local cache6, byAppIdSize6, byNameSize6, isNewFormat6 = cache_merger.merge_license_page(cache5, 12345)
    lu.assertEquals(byAppIdSize6, 2, "Bad number data: byAppId size should remain 2")
    lu.assertEquals(byNameSize6, 3, "Bad number data: byName size should remain 3")
    lu.assertEquals(isNewFormat6, false, "Bad number data: should not detect as new format")

    -- Test 6: Overwriting existing keys
    -- If a game license is fetched again, the newer data overwrites the old data in the cache dictionary.
    local overwriteIncoming = {
        byAppId = { ["123"] = { acquisition = "Retail", date = "Jan 2, 2023" } }, -- 123 was Gift previously
        totalLicenses = 101 -- updated total
    }
    local cache7, byAppIdSize7, byNameSize7, isNewFormat7 = cache_merger.merge_license_page(cache6, overwriteIncoming)
    lu.assertEquals(byAppIdSize7, 2, "byAppId size should remain 2 after overwrite")
    lu.assertEquals(cache7.byAppId["123"].acquisition, "Retail", "Existing key should be overwritten")
    lu.assertEquals(cache7.totalLicenses, 101, "totalLicenses should be updated")

    -- Test 7: Malformed legacy array (missing item name)
    local malformedLegacy = {
        { acquisition = "Gift", date = "Apr 4, 2023" }, -- missing item name
        { item = "Valid Legacy", acquisition = "Store", date = "Apr 5, 2023" }
    }
    local cache8, byAppIdSize8, byNameSize8, isNewFormat8 = cache_merger.merge_license_page(cache7, malformedLegacy)
    lu.assertEquals(byNameSize8, 4, "Only the valid legacy item should be added")
    lu.assertEquals(type(cache8.byName["Valid Legacy"]), "table", "Valid legacy item was added")
    lu.assertEquals(cache8.byName["Valid Legacy"].acquisition, "Store", "Valid legacy item data is correct")
end
