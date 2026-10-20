//! `GET /v1/statements` — monthly account statement, per asset.
//!
//! # Query parameters
//!
//! | name     | type   | default | description                                   |
//! |----------|--------|---------|-----------------------------------------------|
//! | `year`   | u32    | —       | four-digit year, e.g. `2026`                  |
//! | `month`  | u32    | —       | 1–12, e.g. `10` for October                   |
//! | `format` | string | `json`  | `json`, `csv`, or `pdf`                       |
//!
//! # Response
//!
//! **JSON** (`Content-Type: application/json`): `StatementResponse` body.
//!
//! **CSV** (`Content-Type: text/csv`): one row per posting across all assets,
//! plus header and summary rows.
//!
//! **PDF** (`Content-Type: application/pdf`): a human-readable plain-text
//! statement formatted as a minimal RFC 3461-compatible PDF.
//!
//! # Balance identity guarantee
//!
//! The handler checks `opening + Σ(movements) == closing` for every asset and
//! returns `500 Internal Server Error` if the invariant is violated.  This
//! should never happen; if it does, the ledger has a bug.

use axum::extract::{Query, State};
use axum::http::{HeaderMap, HeaderValue, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use chrono::NaiveDate;
use engipay_core::Asset;
use engipay_ledger::postgres::PostgresLedgerStore;
use engipay_ledger::{AssetStatement, MonthlyStatement};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;
use crate::routes::balances::format_minor;

// ── Router ────────────────────────────────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new().route("/statements", get(get_statement))
}

// ── Query / response types ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct StatementQuery {
    /// Four-digit year, e.g. `2026`.
    pub year: i32,
    /// 1–12.
    pub month: u32,
    /// `json` (default), `csv`, or `pdf`.
    #[serde(default = "default_format")]
    pub format: StatementFormat,
}

fn default_format() -> StatementFormat {
    StatementFormat::Json
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StatementFormat {
    Json,
    Csv,
    Pdf,
}

/// One posting line in the JSON response.
#[derive(Debug, Clone, Serialize)]
pub struct StatementLineResponse {
    pub transaction_id: String,
    pub kind: String,
    pub reference: String,
    pub asset: Asset,
    pub bucket: String,
    /// Raw signed integer (minor units).
    pub amount_minor: i128,
    /// Fixed-decimal string.
    pub amount: String,
    pub created_at: String,
}

/// Per-asset section of the JSON statement.
#[derive(Debug, Clone, Serialize)]
pub struct AssetStatementResponse {
    pub asset: Asset,
    /// Minor-unit balance immediately before the period.
    pub opening_balance_minor: i128,
    /// Fixed-decimal opening balance.
    pub opening_balance: String,
    /// All postings within the period.
    pub lines: Vec<StatementLineResponse>,
    /// Algebraic sum of all line amounts, in minor units.
    pub net_movement_minor: i128,
    /// Fixed-decimal net movement.
    pub net_movement: String,
    /// Minor-unit balance at the end of the period.
    pub closing_balance_minor: i128,
    /// Fixed-decimal closing balance.
    pub closing_balance: String,
}

/// Top-level JSON response body.
#[derive(Debug, Serialize)]
pub struct StatementResponse {
    /// ISO 8601 period start (first day of the requested month).
    pub period_start: String,
    /// ISO 8601 period end (first day of the month after).
    pub period_end: String,
    /// One entry per asset in `Asset::ALL` order.
    pub assets: Vec<AssetStatementResponse>,
}

// ── Handler ───────────────────────────────────────────────────────────────────

async fn get_statement(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(params): Query<StatementQuery>,
) -> Result<Response, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // Validate and build the period start date.
    let period_start = NaiveDate::from_ymd_opt(params.year, params.month, 1)
        .ok_or_else(|| ApiError::BadRequest("invalid year/month combination".to_string()))?;

    let store = PostgresLedgerStore::new(pool);
    let statement = store
        .get_monthly_statement(user_id, period_start)
        .await
        .map_err(|e| match e {
            engipay_ledger::LedgerError::InvariantViolated(msg) => {
                tracing::error!(
                    user_id = %user_id,
                    period_start = %period_start,
                    "balance identity violated in monthly statement: {msg}"
                );
                ApiError::Internal(anyhow::anyhow!("balance identity violated: {msg}"))
            }
            other => ApiError::Internal(anyhow::anyhow!(other.to_string())),
        })?;

    let response = match params.format {
        StatementFormat::Json => render_json(statement)?,
        StatementFormat::Csv => render_csv(statement)?,
        StatementFormat::Pdf => render_pdf(statement)?,
    };

    Ok(response)
}

