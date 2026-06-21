/**
 * MiniPanel.tsx — 迷你模式浮窗面板。
 *
 * 独立 Tauri 窗口 (?window=mini)，始终置顶，显示今日统计、ASR 模型选择、
 * 润色开关和最近识别。Header 区域可拖拽 (data-tauri-drag-region)。
 * 点击展开按钮恢复正常模式。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectLite, type SelectOption } from './ui/SelectLite';
import { Toggle } from '../pages/settings/shared';
import {
  exitMiniMode,
  getCredentials,
  getProcessMemory,
  listHistory,
  setActiveAsrProvider,
} from '../lib/ipc';
import type { ProcessMemoryInfo } from '../lib/ipc';
import type { CredentialsStatus, DictationSession, UserPreferences } from '../lib/types';
import { useHotkeySettings } from '../state/HotkeySettingsContext';
import { getSherpaOnnxAsrCatalog, getFoundryLocalAsrCatalog } from '../lib/localAsr';
import type { SherpaOnnxCatalogModel, FoundryLocalAsrCatalogModel } from '../lib/localAsr';

// ── 常量（与 Overview 保持一致） ──────────────────────────────────────────────

const CLOUD_ASR_PROVIDERS: ReadonlyArray<{ id: string; nameKey: string }> = [
  { id: 'volcengine',       nameKey: 'asrVolcengine' },
  { id: 'bailian',          nameKey: 'asrBailian' },
  { id: 'siliconflow',      nameKey: 'asrSiliconflow' },
  { id: 'zhipu',            nameKey: 'asrZhipu' },
  { id: 'groq',             nameKey: 'asrGroq' },
  { id: 'whisper',          nameKey: 'asrWhisper' },
  { id: 'openrouter',       nameKey: 'asrOpenrouter' },
  { id: 'xiaomi-mimo-asr',  nameKey: 'asrXiaomiMimo' },
];

const LOCAL_ENGINE_IDS = new Set(['foundry-local-whisper', 'sherpa-onnx-local', 'local-qwen3', 'apple-speech']);

const LOCAL_MODEL_NAME_KEY: Record<string, string> = {
  'sense-voice-small-zh':  'settings.advanced.simplified.modelSenseVoiceSmall',
  'paraformer-zh':         'settings.advanced.simplified.modelParaformerZh',
  'whisper-small-multi':   'settings.advanced.simplified.modelWhisperSmallMulti',
  'qwen3-asr-0.6b-int8':  'settings.advanced.simplified.modelQwen3Asr',
  'whisper-tiny':          'settings.advanced.simplified.modelWhisperTiny',
  'whisper-base':          'settings.advanced.simplified.modelWhisperBase',
  'whisper-small':         'settings.advanced.simplified.modelWhisperSmallFoundry',
  'whisper-medium':        'settings.advanced.simplified.modelWhisperMedium',
  'whisper-large-v3-turbo': 'settings.advanced.simplified.modelWhisperLargeTurbo',
  'zipformer-bilingual-zh-en-streaming': 'settings.advanced.simplified.modelZipformerStreaming',
  'paraformer-streaming-zh':           'settings.advanced.simplified.modelParaformerStreamingZh',
  'whisper-large-v3-multi':             'settings.advanced.simplified.modelWhisperLargeV3',
  'zipformer-small-ctc-zh-streaming':   'settings.advanced.simplified.modelZipformerSmallCtcZh',
};

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function formatMemory(bytes: number): string {
  if (bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb < 10) return mb.toFixed(1) + ' MB';
  return Math.round(mb) + ' MB';
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  const sec = ms / 1000;
  if (sec < 60) return sec.toFixed(1) + 's';
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

// ── SVG 图标 ──────────────────────────────────────────────────────────────────

/** 展开图标：从紧凑视图恢复到主窗口 */
function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9v4h4" />
      <path d="M13 7V3H9" />
      <path d="M3 13l4-4" />
      <path d="M13 3l-4 4" />
    </svg>
  );
}

// ── 组件 ──────────────────────────────────────────────────────────────────────

