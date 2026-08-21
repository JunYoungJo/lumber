use crate::index::{scan_into, scan_tail_line, Index, Scanner};
use crate::query::CompiledFilter;
use notify::{RecursiveMode, Watcher};
use serde_json::json;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{mpsc, Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

const CHUNK: usize = 4 * 1024 * 1024;
const LINE_CAP: usize = 8 * 1024;
/// tail-appended 이벤트에 실어 보내는 최대 라인 수(마지막 N줄).
const TAIL_PUSH_MAX: usize = 300;
const BATCH_LINES: usize = 8192;
const PROGRESS_EVERY: Duration = Duration::from_millis(150);

pub trait Emitter: Send + Sync {
    fn emit(&self, event: &str, payload: serde_json::Value);
}

#[cfg(test)]
pub struct NoopEmitter;
#[cfg(test)]
impl Emitter for NoopEmitter {
    fn emit(&self, _: &str, _: serde_json::Value) {}
}

pub struct ViewState {
    pub generation: u64,
    /// None = 필터 없음(모든 라인이 뷰), Some = 뷰 행 → 파일 라인 인덱스
    pub rows: Option<Vec<u32>>,
    pub complete: bool,
}

pub struct SearchState {
    pub generation: u64,
    pub matches: Vec<u32>,
    pub done: bool,
}

pub enum Job {
    Rebuild { generation: u64, filter: Option<Arc<CompiledFilter>> },
    Append { start: u32, end: u32 },
    Reset,
}

pub struct TabState {
    pub id: u64,
    pub path: PathBuf,
    pub index: RwLock<Index>,
    pub scanner: Scanner,
    pub view: RwLock<ViewState>,
    pub filter: Mutex<Option<Arc<CompiledFilter>>>,
    pub filter_gen: AtomicU64,
    pub search: Mutex<SearchState>,
    pub search_gen: AtomicU64,
    pub alive: AtomicBool,
    pub tail_open: AtomicBool,
    pub jobs: Mutex<Option<Sender<Job>>>,
    pub emitter: Arc<dyn Emitter>,
}

impl TabState {
    #[cfg(test)]
    pub fn new(id: u64, path: PathBuf, emitter: Arc<dyn Emitter>) -> Arc<Self> {
        Self::with_scanner(id, path, emitter, Scanner::new())
    }

    pub fn with_scanner(id: u64, path: PathBuf, emitter: Arc<dyn Emitter>, scanner: Scanner) -> Arc<Self> {
        Arc::new(Self {
            id,
            path,
            index: RwLock::new(Index::new()),
            scanner,
            view: RwLock::new(ViewState { generation: 0, rows: None, complete: true }),
            filter: Mutex::new(None),
            filter_gen: AtomicU64::new(0),
            search: Mutex::new(SearchState { generation: 0, matches: Vec::new(), done: true }),
            search_gen: AtomicU64::new(0),
            alive: AtomicBool::new(true),
            tail_open: AtomicBool::new(false),
            jobs: Mutex::new(None),
            emitter,
        })
    }

    pub fn send_job(&self, job: Job) {
        if let Some(tx) = self.jobs.lock().unwrap().as_ref() {
            let _ = tx.send(job);
        }
    }

    pub fn view_len(&self) -> u32 {
        let index = self.index.read().unwrap();
        let view = self.view.read().unwrap();
        match &view.rows {
            Some(r) => r.len() as u32,
            None => index.lines.len() as u32,
        }
    }

    /// 뷰 행 범위를 파일 위치·메타로 변환한다.
    pub fn resolve_rows(&self, start: u32, count: u32) -> (u64, Vec<ResolvedLine>) {
        let index = self.index.read().unwrap();
        let view = self.view.read().unwrap();
        let generation = view.generation;
        let base = index.base_ts_ms.unwrap_or(0);
        let mut out = Vec::new();
        let mut push = |row: usize, line: usize| {
            if line < index.lines.len() {
                let m = &index.lines[line];
                out.push(ResolvedLine {
                    row: row as u32,
                    line: line as u32,
                    start: m.offset,
                    end: index.line_end(line),
                    level: m.level(),
                    ts: m.ts_ms(base),
                });
            }
        };
        match &view.rows {
            Some(rows) => {
                let end = (start as usize + count as usize).min(rows.len());
                for row in start as usize..end {
                    push(row, rows[row] as usize);
                }
            }
            None => {
                let end = (start as usize + count as usize).min(index.lines.len());
                for line in start as usize..end {
                    push(line, line);
                }
            }
        }
        (generation, out)
    }
}

pub struct ResolvedLine {
    pub row: u32,
    pub line: u32,
    pub start: u64,
    pub end: u64,
    pub level: u8,
    pub ts: Option<i64>,
}

pub fn read_line_text(file: &mut File, start: u64, end: u64) -> (String, bool) {
    let len = (end - start) as usize;
    let capped = len.min(LINE_CAP);
    let mut buf = vec![0u8; capped];
    if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buf).is_err() {
        return (String::new(), false);
    }
    while matches!(buf.last(), Some(b'\n') | Some(b'\r')) {
        buf.pop();
    }
    (String::from_utf8_lossy(&buf).into_owned(), len > LINE_CAP)
}

