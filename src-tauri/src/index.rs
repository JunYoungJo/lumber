use chrono::{DateTime, NaiveDateTime, NaiveTime, Timelike};
use regex::bytes::Regex;

pub const LVL_NONE: u8 = 0;
pub const LVL_TRACE: u8 = 1;
pub const LVL_DEBUG: u8 = 2;
pub const LVL_INFO: u8 = 3;
pub const LVL_WARN: u8 = 4;
pub const LVL_ERROR: u8 = 5;
pub const LVL_FATAL: u8 = 6;

const META_JSON: u64 = 1 << 4;
const META_HAS_TS: u64 = 1 << 5;
const TS_SHIFT: u64 = 16;
const TS_MAX: u64 = (1 << 48) - 1;
const SCAN_PREFIX: usize = 512;

#[derive(Clone, Copy)]
pub struct LineMeta {
    pub offset: u64,
    meta: u64,
}

impl LineMeta {
    pub fn new(offset: u64, level: u8, is_json: bool, ts_delta_ms: Option<u64>) -> Self {
        let mut meta = (level as u64) & 0xF;
        if is_json {
            meta |= META_JSON;
        }
        if let Some(d) = ts_delta_ms {
            meta |= META_HAS_TS | (d.min(TS_MAX) << TS_SHIFT);
        }
        Self { offset, meta }
    }
    pub fn level(&self) -> u8 {
        (self.meta & 0xF) as u8
    }
    pub fn is_json(&self) -> bool {
        self.meta & META_JSON != 0
    }
    pub fn ts_ms(&self, base_ms: i64) -> Option<i64> {
        if self.meta & META_HAS_TS != 0 {
            Some(base_ms + (self.meta >> TS_SHIFT) as i64)
        } else {
            None
        }
    }
}

pub struct Index {
    pub lines: Vec<LineMeta>,
    pub base_ts_ms: Option<i64>,
    pub indexed_bytes: u64,
    pub file_size: u64,
    pub done: bool,
    pub json: bool,
}

impl Index {
    pub fn new() -> Self {
        Self { lines: Vec::new(), base_ts_ms: None, indexed_bytes: 0, file_size: 0, done: false, json: false }
    }
    pub fn line_end(&self, i: usize) -> u64 {
        if i + 1 < self.lines.len() {
            self.lines[i + 1].offset
        } else {
            self.indexed_bytes
        }
    }
}

pub struct Scanner {
    level_re: Regex,
    ts_re: Regex,
    time_re: Regex,
    json_level_re: Regex,
    json_ts_re: Regex,
    custom: Vec<(Regex, u8)>,
}

impl Scanner {
    #[cfg(test)]
    pub fn new() -> Self {
        Self::with_rules(&[])
    }

