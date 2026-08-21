use crate::tab::TabState;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoBucket {
    pub total: u32,
    pub warn: u32,
    pub error: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub level_counts: [u64; 7],
    pub histogram: Vec<HistoBucket>,
    pub histo_by_time: bool,
    pub ts_start: Option<i64>,
    pub ts_end: Option<i64>,
    pub has_ts: bool,
    pub minimap_levels: Vec<u8>,
    pub minimap_match: Vec<bool>,
    pub view_len: u32,
    pub total_lines: u32,
    pub indexing_done: bool,
    pub json: bool,
    pub file_size: u64,
}

pub fn overview(tab: &TabState, histo_buckets: usize, minimap_buckets: usize) -> Overview {
    let index = tab.index.read().unwrap();
    let view = tab.view.read().unwrap();
    let search = tab.search.lock().unwrap();

    let n = index.lines.len();
    let mut level_counts = [0u64; 7];
    let mut ts_count = 0usize;
    let mut ts_max = i64::MIN;
    let base = index.base_ts_ms;
    for m in &index.lines {
        level_counts[(m.level() % 7) as usize] += 1;
        if let (Some(b), Some(t)) = (base, m.ts_ms(base.unwrap_or(0))) {
            let _ = b;
            ts_count += 1;
            if t > ts_max {
                ts_max = t;
            }
        }
    }

    let by_time = base.is_some() && ts_count * 2 >= n && ts_max > base.unwrap_or(0);
    let histo_buckets = histo_buckets.max(1);
    let mut histogram: Vec<HistoBucket> = (0..histo_buckets).map(|_| HistoBucket { total: 0, warn: 0, error: 0 }).collect();

    if n > 0 {
        if by_time {
            let start = base.unwrap();
            let span = (ts_max - start).max(1) as u128;
            let mut cursor = 0usize;
            for m in &index.lines {
                let b = match m.ts_ms(start) {
                    Some(t) => {
                        let b = ((t - start) as u128 * (histo_buckets as u128 - 1) / span) as usize;
                        cursor = b;
                        b
                    }
                    None => cursor,
                };
                bump(&mut histogram[b.min(histo_buckets - 1)], m.level());
            }
        } else {
            for (i, m) in index.lines.iter().enumerate() {
                let b = i * histo_buckets / n;
                bump(&mut histogram[b], m.level());
            }
        }
    }

    let minimap_buckets = minimap_buckets.max(1);
    let mut minimap_levels = vec![0u8; minimap_buckets];
    let mut minimap_match = vec![false; minimap_buckets];
    let view_len = match &view.rows {
        Some(r) => r.len(),
        None => n,
    };
    if view_len > 0 {
        match &view.rows {
            Some(rows) => {
                for (row, &line) in rows.iter().enumerate() {
                    let b = row * minimap_buckets / view_len;
                    let lvl = index.lines.get(line as usize).map(|m| m.level()).unwrap_or(0);
                    if lvl > minimap_levels[b] {
                        minimap_levels[b] = lvl;
                    }
                }
                for &m in &search.matches {
                    if let Ok(row) = rows.binary_search(&m) {
                        minimap_match[row * minimap_buckets / view_len] = true;
                    }
                }
            }
            None => {
                for (i, m) in index.lines.iter().enumerate() {
                    let b = i * minimap_buckets / view_len;
                    let lvl = m.level();
                    if lvl > minimap_levels[b] {
                        minimap_levels[b] = lvl;
                    }
                }
                for &m in &search.matches {
                    if (m as usize) < view_len {
                        minimap_match[m as usize * minimap_buckets / view_len] = true;
                    }
                }
            }
        }
    }

    Overview {
        level_counts,
        histogram,
        histo_by_time: by_time,
        ts_start: if by_time { base } else { None },
        ts_end: if by_time { Some(ts_max) } else { None },
        has_ts: ts_count > 0,
        minimap_levels,
        minimap_match,
        view_len: view_len as u32,
        total_lines: n as u32,
        indexing_done: index.done,
        json: index.json,
        file_size: index.file_size,
    }
}

fn bump(b: &mut HistoBucket, level: u8) {
    b.total += 1;
    if level == crate::index::LVL_WARN {
        b.warn += 1;
    } else if level >= crate::index::LVL_ERROR {
        b.error += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tab::{Emitter, NoopEmitter, TabState};
    use std::sync::Arc;

    fn tab_with(lines: &[(&str, u8)]) -> Arc<TabState> {
        use crate::index::LineMeta;
        let tab = TabState::new(9, std::path::PathBuf::from("x"), Arc::new(NoopEmitter) as Arc<dyn Emitter>);
        {
            let mut index = tab.index.write().unwrap();
            let mut off = 0u64;
            for (text, level) in lines {
                index.lines.push(LineMeta::new(off, *level, false, None));
                off += text.len() as u64 + 1;
            }
            index.indexed_bytes = off;
            index.file_size = off;
            index.done = true;
        }
        tab
    }

    #[test]
    fn level_counts_and_line_histogram() {
        use crate::index::{LVL_ERROR, LVL_INFO, LVL_WARN};
        let tab = tab_with(&[("a", LVL_INFO), ("b", LVL_ERROR), ("c", LVL_WARN), ("d", LVL_INFO)]);
        let ov = overview(&tab, 2, 4);
        assert_eq!(ov.level_counts[LVL_INFO as usize], 2);
        assert_eq!(ov.level_counts[LVL_ERROR as usize], 1);
        assert!(!ov.histo_by_time);
        assert_eq!(ov.histogram.len(), 2);
        assert_eq!(ov.histogram[0].total, 2);
        assert_eq!(ov.histogram[0].error, 1);
        assert_eq!(ov.histogram[1].warn, 1);
        assert_eq!(ov.minimap_levels, vec![LVL_INFO, LVL_ERROR, LVL_WARN, LVL_INFO]);
    }

    #[test]
    fn minimap_respects_filtered_view() {
        use crate::index::{LVL_ERROR, LVL_INFO};
        let tab = tab_with(&[("a", LVL_INFO), ("b", LVL_ERROR), ("c", LVL_INFO), ("d", LVL_ERROR)]);
        {
            let mut view = tab.view.write().unwrap();
            view.rows = Some(vec![1, 3]);
        }
        {
            let mut s = tab.search.lock().unwrap();
            s.matches = vec![3];
        }
        let ov = overview(&tab, 1, 2);
        assert_eq!(ov.view_len, 2);
        assert_eq!(ov.minimap_levels, vec![LVL_ERROR, LVL_ERROR]);
        assert_eq!(ov.minimap_match, vec![false, true]);
    }
}