/// 배치 단위 라인 순회: 인덱스 잠금은 오프셋 수집 동안만 잡고, 파일 읽기는 잠금 밖에서 한다.
/// `f`가 false를 반환하면 중단한다.
pub fn for_each_line(
    tab: &TabState,
    file: &mut File,
    from: u32,
    to_snapshot: u32,
    mut f: impl FnMut(u32, &[u8], u8) -> bool,
) -> bool {
    let mut line = from as usize;
    let end_snapshot = to_snapshot as usize;
    while line < end_snapshot {
        let batch_end;
        let mut offsets: Vec<(u64, u64, u8)> = Vec::new();
        {
            let index = tab.index.read().unwrap();
            let avail = index.lines.len().min(end_snapshot);
            if line >= avail {
                break;
            }
            batch_end = (line + BATCH_LINES).min(avail);
            offsets.reserve(batch_end - line);
            for i in line..batch_end {
                offsets.push((index.lines[i].offset, index.line_end(i), index.lines[i].level()));
            }
        }
        let span_start = offsets[0].0;
        let span_end = offsets[offsets.len() - 1].1;
        let mut buf = vec![0u8; (span_end - span_start) as usize];
        if file.seek(SeekFrom::Start(span_start)).is_err() || file.read_exact(&mut buf).is_err() {
            return false;
        }
        for (i, (s, e, level)) in offsets.iter().enumerate() {
            let mut sl = &buf[(*s - span_start) as usize..(*e - span_start) as usize];
            while matches!(sl.last(), Some(b'\n') | Some(b'\r')) {
                sl = &sl[..sl.len() - 1];
            }
            if !f((line + i) as u32, sl, *level) {
                return false;
            }
        }
        line = batch_end;
    }
    true
}

// ─────────────────────────── IO 스레드 (인덱싱 + 감시) ───────────────────────────

pub fn spawn_io_thread(tab: Arc<TabState>) {
    std::thread::spawn(move || io_loop(tab));
}

fn io_loop(tab: Arc<TabState>) {
    let emitter = tab.emitter.clone();
    let id = tab.id;

    let mut file = match File::open(&tab.path) {
        Ok(f) => f,
        Err(e) => {
            emitter.emit("file-error", json!({ "id": id, "message": e.to_string() }));
            return;
        }
    };

    initial_scan(&tab, &mut file);

    let (wtx, wrx) = mpsc::channel::<()>();
    let mut _watcher = None;
    if let Some(parent) = tab.path.parent() {
        if let Ok(mut w) = notify::recommended_watcher(move |_res: Result<notify::Event, notify::Error>| {
            let _ = wtx.send(());
        }) {
            if w.watch(parent, RecursiveMode::NonRecursive).is_ok() {
                _watcher = Some(w);
            }
        }
    }

    let mut missing_reported = false;
    while tab.alive.load(Ordering::Relaxed) {
        let _ = wrx.recv_timeout(Duration::from_millis(300));
        while wrx.try_recv().is_ok() {}
        if !tab.alive.load(Ordering::Relaxed) {
            break;
        }

        let meta = match std::fs::metadata(&tab.path) {
            Ok(m) => m,
            Err(_) => {
                if !missing_reported {
                    missing_reported = true;
                    emitter.emit("file-error", json!({ "id": id, "message": "File not found — waiting to reconnect" }));
                }
                continue;
            }
        };
        if missing_reported {
            missing_reported = false;
            emitter.emit("file-recovered", json!({ "id": id }));
        }

        let size = meta.len();
        let indexed = tab.index.read().unwrap().indexed_bytes;

        if size < indexed {
            // truncation 또는 로테이션
            emitter.emit("file-rotated", json!({ "id": id }));
            {
                let mut index = tab.index.write().unwrap();
                *index = Index::new();
            }
            tab.tail_open.store(false, Ordering::Relaxed);
            tab.send_job(Job::Reset);
            let cleared_generation = {
                let mut search = tab.search.lock().unwrap();
                search.generation = tab.search_gen.fetch_add(1, Ordering::SeqCst) + 1;
                search.matches.clear();
                search.done = true;
                search.generation
            };
            emitter.emit("search-update", json!({ "id": id, "gen": cleared_generation, "total": 0, "done": true, "cleared": true }));
            file = match File::open(&tab.path) {
                Ok(f) => f,
                Err(_) => continue,
            };
            initial_scan(&tab, &mut file);
            let filter = tab.filter.lock().unwrap().clone();
            if filter.is_some() {
                let generation = tab.filter_gen.load(Ordering::SeqCst);
                tab.send_job(Job::Rebuild { generation, filter });
            }
        } else if size > indexed {
            incremental_scan(&tab, &mut file, size);
        }
    }
}

