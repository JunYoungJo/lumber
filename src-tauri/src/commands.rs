use crate::aggregate::{overview, Overview};
use crate::index::{LVL_ERROR, LVL_WARN};
use crate::query::{build_matcher, CompiledFilter, FilterSpec, PatternSpec};
use crate::tab::{
    read_line_text, run_search, spawn_io_thread, spawn_view_worker, Emitter, Job, TabState,
};
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter as TauriEmit, State};

const DETAIL_CAP: usize = 256 * 1024;

pub struct AppEmitter(pub AppHandle);
impl Emitter for AppEmitter {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        let _ = TauriEmit::emit(&self.0, event, payload);
    }
}

#[derive(Default)]
pub struct AppState {
    pub tabs: Mutex<HashMap<u64, Arc<TabState>>>,
    pub next_id: AtomicU64,
}

fn tab_of(state: &State<'_, AppState>, id: u64) -> Result<Arc<TabState>, String> {
    state
        .tabs
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("탭 {}이(가) 없습니다", id))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabInfo {
    pub id: u64,
    pub path: String,
    pub name: String,
}

#[derive(serde::Deserialize)]
pub struct LevelRule {
    pub pattern: String,
    pub level: u8,
}

#[tauri::command]
pub async fn open_file(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    level_rules: Option<Vec<LevelRule>>,
) -> Result<TabInfo, String> {
    let pb = std::path::PathBuf::from(&path);
    let meta = std::fs::metadata(&pb).map_err(|e| format!("파일을 열 수 없습니다: {}", e))?;
    if !meta.is_file() {
        return Err("파일이 아닙니다".into());
    }
    {
        let tabs = state.tabs.lock().unwrap();
        if let Some((id, _)) = tabs.iter().find(|(_, t)| t.path == pb) {
            return Ok(TabInfo { id: *id, path, name: file_name(&pb) });
        }
    }
    let rules: Vec<(String, u8)> = level_rules
        .unwrap_or_default()
        .into_iter()
        .filter(|r| !r.pattern.trim().is_empty())
        .map(|r| (r.pattern, r.level.min(6)))
        .collect();
    let id = state.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let tab = TabState::with_scanner(id, pb.clone(), Arc::new(AppEmitter(app)), crate::index::Scanner::with_rules(&rules));
    spawn_view_worker(tab.clone());
    spawn_io_thread(tab.clone());
    state.tabs.lock().unwrap().insert(id, tab);
    Ok(TabInfo { id, path, name: file_name(&pb) })
}

fn file_name(p: &std::path::Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| p.display().to_string())
}

