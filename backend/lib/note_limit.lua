-- The gift note cap, counted in Unicode characters. The modal's maxLength counts UTF-16 units, never
-- fewer than characters, so the backend never rejects a note the textarea allowed.
local note_limit = {}

note_limit.NOTE_MAX_CHARS = 2000

-- Counts every byte that doesn't continue a UTF-8 sequence
function note_limit.char_count(s)
    return select(2, s:gsub("[^\128-\191]", ""))
end

function note_limit.is_within_limit(s)
    return note_limit.char_count(s) <= note_limit.NOTE_MAX_CHARS
end

return note_limit
