//! Shared validation for persisted ASR endpoint preferences.
use std::collections::HashMap;
const LANGUAGES: [&str; 5] = ["auto", "zh", "en", "ja", "ko"];

pub fn validate(lang: &str, value: f32) -> Result<f32, String> {
    if !LANGUAGES.contains(&lang) { return Err("不支持的识别语言".into()); }
    if !value.is_finite() { return Err("断句灵敏度必须是有限数值".into()); }
    Ok(value.clamp(0.1, 5.0))
}

pub fn restore(saved: Option<&serde_json::Value>) -> HashMap<String, f32> {
    LANGUAGES.into_iter().map(|lang| {
        let value = saved.and_then(|map| map.get(lang)).and_then(|value| value.as_f64())
            .and_then(|value| validate(lang, value as f32).ok()).unwrap_or(0.6);
        (lang.to_string(), value)
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restores_supported_finite_preferences_with_safe_defaults() {
        let value = serde_json::json!({"en":1.2,"zh":0.01,"ja":50,"ko":"invalid","unexpected":2.0});
        let map = restore(Some(&value));
        assert_eq!(map.len(), 5);
        assert_eq!(map["auto"], 0.6);
        assert_eq!(map["en"], 1.2);
        assert_eq!(map["zh"], 0.1);
        assert_eq!(map["ja"], 5.0);
        assert_eq!(map["ko"], 0.6);
        assert!(validate("unexpected", 1.0).is_err());
        assert!(validate("en", f32::NAN).is_err());
        assert!(validate("en", f32::INFINITY).is_err());
    }
}
