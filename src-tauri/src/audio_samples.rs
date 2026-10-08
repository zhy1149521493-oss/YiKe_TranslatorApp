/// WASAPI guarantees the non-silent packet allocation for the reported frame count.
/// Silent packets may have no data allocation and must never be dereferenced.
pub(crate) unsafe fn packet_to_mono(
    data: *const u8, frames: u32, channels: u16, bits: u16, is_float: bool, silent: bool,
) -> Result<Vec<f32>, String> {
    if channels == 0 { return Err("音频格式的声道数为零".into()); }
    if !matches!((is_float, bits), (true, 32 | 64) | (false, 16)) {
        return Err(format!("不支持的音频位深: {bits} (float={is_float})"));
    }
    if silent || frames == 0 { return Ok(vec![0.0; frames as usize]); }
    if data.is_null() { return Err("非静音音频包的数据指针为空".into()); }
    let sample_bytes = (bits / 8) as usize;
    let block_align = sample_bytes * channels as usize;
    let len = (frames as usize).checked_mul(block_align)
        .filter(|len| *len <= isize::MAX as usize).ok_or("音频包长度溢出")?;
    let raw = std::slice::from_raw_parts(data, len);
    Ok(raw.chunks_exact(block_align).map(|frame| {
        let sum: f64 = frame.chunks_exact(sample_bytes).map(|sample| match (is_float, bits) {
            (true, 32) => f32::from_le_bytes(sample.try_into().unwrap()) as f64,
            (true, 64) => f64::from_le_bytes(sample.try_into().unwrap()),
            _ => i16::from_le_bytes(sample.try_into().unwrap()) as f64 / 32768.0,
        }).sum();
        (sum / channels as f64) as f32
    }).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silent_packet_does_not_read_null_or_nonzero_data() {
        unsafe {
            assert_eq!(packet_to_mono(std::ptr::null(), 3, 2, 32, true, true).unwrap(), vec![0.0; 3]);
            let samples = [1.0f32; 2];
            assert_eq!(packet_to_mono(samples.as_ptr().cast(), 2, 1, 32, true, true).unwrap(), vec![0.0; 2]);
            assert!(packet_to_mono(std::ptr::null(), 3, 2, 32, true, false).is_err());
        }
    }

    #[test]
    fn mixes_supported_formats_and_rejects_invalid_formats() {
        unsafe {
            let float32 = [0.5f32, -0.5, 0.25, 0.75];
            assert_eq!(packet_to_mono(float32.as_ptr().cast(), 2, 2, 32, true, false).unwrap(), vec![0.0, 0.5]);
            let pcm16 = [16384i16, -16384];
            assert_eq!(packet_to_mono(pcm16.as_ptr().cast(), 2, 1, 16, false, false).unwrap(), vec![0.5, -0.5]);
            let float64 = [0.125f64];
            assert_eq!(packet_to_mono(float64.as_ptr().cast(), 1, 1, 64, true, false).unwrap(), vec![0.125]);
            assert!(packet_to_mono(std::ptr::null(), 1, 0, 32, true, true).is_err());
            assert!(packet_to_mono(std::ptr::null(), 1, 2, 24, false, true).is_err());
        }
    }
}