// ── JSON renderer ─────────────────────────────────────────────────────────────

fn render_json(statement: MonthlyStatement) -> Result<Response, ApiError> {
    let period_start = statement.period_start;
    let period_end = next_month_naive(period_start)
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("period_end overflow")))?;

    let assets: Vec<AssetStatementResponse> = statement
        .assets
        .into_iter()
        .map(asset_statement_to_response)
        .collect();

    Ok(Json(StatementResponse {
        period_start: period_start.to_string(),
        period_end: period_end.to_string(),
        assets,
    })
    .into_response())
}

fn asset_statement_to_response(a: AssetStatement) -> AssetStatementResponse {
    let net = a.net_movement();
    let lines = a
        .lines
        .iter()
        .map(|l| StatementLineResponse {
            transaction_id: l.transaction_id.to_string(),
            kind: l.kind.clone(),
            reference: l.reference.clone(),
            asset: l.asset,
            bucket: l.bucket.clone(),
            amount_minor: l.amount,
            amount: format_minor(l.asset, l.amount),
            created_at: l.created_at.clone(),
        })
        .collect();

    AssetStatementResponse {
        asset: a.asset,
        opening_balance_minor: a.opening_balance,
        opening_balance: format_minor(a.asset, a.opening_balance),
        lines,
        net_movement_minor: net,
        net_movement: format_minor(a.asset, net),
        closing_balance_minor: a.closing_balance,
        closing_balance: format_minor(a.asset, a.closing_balance),
    }
}

// ── CSV renderer ──────────────────────────────────────────────────────────────

fn render_csv(statement: MonthlyStatement) -> Result<Response, ApiError> {
    let mut output = String::new();

    // Header row.
    csv_row(
        &mut output,
        &[
            "period_start",
            "asset",
            "type",
            "transaction_id",
            "kind",
            "reference",
            "bucket",
            "amount_minor",
            "amount",
            "created_at",
            "running_balance_minor",
            "running_balance",
        ],
    );

    let period_start = statement.period_start.to_string();

    for asset_stmt in &statement.assets {
        // Opening balance row.
        csv_row(
            &mut output,
            &[
                &period_start,
                asset_stmt.asset.symbol(),
                "opening_balance",
                "",
                "",
                "",
                "",
                &asset_stmt.opening_balance.to_string(),
                &format_minor(asset_stmt.asset, asset_stmt.opening_balance),
                "",
                &asset_stmt.opening_balance.to_string(),
                &format_minor(asset_stmt.asset, asset_stmt.opening_balance),
            ],
        );

        let mut running = asset_stmt.opening_balance;
        for line in &asset_stmt.lines {
            running = running
                .checked_add(line.amount)
                .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("amount overflow in csv")))?;
            csv_row(
                &mut output,
                &[
                    &period_start,
                    line.asset.symbol(),
                    "posting",
                    &line.transaction_id.to_string(),
                    &line.kind,
                    &line.reference,
                    &line.bucket,
                    &line.amount.to_string(),
                    &format_minor(line.asset, line.amount),
                    &line.created_at,
                    &running.to_string(),
                    &format_minor(line.asset, running),
                ],
            );
        }

        // Closing balance row.
        csv_row(
            &mut output,
            &[
                &period_start,
                asset_stmt.asset.symbol(),
                "closing_balance",
                "",
                "",
                "",
                "",
                &asset_stmt.closing_balance.to_string(),
                &format_minor(asset_stmt.asset, asset_stmt.closing_balance),
                "",
                &asset_stmt.closing_balance.to_string(),
                &format_minor(asset_stmt.asset, asset_stmt.closing_balance),
            ],
        );
    }

    let filename = format!("statement-{}.csv", statement.period_start);
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/csv; charset=utf-8"));
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("header error: {e}")))?,
    );

    Ok((headers, output.into_bytes()).into_response())
}

