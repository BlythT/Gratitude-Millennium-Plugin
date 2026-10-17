local logger = require("logger")
local json = require("json")
local io = require("io")
local fs = require("fs")
local utils = require("utils")

local JsonStore = {}
JsonStore.__index = JsonStore

local RENAME_ATTEMPTS = 5
local RENAME_RETRY_DELAY_MS = 50

-- The only place the data folder is decided; every store file and its copies derive from it
local function data_dir()
    return utils.get_backend_path()
end

-- io.open errors start with the full path, which holds the user's home folder name on Linux
local function without_path(message, path)
    message = tostring(message)
    local first, last = message:find(path, 1, true)
    if not first then
        return message
    end
    return message:sub(1, first - 1) .. fs.filename(path) .. message:sub(last + 1)
end

-- Retries because antivirus software on Windows can hold a file open briefly
local function rename_with_retry(from, to)
    local renamed, err
    for attempt = 1, RENAME_ATTEMPTS do
        renamed, err = fs.rename(from, to)
        if renamed then
            return true
        end
        if attempt < RENAME_ATTEMPTS then
            utils.sleep(RENAME_RETRY_DELAY_MS)
        end
    end
    return false, tostring(err)
end

-- The file may hold recoverable data, so saving over it is refused for the rest of the session
local function block_saves(store, reason)
    store.save_blocked_reason = reason
    logger:error(store.description .. " saves are disabled for this session: " .. reason)
end

-- Keeps an unreadable store file as <name>.corrupted.<unix time> rather than saving over it
local function set_aside(store, why)
    local corrupted_path = store.path .. ".corrupted." .. os.time()
    local file_name, corrupted_name = fs.filename(store.path), fs.filename(corrupted_path)
    if fs.exists(corrupted_path) then
        block_saves(store, "unreadable file " .. file_name .. " could not be set aside, " .. corrupted_name .. " already exists")
        return
    end

    local renamed, err = rename_with_retry(store.path, corrupted_path)
    if not renamed then
        block_saves(store, "unreadable file " .. file_name .. " could not be set aside: " .. err)
        return
    end
    logger:error(store.description .. " file was unreadable (" .. why .. "), set aside as " .. corrupted_name)
end

-- Returns whether the file holds a JSON object or array, or nil and the error when it couldn't be
-- opened or read, which can be a passing lock rather than a bad file
local function is_valid_json_file(path)
    local file, open_err = io.open(path, "r")
    if not file then
        return nil, without_path(open_err, path)
    end
    local content, read_err = file:read("*all")
    file:close()
    if not content then
        return nil, without_path(read_err, path)
    end
    if not content:find("%S") then
        return false
    end
    local success, decoded = pcall(json.decode, content)
    return success and type(decoded) == "table"
end

-- A leftover temporary file means the rename never happened. The store file, when present, is
-- the last completed save. Without one, a temporary file that parses is the only copy of a first
-- save killed between close and rename, so it is promoted; a partial one won't parse. One that
-- can't be checked or promoted is kept, and saves are refused because they write over it.
local function resolve_leftover(store)
    local tmp_path = store.tmp_path
    if not fs.exists(tmp_path) then
        return
    end
    local tmp_name = fs.filename(tmp_path)

    if not fs.exists(store.path) then
        local valid, check_err = is_valid_json_file(tmp_path)
        if valid == nil then
            logger:error("Failed to check leftover temporary " .. store.description .. " file " .. tmp_name .. ": " .. check_err)
            block_saves(store, "leftover " .. tmp_name .. " could not be checked")
            return
        end
        if valid then
            local promoted, rename_err = rename_with_retry(tmp_path, store.path)
            if not promoted then
                block_saves(store, "leftover " .. tmp_name .. " could not be promoted: " .. rename_err)
                return
            end
            logger:warn("Promoted leftover temporary " .. store.description .. " file to " .. fs.filename(store.path))
            return
        end
    end

    local removed, remove_err = fs.remove(tmp_path)
    if not removed then
        logger:warn("Failed to remove leftover temporary " .. store.description .. " file " .. tmp_name .. ": " .. without_path(remove_err, tmp_path))
        return
    end
    logger:warn("Removed leftover temporary " .. store.description .. " file " .. tmp_name)
