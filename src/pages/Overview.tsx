// Overview.tsx — 真实指标，从 listHistory + getCredentials 派生。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon';
import { SelectLite } from '../components/ui/SelectLite';
import type { SelectOption } from '../components/ui/SelectLite';
import { formatComboLabel } from '../lib/hotkey';
import { getCredentials, listHistory, setActiveAsrProvider, setSettings, setActiveLlmProvider, getProcessMemory, getGpuMemory, enterMiniMode } from '../lib/ipc';
import type { ProcessMemoryInfo, GpuMemoryInfo } from '../lib/ipc';
import { getSherpaOnnxAsrCatalog, getFoundryLocalAsrCatalog } from '../lib/localAsr';
import type { SherpaOnnxCatalogModel, FoundryLocalAsrCatalogModel } from '../lib/localAsr';
import { useMobileLayout } from '../lib/useMobileLayout';
import type { CredentialsStatus, DictationSession, PolishMode, UserPreferences } from '../lib/types';
import { useHotkeySettings } from '../state/HotkeySettingsContext';
import { estimateDailyCost, formatDurationShort, formatTokens, getCurrencySymbol } from '../lib/pricing';
import { Btn, Card, PageHeader, Pill } from './_atoms';
import { Toggle } from './settings/shared';

function useModeLabels(): Record<PolishMode, string> {
  const { t } = useTranslation();
  return {
    raw: t('style.modes.raw.name'),
    light: t('style.modes.light.name'),
    structured: t('style.modes.structured.name'),
    formal: t('style.modes.formal.name'),
  };
}

interface OverviewProps {
  onOpenHistory?: () => void;
  onOpenSettings?: (section?: string) => void;
}

const ASR_NAME_KEY_BY_ID: Record<string, string> = {
  volcengine: 'asrVolcengine',
  bailian: 'asrBailian',
  siliconflow: 'asrSiliconflow',
  zhipu: 'asrZhipu',
  groq: 'asrGroq',
  whisper: 'asrWhisper',
  openrouter: 'asrOpenrouter',
  'xiaomi-mimo-asr': 'asrXiaomiMimo',
  'foundry-local-whisper': 'asrFoundryLocalWhisper',
  'sherpa-onnx-local': 'asrSherpaOnnxLocal',
  'local-qwen3': 'asrLocalQwen3',
  'apple-speech': 'asrAppleSpeech',
};

/** 云端 ASR 提供商（排除本地引擎），用于概览下拉菜单 */
const CLOUD_ASR_PROVIDERS: ReadonlyArray<{ id: string; nameKey: string }> = [
  { id: 'volcengine',        nameKey: 'asrVolcengine' },
  { id: 'bailian',           nameKey: 'asrBailian' },
  { id: 'siliconflow',       nameKey: 'asrSiliconflow' },
  { id: 'zhipu',             nameKey: 'asrZhipu' },
  { id: 'groq',              nameKey: 'asrGroq' },
  { id: 'whisper',           nameKey: 'asrWhisper' },
  { id: 'openrouter',        nameKey: 'asrOpenrouter' },
  { id: 'xiaomi-mimo-asr',  nameKey: 'asrXiaomiMimo' },
];

const LOCAL_ENGINE_IDS = new Set(['foundry-local-whisper', 'sherpa-onnx-local', 'local-qwen3', 'apple-speech']);
/** 云端 LLM 提供商（用于概览下拉菜单） */
const CLOUD_LLM_PROVIDERS: ReadonlyArray<{ id: string; nameKey: string }> = [
  { id: 'ark',             nameKey: 'ark' },
  { id: 'deepseek',        nameKey: 'deepseek' },
  { id: 'siliconflow',     nameKey: 'siliconflow' },
  { id: 'openai',          nameKey: 'openai' },
  { id: 'codex_oauth',     nameKey: 'codexOAuth' },
  { id: 'mimo',            nameKey: 'mimo' },
  { id: 'cometapi',        nameKey: 'cometapi' },
  { id: 'openrouterFree',  nameKey: 'openrouterFree' },
  { id: 'alibabaCoding',   nameKey: 'alibabaCoding' },
  { id: 'codingPlanX',     nameKey: 'codingPlanX' },
  { id: 'custom',          nameKey: 'custom' },
  { id: 'gemini',          nameKey: 'gemini' },
  { id: 'minimax',         nameKey: 'minimax' },
];

