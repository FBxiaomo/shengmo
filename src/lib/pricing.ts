// 前端定价常量 + 预估消耗计算。纯前端数据，不依赖后端。
// 货币单位：CNY（元）。LLM 按百万 Token 计费，ASR 按分钟计费。

export interface LlmPricing {
  displayName: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
  isFree: boolean;
}

export interface AsrPricing {
  displayName: string;
  pricePerMinute: number;
  isFree: boolean;
}

// ── LLM 模型定价（按百万 Token）──────────────────────────
export const LLM_PRICING: Record<string, LlmPricing> = {
  'deepseek-v4-flash': { displayName: 'DeepSeek V4-Flash', inputPricePer1M: 1.0, outputPricePer1M: 2.0, isFree: false },
  'deepseek-v4-pro': { displayName: 'DeepSeek V4-Pro', inputPricePer1M: 3.0, outputPricePer1M: 6.0, isFree: false },
  'qwen3-plus': { displayName: '通义 Qwen3-Plus', inputPricePer1M: 0.8, outputPricePer1M: 2.0, isFree: false },
  'qwen3-max': { displayName: '通义 Qwen3-Max', inputPricePer1M: 2.5, outputPricePer1M: 10.0, isFree: false },
  'doubao-seed2-lite': { displayName: '豆包 Seed2.0-Lite', inputPricePer1M: 0.6, outputPricePer1M: 1.2, isFree: false },
  'mimo-v2.5-flash': { displayName: 'MiMo-V2.5-Flash', inputPricePer1M: 0.7, outputPricePer1M: 2.1, isFree: false },
  'glm-4-flash': { displayName: 'GLM-4-Flash', inputPricePer1M: 0, outputPricePer1M: 0, isFree: true },
  'gpt-4o': { displayName: 'GPT-4o', inputPricePer1M: 18.0, outputPricePer1M: 72.0, isFree: false },
  'gpt-5.5': { displayName: 'GPT-5.5', inputPricePer1M: 36.0, outputPricePer1M: 216.0, isFree: false },
  'claude-opus-4.6': { displayName: 'Claude Opus 4.6', inputPricePer1M: 36.0, outputPricePer1M: 180.0, isFree: false },
};

// ── ASR 模型定价（每分钟）────────────────────────────────
export const ASR_PRICING: Record<string, AsrPricing> = {
  'volcengine': { displayName: '火山引擎 BigASR', pricePerMinute: 0.020, isFree: false },
  'bailian': { displayName: '百炼 Paraformer', pricePerMinute: 0.0048, isFree: false },
  'siliconflow': { displayName: '硅基流动 SenseVoice', pricePerMinute: 0, isFree: true },
  'zhipu': { displayName: '智谱 GLM-ASR', pricePerMinute: 0.060, isFree: false },
  'groq': { displayName: 'Groq Whisper', pricePerMinute: 0, isFree: true },
  'whisper': { displayName: 'OpenAI Whisper', pricePerMinute: 0.043, isFree: false },
  'openrouter': { displayName: 'OpenRouter Whisper', pricePerMinute: 0.045, isFree: false },
  'xiaomi-mimo-asr': { displayName: 'MiMo ASR', pricePerMinute: 0.0083, isFree: false },
  'foundry-local-whisper': { displayName: '本地离线', pricePerMinute: 0, isFree: true },
  'sherpa-onnx-local': { displayName: '本地离线', pricePerMinute: 0, isFree: true },
  'local-qwen3': { displayName: '本地离线', pricePerMinute: 0, isFree: true },
  'apple-speech': { displayName: 'Apple 语音', pricePerMinute: 0, isFree: true },
};

// ── 预估消耗计算 ──────────────────────────────────────────

export interface DailyCostBreakdown {
  /** ASR 消耗（元） */
  asrCost: number;
  /** LLM 润色消耗（元，基于文本长度估算） */
  llmCost: number;
  /** 总消耗 */
  totalCost: number;
  /** 今日 ASR 总时长（秒） */
  asrDurationSec: number;
  /** 今日估算 LLM Token 数（input + output） */
  estimatedLlmTokens: number;
  /** 是否为免费方案 */
  isFree: boolean;
}