export function MiniPanel() {
  const { t } = useTranslation();
  const { prefs, updatePrefs } = useHotkeySettings();
  const [history, setHistory] = useState<DictationSession[]>([]);
  const [creds, setCreds] = useState<CredentialsStatus | null>(null);
  const [memInfo, setMemInfo] = useState<ProcessMemoryInfo | null>(null);
  const [sherpaCatalog, setSherpaCatalog] = useState<SherpaOnnxCatalogModel[]>([]);
  const [foundryCatalog, setFoundryCatalog] = useState<FoundryLocalAsrCatalogModel[]>([]);

  // ── 历史记录 ──
  useEffect(() => {
    listHistory().then(setHistory).catch(() => {});
  }, []);

  // ── 凭据状态 ──
  useEffect(() => {
    getCredentials().then(setCreds).catch(() => {});
  }, [prefs?.activeAsrProvider]);

  // ── 内存轮询（2s 间隔） ──
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      getProcessMemory().then(info => {
        if (!cancelled) setMemInfo(info);
      }).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // ── 本地模型 catalog ──
  useEffect(() => {
    getSherpaOnnxAsrCatalog().then(setSherpaCatalog).catch(() => {});
    getFoundryLocalAsrCatalog().then(setFoundryCatalog).catch(() => {});
  }, [prefs?.activeAsrProvider]);

  // ── 今日统计 ──
  const metrics = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todays = history.filter(s => new Date(s.createdAt) >= today);
    const charsToday = todays.reduce((acc, s) => acc + s.finalText.length, 0);
    const totalDurationMs = todays.reduce((acc, s) => acc + (s.durationMs ?? 0), 0);
    return { charsToday, totalDurationMs };
  }, [history]);

  // ── 已安装的本地模型 ──
  const offlineEnabled = prefs?.offlineEnabled ?? true;
  const installedLocalModels = useMemo(() => {
    if (!offlineEnabled) return [];
    const result: Array<{ alias: string; providerId: string; nameKey: string }> = [];
    for (const m of sherpaCatalog) {
      if (m.cached && LOCAL_MODEL_NAME_KEY[m.alias]) {
        result.push({ alias: m.alias, providerId: 'sherpa-onnx-local', nameKey: LOCAL_MODEL_NAME_KEY[m.alias] });
      }
    }
    for (const m of foundryCatalog) {
      if (m.cached && LOCAL_MODEL_NAME_KEY[m.alias]) {
        result.push({ alias: m.alias, providerId: 'foundry-local-whisper', nameKey: LOCAL_MODEL_NAME_KEY[m.alias] });
      }
    }
    return result;
  }, [sherpaCatalog, foundryCatalog, offlineEnabled]);

  // ── ASR 下拉选项 ──
  const asrProviderId = prefs?.activeAsrProvider ?? creds?.activeAsrProvider ?? 'volcengine';
  const asrDropdownOptions = useMemo(() => {
    const configuredMap = creds?.asrProvidersConfigured ?? {};
    const opts: SelectOption[] = CLOUD_ASR_PROVIDERS
      .filter(p => configuredMap[p.id])
      .map(p => ({
        value: p.id,
        label: t(`settings.providers.presets.${p.nameKey}`),
      }));
    if (opts.length > 0 && installedLocalModels.length > 0) {
      opts.push({ value: '__sep_local__', label: '', separator: true, disabled: true });
    }
    if (installedLocalModels.length > 0) {
      for (const m of installedLocalModels) {
        opts.push({
          value: `local:${m.providerId}:${m.alias}`,
          label: t(LOCAL_MODEL_NAME_KEY[m.alias] ?? 'settings.advanced.simplified.offlineTitle'),
        });
      }
    }
    if (opts.length === 0) {
      opts.push({ value: '__empty__', label: t('overview.noLocalModel'), disabled: true });
    }
    return opts;
  }, [creds, t, installedLocalModels]);

  const asrDropdownValue = useMemo(() => {
    if (LOCAL_ENGINE_IDS.has(asrProviderId)) {
      const sherpaAlias = prefs?.sherpaOnnxModel || 'sense-voice-small-zh';
      const foundryAlias = prefs?.foundryLocalAsrModel || 'whisper-medium';
      if (asrProviderId === 'sherpa-onnx-local') return `local:sherpa-onnx-local:${sherpaAlias}`;
      if (asrProviderId === 'foundry-local-whisper') return `local:foundry-local-whisper:${foundryAlias}`;
      return asrProviderId;
    }
    return asrProviderId;
  }, [asrProviderId, prefs]);

  // ── ASR 切换（必须在 updatePrefs 之前调用 setActiveAsrProvider） ──
  const onAsrModelChange = useCallback(async (value: string) => {
    if (!prefs || value.startsWith('__')) return;
    if (value.startsWith('local:')) {
      const [, providerId, alias] = value.split(':');
      await setActiveAsrProvider(providerId);
      const updated: UserPreferences = { ...prefs, activeAsrProvider: providerId };
      if (providerId === 'sherpa-onnx-local') updated.sherpaOnnxModel = alias;
      if (providerId === 'foundry-local-whisper') updated.foundryLocalAsrModel = alias;
      await updatePrefs(updated);
    } else {
      await setActiveAsrProvider(value);
      await updatePrefs({ ...prefs, activeAsrProvider: value });
    }
    getCredentials().then(setCreds).catch(() => {});
  }, [prefs, updatePrefs]);

  // ── 润色开关（polishEnabled 和 normalMode 互斥联动） ──
  const onPolishToggle = useCallback((enabled: boolean) => {
    if (!prefs) return;
    updatePrefs({ ...prefs, polishEnabled: enabled, normalMode: !enabled });
  }, [prefs, updatePrefs]);

  // ── 展开恢复正常模式 ──
  const onExpand = useCallback(() => {
    exitMiniMode().catch(console.error);
  }, []);

  // ── 当前 ASR 模型显示名称 ──
  const currentAsrName = useMemo(() => {
    if (LOCAL_ENGINE_IDS.has(asrProviderId)) {
      const alias = asrProviderId === 'sherpa-onnx-local'
        ? (prefs?.sherpaOnnxModel ?? '')
        : asrProviderId === 'foundry-local-whisper'
          ? (prefs?.foundryLocalAsrModel ?? '')
          : '';
      const key = LOCAL_MODEL_NAME_KEY[alias];
      return key ? t(key) : alias || asrProviderId;
    }
    const p = CLOUD_ASR_PROVIDERS.find(p => p.id === asrProviderId);
    return p ? t(`settings.providers.presets.${p.nameKey}`) : asrProviderId;
  }, [asrProviderId, prefs, t]);

  // ── 最近识别记录（取前 3 条） ──
  const recentItems = history.slice(0, 3);

  return (
    <div style={styles.root}>
      {/* Header — 可拖拽区域 */}
      <div data-tauri-drag-region style={styles.header}>
        <div data-tauri-drag-region style={styles.logo}>
          <div style={styles.logoIcon}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </svg>
          </div>
          <span style={styles.logoText}>{t('app.name', '声墨')}</span>
        </div>
        <button onClick={onExpand} style={styles.expandBtn} title={t('miniPanel.expand', '恢复正常')}>
          <ExpandIcon />
        </button>
      </div>

      {/* 统计卡片 */}
      <div style={styles.statsRow}>
        <div style={styles.statCard}>
          <div style={styles.statLabel}># {t('overview.metricChars')}</div>
          <div style={styles.statValue}>{metrics.charsToday.toLocaleString()}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
            {' '}{t('miniPanel.totalDuration', '总时长')}
          </div>
          <div style={styles.statValue}>{formatDuration(metrics.totalDurationMs)}</div>
        </div>
      </div>

      {/* ASR 模型选择 */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>{t('overview.asrKind')}</div>
        <SelectLite
          value={asrDropdownValue}
          onChange={onAsrModelChange}
          options={asrDropdownOptions}
          placeholder={t('overview.selectModel')}
          ariaLabel={t('overview.selectModel')}
          style={{ width: '100%' }}
        />
      </div>

      {/* 润色开关 */}
      <div style={{ ...styles.section, marginBottom: 0 }}>
        <div style={styles.polishRow}>
          <div style={styles.polishInfo}>
            <div style={styles.polishTitle}>
              <span>✨</span>
              <span>{t('miniPanel.polish', '润色')}</span>
              <span style={{
                ...styles.polishBadge,
                ...(prefs?.polishEnabled ? {} : styles.polishBadgeOff),
              }}>
                {prefs?.polishEnabled
                  ? t('miniPanel.polishOn', '已启用')
                  : t('miniPanel.polishOff', '已关闭')}
              </span>
            </div>
            <div style={styles.polishSub}>{t('miniPanel.polishDesc', '识别后自动润色文本')}</div>
          </div>
          <Toggle
            on={prefs?.polishEnabled ?? false}
            onToggle={onPolishToggle}
          />
        </div>
      </div>

      {/* 最近识别 */}
      {recentItems.length > 0 && (
        <div style={styles.section}>
          <div style={styles.recentLabel}>
            <span>{t('overview.recentTitle')}</span>
            <span>{t('overview.recentTotal', { count: history.length })}</span>
          </div>
          <div style={styles.recentList}>
            {recentItems.map(s => {
              const time = new Date(s.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
              return (
                <div key={s.id} style={styles.recentItem}>
                  <span style={styles.recentTime}>{time}</span>
                  <span style={styles.recentText}>{s.finalText.split('\n')[0]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 状态栏 */}
      <div style={styles.statusBar}>
        <div style={styles.statusDot} />
        <span>
          {t('miniPanel.statusReady', '语音识别就绪')}
          {memInfo && <> · {formatMemory(memInfo.memoryBytes)}</>}
        </span>
      </div>
    </div>
  );
}

// ── 样式（使用 --ol-* 设计令牌，自动适配明暗主题） ─────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--ol-surface)',
    color: 'var(--ol-ink)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: 13,
    overflow: 'hidden',
    userSelect: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 14px 8px',
    cursor: 'default',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  logoIcon: {
    width: 22,
    height: 22,
    borderRadius: 6,
    background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--ol-ink)',
  },
  expandBtn: {
    width: 26,
    height: 26,
    borderRadius: 6,
    background: 'var(--ol-control-muted)',
    border: '0.5px solid var(--ol-line)',
    color: 'var(--ol-ink-3)',
    cursor: 'default',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    transition: 'background 0.15s, color 0.15s',
  },
  statsRow: {
    display: 'flex',
    padding: '0 14px 12px',
    gap: 10,
  },
  statCard: {
    flex: 1,
    background: 'var(--ol-surface-2)',
    border: '0.5px solid var(--ol-line-soft)',
    borderRadius: 10,
    padding: '10px 10px',
    textAlign: 'center' as const,
  },
  statLabel: {
    fontSize: 11,
    color: 'var(--ol-ink-4)',
    marginBottom: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: '-0.5px',
    color: 'var(--ol-ink)',
    lineHeight: 1.2,
  },
  section: {
    padding: '0 14px 12px',
  },
  sectionLabel: {
    fontSize: 11,
    color: 'var(--ol-ink-4)',
    marginBottom: 6,
    paddingLeft: 2,
  },
  polishRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 10px',
    background: 'var(--ol-surface-2)',
    border: '0.5px solid var(--ol-line-soft)',
    borderRadius: 10,
  },
  polishInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  polishTitle: {
    fontSize: 13,
    color: 'var(--ol-ink)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  polishBadge: {
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 4,
    background: 'var(--ol-ok-soft)',
    color: 'var(--ol-ok)',
    fontWeight: 500,
  },
  polishBadgeOff: {
    background: 'var(--ol-control-muted)',
    color: 'var(--ol-ink-4)',
  },
  polishSub: {
    fontSize: 11,
    color: 'var(--ol-ink-4)',
  },
  recentLabel: {
    fontSize: 11,
    color: 'var(--ol-ink-4)',
    marginBottom: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 2,
  },
  recentItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    background: 'var(--ol-surface-2)',
    border: '0.5px solid var(--ol-line-soft)',
    borderRadius: 8,
  },
  recentList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  recentTime: {
    fontSize: 11,
    color: 'var(--ol-ink-4)',
    flexShrink: 0,
  },
  recentText: {
    flex: 1,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontSize: 12,
    color: 'var(--ol-ink)',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    borderTop: '0.5px solid var(--ol-line-soft)',
    fontSize: 11,
    color: 'var(--ol-ink-4)',
    marginTop: 'auto',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--ol-ok)',
    flexShrink: 0,
  },
};
