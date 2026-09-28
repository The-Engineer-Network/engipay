-- XLM is part of the core Asset enum and is stored at the same exact integer
-- precision as the other supported assets.
ALTER TABLE ledger_postings DROP CONSTRAINT ledger_postings_asset_check;
ALTER TABLE ledger_postings ADD CONSTRAINT ledger_postings_asset_check
    CHECK (asset IN ('ETH', 'USDC', 'BTC', 'XLM'));

ALTER TABLE ledger_holds DROP CONSTRAINT ledger_holds_asset_check;
ALTER TABLE ledger_holds ADD CONSTRAINT ledger_holds_asset_check
    CHECK (asset IN ('ETH', 'USDC', 'BTC', 'XLM'));