/**
 * 按文本字数估算 LLM Token 数。
 * 中文字符 ≈ 1-2 tokens/字，英文 ≈ 0.25 tokens/word。
 * 这里取折中：字符数 × 1.5 作为 input，output 按 1:0.6 比例。
 */
function estimateTokensFromText(charCount: number): { input: number; output: number } {
  const input = Math.round(charCount * 1.5);
  const output = Math.round(input * 0.6);
  return { input, output };
}

/**
 * 计算今日预估消耗。
 * @param todaySessions 今日的所有 DictationSession
 * @param llmModelId 当前 LLM provider 对应的 model key（如 'deepseek-v4-flash'）
 * @param asrProviderId 当前 ASR provider id（如 'volcengine'）
 * @param polishEnabled 润色是否开启。false 时跳过 LLM 计算。
 */
export function estimateDailyCost(
  todaySessions: Array<{ finalText: string; durationMs: number | null }>,
  llmModelId: string | null,
  asrProviderId: string | null,
  polishEnabled?: boolean,
): DailyCostBreakdown {
  let asrCost = 0;
  let llmCost = 0;
  let asrDurationSec = 0;
  let estimatedLlmTokens = 0;

  // ASR 时长
  for (const s of todaySessions) {
    asrDurationSec += (s.durationMs ?? 0) / 1000;
  }

  // ASR 计费
  const asrPricing = asrProviderId ? ASR_PRICING[asrProviderId] : null;
  if (asrPricing && !asrPricing.isFree) {
    asrCost = (asrDurationSec / 60) * asrPricing.pricePerMinute;
  }

  // LLM 计费（按文本字数估算 token）
  const llmPricing = llmModelId ? LLM_PRICING[llmModelId] : null;
  if (polishEnabled !== false && llmPricing && !llmPricing.isFree) {
    let totalChars = 0;
    for (const s of todaySessions) {
      totalChars += s.finalText.length;
    }
    const { input, output } = estimateTokensFromText(totalChars);
    estimatedLlmTokens = input + output;
    llmCost = (input / 1_000_000) * llmPricing.inputPricePer1M
            + (output / 1_000_000) * llmPricing.outputPricePer1M;
  }

  const totalCost = asrCost + llmCost;
  const isFree = totalCost === 0;

  return {
    asrCost: parseFloat(asrCost.toFixed(4)),
    llmCost: parseFloat(llmCost.toFixed(4)),
    totalCost: parseFloat(totalCost.toFixed(4)),
    asrDurationSec: Math.round(asrDurationSec),
    estimatedLlmTokens,
    isFree,
  };
}

/**
 * 根据语言返回货币符号。
 * zh-CN / zh-TW → ¥（人民币/新台币），en → $（美元），ko → ₩（韩元），ja → ¥（日元）。
 */
export function getCurrencySymbol(lang: string): string {
  if (lang.startsWith('en')) return '$';
  if (lang.startsWith('ko')) return '₩';
  return '¥'; // zh-CN, zh-TW, ja, 其他
}

/**
 * 格式化为显示字符串：¥ 0.38 / $ 0.05 / < ¥ 0.01
 * @param cost 金额数值
 * @param lang i18n 当前语言（如 'zh-CN'、'en'）
 */
export function formatCost(cost: number, lang?: string): string {
  const sym = getCurrencySymbol(lang ?? 'zh-CN');
  if (cost === 0) return `${sym} 0.000`;
  if (cost < 0.001) return `< ${sym} 0.001`;
  return `${sym} ${cost.toFixed(3)}`;
}

/**
 * 格式化时长：5m 30s / 1h 20m / 30s
 */
export function formatDurationShort(totalSec: number): string {
  if (totalSec < 60) return `${totalSec}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * 格式化 Token 数：1.2k / 24.5k / 1.3M
 */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
  if (count >= 1_000) return (count / 1_000).toFixed(1) + 'k';
  return String(count);
}
