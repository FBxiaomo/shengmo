// 高级 → 离线识别（Windows 精简版）：主开关 + 全模型分组列表 + 场景描述 + 内联进度 + 文件夹选择器。
// 替代原 LocalModelSection + <LocalAsr embedded /> 的全部功能，
// 隐藏引擎名 / alias / 镜像源 / 运行时 / 路径等技术细节。
// macOS 仍然使用 LocalModelSection（保留 CodingAgent / ClaudeConsole 等）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Btn, Pill, Collapsible } from '../_atoms';
import { SettingRow, Toggle, SectionTitle } from './shared';
import { FoundryPrepareProgressBlock, DownloadProgressBlock } from '../LocalAsr/components';
import { useHotkeySettings } from '../../state/HotkeySettingsContext';
import { isTauri } from '../../lib/ipc';
import { setActiveAsrProvider } from '../../lib/ipc';
import {
  getSherpaOnnxAsrCatalog,
  getSherpaOnnxAsrStatus,
  getLocalAsrStorageSettings,
  setLocalAsrModelsBaseDir,
  setSherpaOnnxAsrModel,
  downloadSherpaOnnxAsrModel,
  prepareSherpaOnnxAsr,
  cancelSherpaOnnxAsrDownload,
  cancelSherpaOnnxAsrPrepare,
  deleteSherpaOnnxAsrModel,
  revealLocalAsrModelsRoot,
  fetchSherpaOnnxAsrRemoteInfo,
  type SherpaOnnxCatalogModel,
  type FoundryPrepareProgress,
  type SherpaPrepareProgress,
  type LocalAsrDownloadProgress,
} from '../../lib/localAsr';
import type { AsrPresetId } from './shared';

// ── 全模型列表（按使用场景分组）─────────────────────────────────
interface ModelEntry {
  id: string;
  nameKey: string;
  descKey: string;
  langKey: string;
  engine: 'sherpa';
  alias: string;
  providerId: AsrPresetId;
  group: 'chinese' | 'multilingual' | 'lightweight';
  recommended?: boolean;
  experimental?: boolean;
  streaming?: boolean;
  approximateSizeMb?: number;
}

const PREFIX = 'settings.advanced.simplified.';

