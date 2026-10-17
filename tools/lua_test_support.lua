-- Stand-ins for Millennium's Lua modules, so backend code runs under plain Lua 5.1 in tests.
-- Installed through package.loaded when this module is first required; each stand-in reads the
-- switches of the current env, so tests control failures per test.
local cjson = require("cjson")

local realIo = io
local realOsTime = os.time

if not package.path:find("./backend/?.lua", 1, true) then
    package.path = "./backend/?.lua;./tools/?.lua;" .. package.path
end

local support = {}

local current = nil

local function shellQuote(value)
    return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function pathMatches(path)
    local pattern = current and current.fail.only_path
    if not pattern then
        return true
    end
    return tostring(path):find(pattern) ~= nil
end

-- Returns the injected failure message for a switch, or nil when the switch is off or the path
-- doesn't match only_path
local function injectedFailure(name, path)
    if not current then
        return nil
    end
    local message = current.fail[name]
    if message == nil or not pathMatches(path) then
        return nil
    end
    return message
end

local function pathExists(path)
    -- os.rename onto itself succeeds for any existing file or folder and changes nothing
    return os.rename(path, path) == true
end

-- io proxy: only code that does require("io") sees it

local function wrapFile(file, path)
    local wrapper = { _file = file, _path = path }

    -- LuaJIT's file:read returns nil, message on a stream error such as a Windows lock violation
    function wrapper:read(...)
        local message = injectedFailure("read", path)
        if message then
            return nil, message
        end
        return file:read(...)
    end

    function wrapper:write(...)
        local message = injectedFailure("write", path)
        if message then
            return nil, message
        end
        return file:write(...)
    end

    function wrapper:close()
        local ok, err = file:close()
        local message = injectedFailure("close", path)
        if message then
            return nil, message
        end
        return ok, err
    end

    return setmetatable(wrapper, {
        __index = function(_, key)
            local member = file[key]
            if type(member) == "function" then
                return function(_, ...)
                    return member(file, ...)
                end
            end
            return member
        end,
    })
end

local ioProxy = setmetatable({}, { __index = realIo })

function ioProxy.open(path, mode)
    mode = mode or "r"
    local isWrite = mode:find("[wa+]") ~= nil

    if isWrite then
        if current then
            table.insert(current.opened_for_write, path)
        end
        local message = injectedFailure("open_write", path)
        if message then
            return nil, path .. ": " .. message
        end
    else
        local message = injectedFailure("open_read", path)
        if message and pathExists(path) then
            return nil, path .. ": " .. message
        end
    end

    local file, err = realIo.open(path, mode)
    if not file then
        return nil, err
    end
    return wrapFile(file, path)
end

-- fs stand-in, matching the return values of Millennium's src/lua_host/api/filesystem.cc

local fsStub = {}

function fsStub.join(...)
    local parts = { ... }
    local joined = table.concat(parts, "/")
    return (joined:gsub("//+", "/"))
end

function fsStub.exists(path)
    return pathExists(path)
end

function fsStub.filename(path)
    return tostring(path):match("([^/\\]+)$") or ""
end

function fsStub.remove(path)
    if not pathExists(path) then
        return false
    end
    local ok, err = os.remove(path)
    if ok then
        return true
    end
    return false, err
end

-- os.rename replaces an existing target on Linux, like Millennium's std::filesystem::rename
function fsStub.rename(from, to, throwError)
    local spec = current and current.fail.rename
    if spec and (spec.count or 0) > 0 and (pathMatches(from) or pathMatches(to)) then
        spec.count = spec.count - 1
        local message = spec.message or "Access is denied"
        if throwError then
            error(message)
        end
        return nil, message
    end

    local ok, err = os.rename(from, to)
    if ok then
        return true
    end
    if throwError then
        error(err)
    end
    return nil, err
end