fn initial_scan(tab: &TabState, file: &mut File) {
    let emitter = tab.emitter.clone();
    let id = tab.id;
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    {
        let mut index = tab.index.write().unwrap();
        index.file_size = size;
    }
    let _ = file.seek(SeekFrom::Start(0));
    let mut pending: Vec<u8> = Vec::new();
    let mut chunk = vec![0u8; CHUNK];
    let mut fed = 0u64;
    let mut last_emit = Instant::now();

    loop {
        if !tab.alive.load(Ordering::Relaxed) {
            return;
        }
        let n = match file.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                emitter.emit("file-error", json!({ "id": id, "message": e.to_string() }));
                return;
            }
        };
        pending.extend_from_slice(&chunk[..n]);
        fed += n as u64;
        {
            let mut index = tab.index.write().unwrap();
            let base = fed - pending.len() as u64;
            let consumed = scan_into(&mut index, &tab.scanner, &pending, base);
            index.file_size = index.file_size.max(fed);
            pending.drain(..consumed);
        }
        if last_emit.elapsed() >= PROGRESS_EVERY {
            last_emit = Instant::now();
            let (lines, bytes, fsize) = {
                let index = tab.index.read().unwrap();
                (index.lines.len(), index.indexed_bytes, index.file_size)
            };
            emitter.emit(
                "index-progress",
                json!({ "id": id, "lines": lines, "bytes": bytes, "size": fsize, "done": false }),
            );
        }
    }

    let (lines, bytes, fsize, is_json) = {
        let mut index = tab.index.write().unwrap();
        if !pending.is_empty() {
            let base = fed - pending.len() as u64;
            scan_tail_line(&mut index, &tab.scanner, &pending, base);
            tab.tail_open.store(true, Ordering::Relaxed);
        }
        index.done = true;
        index.file_size = fed;
        (index.lines.len(), index.indexed_bytes, index.file_size, index.json)
    };
    emitter.emit(
        "index-progress",
        json!({ "id": id, "lines": lines, "bytes": bytes, "size": fsize, "done": true, "json": is_json }),
    );
}

fn incremental_scan(tab: &TabState, file: &mut File, new_size: u64) {
    let emitter = tab.emitter.clone();
    let id = tab.id;

    let (mut from_offset, mut first_new_line) = {
        let index = tab.index.read().unwrap();
        (index.indexed_bytes, index.lines.len() as u32)
    };

    // 직전 인덱싱이 개행 없는 마지막 라인을 포함했다면, 그 라인은 이어질 수
    // 있으므로 지우고 해당 오프셋부터 다시 스캔한다.
    if tab.tail_open.swap(false, Ordering::Relaxed) {
        let mut index = tab.index.write().unwrap();
        if let Some(last) = index.lines.pop() {
            index.indexed_bytes = last.offset;
            from_offset = last.offset;
            first_new_line = index.lines.len() as u32;
        }
    }

    if file.seek(SeekFrom::Start(from_offset)).is_err() {
        return;
    }
    let mut pending: Vec<u8> = Vec::new();
    let mut chunk = vec![0u8; CHUNK];
    let mut fed = from_offset;
    loop {
        let n = match file.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        pending.extend_from_slice(&chunk[..n]);
        fed += n as u64;
        let mut index = tab.index.write().unwrap();
        let base = fed - pending.len() as u64;
        let consumed = scan_into(&mut index, &tab.scanner, &pending, base);
        index.file_size = new_size.max(fed);
        pending.drain(..consumed);
    }
    let total = {
        let mut index = tab.index.write().unwrap();
        if !pending.is_empty() {
            let base = fed - pending.len() as u64;
            scan_tail_line(&mut index, &tab.scanner, &pending, base);
            tab.tail_open.store(true, Ordering::Relaxed);
        }
        index.file_size = fed.max(new_size);
        index.lines.len() as u32
    };

    if total != first_new_line || first_new_line > 0 {
        tab.send_job(Job::Append { start: first_new_line, end: total });
        let tail = build_tail_payload(tab, file, first_new_line, total);
        emitter.emit(
            "tail-appended",
            json!({ "id": id, "lines": total, "rolledBackTo": first_new_line, "tail": tail }),
        );
    }
}

