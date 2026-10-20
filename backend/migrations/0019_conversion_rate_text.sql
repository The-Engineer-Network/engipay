-- Migration 0019: conversions.rate stores the exact quoted rate.
--
-- The API quotes an exact rational "numerator/denominator" (e.g. "10/1") and
-- inserts it verbatim on POST /v1/convert/quote. NUMERIC cannot represent a
-- fraction, so every quote insert failed with "invalid input syntax for type
-- numeric". No code reads the column back as a number; TEXT stores the quote
-- exactly as the API reports it.

ALTER TABLE conversions
    ALTER COLUMN rate TYPE TEXT USING rate::text;

COMMENT ON COLUMN conversions.rate IS
    'Exchange rate the quote was priced at, as an exact numerator/denominator string (e.g. 10/1).';
