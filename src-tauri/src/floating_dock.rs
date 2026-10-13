//! Pure, physical-pixel geometry for joining auxiliary windows at their edges.
//!
//! This module neither moves windows nor creates persistent groups. Callers should
//! exclude the moving window from `peers` and apply a returned placement only while
//! handling a user move/resize. Moving farther than `threshold` detaches naturally.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Rect {
    pub fn right(self) -> i64 {
        i64::from(self.x) + i64::from(self.width)
    }

    pub fn bottom(self) -> i64 {
        i64::from(self.y) + i64::from(self.height)
    }

    fn valid(self) -> bool {
        self.width > 0 && self.height > 0
    }

    fn overlaps(self, other: Self) -> bool {
        i64::from(self.x) < other.right()
            && self.right() > i64::from(other.x)
            && i64::from(self.y) < other.bottom()
            && self.bottom() > i64::from(other.y)
    }
}

/// The moving rectangle's position relative to its selected peer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edge {
    Left,
    Right,
    Above,
    Below,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Placement {
    pub rect: Rect,
    pub peer_index: usize,
    pub edge: Edge,
}

/// Find the nearest eligible flush edge without resizing either rectangle.
///
/// An edge must be within `threshold` physical pixels. Its perpendicular spans
/// must overlap by at least `min(threshold, 24, smaller span)` pixels (at least
/// one pixel), unless aligning nearby matching corners provides that overlap.
/// When top/bottom or left/right boundaries are close, the closest matching
/// boundary is aligned. Otherwise the perpendicular offset stays unchanged,
/// allowing windows of different sizes to join without being distorted.
///
/// The closest shared edge wins, followed by the smallest corner adjustment,
/// peer order and edge order for deterministic ties. Placements that intersect
/// any other peer are rejected. Invalid and identical self rectangles are ignored.
pub fn snap(moving: Rect, peers: &[Rect], threshold: i32) -> Option<Placement> {
    if !moving.valid() || threshold < 0 {
        return None;
    }
    let threshold = i64::from(threshold);
    let mut best: Option<((i64, i64, usize, usize), Placement)> = None;

    for (peer_index, &peer) in peers.iter().enumerate() {
        if !peer.valid() || peer == moving {
            continue;
        }
        let edges = [
            (Edge::Left, i64::from(peer.x) - moving.right()),
            (Edge::Right, peer.right() - i64::from(moving.x)),
            (Edge::Above, i64::from(peer.y) - moving.bottom()),
            (Edge::Below, peer.bottom() - i64::from(moving.y)),
        ];
        for (edge_order, (edge, primary_delta)) in edges.into_iter().enumerate() {
            if primary_delta.abs() > threshold {
                continue;
            }
            let horizontal = matches!(edge, Edge::Left | Edge::Right);
            let (start, span, peer_start, peer_span) = if horizontal {
                (moving.y, moving.height, peer.y, peer.height)
            } else {
                (moving.x, moving.width, peer.x, peer.width)
            };
            let start = i64::from(start);
            let span = i64::from(span);
            let peer_start = i64::from(peer_start);
            let peer_span = i64::from(peer_span);
            let minimum_overlap = threshold.max(1).min(24).min(span.min(peer_span));

            // Try nearby matching corners first, then retain the existing offset.
            // If a corner would collide with another window, the offset fallback
            // can still provide a safe join along the same nearest edge.
            let mut secondary_deltas = Vec::with_capacity(3);
            for delta in [peer_start - start, peer_start + peer_span - start - span] {
                if delta.abs() <= threshold && !secondary_deltas.contains(&delta) {
                    secondary_deltas.push(delta);
                }
            }
            secondary_deltas.sort_by_key(|delta| delta.abs());
            if !secondary_deltas.contains(&0) {
                secondary_deltas.push(0);
            }

            for secondary_delta in secondary_deltas {
                let adjusted_start = start + secondary_delta;
                let overlap = (adjusted_start + span).min(peer_start + peer_span)
                    - adjusted_start.max(peer_start);
                if overlap < minimum_overlap {
                    continue;
                }
                let (x, y) = if horizontal {
                    (i64::from(moving.x) + primary_delta, adjusted_start)
                } else {
                    (adjusted_start, i64::from(moving.y) + primary_delta)
                };
                let (Ok(x), Ok(y)) = (i32::try_from(x), i32::try_from(y)) else {
                    continue;
                };
                let rect = Rect { x, y, ..moving };
                if peers
                    .iter()
                    .any(|&other| other.valid() && other != moving && rect.overlaps(other))
                {
                    continue;
                }
                let score = (
                    primary_delta.abs(),
                    secondary_delta.abs(),
                    peer_index,
                    edge_order,
                );
                if best
                    .as_ref()
                    .is_none_or(|(best_score, _)| score < *best_score)
                {
                    best = Some((
                        score,
                        Placement {
                            rect,
                            peer_index,
                            edge,
                        },
                    ));
                }
                break;
            }
        }
    }
    best.map(|(_, placement)| placement)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, width: i32, height: i32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn joins_horizontal_edges_and_nearby_top_corners() {
        let peer = rect(100, 100, 300, 220);
        let result = snap(rect(407, 106, 240, 180), &[peer], 12).unwrap();
        assert_eq!(result.rect, rect(400, 100, 240, 180));
        assert_eq!(result.edge, Edge::Right);
        assert_eq!(
            snap(rect(-148, 100, 240, 180), &[peer], 12).unwrap().rect.x,
            -140
        );
    }

    #[test]
    fn joins_vertical_edges_and_nearby_right_corners() {
        let peer = rect(100, 100, 300, 220);
        let result = snap(rect(167, 326, 240, 180), &[peer], 12).unwrap();
        assert_eq!(result.rect, rect(160, 320, 240, 180));
        assert_eq!(result.edge, Edge::Below);
        assert_eq!(
            snap(rect(100, -85, 240, 180), &[peer], 12).unwrap().rect.y,
            -80
        );
    }

    #[test]
    fn unequal_sizes_preserve_arbitrary_perpendicular_offsets() {
        let peer = rect(100, 100, 300, 360);
        let moving = rect(409, 172, 180, 150);
        let result = snap(moving, &[peer], 12).unwrap();
        assert_eq!(result.rect, rect(400, 172, 180, 150));
        assert_eq!(
            (result.rect.width, result.rect.height),
            (moving.width, moving.height)
        );
    }

    #[test]
    fn unequal_sizes_can_align_bottoms_without_changing_size() {
        let result = snap(rect(406, 248, 180, 200), &[rect(100, 100, 300, 350)], 12).unwrap();
        assert_eq!(result.rect, rect(400, 250, 180, 200));
    }

    #[test]
    fn closest_edge_wins_regardless_of_peer_order() {
        let moving = rect(307, 100, 100, 100);
        let result = snap(
            moving,
            &[rect(0, 100, 300, 100), rect(410, 100, 100, 100)],
            12,
        )
        .unwrap();
        assert_eq!(result.peer_index, 1);
        assert_eq!(result.edge, Edge::Left);
        assert_eq!(result.rect.x, 310);
    }

    #[test]
    fn rejects_distant_edges_and_distant_perpendicular_spans() {
        let peer = rect(100, 100, 300, 220);
        assert!(snap(rect(430, 100, 200, 180), &[peer], 12).is_none());
        assert!(snap(rect(407, 600, 200, 180), &[peer], 12).is_none());
        assert!(snap(rect(407, 319, 200, 180), &[peer], 12).is_none());
    }

    #[test]
    fn does_not_snap_diagonally_at_a_single_corner() {
        assert!(snap(rect(405, 325, 100, 100), &[rect(100, 100, 300, 220)], 12).is_none());
    }

    #[test]
    fn rejects_placements_that_overlap_a_third_window() {
        let moving = rect(408, 100, 200, 180);
        let peers = [rect(100, 100, 300, 220), rect(405, 100, 200, 180)];
        assert!(snap(moving, &peers, 12).is_none());
    }

    #[test]
    fn corner_alignment_falls_back_to_offset_to_avoid_collision() {
        let moving = rect(401, 108, 200, 180);
        let peers = [rect(100, 100, 300, 220), rect(400, 40, 200, 64)];
        let result = snap(moving, &peers, 12).unwrap();
        assert_eq!(result.rect, rect(400, 108, 200, 180));
        assert_eq!(result.peer_index, 0);
    }

    #[test]
    fn identical_self_invalid_rectangles_and_negative_threshold_are_ignored() {
        let moving = rect(0, 0, 200, 150);
        assert!(snap(moving, &[moving], 12).is_none());
        assert!(snap(moving, &[rect(205, 0, 0, 150)], 12).is_none());
        assert!(snap(rect(0, 0, -1, 150), &[moving], 12).is_none());
        assert!(snap(moving, &[rect(205, 0, 200, 150)], -1).is_none());
    }

    #[test]
    fn negative_monitor_coordinates_and_exact_edges_are_supported() {
        let peer = rect(-1200, -300, 300, 220);
        assert_eq!(
            snap(rect(-892, -296, 240, 180), &[peer], 12).unwrap().rect,
            rect(-900, -300, 240, 180)
        );
        assert_eq!(
            snap(rect(-900, -300, 240, 180), &[peer], 0).unwrap().rect,
            rect(-900, -300, 240, 180)
        );
    }

    #[test]
    fn extreme_coordinates_do_not_overflow() {
        let moving = rect(i32::MIN, i32::MIN, 300, 200);
        let peer = rect(i32::MAX - 100, i32::MAX - 100, 300, 200);
        assert!(snap(moving, &[peer], 12).is_none());
        assert!(snap(
            rect(i32::MAX - 95, 0, 200, 200),
            &[rect(i32::MAX - 300, 0, 300, 200)],
            12
        )
        .is_none());
    }
}
