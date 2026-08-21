use regex::bytes::{Regex, RegexBuilder};
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct FilterSpec {
    #[serde(default)]
    pub levels: Option<Vec<u8>>,
    /// 모두 매치해야 표시 (AND). 각 항목 내부의 OR은 패턴 자체(| 정규식)로 표현한다.
    #[serde(default)]
    pub includes: Vec<PatternSpec>,
    #[serde(default)]
    pub exclude: Option<PatternSpec>,
    #[serde(default)]
    pub fields: Vec<FieldCond>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PatternSpec {
    pub pattern: String,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct FieldCond {
    pub key: String,
    pub value: String,
}

pub fn build_matcher(p: &PatternSpec) -> Result<Regex, String> {
    let source = if p.regex { p.pattern.clone() } else { regex::escape(&p.pattern) };
    RegexBuilder::new(&source)
        .case_insensitive(!p.case_sensitive)
        .build()
        .map_err(|e| e.to_string())
}

pub struct CompiledFilter {
    pub level_mask: u16,
    pub includes: Vec<Regex>,
    pub exclude: Option<Regex>,
    pub fields: Vec<(Regex, String)>,
    pub needs_text: bool,
}

impl CompiledFilter {
    pub fn compile(spec: &FilterSpec) -> Result<Self, String> {
        let level_mask = match &spec.levels {
            None => u16::MAX,
            Some(levels) => levels.iter().fold(0u16, |m, l| m | 1 << (l % 16)),
        };
        let includes = spec.includes.iter().map(build_matcher).collect::<Result<Vec<_>, String>>()?;
        let exclude = spec.exclude.as_ref().map(build_matcher).transpose()?;
        let fields = spec
            .fields
            .iter()
            .map(|f| {
                let key_re = RegexBuilder::new(&format!(
                    r#""{}"\s*:\s*"?([^",}}]*)"#,
                    regex::escape(&f.key)
                ))
                .build()
                .map_err(|e| e.to_string())?;
                Ok((key_re, f.value.clone()))
            })
            .collect::<Result<Vec<_>, String>>()?;
        let needs_text = !includes.is_empty() || exclude.is_some() || !fields.is_empty();
        Ok(Self { level_mask, includes, exclude, fields, needs_text })
    }

    pub fn level_passes(&self, level: u8) -> bool {
        self.level_mask & (1 << (level % 16)) != 0
    }

    pub fn text_passes(&self, line: &[u8]) -> bool {
        for inc in &self.includes {
            if !inc.is_match(line) {
                return false;
            }
        }
        if let Some(exc) = &self.exclude {
            if exc.is_match(line) {
                return false;
            }
        }
        for (key_re, want) in &self.fields {
            let got = key_re.captures(line).and_then(|c| c.get(1));
            match got {
                Some(m) if m.as_bytes() == want.as_bytes() => {}
                _ => return false,
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::{LVL_ERROR, LVL_INFO, LVL_WARN};

    fn spec(levels: Option<Vec<u8>>, includes: &[&str], exclude: Option<&str>, fields: &[(&str, &str)]) -> CompiledFilter {
        let s = FilterSpec {
            levels,
            includes: includes
                .iter()
                .map(|p| PatternSpec { pattern: (*p).into(), regex: false, case_sensitive: false })
                .collect(),
            exclude: exclude.map(|p| PatternSpec { pattern: p.into(), regex: false, case_sensitive: false }),
            fields: fields.iter().map(|(k, v)| FieldCond { key: (*k).into(), value: (*v).into() }).collect(),
        };
        CompiledFilter::compile(&s).unwrap()
    }

    #[test]
    fn level_mask() {
        let f = spec(Some(vec![LVL_WARN, LVL_ERROR]), &[], None, &[]);
        assert!(f.level_passes(LVL_ERROR));
        assert!(f.level_passes(LVL_WARN));
        assert!(!f.level_passes(LVL_INFO));
        assert!(!f.needs_text);
    }

    #[test]
    fn include_exclude() {
        let f = spec(None, &["timeout"], Some("healthz"), &[]);
        assert!(f.text_passes(b"request TIMEOUT after 8s"));
        assert!(!f.text_passes(b"GET /healthz timeout"));
        assert!(!f.text_passes(b"all fine"));
    }

    #[test]
    fn plain_pattern_is_escaped() {
        let f = spec(None, &["a.b(c)"], None, &[]);
        assert!(f.text_passes(b"xx a.b(c) yy"));
        assert!(!f.text_passes(b"aXb(c)"));
    }

    #[test]
    fn multiple_includes_are_and() {
        let f = spec(None, &["apple", "banana"], None, &[]);
        assert!(f.text_passes(b"banana and apple pie"));
        assert!(!f.text_passes(b"only apple"));
        assert!(!f.text_passes(b"only banana"));
    }

    #[test]
    fn invalid_regex_is_error() {
        let s = FilterSpec {
            levels: None,
            includes: vec![PatternSpec { pattern: "(unclosed".into(), regex: true, case_sensitive: false }],
            exclude: None,
            fields: vec![],
        };
        assert!(CompiledFilter::compile(&s).is_err());
    }

    #[test]
    fn json_field_conditions_and_semantics() {
        let f = spec(None, &[], None, &[("level", "error"), ("service", "api")]);
        assert!(f.text_passes(br#"{"level":"error","service":"api","msg":"x"}"#));
        assert!(!f.text_passes(br#"{"level":"error","service":"web"}"#));
        assert!(!f.text_passes(br#"{"level":"error"}"#));
        let n = spec(None, &[], None, &[("status", "500")]);
        assert!(n.text_passes(br#"{"status":500}"#));
    }
}
