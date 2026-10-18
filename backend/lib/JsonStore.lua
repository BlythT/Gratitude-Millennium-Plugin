local logger = require("logger")
local json = require("json")
local io = require("io")
local fs = require("fs")
local utils = require("utils")
local log_redact = require("lib.log_redact")

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
    return log_redact.replace_literal(message, path, fs.filename(path))
end

-- Millennium's fs.exists returns false on any stat error, not only for a missing file, so a file
-- that can still be opened counts as present. A failed open still reads as absent: telling a
-- missing file from an unreadable one would mean matching error text.
local function is_present(path)
    if fs.exists(path) then
        return true
    end
    local file = io.open(path, "r")
    if file then
        file:close()
        return true
    end
    return false
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
    if is_present(corrupted_path) then
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

-- The one definition of a usable store file. Returns the JSON object or array it holds; or false,
-- why ("empty", "invalid JSON" or "not a JSON object or array") and any decode error; or nil, the
-- error and "open" or "read" when it couldn't be opened or read, which can be a passing lock
-- rather than a bad file. "Empty" means no content or only whitespace, never a valid {}.
local function read_json_table(path)
    local file, open_err = io.open(path, "r")
    if not file then
        return nil, without_path(open_err, path), "open"
    end
    local content, read_err = file:read("*all")
    file:close()
    if not content then
        return nil, without_path(read_err, path), "read"
    end
    if not content:find("%S") then
        return false, "empty"
    end
    local success, decoded = pcall(json.decode, content)
    if not success then
        return false, "invalid JSON", tostring(decoded)
    end
    -- null, numbers, strings and booleans decode fine but callers expect a table
    if type(decoded) ~= "table" then
        return false, "not a JSON object or array"
    end
    return decoded
end

local function is_valid_json_file(path)
    local data, err = read_json_table(path)
    if data == nil then
        return nil, err
    end
    return data ~= false
end

-- A leftover temporary file means the rename never happened. The store file, when present, is
-- the last completed save. Without one, a temporary file that parses is the only copy of a first
-- save killed between close and rename, so it is promoted; a partial one won't parse. One that
-- can't be checked or promoted is kept, and saves are refused because they write over it.
local function resolve_leftover(store)
    local tmp_path = store.tmp_path
    if not is_present(tmp_path) then
        return
    end
    local tmp_name = fs.filename(tmp_path)

    if not is_present(store.path) then
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

    if is_present(self.path) then
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

    if not is_present(self.path) then
        logger:info(self.description .. " file " .. fs.filename(self.path) .. " doesn't exist")
        return defaultState or {}
    end

    local data, why, detail = read_json_table(self.path)

    -- Left in place: an open or read failure can be a passing lock on a healthy file
    if data == nil and detail == "open" then
        logger:error("Failed to open " .. self.description .. " file for reading: " .. why)
        block_saves(self, fs.filename(self.path) .. " could not be opened for reading")
        return defaultState or {}
    end
    if data == nil then
        logger:error("Failed to read " .. self.description .. " file: " .. why)
        block_saves(self, fs.filename(self.path) .. " could not be read")
        return defaultState or {}
    end

    if data == false then
        if why == "empty" then
            logger:info(self.description .. " file " .. fs.filename(self.path) .. " is empty")
        elseif why == "invalid JSON" then
            -- detail is cjson's error text, which gives a position, not the input
            logger:error("Failed to decode " .. self.description .. " JSON: " .. detail)
        end
        set_aside(self, why)
        return defaultState or {}
    end

    logger:info(self.description .. " loaded successfully from " .. fs.filename(self.path))
    return data
end

function JsonStore:exists()
    return is_present(self.path)
end

-- Renames the store file to <name>.migrated, or to <name>.migrated.<unix time> when that exists.
-- Never replaces a .migrated file, because each can hold data no other copy has.
function JsonStore:retire()
    local file_name = fs.filename(self.path)
    local target = self.path .. ".migrated"
    if is_present(target) then
        target = target .. "." .. os.time()
        if is_present(target) then
            local reason = fs.filename(target) .. " already exists"
            logger:warn(self.description .. " file " .. file_name .. " not retired: " .. reason)
            return nil, reason
        end
    end

    local renamed, err = rename_with_retry(self.path, target)
    if not renamed then
        logger:error("Failed to retire " .. self.description .. " file " .. file_name .. ": " .. err)
        return nil, err
    end
    logger:info("Retired " .. self.description .. " file " .. file_name .. " as " .. fs.filename(target))
    return target
end

-- Reads the newest .migrated copy: the highest <unix time> suffix, with plain .migrated the oldest.
-- An unreadable copy is skipped for the next newest. Read only: no copy is renamed or changed.
-- The second value is true when a newer copy exists but couldn't be opened or read, which can be a
-- passing lock, so the caller knows data may be missing; a copy holding bad JSON doesn't count.
function JsonStore:load_newest_migrated()
    local plain_name = fs.filename(self.path) .. ".migrated"
    local entries, list_err = fs.list(self.dir)
    if not entries then
        logger:warn("Couldn't look for " .. self.description .. " copies: " .. tostring(list_err))
        return nil, true
    end
    local copies = {}
    for _, entry in ipairs(entries) do
        local suffix = entry.name:sub(#plain_name + 1)
        if entry.is_file and entry.name:sub(1, #plain_name) == plain_name then
            if suffix == "" then
                table.insert(copies, { path = entry.path, time = -1 })
            elseif suffix:match("^%.%d+$") then
                table.insert(copies, { path = entry.path, time = tonumber(suffix:sub(2)) })
            end
        end
    end
    table.sort(copies, function(a, b)
        return a.time > b.time
    end)

    local unread = false
    for _, copy in ipairs(copies) do
        local data, why = read_json_table(copy.path)
        if data then
            logger:info(self.description .. " loaded from " .. fs.filename(copy.path))
            return data, unread
        end
        unread = unread or data == nil
        logger:warn("Skipped unreadable " .. self.description .. " copy " .. fs.filename(copy.path) .. ": " .. why)
    end
    return nil, unread
end

return JsonStore
