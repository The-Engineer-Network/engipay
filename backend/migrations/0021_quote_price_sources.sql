ALTER TABLE conversions
    ADD COLUMN price_sources TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE buy_quotes
    ADD COLUMN price_sources TEXT[] NOT NULL DEFAULT '{}';