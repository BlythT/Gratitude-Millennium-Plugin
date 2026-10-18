-- Masks identifiers before they reach the logs (same rules as lib/log-redact.ts)
local log_redact = {}

local NONE = "<none>"
local MASK = "****"

local function to_log_string(value)
    if value == nil then
        return nil
    end
    local text = tostring(value)
    if text == "" then
        return nil
    end
    return text
end

function log_redact.mask_id(id)
    local text = to_log_string(id)
    if not text then
        return NONE
    end
    if #text <= 4 then
        return MASK
    end
    return MASK .. text:sub(-4)
end

-- Replaces every plain-text occurrence of secret in message, for error text that may quote a
-- path or key; nothing is read as a Lua pattern
function log_redact.replace_literal(message, secret, replacement)
    message = tostring(message)
    if secret == nil or secret == "" then
        return message
    end
    local parts, position = {}, 1
    while true do
        local first, last = message:find(secret, position, true)
        if not first then
            break
        end
        table.insert(parts, message:sub(position, first - 1))
        table.insert(parts, replacement)
        position = last + 1
    end
    table.insert(parts, message:sub(position))
    return table.concat(parts)
end

function log_redact.safe_license_key(key)
    local text = to_log_string(key)
    if not text then
        return NONE
    end
    if text:match("^%d+$") then
        return text
    end
    return "non-numeric key"
end

return log_redact
