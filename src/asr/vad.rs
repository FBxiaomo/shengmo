//! VAD（Voice Activity Detection）—— 前导静音门控。
//!
//! 在录音阶段实时丢弃前导静音帧，减少云端 API 延迟/费用和本地推理耗时。
//! 一旦检测到语音（RMS 超过阈值），后续所有帧直接透传，零额外开销。

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use crate::recorder::AudioConsumer;

use super::pcm::pcm_rms;

/// 前导静音门控阈值（i16 归一化到 [-1, 1] 后的 RMS）。
/// 低于此值的帧视为静音，会被丢弃直到首帧语音出现。
const VAD_RMS_THRESHOLD: f32 = 0.01;

/// 包装任意 `AudioConsumer`，实时丢弃前导静音帧。
///
/// 一旦检测到语音（RMS ≥ `VAD_RMS_THRESHOLD`），后续所有帧直接透传。
/// 适合放在 `Recorder::start` 入口处，对所有 ASR 引擎统一生效。
pub struct VadGatedConsumer {
    inner: Arc<dyn AudioConsumer>,
    speech_started: AtomicBool,
    /// 已丢弃的前导静音字节数（仅用于日志）。
    skipped_bytes: AtomicUsize,
}

impl VadGatedConsumer {
    pub fn new(inner: Arc<dyn AudioConsumer>) -> Self {
        Self {
            inner,
            speech_started: AtomicBool::new(false),
            skipped_bytes: AtomicUsize::new(0),
        }
    }
}

impl AudioConsumer for VadGatedConsumer {
    fn consume_pcm_chunk(&self, pcm: &[u8]) {
        if self.speech_started.load(Ordering::Relaxed) {
            // 语音已开始 → 全部透传（零开销快速路径）
            self.inner.consume_pcm_chunk(pcm);
            return;
        }

        // 检查当前帧能量
        if pcm_rms(pcm) >= VAD_RMS_THRESHOLD {
            self.speech_started.store(true, Ordering::Relaxed);
            let skipped = self.skipped_bytes.load(Ordering::Relaxed);
            if skipped > 0 {
                log::info!(
                    "[vad] speech detected; dropped {skipped} bytes of leading silence ({} ms)",
                    skipped / 32 // 32 bytes/ms at 16kHz/16bit/mono
                );
            }
            self.inner.consume_pcm_chunk(pcm);
        } else {
            // 静音帧 → 丢弃
            self.skipped_bytes.fetch_add(pcm.len(), Ordering::Relaxed);
        }
    }
}