    pub fn with_rules(rules: &[(String, u8)]) -> Self {
        let custom = rules
            .iter()
            .filter_map(|(pattern, level)| {
                regex::bytes::RegexBuilder::new(&regex::escape(pattern))
                    .case_insensitive(true)
                    .build()
                    .ok()
                    .map(|re| (re, *level))
            })
            .collect();
        Self {
            level_re: Regex::new(r"(?i)(?:^|[\[ \t|:(])(TRACE|DEBUG|DBG|INFO|INF|WARNING|WARN|WRN|ERROR|ERR|FATAL|CRITICAL|CRIT)(?:[\]\s|:)]|$)").unwrap(),
            ts_re: Regex::new(r"\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?").unwrap(),
            time_re: Regex::new(r"(?:^|[\[ \t])(\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,9})?)").unwrap(),
            json_level_re: Regex::new(r#""(?:level|lvl|severity|log\.level)"\s*:\s*"?([A-Za-z]+|\d{1,3})"#).unwrap(),
            json_ts_re: Regex::new(r#""(?:@?timestamp|time|ts|Timestamp)"\s*:\s*"?([^",}\s]+)"#).unwrap(),
            custom,
        }
    }

    fn custom_level(&self, head: &[u8]) -> Option<u8> {
        self.custom.iter().find(|(re, _)| re.is_match(head)).map(|(_, l)| *l)
    }

    pub fn parse_line(&self, line: &[u8]) -> (u8, bool, Option<i64>) {
        let head = &line[..line.len().min(SCAN_PREFIX)];
        let trimmed = trim_start(line);
        let is_json = trimmed.first() == Some(&b'{');
        if let Some(level) = self.custom_level(head) {
            let ts = if is_json {
                self.json_ts_re.captures(head).and_then(|c| c.get(1)).and_then(|m| parse_ts_token(m.as_bytes()))
            } else {
                self.ts_re
                    .find(head)
                    .and_then(|m| parse_datetime(m.as_bytes()))
                    .or_else(|| self.time_re.captures(head).and_then(|c| c.get(1)).and_then(|m| parse_time_only(m.as_bytes())))
            };
            return (level, is_json, ts);
        }
        if is_json {
            let level = self
                .json_level_re
                .captures(head)
                .and_then(|c| c.get(1))
                .map(|m| parse_level_token(m.as_bytes()))
                .unwrap_or(LVL_NONE);
            let ts = self
                .json_ts_re
                .captures(head)
                .and_then(|c| c.get(1))
                .and_then(|m| parse_ts_token(m.as_bytes()));
            (level, true, ts)
        } else {
            let level = self
                .level_re
                .captures(head)
                .and_then(|c| c.get(1))
                .map(|m| parse_level_token(m.as_bytes()))
                .unwrap_or(LVL_NONE);
            let ts = self
                .ts_re
                .find(head)
                .and_then(|m| parse_datetime(m.as_bytes()))
                .or_else(|| {
                    self.time_re
                        .captures(head)
                        .and_then(|c| c.get(1))
                        .and_then(|m| parse_time_only(m.as_bytes()))
                });
            (level, false, ts)
        }
    }
}

fn trim_start(b: &[u8]) -> &[u8] {
    let mut i = 0;
    while i < b.len() && (b[i] == b' ' || b[i] == b'\t') {
        i += 1;
    }
    &b[i..]
}

fn parse_level_token(tok: &[u8]) -> u8 {
    if tok.iter().all(|c| c.is_ascii_digit()) {
        let n: u32 = std::str::from_utf8(tok).ok().and_then(|s| s.parse().ok()).unwrap_or(0);
        return match n {
            0..=19 => LVL_TRACE,
            20..=29 => LVL_DEBUG,
            30..=39 => LVL_INFO,
            40..=49 => LVL_WARN,
            50..=59 => LVL_ERROR,
            _ => LVL_FATAL,
        };
    }
    let up = tok.to_ascii_uppercase();
    match up.as_slice() {
        b"TRACE" => LVL_TRACE,
        b"DEBUG" | b"DBG" => LVL_DEBUG,
        b"INFO" | b"INF" => LVL_INFO,
        b"WARN" | b"WARNING" | b"WRN" => LVL_WARN,
        b"ERROR" | b"ERR" => LVL_ERROR,
        b"FATAL" | b"CRITICAL" | b"CRIT" => LVL_FATAL,
        _ => LVL_NONE,
    }
}

fn parse_ts_token(tok: &[u8]) -> Option<i64> {
    if tok.iter().all(|c| c.is_ascii_digit() || *c == b'.') {
        let s = std::str::from_utf8(tok).ok()?;
        let v: f64 = s.parse().ok()?;
        return Some(if v >= 1e14 {
            (v / 1000.0) as i64
        } else if v >= 1e11 {
            v as i64
        } else {
            (v * 1000.0) as i64
        });
    }
    parse_datetime(tok)
}

fn parse_datetime(b: &[u8]) -> Option<i64> {
    let s = std::str::from_utf8(b).ok()?;
    let s = s.replace(',', ".");
    if let Ok(dt) = DateTime::parse_from_rfc3339(&s) {
        return Some(dt.timestamp_millis());
    }
    for fmt in [
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y/%m/%d %H:%M:%S%.f",
    ] {
        if let Ok(dt) = NaiveDateTime::parse_from_str(&s, fmt) {
            return Some(dt.and_utc().timestamp_millis());
        }
    }
    None
}

fn parse_time_only(b: &[u8]) -> Option<i64> {
    let s = std::str::from_utf8(b).ok()?;
    let s = s.replace(',', ".");
    let t = NaiveTime::parse_from_str(&s, "%H:%M:%S%.f").ok()?;
    Some(t.num_seconds_from_midnight() as i64 * 1000 + (t.nanosecond() / 1_000_000) as i64)
}

/// Scans complete lines in `buf` (starting at absolute `base_offset`), appending
/// metadata to `index`. Returns the number of bytes consumed (up to and
/// including the final newline); the caller re-feeds the remainder later.
pub fn scan_into(index: &mut Index, scanner: &Scanner, buf: &[u8], base_offset: u64) -> usize {
    let mut consumed = 0usize;
    while let Some(nl) = memchr(&buf[consumed..], b'\n') {
        let start = consumed;
        let mut end = consumed + nl;
        if end > start && buf[end - 1] == b'\r' {
            end -= 1;
        }
        let line = &buf[start..end];
        let (level, is_json, ts) = scanner.parse_line(line);
        let delta = ts.map(|t| {
            let base = *index.base_ts_ms.get_or_insert(t);
            (t - base).max(0) as u64
        });
        index.lines.push(LineMeta::new(base_offset + start as u64, level, is_json, delta));
        if is_json {
            index.json = true;
        }
        consumed += nl + 1;
    }
    index.indexed_bytes = base_offset + consumed as u64;
    consumed
}

/// Indexes a trailing chunk with no final newline (end of file reached and the
/// writer may never append one). Only called when scanning is otherwise done.
pub fn scan_tail_line(index: &mut Index, scanner: &Scanner, buf: &[u8], base_offset: u64) {
    if buf.is_empty() {
        return;
    }
    let mut end = buf.len();
    if buf[end - 1] == b'\r' {
        end -= 1;
    }
    let (level, is_json, ts) = scanner.parse_line(&buf[..end]);
    let delta = ts.map(|t| {
        let base = *index.base_ts_ms.get_or_insert(t);
        (t - base).max(0) as u64
    });
    index.lines.push(LineMeta::new(base_offset, level, is_json, delta));
    index.indexed_bytes = base_offset + buf.len() as u64;
}

fn memchr(haystack: &[u8], needle: u8) -> Option<usize> {
    haystack.iter().position(|&b| b == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scan_all(data: &[u8]) -> Index {
        let mut idx = Index::new();
        let sc = Scanner::new();
        let consumed = scan_into(&mut idx, &sc, data, 0);
        if consumed < data.len() {
            scan_tail_line(&mut idx, &sc, &data[consumed..], consumed as u64);
        }
        idx.file_size = data.len() as u64;
        idx.done = true;
        idx
    }

    #[test]
    fn lf_and_crlf_line_boundaries() {
        let idx = scan_all(b"alpha\r\nbeta\ngamma");
        assert_eq!(idx.lines.len(), 3);
        assert_eq!(idx.lines[0].offset, 0);
        assert_eq!(idx.lines[1].offset, 7);
        assert_eq!(idx.lines[2].offset, 12);
        assert_eq!(idx.indexed_bytes, 17);
    }

    #[test]
    fn no_trailing_newline_keeps_last_line() {
        let idx = scan_all(b"one\ntwo");
        assert_eq!(idx.lines.len(), 2);
        assert_eq!(idx.line_end(1), 7);
    }

    #[test]
    fn empty_lines_are_lines() {
        let idx = scan_all(b"a\n\nb\n");
        assert_eq!(idx.lines.len(), 3);
    }

    #[test]
    fn text_level_detection() {
        let idx = scan_all(b"2024-01-01 10:00:00.100 [ERROR] boom\n2024-01-01 10:00:00.200 [warn] careful\nplain line\n");
        assert_eq!(idx.lines[0].level(), LVL_ERROR);
        assert_eq!(idx.lines[1].level(), LVL_WARN);
        assert_eq!(idx.lines[2].level(), LVL_NONE);
    }

    #[test]
    fn level_word_needs_delimiters() {
        let idx = scan_all(b"processing information for userinfo\n");
        assert_eq!(idx.lines[0].level(), LVL_NONE);
    }

    #[test]
    fn level_at_line_start() {
        let idx = scan_all(
            b"INFO 2026-07-13T08:49:53.935 [RequestController] Received Request Image (TaskId: 1 , Slice Index: 52 )\nERROR something failed\n",
        );
        assert_eq!(idx.lines[0].level(), LVL_INFO);
        assert_eq!(idx.lines[1].level(), LVL_ERROR);
        let base = idx.base_ts_ms.unwrap();
        assert!(idx.lines[0].ts_ms(base).is_some());
    }

    #[test]
    fn custom_level_rules_override() {
        let sc = Scanner::with_rules(&[("slice index".into(), LVL_WARN)]);
        let mut idx = Index::new();
        scan_into(&mut idx, &sc, b"INFO got Slice Index: 3\nINFO plain line\n", 0);
        assert_eq!(idx.lines[0].level(), LVL_WARN);
        assert_eq!(idx.lines[1].level(), LVL_INFO);
    }

    #[test]
    fn text_timestamp_delta() {
        let idx = scan_all(b"2024-01-01 10:00:00.000 INFO a\n2024-01-01 10:00:01.500 INFO b\n");
        let base = idx.base_ts_ms.unwrap();
        assert_eq!(idx.lines[0].ts_ms(base), Some(base));
        assert_eq!(idx.lines[1].ts_ms(base), Some(base + 1500));
    }

    #[test]
    fn comma_millis_timestamp() {
        let idx = scan_all(b"2024-01-01 10:00:00,250 INFO x\n2024-01-01 10:00:00,750 INFO y\n");
        let base = idx.base_ts_ms.unwrap();
        assert_eq!(idx.lines[1].ts_ms(base).unwrap() - base, 500);
    }

    #[test]
    fn time_only_timestamp() {
        let idx = scan_all(b"[10:00:00.000] INFO a\n[10:00:02.000] INFO b\n");
        let base = idx.base_ts_ms.unwrap();
        assert_eq!(idx.lines[1].ts_ms(base).unwrap() - base, 2000);
    }

    #[test]
    fn json_level_and_ts() {
        let idx = scan_all(
            br#"{"level":"error","time":"2024-01-01T10:00:00.000Z","msg":"boom"}
{"level":"info","time":"2024-01-01T10:00:01.000Z","msg":"ok"}
{"level":30,"time":1704103202000,"msg":"pino numeric"}
"#,
        );
        assert!(idx.json);
        assert_eq!(idx.lines[0].level(), LVL_ERROR);
        assert!(idx.lines[0].is_json());
        assert_eq!(idx.lines[1].level(), LVL_INFO);
        assert_eq!(idx.lines[2].level(), LVL_INFO);
        let base = idx.base_ts_ms.unwrap();
        assert_eq!(idx.lines[1].ts_ms(base).unwrap() - base, 1000);
    }

    #[test]
    fn incremental_scan_matches_full_scan() {
        let data: Vec<u8> = (0..1000)
            .map(|i| format!("2024-01-01 10:00:{:02}.000 INFO line {}\n", i % 60, i))
            .collect::<String>()
            .into_bytes();
        let full = scan_all(&data);

        let mut inc = Index::new();
        let sc = Scanner::new();
        let mut pending: Vec<u8> = Vec::new();
        let mut fed = 0usize;
        for chunk in data.chunks(97) {
            pending.extend_from_slice(chunk);
            fed += chunk.len();
            let consumed = scan_into(&mut inc, &sc, &pending, (fed - pending.len()) as u64);
            pending.drain(..consumed);
        }
        assert!(pending.is_empty());
        assert_eq!(inc.lines.len(), full.lines.len());
        for (a, b) in inc.lines.iter().zip(full.lines.iter()) {
            assert_eq!(a.offset, b.offset);
            assert_eq!(a.level(), b.level());
        }
    }
}
