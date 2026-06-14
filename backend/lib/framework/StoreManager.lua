local JsonStore = require("lib.JsonStore")

local StoreManager = {}
StoreManager.__index = StoreManager

function StoreManager.new(filename, description, useMemoryCache)
    local self = setmetatable({}, StoreManager)
    self.store = JsonStore.new(filename, description)
    self.useMemoryCache = useMemoryCache == true
    
    if self.useMemoryCache then
        self.memoryCache = self.store:load({})
    end
    
    return self
end

function StoreManager:get(key)
    local data
    if self.useMemoryCache then
        data = self.memoryCache
    else
        data = self.store:load({})
    end
    
    if key == nil then
        return data
    end
    return data[key]
end

function StoreManager:set(key, data, skipSave)
    local cache
    if self.useMemoryCache then
        cache = self.memoryCache
    else
        cache = self.store:load({})
    end
    
    if key == nil then
        cache = data
        if self.useMemoryCache then
            self.memoryCache = cache
        end
    else
        cache[key] = data
    end
    
    if skipSave then
        return true
    end
    
    return self.store:save(cache)
end

function StoreManager:clear(key, skipSave)
    local cache
    if self.useMemoryCache then
        cache = self.memoryCache
    else
        cache = self.store:load({})
    end
    
    if key == nil then
        cache = {}
        if self.useMemoryCache then
            self.memoryCache = cache
        end
    else
        cache[key] = nil
    end
    
    if skipSave then
        return true
    end
    
    return self.store:save(cache)
end

return StoreManager
