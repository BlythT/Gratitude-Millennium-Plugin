local StoreManager = require("backend.lib.framework.StoreManager")

-- Mock JsonStore dependency
package.loaded["lib.JsonStore"] = {
    new = function(filename, description)
        return {
            filename = filename,
            data = {},
            load = function(self, default)
                return self.data or default
            end,
            save = function(self, data)
                -- simulate disk save
                local copy = {}
                for k, v in pairs(data) do copy[k] = v end
                self.data = copy
                return true
            end
        }
    end
}

local friendsStore = StoreManager.new("test_friends.json", "Friends", true)

print("Initial get:", friendsStore:get("123"))

friendsStore:set("123", { friends = {"Alice", "Bob"} })
print("After set, get:", friendsStore:get("123").friends[1])

local diskData = friendsStore.store:load({})
print("Disk data has key 123:", diskData["123"] ~= nil)

-- Now clear it
friendsStore:clear("123")
print("After clear, get:", friendsStore:get("123"))
