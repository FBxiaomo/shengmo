//! 共享 PCM 工具：时长计算、RMS 能量、静音裁剪。
//!
//! 录音统一是 16 kHz / 单声道 / 16-bit 小端 PCM。时长换算、能量计算、静音检测
//! 原本散落在各 ASR provider 里重复，这里收口成唯一实现。

/// 每个采样的字节数（16-bit → 2 字节）。
const PCM_BYTES_PER_SAMPLE: u64 = 2;
/// 采样率（16 kHz）。
const PCM_SAMPLE_RATE_HZ: u64 = 16_000;

/// 由原始字节数计算 16 kHz / 单声道 / 16-bit PCM 的时长（毫秒）。
pub fn pcm_duration_ms_from_bytes(bytes: u64) -> u64 {
    (bytes / PCM_BYTES_PER_SAMPLE) * 1000 / PCM_SAMPLE_RATE_HZ
}

/// 由 PCM 字节切片计算 16 kHz / 单声道 / 16-bit PCM 的时长（毫秒）。
pub fn pcm_duration_ms(pcm: &[u8]) -> u64 {
    pcm_duration_ms_from_bytes(pcm.len() as u64)
}

/// 计算 i16 LE PCM 字节序列的 RMS 能量（归一化到 0.0..1.0）。
///
/// 将每个 i16 样本除以 32768.0 归一化到 [-1, 1]，然后计算均方根。
/// 典型语音 RMS 约 0.02–0.15；环境静音约 0.001–0.005。
pub fn pcm_rms(pcm: &[u8]) -> f32 {
    if pcm.len() < 2 {
        return 0.0;
    }
    let sample_count = pcm.len() / 2;
    let sum_sq: f64 = pcm
        .chunks_exact(2)
        .map(|chunk| {
            let sample = i16::from_le_bytes([chunk[0], chunk[1]]) as f64 / 32768.0;
            sample * sample
        })
        .sum();
    (sum_sq / sample_count as f64).sqrt() as f32
}

/// 裁剪 PCM 缓冲区的前导和尾部静音，保留中间的语音段 + padding。
///
/// - `chunk_bytes`: 静音检测窗口大小（字节），建议 3200（100ms @16kHz/16bit/mono）
/// - `threshold`: RMS 阈值，低于此值的窗口视为静音
/// - `padding_bytes`: 语音段前后各保留的静音字节数，防止首尾音被截断
///
/// 如果没有检测到任何语音窗口，返回空 Vec。
pub fn strip_silence(pcm: &[u8], chunk_bytes: usize, threshold: f32, padding_bytes: usize) -> Vec<u8> {
    if pcm.is_empty() || chunk_bytes == 0 {
        return pcm.to_vec();
    }

    // 按 chunk_bytes 分窗，找到第一个和最后一个 RMS >= threshold 的窗口索引
    let window_count = pcm.len() / chunk_bytes;
    if window_count == 0 {
        // PCM 不到一个窗口长度 → 直接检查整体 RMS
        if pcm_rms(pcm) < threshold {
            return Vec::new();
        }
        return pcm.to_vec();
    }

    let mut first_voice: Option<usize> = None;
    let mut last_voice: Option<usize> = None;

    for i in 0..window_count {
        let start = i * chunk_bytes;
        let end = start + chunk_bytes;
        let rms = pcm_rms(&pcm[start..end]);
        if rms >= threshold {
            if first_voice.is_none() {
                first_voice = Some(i);
            }
            last_voice = Some(i);
        }
    }

    // 处理最后一个不完整的尾部窗口
    let remainder_start = window_count * chunk_bytes;
    if remainder_start < pcm.len() {
        let rms = pcm_rms(&pcm[remainder_start..]);
        if rms >= threshold {
            if first_voice.is_none() {
                first_voice = Some(window_count);
            }
            last_voice = Some(window_count);
        }
    }

    match (first_voice, last_voice) {
        (Some(first), Some(last)) => {
            let voice_start = first * chunk_bytes;
            let voice_end = if last >= window_count {
                pcm.len() // 最后一个不完整窗口
            } else {
                (last + 1) * chunk_bytes
            };

            let trim_start = voice_start.saturating_sub(padding_bytes);
            let trim_end = (voice_end + padding_bytes).min(pcm.len());

            pcm[trim_start..trim_end].to_vec()
        }
        _ => {
            // 没有检测到语音 → 返回空
            Vec::new()
        }
    }
}

