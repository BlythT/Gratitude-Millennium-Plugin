local logger = require("logger")
local json = require("json")
local io = require("io")
local fs = require("fs")
local utils = require("utils")

local JsonStore = {}
JsonStore.__index = JsonStore

function JsonStore.new(filename, description)
    local self = setmetatable({}, JsonStore)
    self.path = fs.join(utils.get_backend_path(), filename)
    self.description = description
    return self
end

function JsonStore:save(data)
    if not self.path then
        logger:error("No valid path provided for " .. self.description .. " file")
        return false
    end

    if fs.exists(self.path) then
        logger:info(self.description .. " file already exists at " .. self.path .. ", overwriting")
    else
        logger:info("Saving " .. self.description .. " to new file at " .. self.path)
    end

    local success, encoded = pcall(json.encode, data)
    if not success then
        logger:error("Failed to encode " .. self.description .. " data: " .. tostring(encoded))
        return false
    end

    local file, err = io.open(self.path, "w")
    if not file then
        logger:error("Failed to open " .. self.description .. " file for writing: " .. tostring(err))
        return false
    end

    local write_success, write_err = pcall(function()
        file:write(encoded)
    end)

    file:close()

    if not write_success then
        logger:error("Failed to write " .. self.description .. " file: " .. tostring(write_err))
        return false
    end

    logger:info(self.description .. " saved successfully")
    return true
end

function JsonStore:load(defaultState)
    if not self.path then
        logger:error("No valid path provided for " .. self.description .. " file")
        return defaultState or {}
    end

    if not fs.exists(self.path) then
        logger:info(self.description .. " file doesn't exist at " .. self.path)
        return defaultState or {}
    end

    local file, err = io.open(self.path, "r")
    if not file then
        logger:error("Failed to open " .. self.description .. " file for reading: " .. tostring(err))
        return defaultState or {}
    end

    local content = file:read("*all")
    file:close()

    if content and #content > 0 then
        local success, decoded = pcall(json.decode, content)
        if success then
            logger:info(self.description .. " loaded successfully from " .. self.path)
            return decoded
        else
            logger:error("Failed to decode " .. self.description .. " JSON: " .. tostring(decoded))
            return defaultState or {}
        end
    else
        logger:info(self.description .. " file is empty at " .. self.path)
        return defaultState or {}
    end
end

return JsonStore