/** 本地模型 alias → 展示名称 i18n key */
const LOCAL_MODEL_NAME_KEY: Record<string, string> = {
  // Sherpa 离线模型
  'sense-voice-small-zh':  'settings.advanced.simplified.modelSenseVoiceSmall',
  'paraformer-zh':         'settings.advanced.simplified.modelParaformerZh',
  'whisper-small-multi':   'settings.advanced.simplified.modelWhisperSmallMulti',
  'qwen3-asr-0.6b-int8':  'settings.advanced.simplified.modelQwen3Asr',
  // Foundry (实验室) 离线模型
  'whisper-tiny':          'settings.advanced.simplified.modelWhisperTiny',
  'whisper-base':          'settings.advanced.simplified.modelWhisperBase',
  'whisper-small':         'settings.advanced.simplified.modelWhisperSmallFoundry',
  'whisper-medium':        'settings.advanced.simplified.modelWhisperMedium',
  'whisper-large-v3-turbo': 'settings.advanced.simplified.modelWhisperLargeTurbo',
  // Sherpa 流式模型
  'zipformer-bilingual-zh-en-streaming': 'settings.advanced.simplified.modelZipformerStreaming',
  'paraformer-streaming-zh':           'settings.advanced.simplified.modelParaformerStreamingZh',
  'whisper-large-v3-multi':             'settings.advanced.simplified.modelWhisperLargeV3',
  'zipformer-small-ctc-zh-streaming':   'settings.advanced.simplified.modelZipformerSmallCtcZh',
};

const LLM_NAME_KEY_BY_ID: Record<string, string> = {
  ark: 'ark',
  deepseek: 'deepseek',
  siliconflow: 'siliconflow',
  openai: 'openai',
  codex_oauth: 'codexOAuth',
  mimo: 'mimo',
  cometapi: 'cometapi',
  openrouterFree: 'openrouterFree',
  alibabaCoding: 'alibabaCoding',
  codingPlanX: 'codingPlanX',
  custom: 'custom',
  gemini: 'gemini',
  minimax: 'minimax',
};

// LLM 提供商 → 代表性模型 ID（用于定价查找）
const LLM_MODEL_FOR_PROVIDER: Record<string, string> = {
  ark: 'doubao-seed2-lite',
  deepseek: 'deepseek-v4-flash',
  siliconflow: 'deepseek-v4-flash',
  openai: 'gpt-4o',
  codex_oauth: 'gpt-4o',
  mimo: 'mimo-v2.5-flash',
  cometapi: 'deepseek-v4-flash',
  openrouterFree: 'deepseek-v4-flash',
  alibabaCoding: 'qwen3-plus',
  codingPlanX: 'qwen3-plus',
  custom: 'deepseek-v4-flash',
  gemini: 'gpt-4o',
  minimax: 'deepseek-v4-flash',
};