function fsStub.list(path)
    local entries = {}
    local listing = realIo.popen("ls -1Ap " .. shellQuote(path) .. " 2>/dev/null")
    for name in listing:lines() do
        local isDirectory = name:sub(-1) == "/"
        local cleanName = isDirectory and name:sub(1, -2) or name
        table.insert(entries, {
            name = cleanName,
            path = fsStub.join(path, cleanName),
            is_directory = isDirectory,
            is_file = not isDirectory,
            is_symlink = false,
        })
    end
    listing:close()
    return entries
end

local utilsStub = {
    get_backend_path = function()
        return current and current.dir or ""
    end,
    sleep = function(milliseconds)
        if current then
            table.insert(current.sleeps, milliseconds)
        end
    end,
}

local loggerStub = {}

local function logAt(level)
    return function(selfOrMessage, message)
        if selfOrMessage ~= loggerStub then
            message = selfOrMessage
        end
        if current then
            table.insert(current.logs, { level = level, message = tostring(message) })
        end
    end
end

loggerStub.info = logAt("info")
loggerStub.warn = logAt("warn")
loggerStub.error = logAt("error")
loggerStub.debug = logAt("debug")

local function parseVersion(version)
    local parts = {}
    for number in tostring(version):gmatch("%d+") do
        table.insert(parts, tonumber(number))
    end
    return parts
end

local millenniumStub = setmetatable({
    version = function()
        return "v3.6.1"
    end,
    cmp_version = function(a, b)
        local left, right = parseVersion(a), parseVersion(b)
        for i = 1, math.max(#left, #right) do
            local x, y = left[i] or 0, right[i] or 0
            if x ~= y then
                return x < y and -1 or 1
            end
        end
        return 0
    end,
    add_browser_js = function()
        return true
    end,
    ready = function() end,
}, {
    -- millennium.config is only present when a test sets env.config
    __index = function(_, key)
        if key == "config" then
            return current and current.config
        end
        return nil
    end,
})

package.loaded["json"] = cjson
package.loaded["io"] = ioProxy
package.loaded["fs"] = fsStub
package.loaded["utils"] = utilsStub
package.loaded["logger"] = loggerStub
package.loaded["millennium"] = millenniumStub

local function makeTempDir(prefix)
    local template = "/tmp/" .. (prefix or "gratitude-test") .. "-XXXXXX"
    local handle = realIo.popen("mktemp -d " .. shellQuote(template))
    local dir = handle:read("*l")
    handle:close()
    assert(dir and dir ~= "", "mktemp -d failed")
    return dir
end

-- options.prefix names the temp folder, e.g. to check that a folder name never reaches the logs
function support.new_env(options)
    options = options or {}
    if current then
        current.cleanup()
    end

    local env = {
        fail = {},
        logs = {},
        sleeps = {},
        opened_for_write = {},
        config = nil,
    }
    env.dir = makeTempDir(options.prefix)

    local function fullPath(name)
        return env.dir .. "/" .. name
    end

    function env.write_file(name, content)
        local file = assert(realIo.open(fullPath(name), "wb"))
        file:write(content)
        file:close()
    end

    function env.read_file(name)
        local file = realIo.open(fullPath(name), "rb")
        if not file then
            return nil
        end
        local content = file:read("*a")
        file:close()
        return content
    end

    function env.exists(name)
        return pathExists(fullPath(name))
    end

    function env.list()
        local names = {}
        for _, entry in ipairs(fsStub.list(env.dir)) do
            table.insert(names, entry.name)
        end
        table.sort(names)
        return names
    end

    function env.freeze_time(t)
        os.time = function(spec)
            if spec ~= nil then
                return realOsTime(spec)
            end
            return t
        end
    end

    function env.load_backend()
        for name in pairs(package.loaded) do
            if name:sub(1, 4) == "lib." then
                package.loaded[name] = nil
            end
        end
        return dofile("backend/main.lua")
    end

    function env.cleanup()
        os.time = realOsTime
        if env.dir and env.dir:match("^/tmp/[^/]+$") then
            os.execute("rm -rf " .. shellQuote(env.dir))
        end
        if current == env then
            current = nil
        end
    end

    current = env
    return env
end

return support
