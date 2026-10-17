-- Runs every tools/test_*.lua file with LuaUnit. Run from the repo root: npm run test:lua
-- Arguments pass through to LuaUnit, e.g. npm run test:lua -- -p TestJsonStore
package.path = "./backend/?.lua;./tools/?.lua;" .. package.path

local lu = require("luaunit")

local listing = io.popen("ls -1 tools/test_*.lua 2>/dev/null")
local testFiles = {}
for path in listing:lines() do
    table.insert(testFiles, path)
end
listing:close()

if #testFiles == 0 then
    error("No Lua test files found in tools/ (run from the repo root)")
end

-- A file that fails to load becomes a failing test, so the other files still run
TestLoadErrors = {}

table.sort(testFiles)
for _, path in ipairs(testFiles) do
    local ok, err = pcall(dofile, path)
    if not ok then
        TestLoadErrors["test_load_" .. path] = function()
            error(tostring(err), 0)
        end
    end
end

local failures = lu.LuaUnit.run()
os.exit(failures == 0 and 0 or 1)