/// Appends one RFC 4180-compliant CSV row to `buf`.
///
/// Fields containing commas, double-quotes, or newlines are quoted and any
/// internal double-quotes are doubled.
fn csv_row(buf: &mut String, fields: &[&str]) {
    for (i, field) in fields.iter().enumerate() {
        if i > 0 {
            buf.push(',');
        }
        if field.contains([',', '"', '\n', '\r']) {
            buf.push('"');
            for ch in field.chars() {
                if ch == '"' {
                    buf.push('"'); // double the quote
                }
                buf.push(ch);
            }
            buf.push('"');
        } else {
            buf.push_str(field);
        }
    }
    buf.push('\n');
}

// ── PDF renderer ──────────────────────────────────────────────────────────────
//
// A minimal PDF generated from scratch with no third-party library.  The file
// is a valid PDF 1.4 document with a single page per asset, rendered as
// pre-formatted text using Courier (a standard PDF font).  No images, no
// external resources, no binary blobs beyond the PDF structure bytes.

fn render_pdf(statement: MonthlyStatement) -> Result<Response, ApiError> {
    let pdf_bytes = build_pdf(&statement)
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("pdf build error: {e}")))?;

    let filename = format!("statement-{}.pdf", statement.period_start);
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/pdf"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("header error: {e}")))?,
    );

    Ok((headers, pdf_bytes).into_response())
}

