//! Pricing rules for buying crypto with Naira.
//!
//! Money is integer-only: Naira is held in kobo (1/100 naira) and the asset in
//! its smallest unit. The rate and fee come from configuration and are never
//! invented here. With either one unset, no quote can be made.

/// How long a quote stays valid. Enforced by the database (`expires_at`), so
/// the quote and the order check agree on the same clock.
pub const QUOTE_LIFETIME_SQL: &str = "2 minutes";

/// The configured terms a quote is priced with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Terms {
    /// Kobo that buy one whole unit of the asset.
    pub kobo_per_unit: i128,
    /// Fee in basis points (1/100 of a percent), taken from the Naira amount.
    pub fee_bps: u32,
}

/// A priced buy, all integers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Priced {
    pub naira_kobo: i128,
    pub fee_kobo: i128,
    pub receive_minor: i128,
}

/// Prices `naira_kobo` for an asset with `asset_decimals` decimals. Returns
/// `None` when the amount is not positive, the terms are unusable, or the
/// arithmetic would overflow.
pub fn price(naira_kobo: i128, terms: Terms, asset_decimals: u32) -> Option<Priced> {
    if naira_kobo <= 0 || terms.kobo_per_unit <= 0 || terms.fee_bps >= 10_000 {
        return None;
    }
    let fee_kobo = naira_kobo.checked_mul(i128::from(terms.fee_bps))? / 10_000;
    let net_kobo = naira_kobo - fee_kobo;
    let scale = 10_i128.checked_pow(asset_decimals)?;
    let receive_minor = net_kobo.checked_mul(scale)? / terms.kobo_per_unit;
    if receive_minor <= 0 {
        return None;
    }
    Some(Priced {
        naira_kobo,
        fee_kobo,
        receive_minor,
    })
}

/// Parses a Naira amount typed by the user ("5000", "5000.5", "5,000.50")
/// into kobo. At most two decimal places, no sign, no empty input.
pub fn parse_naira_to_kobo(input: &str) -> Option<i128> {
    let cleaned: String = input.trim().chars().filter(|c| *c != ',').collect();
    let (whole, frac) = match cleaned.split_once('.') {
        Some((whole, frac)) => (whole, frac),
        None => (cleaned.as_str(), ""),
    };
    if whole.is_empty() || !whole.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    // A dot must be followed by digits: "5." is not an amount.
    if cleaned.contains('.') && frac.is_empty() {
        return None;
    }
    if frac.len() > 2 || !frac.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let whole: i128 = whole.parse().ok()?;
    let frac: i128 = match frac.len() {
        0 => 0,
        1 => frac.parse::<i128>().ok()? * 10,
        _ => frac.parse().ok()?,
    };
    whole.checked_mul(100)?.checked_add(frac)
}

/// Formats an integer amount in its smallest unit as a fixed-point decimal
/// with exactly `decimals` fractional digits ("12.3456789").
pub fn format_fixed(minor: i128, decimals: u32) -> String {
    let scale = 10_i128.pow(decimals);
    let sign = if minor < 0 { "-" } else { "" };
    let abs = minor.abs();
    if decimals == 0 {
        return format!("{sign}{abs}");
    }
    format!(
        "{sign}{}.{:0width$}",
        abs / scale,
        abs % scale,
        width = decimals as usize
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const TERMS: Terms = Terms {
        kobo_per_unit: 150_000,
        fee_bps: 100, // 1%
    };

    #[test]
    fn a_quote_takes_the_fee_then_converts_the_rest() {
        // ₦5,000.00 = 500_000 kobo. Fee 1% = 5_000 kobo. Net 495_000 kobo.
        // 495_000 kobo / 150_000 kobo-per-USDC = 3.3 USDC = 33_000_000 at 7dp.
        let priced = price(500_000, TERMS, 7).unwrap();
        assert_eq!(priced.fee_kobo, 5_000);
        assert_eq!(priced.receive_minor, 33_000_000);
    }

    #[test]
    fn no_fee_means_the_whole_amount_is_converted() {
        let terms = Terms {
            fee_bps: 0,
            ..TERMS
        };
        let priced = price(150_000, terms, 7).unwrap();
        assert_eq!(priced.fee_kobo, 0);
        assert_eq!(priced.receive_minor, 10_000_000);
    }

    #[test]
    fn an_amount_too_small_to_receive_anything_is_refused() {
        // 1 kobo at 10_000_000_000 kobo per USDC is less than one smallest unit.
        let expensive = Terms {
            kobo_per_unit: 10_000_000_000,
            fee_bps: 0,
        };
        assert_eq!(price(1, expensive, 7), None);
    }

    #[test]
    fn non_positive_amounts_and_unusable_terms_are_refused() {
        assert_eq!(price(0, TERMS, 7), None);
        assert_eq!(price(-5, TERMS, 7), None);
        assert_eq!(
            price(
                500_000,
                Terms {
                    kobo_per_unit: 0,
                    fee_bps: 0
                },
                7
            ),
            None
        );
        assert_eq!(
            price(
                500_000,
                Terms {
                    kobo_per_unit: 1,
                    fee_bps: 10_000
                },
                7
            ),
            None
        );
    }

    #[test]
    fn naira_input_is_parsed_into_kobo() {
        assert_eq!(parse_naira_to_kobo("5000"), Some(500_000));
        assert_eq!(parse_naira_to_kobo("5000.5"), Some(500_050));
        assert_eq!(parse_naira_to_kobo("5,000.50"), Some(500_050));
        assert_eq!(parse_naira_to_kobo(" 0.01 "), Some(1));
    }

    #[test]
    fn malformed_naira_input_is_refused() {
        for bad in ["", ".", "-5", "5.", "5.555", "abc", "1e3", "5 000"] {
            assert_eq!(parse_naira_to_kobo(bad), None, "{bad:?} should be refused");
        }
    }

    #[test]
    fn fixed_point_formatting_keeps_every_digit() {
        assert_eq!(format_fixed(33_000_000, 7), "3.3000000");
        assert_eq!(format_fixed(1, 7), "0.0000001");
        assert_eq!(format_fixed(42, 0), "42");
    }
}