end

function JsonStore.new(filename, description)
    local self = setmetatable({}, JsonStore)
    self.dir = data_dir()
    self.path = fs.join(self.dir, filename)
    self.tmp_path = self.path .. ".tmp"
    self.description = description
    return self
end

function JsonStore:save(data)
    if not self.path then
        logger:error("No valid path provided for " .. self.description .. " file")
        return false, "no path"
    end

    if self.save_blocked_reason then
        return false, self.save_blocked_reason
    end

    if fs.exists(self.path) then
        logger:info(self.description .. " file " .. fs.filename(self.path) .. " already exists, overwriting")
    else
        logger:info("Saving " .. self.description .. " to new file " .. fs.filename(self.path))
    end

    local success, encoded = pcall(json.encode, data)
    if not success then
        logger:error("Failed to encode " .. self.description .. " data: " .. tostring(encoded))
        return false, "encode failed: " .. tostring(encoded)
    end

    local tmp_path = self.tmp_path
    local file, err = io.open(tmp_path, "wb")
    if not file then
        local reason = without_path(err, tmp_path)
        logger:error("Failed to open " .. self.description .. " file for writing: " .. reason)
        return false, "open failed: " .. reason
    end

    -- write and close report failure by return value; a full disk may only show at close
    local wrote, write_err = file:write(encoded)
    local closed, close_err = file:close()
    if not wrote or not closed then
        fs.remove(tmp_path)
        local reason = tostring(write_err or close_err)
        logger:error("Failed to write " .. self.description .. " file: " .. reason)
        return false, "write failed: " .. reason
    end

    local renamed, rename_err = rename_with_retry(tmp_path, self.path)
    if not renamed then
        fs.remove(tmp_path)
        logger:error("Failed to replace " .. self.description .. " file: " .. rename_err)
        return false, "rename failed: " .. rename_err
    end

    logger:info(self.description .. " saved successfully")
    return true
end

function JsonStore:load(defaultState)
    if not self.path then
        logger:error("No valid path provided for " .. self.description .. " file")
        return defaultState or {}
    end

    resolve_leftover(self)

    if not fs.exists(self.path) then
        logger:info(self.description .. " file " .. fs.filename(self.path) .. " doesn't exist")
        return defaultState or {}
    end

    local file, err = io.open(self.path, "r")
    if not file then
        logger:error("Failed to open " .. self.description .. " file for reading: " .. without_path(err, self.path))
        -- Left in place: an open failure can be a passing lock on a healthy file
        block_saves(self, fs.filename(self.path) .. " could not be opened for reading")
        return defaultState or {}
    end

    local content, read_err = file:read("*all")
    file:close()

    if not content then
        logger:error("Failed to read " .. self.description .. " file: " .. without_path(read_err, self.path))
        -- Left in place: like an open failure, a read error can be a passing lock
        block_saves(self, fs.filename(self.path) .. " could not be read")
        return defaultState or {}
    end

    -- "Empty" means no content or only whitespace, never a valid {}
    if not content:find("%S") then
        logger:info(self.description .. " file " .. fs.filename(self.path) .. " is empty")
        set_aside(self, "empty")
        return defaultState or {}
    end

    local success, decoded = pcall(json.decode, content)
    if not success then
        logger:error("Failed to decode " .. self.description .. " JSON: " .. tostring(decoded)) -- log-privacy: allow=decoded holds cjson error text, which gives a position, not the input
        set_aside(self, "invalid JSON")
        return defaultState or {}
    end

    -- null, numbers, strings and booleans decode fine but callers expect a table
    if type(decoded) ~= "table" then
        set_aside(self, "not a JSON object or array")
        return defaultState or {}
    end

    logger:info(self.description .. " loaded successfully from " .. fs.filename(self.path))
    return decoded
end

return JsonStore