/// 새로 추가된 라인들을 이벤트에 실어 보낼 페이로드로 만든다(무필터 뷰 한정,
/// 마지막 TAIL_PUSH_MAX줄 캡). 필터 뷰에서는 행 매핑이 달라 Null을 반환한다.
fn build_tail_payload(tab: &TabState, file: &mut File, from: u32, total: u32) -> serde_json::Value {
    let (gen, rows) = {
        let index = tab.index.read().unwrap();
        let view = tab.view.read().unwrap();
        if view.rows.is_some() {
            return serde_json::Value::Null;
        }
        let start = (total as usize).saturating_sub(TAIL_PUSH_MAX).max(from as usize);
        let base = index.base_ts_ms.unwrap_or(0);
        let end = (total as usize).min(index.lines.len());
        let rows = (start..end)
            .map(|line| {
                let m = &index.lines[line];
                (line as u32, m.offset, index.line_end(line), m.level(), m.ts_ms(base))
            })
            .collect::<Vec<_>>();
        (view.generation, rows)
    };
    let start = rows.first().map(|r| r.0).unwrap_or(from);
    let lines: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(line, offset, end, level, ts)| {
            let (text, truncated) = read_line_text(file, offset, end);
            json!({ "row": line, "line": line, "text": text, "truncated": truncated, "level": level, "ts": ts })
        })
        .collect();
    json!({ "start": start, "gen": gen, "lines": lines })
}

// ─────────────────────────── 뷰 워커 (필터 적용) ───────────────────────────

pub fn spawn_view_worker(tab: Arc<TabState>) -> Sender<Job> {
    let (tx, rx) = mpsc::channel::<Job>();
    *tab.jobs.lock().unwrap() = Some(tx.clone());
    std::thread::spawn(move || view_worker(tab, rx));
    tx
}

fn view_worker(tab: Arc<TabState>, rx: Receiver<Job>) {
    let mut applied_upto: u32 = 0;
    let mut active: Option<Arc<CompiledFilter>> = None;

    while let Ok(job) = rx.recv() {
        if !tab.alive.load(Ordering::Relaxed) {
            break;
        }
        match job {
            Job::Reset => {
                applied_upto = 0;
                let mut view = tab.view.write().unwrap();
                if active.is_some() {
                    view.rows = Some(Vec::new());
                } else {
                    view.rows = None;
                }
                view.complete = active.is_none();
                drop(view);
                emit_view(&tab, false);
            }
            Job::Rebuild { generation, filter } => {
                if generation != tab.filter_gen.load(Ordering::SeqCst) {
                    continue;
                }
                active = filter.clone();
                match filter {
                    None => {
                        applied_upto = tab.index.read().unwrap().lines.len() as u32;
                        let mut view = tab.view.write().unwrap();
                        view.generation = generation;
                        view.rows = None;
                        view.complete = true;
                        drop(view);
                        emit_view(&tab, true);
                    }
                    Some(f) => {
                        rebuild(&tab, generation, &f, &mut applied_upto);
                    }
                }
            }
            Job::Append { start, end } => {
                // 되감기(tail_open 라인 재스캔)가 있었으면 그 지점 이후를 뷰에서 제거
                if start < applied_upto {
                    if active.is_some() {
                        let mut view = tab.view.write().unwrap();
                        if let Some(rows) = &mut view.rows {
                            let cut = rows.partition_point(|&l| l < start);
                            rows.truncate(cut);
                        }
                    }
                    applied_upto = start;
                }
                if end <= applied_upto {
                    continue;
                }
                match &active {
                    None => {
                        applied_upto = end;
                        emit_view(&tab, true);
                    }
                    Some(f) => {
                        append_filtered(&tab, f, applied_upto, end);
                        applied_upto = end;
                        emit_view(&tab, true);
                    }
                }
            }
        }
    }
}

fn emit_view(tab: &TabState, complete: bool) {
    let (generation, view_len, total) = {
        let index = tab.index.read().unwrap();
        let view = tab.view.read().unwrap();
        let len = match &view.rows {
            Some(r) => r.len(),
            None => index.lines.len(),
        };
        (view.generation, len, index.lines.len())
    };
    tab.emitter.emit(
        "view-update",
        json!({ "id": tab.id, "gen": generation, "viewLen": view_len, "total": total, "done": complete }),
    );
}