const ALL_MODELS: ModelEntry[] = [
  // ── 中文场景 ──
  {
    id: 'sense-voice',
    nameKey: `${PREFIX}modelSenseVoiceSmall`,
    descKey: `${PREFIX}modelSenseVoiceSmallDesc`,
    langKey: `${PREFIX}modelSenseVoiceSmallLang`,
    engine: 'sherpa',
    alias: 'sense-voice-small-zh',
    providerId: 'sherpa-onnx-local',
    group: 'chinese',
    recommended: true,
    approximateSizeMb: 228,
  },
  {
    id: 'paraformer',
    nameKey: `${PREFIX}modelParaformerZh`,
    descKey: `${PREFIX}modelParaformerZhDesc`,
    langKey: `${PREFIX}modelParaformerZhLang`,
    engine: 'sherpa',
    alias: 'paraformer-zh',
    providerId: 'sherpa-onnx-local',
    group: 'chinese',
    approximateSizeMb: 220,
  },
  {
    id: 'paraformer-streaming',
    nameKey: `${PREFIX}modelParaformerStreamingZh`,
    descKey: `${PREFIX}modelParaformerStreamingZhDesc`,
    langKey: `${PREFIX}modelParaformerStreamingZhLang`,
    engine: 'sherpa',
    alias: 'paraformer-streaming-zh',
    providerId: 'sherpa-onnx-local',
    group: 'chinese',
    experimental: true,
    streaming: true,
    approximateSizeMb: 226,
  },
  // ── 多语言场景 ──
  {
    id: 'whisper-multi',
    nameKey: `${PREFIX}modelWhisperSmallMulti`,
    descKey: `${PREFIX}modelWhisperSmallMultiDesc`,
    langKey: `${PREFIX}modelWhisperSmallMultiLang`,
    engine: 'sherpa',
    alias: 'whisper-small-multi',
    providerId: 'sherpa-onnx-local',
    group: 'multilingual',
    approximateSizeMb: 358,
  },
  {
    id: 'qwen3-asr',
    nameKey: `${PREFIX}modelQwen3Asr`,
    descKey: `${PREFIX}modelQwen3AsrDesc`,
    langKey: `${PREFIX}modelQwen3AsrLang`,
    engine: 'sherpa',
    alias: 'qwen3-asr-0.6b-int8',
    providerId: 'sherpa-onnx-local',
    group: 'multilingual',
    experimental: true,
  },
  {
    id: 'whisper-large-v3',
    nameKey: `${PREFIX}modelWhisperLargeV3`,
    descKey: `${PREFIX}modelWhisperLargeV3Desc`,
    langKey: `${PREFIX}modelWhisperLargeV3Lang`,
    engine: 'sherpa',
    alias: 'whisper-large-v3-multi',
    providerId: 'sherpa-onnx-local',
    group: 'multilingual',
    approximateSizeMb: 1775,
  },
  // ── 轻量 / 实验性 ──
  {
    id: 'zipformer',
    nameKey: `${PREFIX}modelZipformerStreaming`,
    descKey: `${PREFIX}modelZipformerStreamingDesc`,
    langKey: `${PREFIX}modelZipformerStreamingLang`,
    engine: 'sherpa',
    alias: 'zipformer-bilingual-zh-en-streaming',
    providerId: 'sherpa-onnx-local',
    group: 'lightweight',
    experimental: true,
    streaming: true,
    approximateSizeMb: 90,
  },
  {
    id: 'zipformer-small-ctc',
    nameKey: `${PREFIX}modelZipformerSmallCtcZh`,
    descKey: `${PREFIX}modelZipformerSmallCtcZhDesc`,
    langKey: `${PREFIX}modelZipformerSmallCtcZhLang`,
    engine: 'sherpa',
    alias: 'zipformer-small-ctc-zh-streaming',
    providerId: 'sherpa-onnx-local',
    group: 'lightweight',
    experimental: true,
    streaming: true,
    approximateSizeMb: 25,
  },
];

const GROUP_ORDER = ['chinese', 'multilingual', 'lightweight'] as const;
const GROUP_I18N: Record<string, string> = {
  chinese: `${PREFIX}groupChinese`,
  multilingual: `${PREFIX}groupMultilingual`,
  lightweight: `${PREFIX}groupLightweight`,
};

const AUTO_MIRROR = 'hf-mirror';

