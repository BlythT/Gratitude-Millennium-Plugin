-- Decides whether Gratitude must register browser_js hooks for Steam Store and Community pages.
--
-- On Millennium below 3.3.0, Store and Community pages only received plugin webkit scripts when a
-- browser_js hook matched them. From 3.3.0 Millennium injects webkit scripts there by itself, and
-- registering a hook with an empty path makes Millennium read its themes folder as a file, fail,
-- and never answer the page's request, so those pages never finish loading.
--
-- When the running version can't be compared, the hooks are kept, as before this check existed.

local NATIVE_INJECTION_VERSION = "3.3.0"

local function needs_browser_hooks(millennium)
    local ok, result = pcall(function()
        -- Compare "3.6.1", not "v3.6.1": a version cmp_version can't parse would keep the hooks
        local version = tostring(millennium.version()):gsub("^[vV]", "")
        return millennium.cmp_version(version, NATIVE_INJECTION_VERSION)
    end)
    if not ok or type(result) ~= "number" then
        return true
    end
    -- cmp_version returns -1 for an older version and -2 when a version can't be parsed
    return result < 0
end

return {
    needs_browser_hooks = needs_browser_hooks,
}