fn rebuild(tab: &TabState, generation: u64, filter: &CompiledFilter, applied_upto: &mut u32) {
    {
        let mut view = tab.view.write().unwrap();
        view.generation = generation;
        view.rows = Some(Vec::new());
        view.complete = false;
    }
    emit_view(tab, false);

    let mut rows: Vec<u32> = Vec::new();
    let mut last_emit = Instant::now();
    let mut cursor: u32 = 0;

    loop {
        if generation != tab.filter_gen.load(Ordering::SeqCst) || !tab.alive.load(Ordering::Relaxed) {
            return;
        }
        let snapshot = tab.index.read().unwrap().lines.len() as u32;
        if cursor >= snapshot {
            break;
        }
        if filter.needs_text {
            let mut file = match File::open(&tab.path) {
                Ok(f) => f,
                Err(_) => break,
            };
            let ok = for_each_line(tab, &mut file, cursor, snapshot, |line, text, level| {
                if generation != tab.filter_gen.load(Ordering::SeqCst) {
                    return false;
                }
                if filter.level_passes(level) && filter.text_passes(text) {
                    rows.push(line);
                }
                if last_emit.elapsed() >= PROGRESS_EVERY {
                    last_emit = Instant::now();
                    publish_rows(tab, generation, &rows, false);
                }
                true
            });
            if !ok {
                return;
            }
        } else {
            let index = tab.index.read().unwrap();
            for i in cursor as usize..snapshot as usize {
                if filter.level_passes(index.lines[i].level()) {
                    rows.push(i as u32);
                }
            }
        }
        cursor = snapshot;
    }

    *applied_upto = cursor;
    publish_rows(tab, generation, &rows, true);
}

fn publish_rows(tab: &TabState, generation: u64, rows: &[u32], done: bool) {
    {
        let mut view = tab.view.write().unwrap();
        if view.generation != generation {
            return;
        }
        view.rows = Some(rows.to_vec());
        view.complete = done;
    }
    let total = {
        let index = tab.index.read().unwrap();
        index.lines.len()
    };
    tab.emitter.emit(
        "view-update",
        json!({ "id": tab.id, "gen": generation, "viewLen": rows.len(), "total": total, "done": done }),
    );
}

fn append_filtered(tab: &TabState, filter: &CompiledFilter, start: u32, end: u32) {
    let mut passing: Vec<u32> = Vec::new();
    if filter.needs_text {
        let mut file = match File::open(&tab.path) {
            Ok(f) => f,
            Err(_) => return,
        };
        for_each_line(tab, &mut file, start, end, |line, text, level| {
            if filter.level_passes(level) && filter.text_passes(text) {
                passing.push(line);
            }
            true
        });
    } else {
        let index = tab.index.read().unwrap();
        for i in start as usize..(end as usize).min(index.lines.len()) {
            if filter.level_passes(index.lines[i].level()) {
                passing.push(i as u32);
            }
        }
    }
    let mut view = tab.view.write().unwrap();
    if let Some(rows) = &mut view.rows {
        rows.extend_from_slice(&passing);
    }
}

/// ordinal에서 dir 방향으로, 현재 뷰에 표시되는 첫 매치를 찾아 (뷰 행, 매치 순번)을 돌려준다.
pub fn match_nav(tab: &TabState, ordinal: i64, dir: i32) -> Option<(u32, u32)> {
    let index = tab.index.read().unwrap();
    let view = tab.view.read().unwrap();
    let search = tab.search.lock().unwrap();
    let n = search.matches.len() as i64;
    if n == 0 {
        return None;
    }
    let step: i64 = if dir < 0 { -1 } else { 1 };
    let mut i = ordinal.clamp(0, n - 1);
    while i >= 0 && i < n {
        let line = search.matches[i as usize];
        let row = match &view.rows {
            Some(rows) => rows.binary_search(&line).ok().map(|x| x as u32),
            None => {
                if (line as usize) < index.lines.len() {
                    Some(line)
                } else {
                    None
                }
            }
        };
        if let Some(row) = row {
            return Some((row, i as u32));
        }
        i += step;
    }
    None
}

/// 뷰 행 anchor에서 dir 방향의 첫 매치 순번을 구해 match_nav로 위임한다.
pub fn match_from_row(tab: &TabState, row: i64, dir: i32) -> Option<(u32, u32)> {
    let anchor_line = {
        let index = tab.index.read().unwrap();
        let view = tab.view.read().unwrap();
        match &view.rows {
            Some(rows) => {
                if rows.is_empty() {
                    return None;
                }
                rows[row.clamp(0, rows.len() as i64 - 1) as usize]
            }
            None => {
                let n = index.lines.len() as i64;
                if n == 0 {
                    return None;
                }
                row.clamp(0, n - 1) as u32
            }
        }
    };
    let start = {
        let search = tab.search.lock().unwrap();
        if dir > 0 {
            search.matches.partition_point(|&m| m < anchor_line) as i64
        } else {
            search.matches.partition_point(|&m| m <= anchor_line) as i64 - 1
        }
    };
    if start < 0 {
        return None;
    }
    match_nav(tab, start, dir)
}