export function Overview({ onOpenHistory, onOpenSettings }: OverviewProps) {
  const { t, i18n } = useTranslation();
  const mobile = useMobileLayout();
  const modeLabel = useModeLabels();
  const [history, setHistory] = useState<DictationSession[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [credsError, setCredsError] = useState(false);
  const [creds, setCreds] = useState<CredentialsStatus>({
    activeAsrProvider: 'volcengine',
    activeLlmProvider: 'ark',
    asrConfigured: false,
    llmConfigured: false,
    volcengineConfigured: false,
    arkConfigured: false,
    asrProvidersConfigured: {},
    llmProvidersConfigured: {},
  });
  const { prefs } = useHotkeySettings();
  const credentialsRequestSeq = useRef(0);
  const [memInfo, setMemInfo] = useState<ProcessMemoryInfo | null>(null);
  const [gpuMem, setGpuMem] = useState<GpuMemoryInfo | null>(null);

  // 本地模型 catalog（用于概览下拉菜单显示已安装模型）
  const [sherpaCatalog, setSherpaCatalog] = useState<SherpaOnnxCatalogModel[]>([]);
  const [foundryCatalog, setFoundryCatalog] = useState<FoundryLocalAsrCatalogModel[]>([]);

  useEffect(() => {
    getSherpaOnnxAsrCatalog().then(setSherpaCatalog).catch(() => {});
    getFoundryLocalAsrCatalog().then(setFoundryCatalog).catch(() => {});
  }, []);

  // 当 activeAsrProvider 变化时（用户在设置中切换/启用离线），重新加载 catalog 以同步新安装的模型。
  useEffect(() => {
    getSherpaOnnxAsrCatalog().then(setSherpaCatalog).catch(() => {});
    getFoundryLocalAsrCatalog().then(setFoundryCatalog).catch(() => {});
  }, [prefs?.activeAsrProvider]);

  /** 离线识别总开关 */
  const offlineEnabled = prefs?.offlineEnabled ?? true;

  /** 已安装的本地模型列表（受 offlineEnabled 门控） */
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

  /** 概览 ASR 下拉选项 = 已配置的云端 + 已安装的本地模型（逐个展示） */
  const asrDropdownOptions = useMemo(() => {
    const configuredMap = creds.asrProvidersConfigured ?? {};
    const opts: SelectOption[] = CLOUD_ASR_PROVIDERS
      .filter(p => configuredMap[p.id])
      .map(p => ({
        value: p.id,
        label: t(`settings.providers.presets.${p.nameKey}`),
      }));
    /** 无已配置的云端且无已安装本地模型 → 显示「去配置」入口 */
    if (opts.length === 0 && installedLocalModels.length === 0) {
      opts.push({
        value: '__goto_settings__',
        label: t('overview.goToSettings'),
      });
    }
    /** 云端和本地之间加细分隔线（仅离线开启且有本地模型时） */
    if (opts.length > 0 && installedLocalModels.length > 0) {
      opts.push({ value: '__sep_local__', label: '', separator: true, disabled: true });
    }
    /** 已安装的本地模型 → 逐个展示；无模型但离线开启 → 引导去设置页下载 */
    if (installedLocalModels.length > 0) {
      for (const m of installedLocalModels) {
        opts.push({
          value: `local:${m.providerId}:${m.alias}`,
          label: t(LOCAL_MODEL_NAME_KEY[m.alias] ?? 'settings.advanced.simplified.offlineTitle'),
        });
      }
    } else if (offlineEnabled) {
      opts.push({
        value: '__goto_offline_settings__',
        label: t('overview.goToOfflineSettings', '配置离线识别'),
      });
    }
    return opts;
  }, [creds.asrProvidersConfigured, t, installedLocalModels, offlineEnabled]);

  const refreshHistory = useCallback(() => {
    setHistoryError(false);
    listHistory()
      .then(setHistory)
      .catch(error => {
        console.error('[overview] failed to load history', error);
        setHistoryError(true);
      });
  }, []);

  const refreshCredentials = useCallback(() => {
    const requestSeq = credentialsRequestSeq.current + 1;
    credentialsRequestSeq.current = requestSeq;
    setCredsError(false);
    getCredentials()
      .then(status => {
        if (requestSeq !== credentialsRequestSeq.current) return;
        setCreds(status);
        setCredsError(false);
      })
      .catch(error => {
        if (requestSeq !== credentialsRequestSeq.current) return;
        console.error('[overview] failed to load credentials status', error);
        setCredsError(true);
      });
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    refreshCredentials();
  }, [refreshCredentials, prefs?.activeAsrProvider, prefs?.activeLlmProvider]);

  // 凭据被保存后重新拉取状态（issue #532 / #573：在 Settings 中填写/更新凭据
  // 但不切换提供商时，上面的 useEffect 不会重跑，导致概览页的状态仍停留在「未配置」）。
  // 复用 refreshCredentials() 以带上 credentialsRequestSeq 防竞态。
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const handle = await listen('credentials:changed', () => {
          if (cancelled) return;
          refreshCredentials();
        });
        if (cancelled) {
          handle();
        } else {
          unlisten = handle;
        }
      } catch {
        // browser dev mock — 没有 Tauri event bridge
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refreshCredentials]);
  // 内存 + 显存实时消耗轮询（Windows 2s / macOS 3s）
  const [memPlatform, setMemPlatform] = useState<'windows' | 'macos' | 'linux' | 'mobile'>('windows');
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      getProcessMemory().then(info => {
        if (cancelled) return;
        setMemInfo(info);
        setMemPlatform(info.platform);
      }).catch(() => {});
      getGpuMemory().then(setGpuMem).catch(() => {});
    };
    tick();
    const interval = memPlatform === 'macos' ? 3000 : 2000;
    const id = setInterval(tick, interval);
    return () => { cancelled = true; clearInterval(id); };
  }, [memPlatform]);


  const metrics = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todays = history.filter(s => new Date(s.createdAt) >= today);
    const charsToday = todays.reduce((acc, s) => acc + s.finalText.length, 0);
    const segmentsToday = todays.length;
    const totalDurationMs = todays.reduce((acc, s) => acc + (s.durationMs ?? 0), 0);
    const avgLatencyMs = segmentsToday > 0 ? totalDurationMs / segmentsToday : 0;
    return { charsToday, segmentsToday, totalDurationMs, avgLatencyMs };
  }, [history]);

  // 周历:过去 7 天每天的条数
  const weekly = useMemo(() => {
    const buckets = Array(7).fill(0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    history.forEach(s => {
      const d = new Date(s.createdAt);
      const diff = Math.floor((today.getTime() - d.setHours(0, 0, 0, 0)) / 86400000);
      if (diff >= 0 && diff < 7) {
        buckets[6 - diff] += 1;
      }
    });
    return buckets;
  }, [history]);

  const costBreakdown = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaysSessions = history.filter(s => new Date(s.createdAt) >= today);
    const llmModelId = LLM_MODEL_FOR_PROVIDER[creds.activeLlmProvider] ?? null;
    return estimateDailyCost(todaysSessions, llmModelId, creds.activeAsrProvider, prefs?.polishEnabled);
  }, [history, creds.activeLlmProvider, creds.activeAsrProvider, prefs?.polishEnabled]);

  const asrProviderId = prefs?.activeAsrProvider || creds.activeAsrProvider || 'volcengine';
  const llmProviderId = creds.activeLlmProvider || 'ark';

  /** 当前下拉选中值 */
  const asrDropdownValue = useMemo(() => {
    const configuredMap = creds.asrProvidersConfigured ?? {};
    const hasConfiguredCloud = CLOUD_ASR_PROVIDERS.some(p => configuredMap[p.id]);
    /** 未配置任何云端 + 当前不是离线模式 → 显示「去配置」 */
    if (!hasConfiguredCloud && !LOCAL_ENGINE_IDS.has(asrProviderId)) {
      return '__goto_settings__';
    }
    if (LOCAL_ENGINE_IDS.has(asrProviderId)) {
      const sherpaAlias = prefs?.sherpaOnnxModel || 'sense-voice-small-zh';
      const foundryAlias = prefs?.foundryLocalAsrModel || 'whisper-medium';
      if (asrProviderId === 'sherpa-onnx-local') return `local:sherpa-onnx-local:${sherpaAlias}`;
      if (asrProviderId === 'foundry-local-whisper') return `local:foundry-local-whisper:${foundryAlias}`;
      return asrProviderId;
    }
    return asrProviderId;
  }, [asrProviderId, prefs, creds.asrProvidersConfigured]);

  /** 切换 ASR provider */
  const onAsrModelChange = useCallback(async (value: string) => {
    if (value === '__goto_settings__') {
      onOpenSettings?.('services');
      return;
    }
    if (value === '__goto_offline_settings__') {
      onOpenSettings?.('offline');
      return;
    }
    if (!prefs) return;
    if (value.startsWith('local:')) {
      const [, providerId, alias] = value.split(':');
      // setActiveAsrProvider MUST run before setSettings:
      // setSettings → persist_settings syncs the vault with the new provider,
      // which would cause setActiveAsrProvider to early-return and skip
      // runtime release for cross-engine switches.
      await setActiveAsrProvider(providerId);
      const updated: UserPreferences = { ...prefs, activeAsrProvider: providerId };
      if (providerId === 'sherpa-onnx-local') updated.sherpaOnnxModel = alias;
      if (providerId === 'foundry-local-whisper') updated.foundryLocalAsrModel = alias;
      await setSettings(updated);
    } else {
      await setActiveAsrProvider(value);
      await setSettings({ ...prefs, activeAsrProvider: value });
    }
    refreshCredentials();
  }, [prefs, refreshCredentials, onOpenSettings]);

  const llmDropdownOptions = useMemo(() => {
    const configuredMap = creds.llmProvidersConfigured ?? {};
    const opts: SelectOption[] = CLOUD_LLM_PROVIDERS
      .filter(p => configuredMap[p.id])
      .map(p => ({
        value: p.id,
        label: t(`settings.providers.presets.${p.nameKey}`),
      }));
    if (opts.length === 0) {
      opts.push({
        value: '__goto_settings__',
        label: t('overview.goToSettings'),
      });
    }
    return opts;
  }, [creds.llmProvidersConfigured, t]);

  /** 当前 LLM 下拉选中值 */
  const llmDropdownValue = useMemo(() => {
    return llmProviderId;
  }, [llmProviderId]);

  /** 切换 LLM provider */
  const onLlmModelChange = useCallback(async (value: string) => {
    if (value === '__goto_settings__') {
      onOpenSettings?.('services');
      return;
    }
    if (!prefs) return;
    await setActiveLlmProvider(value);
    await setSettings({ ...prefs, activeLlmProvider: value });
    refreshCredentials();
  }, [prefs, refreshCredentials, onOpenSettings]);

  const asrNameKey = ASR_NAME_KEY_BY_ID[asrProviderId];
  const llmNameKey = LLM_NAME_KEY_BY_ID[llmProviderId];
  const asrProviderName = asrNameKey
    ? t(`settings.providers.presets.${asrNameKey}`)
    : asrProviderId;
  const llmProviderName = llmNameKey
    ? t(`settings.providers.presets.${llmNameKey}`)
    : llmProviderId;

  return (
    <>
      <PageHeader
        title={t('overview.title')}
        titleRight={
          <button
            onClick={() => enterMiniMode().catch(console.error)}
            title={t('miniPanel.miniMode', '迷你模式')}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: '0.5px solid var(--ol-line)',
              background: 'var(--ol-surface)',
              color: 'var(--ol-ink-3)',
              cursor: 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="12" height="10" rx="2" />
              <line x1="2" y1="7" x2="14" y2="7" />
              <line x1="6" y1="3" x2="6" y2="7" />
            </svg>
          </button>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 18 }}>
        <ProviderCard
          kind={t('overview.asrKind')}
          name={asrProviderName}
          subname={asrProviderId}
          status={credsError ? 'error' : creds.asrConfigured ? 'configured' : 'notConfigured'}
          select={
            <SelectLite
              value={asrDropdownValue}
              onChange={onAsrModelChange}
              options={asrDropdownOptions}
              placeholder={t('overview.selectModel')}
              ariaLabel={t('overview.selectModel')}
              style={{ width: '100%' }}
            />
          }
        />
        <ProviderCard
          kind={t('overview.llmKind')}
          name={llmProviderName}
          subname={prefs?.polishEnabled === false ? t('overview.polishDisabled', '润色已关闭') : llmProviderId}
          status={credsError ? 'error' : prefs?.polishEnabled === false ? 'disabled' : creds.llmConfigured ? 'configured' : 'notConfigured'}
          select={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Toggle
                on={prefs?.polishEnabled ?? false}
                onToggle={enabled => {
                  if (prefs) setSettings({ ...prefs, polishEnabled: enabled, normalMode: !enabled });
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <SelectLite
                  value={llmDropdownValue}
                  onChange={onLlmModelChange}
                  options={llmDropdownOptions}
                  placeholder={t('overview.selectModel')}
                  ariaLabel={t('overview.selectModel')}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          }
        />
      </div>

      <div className="ol-overview-hero" style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        <Metric icon="hash" label={t('overview.metricChars')} value={historyError ? '—' : metrics.charsToday.toLocaleString()} trend={historyError ? t('overview.historyLoadError') : t('overview.metricSegments', { count: metrics.segmentsToday })} />
        {/* 今日总时长：大数字 + 底部均值同行 */}
        <Card padding={16}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: 'var(--ol-ink-3)' }}>
            <Icon name="mic" size={13} />
            <span style={{ fontSize: 11.5 }}>{t('overview.metricDuration')}</span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ol-ink)', lineHeight: 1.1 }}>
            {historyError ? '—' : formatDuration(metrics.totalDurationMs, t)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ol-ink-4)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            {historyError ? t('overview.historyLoadError') : metrics.segmentsToday > 0 ? (
              <>{t('overview.metricAvgTrend')}{' '}{(metrics.avgLatencyMs / 1000).toFixed(1)}s</>
            ) : t('overview.metricNoData')}
          </div>
        </Card>
        {/* ASR 消耗 */}
        <Card padding={16}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, color: 'var(--ol-ink-3)' }}>
            <Icon name="mic" size={13} />
            <span style={{ fontSize: 11.5 }}>ASR</span>
          </div>
          {historyError ? (
            <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ol-blue)', lineHeight: 1.1 }}>—</div>
          ) : (
            <>
              <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ol-blue)', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {costBreakdown.asrCost === 0 ? (
                  t('overview.metricCostFree')
                ) : costBreakdown.asrCost < 0.001 ? (
                  <><span style={{ fontSize: 13 }}>{'<'}</span><span style={{ fontSize: 13 }}>{getCurrencySymbol(i18n.language)}</span>{'0.001'}</>
                ) : (
                  <><span style={{ fontSize: 13 }}>{getCurrencySymbol(i18n.language)}</span>{' '}{costBreakdown.asrCost.toFixed(3)}</>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ol-ink-4)', marginTop: 6 }}>
                {costBreakdown.asrDurationSec > 0 ? (metrics.charsToday / costBreakdown.asrDurationSec).toFixed(1) + ' 字/秒' : '—'}
              </div>
            </>
          )}
        </Card>
        {/* 内存实时消耗 */}
        <Card padding={16}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, color: 'var(--ol-ink-3)' }}>
            <Icon name="chip" size={13} />
            <span style={{ fontSize: 11.5 }}>{memPlatform === 'macos' ? t('overview.metricMemoryRSS', '内存 (RSS)') : t('overview.metricMemory', '内存')}</span>
          </div>
          {memInfo ? (
            <>
              <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ol-ink)', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {formatMemory(memInfo.memoryBytes)}
              </div>
              {memPlatform === 'windows' && gpuMem?.available && (
                <div style={{ fontSize: 11, color: 'var(--ol-ink-4)', marginTop: 6 }}>
                  {t('overview.metricVram', '显存')}: {formatMemory(gpuMem.usedBytes)}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ol-ink)', lineHeight: 1.1 }}>—</div>
          )}
        </Card>
      </div>

      {/* 底部一行 = flex:1 撑满剩余高度（父 wrapper 是 display:flex/column）。
          只有「最近识别」内部允许滚动；其他卡片按内容自然高度，不破裂底部圆角。
          issue #243 follow-up：去掉外层 overflow 后底部圆角被裁的视觉问题。 */}
      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1.4fr', gap: 12, flex: mobile ? undefined : 1, minHeight: mobile ? undefined : 0 }}>
        <Card padding={18} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ol-ink-2)' }}>{t('overview.weekTitle')}</span>
            <span style={{ fontSize: 11, color: 'var(--ol-ink-4)' }}>{t('overview.weekUnit')}</span>
          </div>
          {historyError ? (
            <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 12, color: 'var(--ol-ink-4)' }}>
              {t('overview.historyLoadError')}
            </div>
          ) : (
            <WeekChart data={weekly} />
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ol-ink-4)', marginTop: 8 }}>
            {weekDayLabels(t('overview.weekDays', { returnObjects: true }) as string[]).map((d, i) => <span key={i}>{d}</span>)}
          </div>
        </Card>

        <Card padding={0} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '0.5px solid var(--ol-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ol-ink-2)' }}>{t('overview.recentTitle')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!historyError && history.length > 0 && (
                <span style={{ fontSize: 11, color: 'var(--ol-ink-4)' }}>{t('overview.recentTotal', { count: history.length })}</span>
              )}
              <Btn size="sm" variant="ghost" onClick={onOpenHistory}>{t('overview.recentAll')}</Btn>
            </div>
          </div>
          <div className="ol-thinscroll" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {historyError ? (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--ol-ink-4)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <span>{t('overview.recentLoadFailed')}</span>
                <Btn size="sm" variant="ghost" onClick={refreshHistory}>{t('overview.historyRetry')}</Btn>
              </div>
            ) : (
              <>
                {history.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--ol-ink-4)' }}>
                    {t('overview.recentEmpty', { trigger: prefs ? formatComboLabel(prefs.dictationHotkey) : '' })}
                  </div>
                )}
                {history.slice(0, 5).map(s => (
                  <RecentRow key={s.id} session={s} modeLabel={modeLabel} />
                ))}
              </>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