export function OfflineRecognitionSection() {
  const { t } = useTranslation();
  const { prefs, updatePrefs } = useHotkeySettings();

  const activeProvider = (prefs?.activeAsrProvider ?? 'volcengine') as string;
  const isOffline = prefs?.offlineEnabled ?? true;

  // ── catalogs & status ──
  const [sherpaCatalog, setSherpaCatalog] = useState<SherpaOnnxCatalogModel[]>([]);
  const [sherpaStatus, setSherpaStatus] = useState<{ activeModel: string | null; loadedModelId: string | null } | null>(null);

  // ── progress ──
  const [sherpaDownloadProgress, setSherpaDownloadProgress] = useState<Record<string, LocalAsrDownloadProgress>>({});
  const [sherpaPrepareProgress, setSherpaPrepareProgress] = useState<SherpaPrepareProgress | null>(null);

  // ── remote sizes ──
  const [remoteSizes, setRemoteSizes] = useState<Record<string, { totalBytes: number; loading: boolean }>>({});

  // ── busy / error ──
  const [busyModelId, setBusyModelId] = useState<string | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [storagePath, setStoragePath] = useState('');
  const [storageBusy, setStorageBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [pendingUninstall, setPendingUninstall] = useState<ModelEntry | null>(null);
  const failedModelRef = useRef<ModelEntry | null>(null);

  const refreshTimerRef = useRef<number | null>(null);

  // ── grouped models ──
  const groupedModels = useMemo(() => {
    const groups: Record<string, ModelEntry[]> = {};
    for (const m of ALL_MODELS) {
      (groups[m.group] ??= []).push(m);
    }
    return groups;
  }, []);

  // ── refresh catalogs & status ──
  const refreshAll = useCallback(async () => {
    const [scRes, ssRes] = await Promise.allSettled([
      getSherpaOnnxAsrCatalog(),
      getSherpaOnnxAsrStatus(),
    ]);
    if (scRes.status === 'fulfilled') setSherpaCatalog(scRes.value);
    if (ssRes.status === 'fulfilled') setSherpaStatus(ssRes.value);
  }, []);

  // load on mount
  useEffect(() => {
    if (!isTauri) return;
    void refreshAll();
    void getLocalAsrStorageSettings().then(s => setStoragePath(s.modelsRootDir)).catch(() => {});

    // 获取所有 Sherpa 模型的远端大小
    const fetchRemoteSizes = async () => {
      for (const m of ALL_MODELS) {
        if (m.engine !== 'sherpa') continue;
        try {
          setRemoteSizes(prev => ({ ...prev, [m.alias]: { totalBytes: 0, loading: true } }));
          const info = await fetchSherpaOnnxAsrRemoteInfo(m.alias, 'hf-mirror');
          setRemoteSizes(prev => ({ ...prev, [m.alias]: { totalBytes: info.totalBytes, loading: false } }));
        } catch {
          setRemoteSizes(prev => ({ ...prev, [m.alias]: { totalBytes: 0, loading: false } }));
        }
      }
    };
    void fetchRemoteSizes();
  }, [refreshAll]);

  // ── Tauri event: Sherpa download progress ──
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const off = await listen<LocalAsrDownloadProgress>(
        'sherpa-onnx-asr-download-progress',
        (e) => {
          const p = e.payload;
          setSherpaDownloadProgress(prev => ({ ...prev, [p.modelId]: p }));
          if (p.phase === 'finished' || p.phase === 'cancelled' || p.phase === 'failed') {
            setCancelRequested(false);
            if (p.phase === 'finished') {
              // download done → start prepare
              void prepareSherpaOnnxAsr(p.modelId).catch(() => {
                setBusyModelId(null);
                setDownloadError(t('settings.advanced.simplified.downloadFailed'));
              });
            } else {
              setBusyModelId(null);
            }
          }
        },
      );
      if (cancelled) off(); else unlisten = off;
    })().catch(() => {});
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [t]);

  // ── Tauri event: Sherpa prepare progress ──
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const off = await listen<SherpaPrepareProgress>(
        'sherpa-onnx-asr-prepare-progress',
        (e) => {
          const p = e.payload;
          setSherpaPrepareProgress(p);
          if (p.phase === 'finished' || p.phase === 'failed') {
            if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = window.setTimeout(() => {
              void refreshAll();
              setBusyModelId(null);
              setCancelRequested(false);
            }, 300);
          }
        },
      );
      if (cancelled) off(); else unlisten = off;
    })().catch(() => {});
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    };
  }, [refreshAll]);

  // ── toggle offline ──
  const onToggle = async (next: boolean) => {
    if (!prefs) return;
    setDownloadError(null);
    try {
      const isLocal = prefs.activeAsrProvider === 'sherpa-onnx-local';
      if (next) {
        const lastCloud = isLocal
          ? (prefs.lastCloudAsrProvider || 'volcengine')
          : prefs.activeAsrProvider;

        // If the currently active sherpa model isn't downloaded, auto-select
        // the recommended model (sense-voice) so offline mode works immediately.
        const activeSherpaModel = sherpaStatus?.activeModel;
        const isSherpaModelCached = activeSherpaModel
          ? sherpaCatalog.find(c => c.alias === activeSherpaModel)?.cached
          : false;
        if (!isSherpaModelCached) {
          const recommended = ALL_MODELS.find(m => m.recommended && m.engine === 'sherpa');
          if (recommended) {
            await setSherpaOnnxAsrModel(recommended.alias);
          }
        }

        await updatePrefs(current => ({
          ...current,
          offlineEnabled: true,
          lastCloudAsrProvider: lastCloud,
          ...(!isLocal ? { activeAsrProvider: 'sherpa-onnx-local' } : {}),
        }));
        if (!isLocal) await setActiveAsrProvider('sherpa-onnx-local');
        await refreshAll();
      } else {
        const fallback = prefs.lastCloudAsrProvider || 'volcengine';
        await updatePrefs(current => ({
          ...current,
          offlineEnabled: false,
          ...(isLocal ? { activeAsrProvider: fallback } : {}),
        }));
        if (isLocal) await setActiveAsrProvider(fallback);
      }
    } catch (err) {
      console.error('[OfflineSection] toggle failed', err);
    }
  };

  // ── model helpers ──
  const getModelCatalog = (m: ModelEntry) => {
    return sherpaCatalog.find(c => c.alias === m.alias);
  };

  const isModelActive = (m: ModelEntry) => {
    return sherpaStatus?.activeModel === m.alias && activeProvider === 'sherpa-onnx-local';
  };

  const isModelDownloaded = (m: ModelEntry) => {
    const cat = getModelCatalog(m);
    if (!cat) return false;
    return cat.cached;
  };

  const isModelBusy = (m: ModelEntry) => busyModelId === m.id;

  const getModelSizeMb = (m: ModelEntry): number | null => {
    const cat = getModelCatalog(m);
    const remoteSize = remoteSizes[m.alias];
    return cat?.fileSizeMb
      ?? (remoteSize?.totalBytes ? Math.round(remoteSize.totalBytes / 1024 / 1024) : null)
      ?? m.approximateSizeMb
      ?? null;
  };

  // ── uninstall model ──
  const onUninstallModel = (m: ModelEntry) => {
    setPendingUninstall(m);
  };

  const performUninstall = async () => {
    const m = pendingUninstall;
    if (!m) return;
    setPendingUninstall(null);
    setBusyModelId(m.id);
    try {
      await deleteSherpaOnnxAsrModel(m.alias);
      await refreshAll();
    } catch (err) {
      console.error('[OfflineSection] uninstall failed', err);
    } finally {
      setBusyModelId(null);
    }
  };

  // ── download & install ──
  const onDownloadInstall = async (m: ModelEntry) => {
    console.log(`[OfflineSection] onDownloadInstall start: alias=${m.alias}`);
    setBusyModelId(m.id);
    setCancelRequested(false);
    setDownloadError(null);
    failedModelRef.current = m;
    try {
      console.log(`[OfflineSection] downloadSherpaOnnxAsrModel(${m.alias}, ${AUTO_MIRROR})...`);
      await downloadSherpaOnnxAsrModel(m.alias, AUTO_MIRROR);
      console.log(`[OfflineSection] download started, waiting for progress events`);
      // prepare triggered by the download-finished event listener
    } catch (err) {
      console.error('[OfflineSection] download/install failed:', err);
      setBusyModelId(null);
      setDownloadError(String(err));
    }
  };

  // ── switch active model (already downloaded) ──
  const onActivate = async (m: ModelEntry) => {
    console.log(`[OfflineSection] onActivate start: engine=${m.engine} alias=${m.alias} provider=${m.providerId}`);
    setBusyModelId(m.id);
    setDownloadError(null);
    try {
      // setActiveAsrProvider MUST run BEFORE updatePrefs:
      // updatePrefs → persist_settings syncs the vault with the new provider,
      // which would cause setActiveAsrProvider to early-return and skip
      // runtime release for cross-engine switches.
      console.log(`[OfflineSection] setActiveAsrProvider(${m.providerId})...`);
      await setActiveAsrProvider(m.providerId);
      console.log(`[OfflineSection] setActiveAsrProvider OK`);

      // Include model alias in updatePrefs so it's written atomically.
      // Without this, the separate setXxxModel call writes to backend prefs,
      // but the subsequent updatePrefs sends the full stale frontend prefs
      // (with old alias) via set_settings, clobbering the model change.
      console.log(`[OfflineSection] updatePrefs provider→${m.providerId} model→${m.alias}...`);
      await updatePrefs(current => ({
        ...current,
        activeAsrProvider: m.providerId,
        sherpaOnnxModel: m.alias,
      }));
      console.log(`[OfflineSection] updatePrefs OK`);

      // Optimistic update: immediately reflect the new active model in the UI
      // so the user doesn't see a flash while refreshAll is still loading.
      setSherpaStatus(prev => prev ? { ...prev, activeModel: m.alias } : prev);

      console.log(`[OfflineSection] refreshAll...`);
      await refreshAll();
      console.log(`[OfflineSection] refreshAll OK, activate complete`);
    } catch (err) {
      console.error('[OfflineSection] activate failed:', err);
      setDownloadError(String(err));
    } finally {
      setBusyModelId(null);
    }
  };

  // ── cancel ──
  const onCancel = async (m: ModelEntry) => {
    setCancelRequested(true);
    try {
      await cancelSherpaOnnxAsrDownload(m.alias).catch(() => {});
      await cancelSherpaOnnxAsrPrepare().catch(() => {});
    } catch {
      // swallow
    }
    setSherpaDownloadProgress(prev => {
      const cur = prev[m.alias];
      if (!cur) return prev;
      return { ...prev, [m.alias]: { ...cur, phase: 'cancelled' as const } };
    });
    setBusyModelId(null);
    setCancelRequested(false);
  };

  // ── retry failed download ──
  const onRetry = () => {
    const m = failedModelRef.current;
    if (m) void onDownloadInstall(m);
    setDownloadError(null);
  };

  // ── storage folder picker ──
  const onChooseFolder = async () => {
    setStorageBusy(true);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const dir = await open({ directory: true, title: t('settings.advanced.simplified.storageChoose') });
      if (dir) {
        const result = await setLocalAsrModelsBaseDir(dir as string);
        setStoragePath(result.modelsRootDir);
      }
    } catch (err) {
      console.error('[OfflineSection] choose folder failed', err);
    } finally {
      setStorageBusy(false);
    }
  };

  if (!prefs) return null;

  // ── styles ──
  const modelCardStyle: React.CSSProperties = {
    padding: '12px 14px',
    borderRadius: 10,
    border: '0.5px solid var(--ol-line-soft)',
    background: 'var(--ol-surface)',
  };

  const groupHeaderStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--ol-ink-2)',
    padding: '8px 0 4px',
  };

  return (
    <>
      {/* ─── 卸载确认弹窗 ─── */}
      {pendingUninstall && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.32)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={e => {
            if (e.target === e.currentTarget && busyModelId === null) setPendingUninstall(null);
          }}>
          <Card
            style={{
              background: 'rgba(255, 80, 60, 0.08)',
              border: '1px solid rgba(220, 60, 40, 0.4)',
              maxWidth: 360,
              width: '100%',
            }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#B5321A', marginBottom: 6 }}>
              {t('settings.advanced.simplified.uninstallConfirmTitle', '确认卸载')}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ol-ink-2)', lineHeight: 1.6, marginBottom: 10 }}>
              {t('settings.advanced.simplified.uninstallConfirm', { name: t(pendingUninstall.nameKey) })}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn variant="ghost" size="sm" disabled={busyModelId !== null} onClick={() => setPendingUninstall(null)}>
                {t('common.cancel')}
              </Btn>
              <Btn
                variant="primary"
                size="sm"
                disabled={busyModelId !== null}
                onClick={() => void performUninstall()}>
                {t('settings.advanced.simplified.uninstall')}
              </Btn>
            </div>
          </Card>
        </div>
      )}

      <Card>
      <SectionTitle>{t('settings.advanced.simplified.offlineTitle')}</SectionTitle>

      {/* ── 首次引导（关闭时显示详细说明）── */}
      {!isOffline && (
        <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--ol-surface)', border: '0.5px solid var(--ol-line-soft)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>
            {t(`${PREFIX}whatIsOfflineTitle`)}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ol-ink-3)', lineHeight: 1.6 }}>
            {t(`${PREFIX}whatIsOfflineBody`)}
          </div>
        </div>
      )}

      {/* ── 主开关 ── */}
      <SettingRow label={t('settings.advanced.simplified.offlineToggleLabel')}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Toggle on={isOffline} onToggle={onToggle} />
        </div>
      </SettingRow>

      {isOffline && (
        <div style={{ fontSize: 11.5, color: 'var(--ol-ok)', padding: '6px 0 10px' }}>
          {t('settings.advanced.simplified.offlineActiveHint')}
        </div>
      )}

      {/* ── 模型列表（按场景分组）── */}
      {isOffline && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {GROUP_ORDER.map((groupKey, groupIdx) => {
            const models = groupedModels[groupKey];
            if (!models?.length) return null;
            const isLightweight = groupKey === 'lightweight';

            const groupContent = (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {!isLightweight && (
                  <div style={groupHeaderStyle}>
                    {t(GROUP_I18N[groupKey])}
                  </div>
                )}
                {models.map(m => {
                  const downloaded = isModelDownloaded(m);
                  const active = isModelActive(m);
                  const busy = isModelBusy(m);
                  const sizeMb = getModelSizeMb(m);
                  const sherpaDlProgress = m.engine === 'sherpa' ? sherpaDownloadProgress[m.alias] : undefined;
                  const sherpaPrepProgress = m.engine === 'sherpa' ? sherpaPrepareProgress : null;
                  const isDownloading = sherpaDlProgress?.phase === 'progress' || sherpaDlProgress?.phase === 'started';
                  const isInstalling = m.engine === 'sherpa' && sherpaPrepProgress && sherpaPrepProgress.modelAlias === m.alias;
                  const isBusy = isDownloading || isInstalling;

                  return (
                    <div key={m.id} style={modelCardStyle}>
                      {/* header row: badges + name + size | action buttons */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {m.recommended && (
                            <Pill tone="ok" size="sm">{t(`${PREFIX}recommended`)}</Pill>
                          )}
                          {m.experimental && (
                            <Pill tone="violet" size="sm">{t(`${PREFIX}experimental`)}</Pill>
                          )}
                          {m.streaming && (
                            <Pill tone="blue" size="sm">{t(`${PREFIX}streaming`)}</Pill>
                          )}
                          <span style={{ fontSize: 13, fontWeight: 600 }}>
                            {t(m.nameKey)}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--ol-ink-4)' }}>
                            {sizeMb != null
                              ? t(`${PREFIX}approxSize`, { mb: sizeMb })
                              : t(`${PREFIX}sizeUnknown`)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          {isBusy ? (
                            <Btn variant="ghost" size="sm" disabled={cancelRequested} onClick={() => void onCancel(m)}>
                              {t(`${PREFIX}cancelDownload`)}
                            </Btn>
                          ) : active && downloaded ? (
                            <Pill tone="blue" size="sm">{t(`${PREFIX}inUse`)}</Pill>
                          ) : downloaded ? (
                            <Btn variant="blue" size="sm" onClick={() => void onActivate(m)}>
                              {t(`${PREFIX}switchTo`)}
                            </Btn>
                          ) : (
                            <Btn variant="blue" size="sm" onClick={() => void onDownloadInstall(m)}>
                              {t(`${PREFIX}downloadInstall`)}
                            </Btn>
                          )}
                          {downloaded && !isBusy && (
                            <Btn variant="ghost" size="sm" style={{ color: 'var(--ol-ink-3)' }} onClick={() => void onUninstallModel(m)}>
                              {t(`${PREFIX}uninstall`)}
                            </Btn>
                          )}
                        </div>
                      </div>

                      {/* scenario description */}
                      <div style={{ fontSize: 11.5, color: 'var(--ol-ink-3)', marginTop: 4, lineHeight: 1.5 }}>
                        {t(m.descKey)}
                      </div>

                      {/* supported languages */}
                      <div style={{ fontSize: 11, color: 'var(--ol-ink-4)', marginTop: 2 }}>
                        {t(m.langKey)}
                      </div>

                      {/* download progress bar */}
                      {isDownloading && sherpaDlProgress && (
                        <div style={{ marginTop: 10 }}>
                          <DownloadProgressBlock
                            progress={sherpaDlProgress}
                            cancelRequested={cancelRequested}
                          />
                        </div>
                      )}

                      {/* sherpa prepare progress */}
                      {isInstalling && m.engine === 'sherpa' && sherpaPrepProgress && (
                        <div style={{ marginTop: 10 }}>
                          <FoundryPrepareProgressBlock
                            progress={sherpaPrepProgress as unknown as FoundryPrepareProgress}
                            modelCached={downloaded}
                            cancelRequested={cancelRequested}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );

            // Lightweight group uses Collapsible (default collapsed)
            if (isLightweight) {
              return (
                <div key={groupKey} style={{ marginTop: groupIdx > 0 ? 4 : 0 }}>
                  <Collapsible
                    title={<span style={{ fontSize: 12, fontWeight: 600 }}>{t(GROUP_I18N[groupKey])}</span>}
                    defaultOpen={false}
                  >
                    <div style={{ padding: '8px 14px 10px' }}>
                      {groupContent}
                    </div>
                  </Collapsible>
                </div>
              );
            }

            return (
              <div key={groupKey} style={{ marginTop: groupIdx > 0 ? 8 : 0 }}>
                {groupContent}
              </div>
            );
          })}
        </div>
      )}

      {/* ── error with retry ── */}
      {downloadError && (
        <div style={{
          marginTop: 12,
          padding: '10px 12px',
          borderRadius: 8,
          background: 'rgba(255, 80, 80, 0.06)',
          border: '0.5px solid var(--ol-line-soft)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ol-err)', marginBottom: 3 }}>
            {t(`${PREFIX}downloadErrorTitle`)}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ol-ink-3)', lineHeight: 1.5, marginBottom: 8 }}>
            {t(`${PREFIX}downloadErrorHint`)}
          </div>
          <Btn variant="ghost" size="sm" onClick={onRetry}>
            {t(`${PREFIX}downloadErrorRetry`)}
          </Btn>
        </div>
      )}

      {/* ── 模型存储位置 ── */}
      <div style={{ marginTop: 20, borderTop: '0.5px solid var(--ol-line)', paddingTop: 14 }}>
        <SettingRow label={t('settings.advanced.simplified.storageTitle')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
            {storagePath && (
              <span
                style={{ fontSize: 11, color: 'var(--ol-ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200, cursor: 'pointer' }}
                title={storagePath}
                onClick={() => void revealLocalAsrModelsRoot()}
              >
                {storagePath}
              </span>
            )}
            <Btn variant="ghost" size="sm" disabled={storageBusy} onClick={onChooseFolder}>
              {storageBusy
                ? t('settings.advanced.simplified.storageBusy')
                : t('settings.advanced.simplified.storageChoose')}
            </Btn>
          </div>
        </SettingRow>
      </div>
    </Card>
    </>
  );
}