/// 生成指定 RMS 的 i16 LE PCM 数据（方波近似）。
/// 供跨模块测试复用，仅在 test profile 下编译。
#[cfg(test)]
pub(crate) fn make_pcm_with_rms(bytes: usize, target_rms: f32) -> Vec<u8> {
    let amplitude = (target_rms * 32768.0) as i16;
    let mut pcm = Vec::with_capacity(bytes);
    for i in 0..(bytes / 2) {
        let sample: i16 = if i % 2 == 0 { amplitude } else { -amplitude };
        pcm.extend_from_slice(&sample.to_le_bytes());
    }
    pcm
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_second_of_16k_i16_pcm_is_1000ms() {
        // 16000 采样 × 2 字节 = 32000 字节 = 1 秒
        assert_eq!(pcm_duration_ms(&vec![0u8; 32_000]), 1000);
        assert_eq!(pcm_duration_ms_from_bytes(32_000), 1000);
    }

    #[test]
    fn odd_trailing_byte_is_floored() {
        // 末尾半个采样向下取整，与历史行为一致
        assert_eq!(
            pcm_duration_ms(&vec![0u8; 33]),
            pcm_duration_ms(&vec![0u8; 32])
        );
    }

    #[test]
    fn rms_of_silence_is_zero() {
        let pcm = vec![0u8; 3200]; // 100ms of silence
        assert!(pcm_rms(&pcm) < 0.001);
    }

    #[test]
    fn rms_of_full_scale_is_high() {
        // Full-scale: alternating +32767 / -32768
        let mut pcm = Vec::with_capacity(3200);
        for i in 0..1600 {
            let sample: i16 = if i % 2 == 0 { 32767 } else { -32768 };
            pcm.extend_from_slice(&sample.to_le_bytes());
        }
        let rms = pcm_rms(&pcm);
        assert!(rms > 0.5, "RMS of full-scale signal should be ~1.0, got {rms}");
    }

    #[test]
    fn rms_of_empty_is_zero() {
        assert_eq!(pcm_rms(&[]), 0.0);
        assert_eq!(pcm_rms(&[0u8]), 0.0); // 1 byte, not enough for a sample
    }

    #[test]
    fn strip_silence_trims_leading_and_trailing() {
        let chunk = 3200; // 100ms
        let threshold = 0.01;
        let padding = 3200; // 100ms

        // 构造：300ms 静音 + 500ms 语音 + 400ms 静音 = 1200ms
        let silence_300 = vec![0u8; chunk * 3];
        let voice_500 = make_pcm_with_rms(chunk * 5, 0.05);
        let silence_400 = vec![0u8; chunk * 4];

        let mut pcm = Vec::new();
        pcm.extend_from_slice(&silence_300);
        pcm.extend_from_slice(&voice_500);
        pcm.extend_from_slice(&silence_400);

        let original_len = pcm.len();
        let result = strip_silence(&pcm, chunk, threshold, padding);

        // 裁剪后应比原始短（前导 300ms 和尾部 400ms 大部分被裁掉，各保留 100ms padding）
        assert!(result.len() < original_len, "strip_silence should reduce length");
        // 预期：100ms padding + 500ms voice + 100ms padding = 700ms = 22400 bytes
        assert_eq!(result.len(), chunk * 7, "expected 700ms (7 chunks)");
    }

    #[test]
    fn strip_silence_returns_empty_for_all_silence() {
        let pcm = vec![0u8; 32000]; // 1 second of silence
        let result = strip_silence(&pcm, 3200, 0.01, 3200);
        assert!(result.is_empty(), "all-silence PCM should produce empty result");
    }

    #[test]
    fn strip_silence_returns_full_for_all_voice() {
        let pcm = make_pcm_with_rms(32000, 0.05); // 1 second of voice
        let result = strip_silence(&pcm, 3200, 0.01, 3200);
        // 全部是语音 → padding 扩展到边界 → 应该返回完整数据
        assert_eq!(result.len(), pcm.len());
    }

    #[test]
    fn strip_silence_handles_empty() {
        let result = strip_silence(&[], 3200, 0.01, 3200);
        assert!(result.is_empty());
    }

    #[test]
    fn strip_silence_trims_sub_chunk_silence() {
        // 50ms of silence (shorter than one 100ms chunk)
        let pcm = vec![0u8; 1600];
        let result = strip_silence(&pcm, 3200, 0.01, 3200);
        assert!(result.is_empty(), "sub-chunk silence should be trimmed to empty");
    }

    #[test]
    fn strip_silence_keeps_sub_chunk_voice() {
        // 50ms of voice (shorter than one 100ms chunk)
        let pcm = make_pcm_with_rms(1600, 0.05);
        let result = strip_silence(&pcm, 3200, 0.01, 3200);
        assert_eq!(result.len(), pcm.len(), "sub-chunk voice should be kept intact");
    }
}