interface ProviderCardProps {
  kind: string;
  name: string;
  subname: string;
  status: 'configured' | 'notConfigured' | 'error' | 'disabled';
  /** 可选：嵌入卡片内部的下拉选择器，替代 name/subname 显示。 */
  select?: React.ReactNode;
}

function ProviderCard({ kind, name, subname, status, select }: ProviderCardProps) {
  const { t } = useTranslation();
  const isAsr = kind === t('overview.asrKind');
  return (
    <Card padding={16} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div
        style={{
          width: 38, height: 38, borderRadius: 10,
          background: 'var(--ol-blue-soft)',
          color: 'var(--ol-blue)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icon name={isAsr ? 'mic' : 'sparkle'} size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--ol-ink-4)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>{kind}</span>
          {status === 'configured' && (
            <Pill tone="ok" size="sm">
              <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--ol-ok)' }} />
              {t('overview.statusConfigured')}
            </Pill>
          )}
          {status === 'notConfigured' && (
            <Pill tone="outline" size="sm">{t('overview.statusNotConfigured')}</Pill>
          )}
          {status === 'error' && (
            <Pill tone="outline" size="sm" style={{ color: 'var(--ol-red, #ef4444)', borderColor: 'rgba(239,68,68,0.24)' }}>{t('overview.statusUnknown')}</Pill>
          )}
          {status === 'disabled' && (
            <Pill tone="outline" size="sm" style={{ color: 'var(--ol-ink-4)', borderColor: 'var(--ol-line)' }}>
              {t('overview.statusDisabled', '已关闭')}
            </Pill>
          )}
        </div>
        {select ? (
          <div style={{ marginTop: 4 }}>{select}</div>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ol-ink)' }}>{name}</div>
            <div style={{ fontSize: 11.5, color: status === 'error' ? 'var(--ol-red, #ef4444)' : 'var(--ol-ink-3)', marginTop: 1, fontFamily: status === 'error' ? undefined : 'var(--ol-font-mono)' }}>
              {status === 'error' ? t('overview.credentialsLoadError') : subname}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

interface MetricProps {
  icon: string;
  label: string;
  value: string;
  subvalue?: string;
  trend: string;
  accent?: boolean;
}

function Metric({ icon, label, value, subvalue, trend, accent }: MetricProps) {
  return (
    <Card padding={16}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: 'var(--ol-ink-3)' }}>
        <Icon name={icon} size={13} />
        <span style={{ fontSize: 11.5 }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: accent ? 'var(--ol-blue)' : 'var(--ol-ink)', lineHeight: 1.1 }}>{value}</div>
        {subvalue && (
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ol-ink-3)', lineHeight: 1.1, whiteSpace: 'nowrap' }}>{subvalue}</div>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ol-ink-4)', marginTop: 6 }}>{trend || ' '}</div>
    </Card>
  );
}

