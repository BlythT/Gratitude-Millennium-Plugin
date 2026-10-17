-- Tests for backend/lib/log_redact.lua (same rules as lib/log-redact.ts)
local lu = require("luaunit")
local log_redact = require("lib.log_redact")

TestLogRedact = {}

function TestLogRedact:test_mask_id_keeps_last_four_characters()
    lu.assertEquals(log_redact.mask_id("1234569341"), "****9341")
end

function TestLogRedact:test_mask_id_masks_a_number_through_its_string_form()
    lu.assertEquals(log_redact.mask_id(1234569341), "****9341")
end

function TestLogRedact:test_mask_id_keeps_last_four_digits_of_a_steamid64()
    lu.assertEquals(log_redact.mask_id("76561198012345678"), "****5678")
end

function TestLogRedact:test_mask_id_fully_masks_four_characters_or_fewer()
    lu.assertEquals(log_redact.mask_id("9341"), "****")
    lu.assertEquals(log_redact.mask_id("41"), "****")
end

function TestLogRedact:test_mask_id_reports_missing_or_empty_as_none()
    lu.assertEquals(log_redact.mask_id(""), "<none>")
    lu.assertEquals(log_redact.mask_id(nil), "<none>")
end

function TestLogRedact:test_safe_license_key_keeps_an_app_id()
    lu.assertEquals(log_redact.safe_license_key("220"), "220")
    lu.assertEquals(log_redact.safe_license_key(220), "220")
end

function TestLogRedact:test_safe_license_key_hides_non_numeric_keys()
    lu.assertEquals(log_redact.safe_license_key("Half-Life 2"), "non-numeric key")
    lu.assertEquals(log_redact.safe_license_key("220a"), "non-numeric key")
end

function TestLogRedact:test_safe_license_key_reports_missing_or_empty_as_none()
    lu.assertEquals(log_redact.safe_license_key(""), "<none>")
    lu.assertEquals(log_redact.safe_license_key(nil), "<none>")
end
