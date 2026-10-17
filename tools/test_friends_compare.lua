-- Tests for backend/lib/friends_compare.lua
local lu = require("luaunit")
local friends_compare = require("lib.friends_compare")

TestFriendsCompare = {}

local function friend(steamID64, displayName, extra)
    local record = {
        steamID64 = steamID64,
        displayName = displayName,
        updatedAt = 1000,
    }
    for key, value in pairs(extra or {}) do
        record[key] = value
    end
    return record
end

local function alice(extra)
    local fields = {
        profileUrl = "https://steamcommunity.com/id/alice",
        nicknameOrAlias = "Al",
        avatarUrl = "https://avatars.example/alice.jpg",
    }
    for key, value in pairs(extra or {}) do
        fields[key] = value
    end
    return friend("76561198000000001", "Alice", fields)
end

local function bob(extra)
    return friend("76561198000000002", "Bob", extra)
end

local function carol(extra)
    return friend("76561198000000003", "Carol", extra)
end

local function assertSame(a, b)
    lu.assertEquals(friends_compare.same_friends(a, b), true)
end

local function assertDifferent(a, b)
    lu.assertEquals(friends_compare.same_friends(a, b), false)
end

function TestFriendsCompare:test_identical_lists_are_the_same()
    assertSame({ alice(), bob(), carol() }, { alice(), bob(), carol() })
end

function TestFriendsCompare:test_reordered_list_is_the_same()
    assertSame({ alice(), bob(), carol() }, { carol(), alice(), bob() })
end

function TestFriendsCompare:test_friend_updated_at_is_ignored()
    assertSame({ alice(), bob() }, { alice({ updatedAt = 2000 }), bob({ updatedAt = 3000 }) })
end

function TestFriendsCompare:test_updated_at_missing_on_one_side_is_ignored()
    local withoutTimestamp = bob()
    withoutTimestamp.updatedAt = nil
    assertSame({ bob() }, { withoutTimestamp })
end

function TestFriendsCompare:test_list_level_updated_at_is_ignored()
    local stored = { alice(), bob() }
    stored.updatedAt = 1000
    local incoming = { bob({ updatedAt = 2000 }), alice({ updatedAt = 2000 }) }
    incoming.updatedAt = 2000
    assertSame(stored, incoming)
end

function TestFriendsCompare:test_changed_avatar_is_different()
    assertDifferent({ alice(), bob() }, { alice({ avatarUrl = "https://avatars.example/new.jpg" }), bob() })
end

function TestFriendsCompare:test_renamed_friend_is_different()
    assertDifferent({ alice(), bob() }, { alice(), friend("76561198000000002", "Robert") })
end

function TestFriendsCompare:test_changed_alias_is_different()
    assertDifferent({ alice() }, { alice({ nicknameOrAlias = "Ally" }) })
end

function TestFriendsCompare:test_nickname_added_is_different()
    assertDifferent({ bob() }, { bob({ nicknameOrAlias = "Bobby" }) })
end

function TestFriendsCompare:test_changed_profile_url_is_different()
    assertDifferent({ alice() }, { alice({ profileUrl = "https://steamcommunity.com/id/alice2" }) })
end

function TestFriendsCompare:test_profile_url_removed_is_different()
    local withoutProfile = alice()
    withoutProfile.profileUrl = nil
    assertDifferent({ alice() }, { withoutProfile })
end

-- Every field except updatedAt counts, so a field the normalizer gains later is compared too
function TestFriendsCompare:test_changed_extra_field_is_different()
    assertDifferent({ alice({ realName = "Alice Smith" }) }, { alice({ realName = "Alice Jones" }) })
end

function TestFriendsCompare:test_matching_extra_field_is_the_same()
    assertSame({ alice({ realName = "Alice Smith" }) }, { alice({ realName = "Alice Smith", updatedAt = 2000 }) })
end