function WeekChart({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100 }}>
      {data.map((v, i) => {
        const isToday = i === 6;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{ fontSize: 9.5, color: isToday ? 'var(--ol-blue)' : 'var(--ol-ink-4)', fontWeight: isToday ? 600 : 400 }}>{v}</div>
            <div
              style={{
                width: '100%',
                height: `${(v / max) * 80}px`,
                minHeight: 2,
                borderRadius: 4,
                background: isToday ? 'var(--ol-blue)' : 'var(--ol-ink-4)',
                opacity: v === 0 ? 0.15 : isToday ? 1 : 0.85,
                transition: 'height 0.18s var(--ol-motion-soft), opacity 0.18s var(--ol-motion-soft)',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function RecentRow({ session, modeLabel }: { session: DictationSession; modeLabel: Record<PolishMode, string> }) {
  const { t } = useTranslation();
  return (
    <div style={{ padding: '12px 18px', borderBottom: '0.5px solid var(--ol-line-soft)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, minWidth: 60 }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--ol-font-mono)', color: 'var(--ol-ink-3)' }}>
          {formatTime(session.createdAt)}
        </span>
        <Pill size="sm" tone="default">{modeLabel[session.mode]}</Pill>
      </div>
      <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ol-ink-2)', whiteSpace: 'pre-line', lineHeight: 1.55, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {session.finalText.split('\n')[0]}
      </div>
      <span style={{ fontSize: 10.5, color: 'var(--ol-ink-4)', fontFamily: 'var(--ol-font-mono)' }}>
        {formatDuration(session.durationMs ?? 0, t)}
      </span>
    </div>
  );
}

function formatMemory(bytes: number): string {
  if (bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb < 10) return mb.toFixed(1) + ' MB';
  return Math.round(mb) + ' MB';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (n: number) => String(n).padStart(2, '0');
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDuration(ms: number, t: ReturnType<typeof useTranslation>['t']): string {
  if (ms <= 0) return '—';
  const sec = ms / 1000;
  if (sec < 60) return t('common.durationSeconds', { value: sec.toFixed(1) });
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

function weekDayLabels(names: string[]): string[] {
  const today = new Date().getDay();
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) {
    out.push(names[(today - i + 7) % 7]);
  }
  return out;
}
