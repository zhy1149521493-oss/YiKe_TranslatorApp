/// Convert physical desktop coordinates into a monitor-local, contained rectangle.
pub(crate) fn local_region(x: i32, y: i32, w: i32, h: i32, mx: i32, my: i32, mw: u32, mh: u32)
    -> Option<(u32, u32, u32, u32)> {
    if w <= 0 || h <= 0 { return None; }
    let lx = i64::from(x) - i64::from(mx);
    let ly = i64::from(y) - i64::from(my);
    if lx < 0 || ly < 0 || lx + i64::from(w) > i64::from(mw) || ly + i64::from(h) > i64::from(mh) {
        return None;
    }
    Some((lx as u32, ly as u32, w as u32, h as u32))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handles_negative_monitor_origins_and_edges() {
        assert_eq!(local_region(-1800, 20, 100, 50, -1920, 0, 1920, 1080), Some((120, 20, 100, 50)));
        assert_eq!(local_region(0, 0, 1920, 1080, 0, 0, 1920, 1080), Some((0, 0, 1920, 1080)));
        assert_eq!(local_region(1900, 1000, 100, 100, 0, 0, 1920, 1080), None);
        assert_eq!(local_region(-1, 0, 10, 10, 0, 0, 1920, 1080), None);
        assert_eq!(local_region(0, 0, 0, 10, 0, 0, 1920, 1080), None);
        assert_eq!(local_region(i32::MAX, 0, i32::MAX, 10, i32::MIN, 0, 1920, 1080), None);
    }
}
