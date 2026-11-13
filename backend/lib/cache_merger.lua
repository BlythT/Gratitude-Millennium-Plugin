local function table_size(t)
    local count = 0
    if type(t) == "table" then
        for _ in pairs(t) do
            count = count + 1
        end
    end
    return count
end

local function merge_license_page(currentCache, decodedData)
    if not decodedData then 
        if type(currentCache) == "table" then
            return currentCache, table_size(currentCache.byAppId), table_size(currentCache.byName)
        else
            return currentCache, 0, 0 
        end
    end

    if type(currentCache) ~= "table" then
        currentCache = {
            byAppId = {},
            byName = {}
        }
    end

    if not currentCache.byAppId then currentCache.byAppId = {} end
    if not currentCache.byName then currentCache.byName = {} end

    local isNewFormat = false
    if type(decodedData) == "table" and (decodedData.byAppId ~= nil or decodedData.byName ~= nil) then
        isNewFormat = true
    end
    if isNewFormat then
        for k, v in pairs(decodedData.byAppId or {}) do
            currentCache.byAppId[k] = v
        end
        for k, v in pairs(decodedData.byName or {}) do
            currentCache.byName[k] = v
        end
        if decodedData.totalLicenses then
            currentCache.totalLicenses = decodedData.totalLicenses
        end
        -- Only the last page of a sync that fetched and saved every page carries this count
        if type(decodedData.completedLicenseCount) == "number" then
            currentCache.completedLicenseCount = decodedData.completedLicenseCount
        end
    else
        -- Fallback for old format (flat array)
        if type(decodedData) == "table" then
            for _, license in ipairs(decodedData) do
                if type(license) == "table" and license.item then
                    currentCache.byName[license.item] = {
                        date = license.date,
                        acquisition = license.acquisition
                    }
                end
            end
        end
    end

    return currentCache, table_size(currentCache.byAppId), table_size(currentCache.byName), isNewFormat
end

-- Turns the cache file's contents into the in-memory cache, one entry per account. Keeps the count
-- from the last completed sync, so an unchanged library isn't fetched again after a restart. The
-- older totalLicenses count is dropped: a sync that stopped part way could have set it.
local function normalize_loaded_cache(loadedCache)
    local cache = {}
    if type(loadedCache) ~= "table" then
        return cache
    end

    for steamUserID, userCache in pairs(loadedCache) do
        if type(userCache) == "table" then
            if userCache.byAppId or userCache.byName then
                cache[steamUserID] = {
                    byAppId = userCache.byAppId or {},
                    byName = userCache.byName or {},
                }
                if type(userCache.completedLicenseCount) == "number" then
                    cache[steamUserID].completedLicenseCount = userCache.completedLicenseCount
                end
            else
                -- Migrate old name-only cache
                cache[steamUserID] = {
                    byAppId = {},
                    byName = userCache,
                }
            end
        end
    end

    return cache
end

return {
    merge_license_page = merge_license_page,
    normalize_loaded_cache = normalize_loaded_cache,
}
