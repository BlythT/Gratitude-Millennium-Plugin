-- Length-prefixed and type-tagged so no two different records share a key
local function encode_value(value)
    local text = tostring(value)
    return type(value) .. ":" .. #text .. ":" .. text
end

-- Every field except updatedAt, sorted by name, so a field the normalizer gains is compared too.
-- Returns nil for a record with a key that isn't a field name.
local function friend_key(friend)
    local fields = {}
    for field in pairs(friend) do
        if type(field) ~= "string" then
            return nil
        end
        if field ~= "updatedAt" then
            fields[#fields + 1] = field
        end
    end
    table.sort(fields)

    local parts = {}
    for index, field in ipairs(fields) do
        parts[index] = encode_value(field) .. "=" .. encode_value(friend[field])
    end
    return table.concat(parts, "|")
end

local function sorted_keys(friends)
    local keys = {}
    for index, friend in ipairs(friends) do
        if type(friend) ~= "table" then
            return nil
        end
        local key = friend_key(friend)
        if not key then
            return nil
        end
        keys[index] = key
    end
    table.sort(keys)
    return keys
end

-- Returns true when both lists hold the same friends, comparing every field except updatedAt and
-- ignoring order. Duplicates count. Anything that isn't a list of records is reported as
-- different, so the caller saves rather than skips.
local function same_friends(a, b)
    if type(a) ~= "table" or type(b) ~= "table" then
        return false
    end
    if #a ~= #b then
        return false
    end

    local keysA = sorted_keys(a)
    local keysB = sorted_keys(b)
    if not keysA or not keysB then
        return false
    end

    for index = 1, #keysA do
        if keysA[index] ~= keysB[index] then
            return false
        end
    end
    return true
end

return {
    same_friends = same_friends
}