function TestFriendsCompare:test_field_on_one_side_only_is_different()
    assertDifferent({ bob() }, { bob({ realName = "Robert" }) })
    assertDifferent({ bob({ realName = "Robert" }) }, { bob() })
end

function TestFriendsCompare:test_changed_steam_id_is_different()
    assertDifferent({ bob() }, { friend("76561198000000009", "Bob") })
end

function TestFriendsCompare:test_friend_added_is_different()
    assertDifferent({ alice(), bob() }, { alice(), bob(), carol() })
end

function TestFriendsCompare:test_friend_removed_is_different()
    assertDifferent({ alice(), bob(), carol() }, { alice(), carol() })
end

function TestFriendsCompare:test_friend_swapped_for_another_is_different()
    assertDifferent({ alice(), bob() }, { alice(), carol() })
end

function TestFriendsCompare:test_both_empty_are_the_same()
    assertSame({}, {})
end

function TestFriendsCompare:test_empty_against_non_empty_is_different()
    assertDifferent({}, { alice() })
    assertDifferent({ alice() }, {})
end

-- nil isn't a list: reporting a difference makes the caller save the normalized list
function TestFriendsCompare:test_nil_is_never_the_same()
    assertDifferent(nil, {})
    assertDifferent({}, nil)
    assertDifferent(nil, { alice() })
    assertDifferent(nil, nil)
end

-- Duplicates count: lists are compared as multisets of whole records, with no dedupe by Steam ID
function TestFriendsCompare:test_duplicated_entry_against_a_single_one_is_different()
    assertDifferent({ alice(), bob() }, { alice(), alice(), bob() })
    assertDifferent({ alice(), alice(), bob() }, { alice(), bob() })
end

function TestFriendsCompare:test_duplicates_must_match_in_count()
    assertDifferent({ alice(), alice(), bob() }, { alice(), bob(), bob() })
    assertSame({ alice(), bob(), alice() }, { alice(), alice(), bob() })
end

function TestFriendsCompare:test_records_sharing_a_steam_id_compare_by_every_field()
    local renamed = friend("76561198000000002", "Robert")
    assertSame({ bob(), renamed }, { renamed, bob({ updatedAt = 2000 }) })
    assertDifferent({ bob(), renamed }, { bob() })
    assertDifferent({ bob(), renamed }, { bob(), bob() })
end

function TestFriendsCompare:test_field_values_do_not_run_together()
    assertDifferent(
        { friend("76561198000000001", "Al", { nicknameOrAlias = "ice" }) },
        { friend("76561198000000001", "Alice") }
    )
    assertDifferent(
        { friend("76561198000000001", "A|B") },
        { friend("76561198000000001", "A", { profileUrl = "B" }) }
    )
end

function TestFriendsCompare:test_field_names_and_values_do_not_run_together()
    assertDifferent({ bob({ ab = "c" }) }, { bob({ a = "bc" }) })
end

function TestFriendsCompare:test_number_and_string_with_the_same_text_are_different()
    assertDifferent({ friend(123, "Bob") }, { friend("123", "Bob") })
end

function TestFriendsCompare:test_non_table_entry_is_never_the_same()
    assertDifferent({ "76561198000000002" }, { "76561198000000002" })
    assertDifferent({ alice(), true }, { alice(), true })
end

-- Only named fields can be sorted by name, so a record with any other key is odd
function TestFriendsCompare:test_record_with_a_non_string_key_is_never_the_same()
    assertDifferent({ { "76561198000000002", "Bob" } }, { { "76561198000000002", "Bob" } })
    local withIndex = bob()
    withIndex[1] = "x"
    assertDifferent({ withIndex }, { withIndex })
end

function TestFriendsCompare:test_inputs_are_not_reordered_or_changed()
    local stored = { carol(), alice(), bob() }
    local incoming = { bob(), carol(), alice() }
    friends_compare.same_friends(stored, incoming)
    lu.assertEquals(stored, { carol(), alice(), bob() })
    lu.assertEquals(incoming, { bob(), carol(), alice() })
end