/// Builds a minimal but spec-valid PDF 1.4 document.
///
/// Architecture: one page per asset, text rendered with `Tj` commands using
/// the standard Courier font (always available in PDF viewers, no embedding
/// needed).  Offsets are tracked to produce a valid cross-reference table.
fn build_pdf(statement: &MonthlyStatement) -> Result<Vec<u8>, String> {
    let mut buf: Vec<u8> = Vec::new();

    // Collect the text lines for every asset page.
    let mut pages: Vec<Vec<String>> = Vec::new();
    for asset_stmt in &statement.assets {
        let mut lines: Vec<String> = Vec::new();

        lines.push(format!(
            "EngiPay Monthly Statement  —  {}",
            statement.period_start
        ));
        lines.push(format!("Asset: {}", asset_stmt.asset.symbol()));
        lines.push(String::new());
        lines.push(format!(
            "Opening balance : {}",
            format_minor(asset_stmt.asset, asset_stmt.opening_balance)
        ));
        lines.push(String::new());
        if asset_stmt.lines.is_empty() {
            lines.push("  (no transactions this month)".to_string());
        } else {
            lines.push(format!(
                "  {:<26}  {:<15}  {:>20}  {}",
                "Date", "Kind", "Amount", "Reference"
            ));
            lines.push(format!("  {}", "-".repeat(80)));
            for l in &asset_stmt.lines {
                let amount_str = format_minor(l.asset, l.amount);
                // Trim the RFC 3339 timestamp to just the date+time without sub-second noise.
                let ts = l.created_at.get(..19).unwrap_or(&l.created_at);
                lines.push(format!(
                    "  {:<26}  {:<15}  {:>20}  {}",
                    ts, l.kind, amount_str, l.reference
                ));
            }
        }
        lines.push(String::new());
        let net = asset_stmt.net_movement();
        lines.push(format!(
            "Net movement    : {}",
            format_minor(asset_stmt.asset, net)
        ));
        lines.push(format!(
            "Closing balance : {}",
            format_minor(asset_stmt.asset, asset_stmt.closing_balance)
        ));
        pages.push(lines);
    }

    // ── PDF header ────────────────────────────────────────────────────────────
    write_bytes(&mut buf, b"%PDF-1.4\n");

    // We will build objects:
    //   1  Catalog
    //   2  Pages (parent of all pages)
    //   3…N  Page + Content stream pairs: every asset gets obj 3+2i (Page) and 3+2i+1 (Content)
    // We record byte offsets for the xref table.

    let n_pages = pages.len();
    // Objects: 1 catalog, 1 pages, (1 page + 1 content stream) * n_pages
    let n_obj: usize = 2 + n_pages.saturating_mul(2);
    let mut offsets: Vec<usize> = vec![0usize; n_obj.saturating_add(1)]; // 1-indexed

    // ── Object 1: Catalog ─────────────────────────────────────────────────────
    offsets[1] = buf.len();
    write_bytes(
        &mut buf,
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    );

    // We need to know all page object numbers before writing the Pages dict.
    // Page objects are 3, 5, 7, … (odd: 3 + 2*i).
    let page_obj_ids: Vec<usize> = (0..n_pages).map(|i| 3 + i.saturating_mul(2)).collect();
    let kids: String = page_obj_ids
        .iter()
        .map(|id| format!("{id} 0 R"))
        .collect::<Vec<_>>()
        .join(" ");

    // ── Object 2: Pages ───────────────────────────────────────────────────────
    offsets[2] = buf.len();
    write_bytes(
        &mut buf,
        format!("2 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>\nendobj\n")
            .as_bytes(),
    );

    // ── Page + Content stream objects ─────────────────────────────────────────
    for (i, text_lines) in pages.iter().enumerate() {
        let page_id = 3 + i.saturating_mul(2);
        let content_id = page_id.saturating_add(1);

        // Build the content stream: position cursor and emit each line with Tj.
        let mut ops = String::new();
        ops.push_str("BT\n/F1 10 Tf\n50 780 Td\n12 TL\n");
        for line in text_lines {
            // Escape special PDF string chars: backslash, parentheses.
            let escaped = line
                .replace('\\', "\\\\")
                .replace('(', "\\(")
                .replace(')', "\\)");
            ops.push_str(&format!("({escaped}) Tj T*\n"));
        }
        ops.push_str("ET\n");

        let stream_bytes = ops.as_bytes();
        let stream_len = stream_bytes.len();

        // Page object.
        offsets[page_id] = buf.len();
        write_bytes(
            &mut buf,
            format!(
                "{page_id} 0 obj\n\
                 << /Type /Page\n\
                    /Parent 2 0 R\n\
                    /MediaBox [0 0 612 792]\n\
                    /Contents {content_id} 0 R\n\
                    /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Courier >> >> >>\n\
                 >>\n\
                 endobj\n"
            )
            .as_bytes(),
        );

        // Content stream object.
        offsets[content_id] = buf.len();
        write_bytes(
            &mut buf,
            format!(
                "{content_id} 0 obj\n<< /Length {stream_len} >>\nstream\n"
            )
            .as_bytes(),
        );
        write_bytes(&mut buf, stream_bytes);
        write_bytes(&mut buf, b"\nendstream\nendobj\n");
    }

    // ── Cross-reference table ─────────────────────────────────────────────────
    let xref_pos = buf.len();
    write_bytes(&mut buf, format!("xref\n0 {}\n", n_obj.saturating_add(1)).as_bytes());
    // Object 0 is the free-list head.
    write_bytes(&mut buf, b"0000000000 65535 f \n");
    for &offset in offsets.iter().skip(1).take(n_obj) {
        write_bytes(
            &mut buf,
            format!("{offset:010} 00000 n \n").as_bytes(),
        );
    }

    // ── Trailer ───────────────────────────────────────────────────────────────
    write_bytes(
        &mut buf,
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n",
            n_obj.saturating_add(1)
        )
        .as_bytes(),
    );

    Ok(buf)
}

fn write_bytes(buf: &mut Vec<u8>, bytes: &[u8]) {
    buf.extend_from_slice(bytes);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn next_month_naive(date: NaiveDate) -> Option<NaiveDate> {
    use chrono::Datelike;
    let (next_year, next_month) = if date.month() == 12 {
        (date.year().checked_add(1)?, 1)
    } else {
        (date.year(), date.month().checked_add(1)?)
    };
    NaiveDate::from_ymd_opt(next_year, next_month, 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_month_naive_wraps_december() {
        let dec = NaiveDate::from_ymd_opt(2026, 12, 1).unwrap();
        let jan = next_month_naive(dec).unwrap();
        assert_eq!(jan, NaiveDate::from_ymd_opt(2027, 1, 1).unwrap());
    }

    #[test]
    fn next_month_naive_advances_normal_month() {
        let oct = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let nov = next_month_naive(oct).unwrap();
        assert_eq!(nov, NaiveDate::from_ymd_opt(2026, 11, 1).unwrap());
    }
}
