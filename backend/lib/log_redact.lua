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