#[tauri::command]
pub async fn close_file(state: State<'_, AppState>, id: u64) -> Result<(), String> {
    if let Some(tab) = state.tabs.lock().unwrap().remove(&id) {
        tab.alive.store(false, Ordering::Relaxed);
        *tab.jobs.lock().unwrap() = None;
        tab.search_gen.fetch_add(1, Ordering::SeqCst);
        tab.filter_gen.fetch_add(1, Ordering::SeqCst);
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineOut {
    pub row: u32,
    pub line: u32,
    pub text: String,
    pub truncated: bool,
    pub level: u8,
    pub ts: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinesOut {
    pub generation: u64,
    pub total: u32,
    pub lines: Vec<LineOut>,
}

#[tauri::command]
pub async fn get_lines(state: State<'_, AppState>, id: u64, start: u32, count: u32) -> Result<LinesOut, String> {
    let tab = tab_of(&state, id)?;
    let count = count.min(1000);
    let (generation, resolved) = tab.resolve_rows(start, count);
    let total = tab.view_len();
    let mut lines = Vec::with_capacity(resolved.len());
    if !resolved.is_empty() {
        let mut file = File::open(&tab.path).map_err(|e| e.to_string())?;
        let span_start = resolved.first().unwrap().start;
        let span_end = resolved.last().unwrap().end;
        let contiguous = span_end > span_start && (span_end - span_start) <= 16 * 1024 * 1024;
        let buf = if contiguous {
            let mut b = vec![0u8; (span_end - span_start) as usize];
            file.seek(SeekFrom::Start(span_start)).map_err(|e| e.to_string())?;
            file.read_exact(&mut b).map_err(|e| e.to_string())?;
            Some(b)
        } else {
            None
        };
        for r in resolved {
            let (text, truncated) = match &buf {
                Some(b) => {
                    let s = (r.start - span_start) as usize;
                    let e = (r.end - span_start) as usize;
                    let mut sl = &b[s..e.min(b.len())];
                    while matches!(sl.last(), Some(b'\n') | Some(b'\r')) {
                        sl = &sl[..sl.len() - 1];
                    }
                    let capped = sl.len() > 8192;
                    let sl = &sl[..sl.len().min(8192)];
                    (String::from_utf8_lossy(sl).into_owned(), capped)
                }
                None => read_line_text(&mut file, r.start, r.end),
            };
            lines.push(LineOut { row: r.row, line: r.line, text, truncated, level: r.level, ts: r.ts });
        }
    }
    Ok(LinesOut { generation, total, lines })
}

#[tauri::command]
pub async fn set_filter(state: State<'_, AppState>, id: u64, spec: Option<FilterSpec>) -> Result<(), String> {
    let tab = tab_of(&state, id)?;
    let compiled = match &spec {
        Some(s) => Some(Arc::new(CompiledFilter::compile(s)?)),
        None => None,
    };
    *tab.filter.lock().unwrap() = compiled.clone();
    let generation = tab.filter_gen.fetch_add(1, Ordering::SeqCst) + 1;
    tab.send_job(Job::Rebuild { generation, filter: compiled });
    Ok(())
}

#[tauri::command]
pub async fn search(state: State<'_, AppState>, id: u64, query: Option<PatternSpec>) -> Result<(), String> {
    let tab = tab_of(&state, id)?;
    let generation = tab.search_gen.fetch_add(1, Ordering::SeqCst) + 1;
    match query {
        None => {
            let mut s = tab.search.lock().unwrap();
            s.generation = generation;
            s.matches.clear();
            s.done = true;
            tab.emitter.emit(
                "search-update",
                json!({ "id": id, "gen": generation, "total": 0, "done": true, "cleared": true }),
            );
            Ok(())
        }
        Some(q) => {
            let matcher = build_matcher(&q)?;
            {
                let mut s = tab.search.lock().unwrap();
                s.generation = generation;
                s.matches.clear();
                s.done = false;
            }
            run_search(tab, generation, matcher);
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn get_overview(state: State<'_, AppState>, id: u64, histo_buckets: u32, minimap_buckets: u32) -> Result<Overview, String> {
    let tab = tab_of(&state, id)?;
    Ok(overview(&tab, histo_buckets as usize, minimap_buckets as usize))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineDetail {
    pub line: u32,
    pub text: String,
    pub truncated: bool,
    pub level: u8,
    pub ts: Option<i64>,
    pub json: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn get_line_detail(state: State<'_, AppState>, id: u64, line: u32) -> Result<LineDetail, String> {
    let tab = tab_of(&state, id)?;
    let (start, end, level, ts, is_json) = {
        let index = tab.index.read().unwrap();
        let i = line as usize;
        if i >= index.lines.len() {
            return Err("라인이 범위를 벗어났습니다".into());
        }
        let m = &index.lines[i];
        let base = index.base_ts_ms.unwrap_or(0);
        (m.offset, index.line_end(i), m.level(), m.ts_ms(base), m.is_json())
    };
    let mut file = File::open(&tab.path).map_err(|e| e.to_string())?;
    let len = (end - start) as usize;
    let capped = len.min(DETAIL_CAP);
    let mut buf = vec![0u8; capped];
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    file.read_exact(&mut buf).map_err(|e| e.to_string())?;
    while matches!(buf.last(), Some(b'\n') | Some(b'\r')) {
        buf.pop();
    }
    let text = String::from_utf8_lossy(&buf).into_owned();
    let parsed = if is_json { serde_json::from_str(&text).ok() } else { None };
    Ok(LineDetail { line, text, truncated: len > DETAIL_CAP, level, ts, json: parsed })
}

#[tauri::command]
pub async fn jump(state: State<'_, AppState>, id: u64, from_row: i64, dir: i32, kind: String) -> Result<Option<u32>, String> {
    let tab = tab_of(&state, id)?;
    let index = tab.index.read().unwrap();
    let view = tab.view.read().unwrap();
    let n = match &view.rows {
        Some(r) => r.len() as i64,
        None => index.lines.len() as i64,
    };
    if n == 0 {
        return Ok(None);
    }
    let line_of = |row: i64| -> u32 {
        match &view.rows {
            Some(r) => r[row as usize],
            None => row as u32,
        }
    };
    if kind == "match" {
        let search = tab.search.lock().unwrap();
        if search.matches.is_empty() {
            return Ok(None);
        }
        let cur_line = line_of(from_row.clamp(0, n - 1)) as i64;
        let matches = &search.matches;
        let mut idx = matches.partition_point(|&m| (m as i64) <= cur_line) as i64;
        if dir < 0 {
            idx = matches.partition_point(|&m| (m as i64) < cur_line) as i64 - 1;
        }
        while idx >= 0 && idx < matches.len() as i64 {
            let target = matches[idx as usize];
            let row = match &view.rows {
                Some(r) => r.binary_search(&target).ok().map(|x| x as u32),
                None => Some(target),
            };
            if let Some(row) = row {
                return Ok(Some(row));
            }
            idx += if dir < 0 { -1 } else { 1 };
        }
        return Ok(None);
    }
    let min_level = if kind == "warn" { LVL_WARN } else { LVL_ERROR };
    let mut row = from_row + dir as i64;
    while row >= 0 && row < n {
        if index.lines[line_of(row) as usize].level() >= min_level {
            return Ok(Some(row as u32));
        }
        row += dir as i64;
    }
    Ok(None)
}

#[tauri::command]
pub async fn match_nav(state: State<'_, AppState>, id: u64, ordinal: i64, dir: i32) -> Result<Option<(u32, u32)>, String> {
    let tab = tab_of(&state, id)?;
    Ok(crate::tab::match_nav(&tab, ordinal, dir))
}

#[tauri::command]
pub async fn match_from_row(state: State<'_, AppState>, id: u64, row: i64, dir: i32) -> Result<Option<(u32, u32)>, String> {
    let tab = tab_of(&state, id)?;
    Ok(crate::tab::match_from_row(&tab, row, dir))
}

#[tauri::command]
pub async fn lines_to_rows(state: State<'_, AppState>, id: u64, lines: Vec<u32>) -> Result<Vec<Option<u32>>, String> {
    let tab = tab_of(&state, id)?;
    let index = tab.index.read().unwrap();
    let view = tab.view.read().unwrap();
    Ok(lines
        .into_iter()
        .map(|l| match &view.rows {
            Some(r) => r.binary_search(&l).ok().map(|x| x as u32),
            None => {
                if (l as usize) < index.lines.len() {
                    Some(l)
                } else {
                    None
                }
            }
        })
        .collect())
}

#[tauri::command]
pub async fn row_for_ts(state: State<'_, AppState>, id: u64, ts: i64) -> Result<Option<u32>, String> {
    let tab = tab_of(&state, id)?;
    let index = tab.index.read().unwrap();
    let view = tab.view.read().unwrap();
    let base = match index.base_ts_ms {
        Some(b) => b,
        None => return Ok(None),
    };
    let line = index
        .lines
        .partition_point(|m| m.ts_ms(base).map(|t| t < ts).unwrap_or(true))
        .min(index.lines.len().saturating_sub(1));
    Ok(match &view.rows {
        Some(r) => {
            let pos = r.partition_point(|&l| (l as usize) < line);
            if pos < r.len() {
                Some(pos as u32)
            } else if r.is_empty() {
                None
            } else {
                Some(r.len() as u32 - 1)
            }
        }
        None => {
            if index.lines.is_empty() {
                None
            } else {
                Some(line as u32)
            }
        }
    })
}
