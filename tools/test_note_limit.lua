-- Tests for backend/lib/note_limit.lua (notes are counted in Unicode characters, not bytes)
local lu = require("luaunit")
require("lua_test_support")
local note_limit = require("lib.note_limit")

-- UTF-8 bytes, since Lua 5.1 has no \u escape
local CJK = "\230\151\165"          -- U+65E5, 3 bytes
local EMOJI = "\240\159\152\128"    -- U+1F600, 4 bytes and 2 UTF-16 units
local E_ACUTE = "\195\169"          -- U+00E9, 2 bytes

TestNoteLimit = {}

function TestNoteLimit:test_the_limit_is_2000()
    lu.assertEquals(note_limit.NOTE_MAX_CHARS, 2000)
end

function TestNoteLimit:test_empty_note_counts_zero()
    lu.assertEquals(note_limit.char_count(""), 0)
end

function TestNoteLimit:test_ascii_limit()
    lu.assertTrue(note_limit.is_within_limit(string.rep("a", 2000)))
    lu.assertFalse(note_limit.is_within_limit(string.rep("a", 2001)))
end

function TestNoteLimit:test_three_byte_characters_count_once()
    local atLimit = string.rep(CJK, 2000)
    lu.assertEquals(#atLimit, 6000)
    lu.assertTrue(note_limit.is_within_limit(atLimit))
    lu.assertFalse(note_limit.is_within_limit(string.rep(CJK, 2001)))
end

-- A 2,000 unit maxLength allows 1,000 of these, so the backend must accept them
function TestNoteLimit:test_what_the_textarea_allows_is_within_the_limit()
    lu.assertEquals(note_limit.char_count(string.rep(EMOJI, 1000)), 1000)
    lu.assertTrue(note_limit.is_within_limit(string.rep(EMOJI, 1000)))
end

function TestNoteLimit:test_accented_letter_counts_once()
    lu.assertEquals(note_limit.char_count(E_ACUTE), 1)
    lu.assertEquals(note_limit.char_count("caf" .. E_ACUTE), 4)
end
