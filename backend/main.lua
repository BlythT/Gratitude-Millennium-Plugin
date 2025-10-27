local logger = require("logger")
local millennium = require("millennium")

function test_frontend_message_callback(message, status, count)
    logger:info("test_frontend_message_callback called")
    logger:info("Received args: " .. table.concat({message, tostring(status), tostring(count)}, ", "))

    return "Response from backend"
end

local function on_load()
    print("Example plugin loaded")
    logger:info("Comparing millennium version: " .. millennium.cmp_version(millennium.version(), "2.29.3"))

    logger:info("Example plugin loaded with Millennium version " .. millennium.version())
    millennium.ready()
end

-- Called when your plugin is unloaded. This happens when the plugin is disabled or Steam is shutting down.
-- NOTE: If Steam crashes or is force closed by task manager, this function may not be called -- so don't rely on it for critical cleanup.
local function on_unload()
    logger:info("Plugin unloaded")
end

-- Called when the Steam UI has fully loaded.
local function on_frontend_loaded()
    logger:info("Frontend loaded")
    local result = millennium.call_frontend_method("classname.method", { 18, "USA", false })
    logger:info(result)
end

return {
    on_frontend_loaded = on_frontend_loaded,
    on_load = on_load,
    on_unload = on_unload
}
