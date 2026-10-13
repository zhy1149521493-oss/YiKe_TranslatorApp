//! Patch saves preserve settings owned by other windows and unknown future keys.
use serde_json::{json, Value};

pub fn merge(target: &mut Value, patch: Value) {
    if let Value::Object(patch) = patch {
        if !target.is_object() { *target = json!({}); }
        let object = target.as_object_mut().unwrap();
        for (key, value) in patch { merge(object.entry(key).or_insert(Value::Null), value); }
    } else { *target = patch; }
}

pub fn normalize_opacity(config: &mut Value) {
    let Some(appearance) = config.pointer_mut("/settings/appearance").and_then(Value::as_object_mut) else { return; };
    let opacity = appearance.get("floating").and_then(|v| v.get("opacity")).and_then(Value::as_f64).unwrap_or(88.0).clamp(0.0, 100.0);
    for surface in ["floating", "audio", "audioMic", "subtitle"] {
        let item = appearance.entry(surface).or_insert_with(|| json!({}));
        if !item.is_object() { *item = json!({}); }
        item["opacity"] = json!(opacity);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn patch_preserves_other_window_values_and_replaces_arrays() {
        let mut value = json!({"providers":["old"],"unknown":5,"settings":{"theme":"dark","appearance":{"floating":{"opacity":76},"main":{"opacity":100}}}});
        merge(&mut value, json!({"providers":[],"settings":{"theme":"light"}}));
        assert_eq!(value["providers"], json!([]));
        assert_eq!(value["unknown"], 5);
        assert_eq!(value["settings"]["appearance"]["floating"]["opacity"],76);
    }
    #[test]
    fn auxiliary_opacity_shares_canonical_value_without_touching_main_or_fonts() {
        let mut value = json!({"settings":{"appearance":{"floating":{"opacity":62},"audio":{"opacity":22,"fontSize":19},"main":{"opacity":93}}}});
        normalize_opacity(&mut value);
        for surface in ["floating","audio","audioMic","subtitle"] { assert_eq!(value["settings"]["appearance"][surface]["opacity"],62.0); }
        assert_eq!(value["settings"]["appearance"]["audio"]["fontSize"],19);
        assert_eq!(value["settings"]["appearance"]["main"]["opacity"],93);
    }
}
