//! Optional note on transfers (#696).

pub const MAX_NOTE_CHARS: usize = 140;

/// A note is valid when its trimmed length is at most 140 characters.
pub fn validate_note(note: Option<&str>) -> Result<(), ()> {
    match note {
        Some(n) if n.trim().chars().count() > MAX_NOTE_CHARS => Err(()),
        _ => Ok(()),
    }
}

/// Trimmed note, or `None` when absent or blank.
pub fn normalize_note(note: Option<&str>) -> Option<String> {
    note.map(str::trim).filter(|n| !n.is_empty()).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_absent_and_140_char_notes() {
        assert!(validate_note(None).is_ok());
        assert!(validate_note(Some(&"a".repeat(140))).is_ok());
    }

    #[test]
    fn rejects_141_char_note() {
        assert!(validate_note(Some(&"a".repeat(141))).is_err());
    }

    #[test]
    fn counts_characters_not_bytes() {
        assert!(validate_note(Some(&"é".repeat(140))).is_ok());
    }

    #[test]
    fn blank_note_is_dropped_and_text_trimmed() {
        assert_eq!(normalize_note(Some("   ")), None);
        assert_eq!(normalize_note(Some(" rent ")), Some("rent".to_string()));
    }
}