// ─────────────────────────── 검색 ───────────────────────────

pub fn run_search(tab: Arc<TabState>, generation: u64, matcher: regex::bytes::Regex) {
    std::thread::spawn(move || {
        let emitter = tab.emitter.clone();
        let id = tab.id;
        let snapshot = tab.index.read().unwrap().lines.len() as u32;
        let mut matches: Vec<u32> = Vec::new();
        let mut last_emit = Instant::now();
        let mut scanned: u32 = 0;

        let mut file = match File::open(&tab.path) {
            Ok(f) => f,
            Err(_) => return,
        };
        let completed = for_each_line(&tab, &mut file, 0, snapshot, |line, text, _| {
            if generation != tab.search_gen.load(Ordering::SeqCst) || !tab.alive.load(Ordering::Relaxed) {
                return false;
            }
            if matcher.is_match(text) {
                matches.push(line);
            }
            scanned = line + 1;
            if last_emit.elapsed() >= PROGRESS_EVERY {
                last_emit = Instant::now();
                let publish = {
                    let mut search = tab.search.lock().unwrap();
                    if search.generation == generation {
                        search.matches = matches.clone();
                        true
                    } else {
                        false
                    }
                };
                if publish {
                    emitter.emit(
                        "search-update",
                        json!({ "id": id, "gen": generation, "total": matches.len(), "scanned": scanned, "of": snapshot, "done": false }),
                    );
                }
            }
            true
        });
        if !completed {
            return;
        }
        let total = matches.len();
        let publish = {
            let mut search = tab.search.lock().unwrap();
            if search.generation == generation {
                search.matches = matches;
                search.done = true;
                true
            } else {
                false
            }
        };
        if publish {
            emitter.emit(
                "search-update",
                json!({ "id": id, "gen": generation, "total": total, "scanned": snapshot, "of": snapshot, "done": true }),
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::{CompiledFilter, FilterSpec, PatternSpec};
    use std::io::Write;

    struct CaptureEmitter(Mutex<Vec<(String, serde_json::Value)>>);
    impl CaptureEmitter {
        fn new() -> Arc<Self> {
            Arc::new(Self(Mutex::new(Vec::new())))
        }
        fn last(&self, event: &str) -> Option<serde_json::Value> {
            self.0.lock().unwrap().iter().rev().find(|(e, _)| e == event).map(|(_, p)| p.clone())
        }
    }
    impl Emitter for CaptureEmitter {
        fn emit(&self, event: &str, payload: serde_json::Value) {
            self.0.lock().unwrap().push((event.to_string(), payload));
        }
    }

    fn append_and_scan(tab: &TabState, path: &PathBuf, text: &str) {
        let mut f = std::fs::OpenOptions::new().append(true).open(path).unwrap();
        write!(f, "{}", text).unwrap();
        drop(f);
        let size = std::fs::metadata(path).unwrap().len();
        let mut file = File::open(path).unwrap();
        incremental_scan(tab, &mut file, size);
    }

    #[test]
    fn tail_appended_pushes_line_payload() {
        let (_d, path) = write_file(&["one", "two"]);
        let emitter = CaptureEmitter::new();
        let tab = TabState::new(1, path.clone(), emitter.clone());
        let mut file = File::open(&path).unwrap();
        initial_scan(&tab, &mut file);

        append_and_scan(&tab, &path, "10:00:01.000 ERROR three\nfour\n");

        let payload = emitter.last("tail-appended").expect("tail-appended emitted");
        assert_eq!(payload["lines"], 4);
        assert_eq!(payload["rolledBackTo"], 2);
        let tail = &payload["tail"];
        assert_eq!(tail["start"], 2);
        assert_eq!(tail["gen"], 0);
        let lines = tail["lines"].as_array().expect("tail.lines array");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["row"], 2);
        assert_eq!(lines[0]["line"], 2);
        assert_eq!(lines[0]["text"], "10:00:01.000 ERROR three");
        assert_eq!(lines[0]["level"], u64::from(crate::index::LVL_ERROR));
        assert_eq!(lines[1]["text"], "four");
    }

    #[test]
    fn tail_payload_rewrites_rolled_back_open_line() {
        let (_d, path) = write_file(&[]);
        {
            let mut f = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
            write!(f, "first\npart").unwrap();
        }
        let emitter = CaptureEmitter::new();
        let tab = TabState::new(1, path.clone(), emitter.clone());
        let mut file = File::open(&path).unwrap();
        initial_scan(&tab, &mut file);

        append_and_scan(&tab, &path, "ial done\nnext\n");

        let payload = emitter.last("tail-appended").unwrap();
        assert_eq!(payload["rolledBackTo"], 1);
        let lines = payload["tail"]["lines"].as_array().unwrap();
        assert_eq!(payload["tail"]["start"], 1);
        assert_eq!(lines[0]["text"], "partial done");
        assert_eq!(lines[1]["text"], "next");
    }

    #[test]
    fn tail_payload_caps_to_last_lines() {
        let (_d, path) = write_file(&["seed"]);
        let emitter = CaptureEmitter::new();
        let tab = TabState::new(1, path.clone(), emitter.clone());
        let mut file = File::open(&path).unwrap();
        initial_scan(&tab, &mut file);

        let mut burst = String::new();
        for i in 0..(TAIL_PUSH_MAX + 50) {
            burst.push_str(&format!("line {}\n", i));
        }
        append_and_scan(&tab, &path, &burst);

        let payload = emitter.last("tail-appended").unwrap();
        let lines = payload["tail"]["lines"].as_array().unwrap();
        assert_eq!(lines.len(), TAIL_PUSH_MAX);
        let total = 1 + TAIL_PUSH_MAX + 50;
        assert_eq!(payload["tail"]["start"], total - TAIL_PUSH_MAX);
        assert_eq!(lines[0]["text"], format!("line {}", 50));
    }

    #[test]
    fn tail_payload_absent_when_filter_view_active() {
        let (_d, path) = write_file(&["a", "b"]);
        let emitter = CaptureEmitter::new();
        let tab = TabState::new(1, path.clone(), emitter.clone());
        let mut file = File::open(&path).unwrap();
        initial_scan(&tab, &mut file);
        {
            let mut view = tab.view.write().unwrap();
            view.rows = Some(vec![0]);
        }

        append_and_scan(&tab, &path, "c\n");

        let payload = emitter.last("tail-appended").unwrap();
        assert!(payload["tail"].is_null(), "filtered view must not push raw-line tail");
    }

    fn write_file(lines: &[&str]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.log");
        let mut f = File::create(&path).unwrap();
        for l in lines {
            writeln!(f, "{}", l).unwrap();
        }
        (dir, path)
    }

    fn open_indexed(path: &PathBuf) -> Arc<TabState> {
        let tab = TabState::new(1, path.clone(), Arc::new(NoopEmitter));
        let mut file = File::open(path).unwrap();
        initial_scan(&tab, &mut file);
        tab
    }

    #[test]
    fn initial_scan_indexes_all_lines() {
        let (_d, path) = write_file(&["2024-01-01 10:00:00 INFO a", "2024-01-01 10:00:01 ERROR b", "plain"]);
        let tab = open_indexed(&path);
        let index = tab.index.read().unwrap();
        assert_eq!(index.lines.len(), 3);
        assert!(index.done);
    }

    #[test]
    fn resolve_rows_maps_offsets() {
        let (_d, path) = write_file(&["aaa", "bbbb", "cc"]);
        let tab = open_indexed(&path);
        let (_gen, rows) = tab.resolve_rows(1, 2);
        assert_eq!(rows.len(), 2);
        let mut f = File::open(&path).unwrap();
        let (text, _) = read_line_text(&mut f, rows[0].start, rows[0].end);
        assert_eq!(text, "bbbb");
        let (text, _) = read_line_text(&mut f, rows[1].start, rows[1].end);
        assert_eq!(text, "cc");
    }

    #[test]
    fn incremental_scan_appends_and_reparses_open_tail() {
        let (_d, path) = write_file(&[]);
        {
            let mut f = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
            write!(f, "first line\npart").unwrap();
        }
        let tab = open_indexed(&path);
        assert_eq!(tab.index.read().unwrap().lines.len(), 2);
        assert!(tab.tail_open.load(Ordering::Relaxed));

        {
            let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
            write!(f, "ial continues\nsecond ERROR line\n").unwrap();
        }
        let size = std::fs::metadata(&path).unwrap().len();
        let mut file = File::open(&path).unwrap();
        incremental_scan(&tab, &mut file, size);

        let index = tab.index.read().unwrap();
        assert_eq!(index.lines.len(), 3);
        assert!(!tab.tail_open.load(Ordering::Relaxed));
        drop(index);

        let (_gen, rows) = tab.resolve_rows(1, 2);
        let mut f = File::open(&path).unwrap();
        let (text, _) = read_line_text(&mut f, rows[0].start, rows[0].end);
        assert_eq!(text, "partial continues");
        let (text, _) = read_line_text(&mut f, rows[1].start, rows[1].end);
        assert_eq!(text, "second ERROR line");
    }

    #[test]
    fn view_worker_filters_and_appends() {
        let (_d, path) = write_file(&[
            "10:00:00.000 INFO ok",
            "10:00:01.000 ERROR boom",
            "10:00:02.000 WARN hmm",
            "10:00:03.000 ERROR boom again",
        ]);
        let tab = open_indexed(&path);
        let tx = spawn_view_worker(tab.clone());

        let spec = FilterSpec {
            levels: Some(vec![crate::index::LVL_ERROR]),
            includes: vec![],
            exclude: None,
            fields: vec![],
        };
        let filter = Arc::new(CompiledFilter::compile(&spec).unwrap());
        *tab.filter.lock().unwrap() = Some(filter.clone());
        let generation = tab.filter_gen.fetch_add(1, Ordering::SeqCst) + 1;
        tx.send(Job::Rebuild { generation, filter: Some(filter) }).unwrap();

        wait_until(|| tab.view.read().unwrap().complete && tab.view_len() == 2);
        assert_eq!(tab.view.read().unwrap().rows.as_ref().unwrap(), &vec![1, 3]);

        {
            let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
            write!(f, "10:00:04.000 ERROR third\n10:00:05.000 INFO not me\n").unwrap();
        }
        let size = std::fs::metadata(&path).unwrap().len();
        let mut file = File::open(&path).unwrap();
        incremental_scan(&tab, &mut file, size);

        wait_until(|| tab.view_len() == 3);
        assert_eq!(tab.view.read().unwrap().rows.as_ref().unwrap(), &vec![1, 3, 4]);
    }

    #[test]
    fn search_finds_matches_with_include_semantics() {
        let (_d, path) = write_file(&["alpha timeout", "beta ok", "TIMEOUT again", "gamma"]);
        let tab = open_indexed(&path);
        let generation = tab.search_gen.fetch_add(1, Ordering::SeqCst) + 1;
        {
            let mut s = tab.search.lock().unwrap();
            s.generation = generation;
            s.matches.clear();
            s.done = false;
        }
        let m = crate::query::build_matcher(&PatternSpec { pattern: "timeout".into(), regex: false, case_sensitive: false }).unwrap();
        run_search(tab.clone(), generation, m);
        wait_until(|| tab.search.lock().unwrap().done);
        assert_eq!(tab.search.lock().unwrap().matches, vec![0, 2]);
    }

    #[test]
    fn match_nav_navigates_and_skips_filtered() {
        let (_d, path) = write_file(&["a hit", "b", "c hit", "d hit", "e"]);
        let tab = open_indexed(&path);
        {
            let mut s = tab.search.lock().unwrap();
            s.matches = vec![0, 2, 3];
            s.done = true;
        }
        assert_eq!(match_nav(&tab, 0, 1), Some((0, 0)));
        assert_eq!(match_nav(&tab, 1, 1), Some((2, 1)));
        assert_eq!(match_nav(&tab, 2, 1), Some((3, 2)));
        assert_eq!(match_nav(&tab, 5, -1), Some((3, 2)));

        // 필터 뷰에서 라인 2가 제외되면 순번 1은 건너뛴다
        {
            let mut view = tab.view.write().unwrap();
            view.rows = Some(vec![0, 3, 4]);
        }
        assert_eq!(match_nav(&tab, 1, 1), Some((1, 2)));
        assert_eq!(match_nav(&tab, 1, -1), Some((0, 0)));
    }

    #[test]
    fn match_from_row_anchors_on_viewport() {
        let (_d, path) = write_file(&["a hit", "b", "c hit", "d", "e hit"]);
        let tab = open_indexed(&path);
        {
            let mut s = tab.search.lock().unwrap();
            s.matches = vec![0, 2, 4];
            s.done = true;
        }
        assert_eq!(match_from_row(&tab, 1, 1), Some((2, 1)));
        assert_eq!(match_from_row(&tab, 2, 1), Some((2, 1)));
        assert_eq!(match_from_row(&tab, 3, -1), Some((2, 1)));
        assert_eq!(match_from_row(&tab, 0, -1), Some((0, 0)));
        assert_eq!(match_from_row(&tab, 4, 1), Some((4, 2)));
    }

    fn wait_until(mut cond: impl FnMut() -> bool) {
        for _ in 0..200 {
            if cond() {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("condition not met in time");
    }
}
