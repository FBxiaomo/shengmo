// 高级 → 离线语音识别：一个主开关 + 引擎选择下拉 + 模型下载管理。
// 原三条引擎开关（Qwen3 / Foundry / sherpa-onnx）合并为统一入口，
// 按平台自动过滤不可用引擎。

import { useEffect, useRef, useState } from 'react';
import type { PlatformCapabilities } from '../../lib/types';
import { useTranslation } from 'react-i18next';
import { LocalAsr } from '../LocalAsr';
import { detectOS } from '../../components/WindowChrome';
import { getPlatformCapabilities } from '../../lib/platform';
import { setActiveAsrProvider } from '../../lib/ipc';
import { getSherpaOnnxAsrCatalog, getFoundryLocalAsrCatalog, SHERPA_ONNX_ASR_MODELS, type SherpaOnnxCatalogModel } from '../../lib/localAsr';
import { useHotkeySettings } from '../../state/HotkeySettingsContext';
import { Btn, Card } from '../_atoms';
import { SelectLite } from '../../components/ui/SelectLite';
import { SettingRow, Toggle, inputStyle, type AsrPresetId } from './shared';

// 各平台可用的本地引擎选项
type LocalEngineId = 'local-qwen3' | 'foundry-local-whisper' | 'sherpa-onnx-local';

const ENGINE_OPTIONS_MAC: Array<{ id: LocalEngineId; labelKey: string }> = [
  { id: 'local-qwen3', labelKey: 'settings.providers.presets.asrLocalQwen3' },
];

const ENGINE_OPTIONS_WIN: Array<{ id: LocalEngineId; labelKey: string }> = [
  { id: 'foundry-local-whisper', labelKey: 'settings.providers.presets.asrFoundryLocalWhisper' },
  { id: 'sherpa-onnx-local', labelKey: 'settings.providers.presets.asrSherpaOnnxLocal' },
];

export function LocalModelSection() {
  const { t } = useTranslation();
  const { prefs, updatePrefs } = useHotkeySettings();
  const os = detectOS();
  const isMac = os === 'mac';
  const isWin = os === 'win';
  const [platformCaps, setPlatformCaps] = useState<PlatformCapabilities | null>(null);
  const [hasAnyDownloadedModel, setHasAnyDownloadedModel] = useState(false);
  const [sherpaCatalog, setSherpaCatalog] = useState<SherpaOnnxCatalogModel[]>([]);

  useEffect(() => {
    void getPlatformCapabilities().then(setPlatformCaps);
  }, []);

  // 查询是否有任何本地模型已下载
  useEffect(() => {
    const checkDownloadedModels = async () => {
      try {
        if (isWin) {
          const [sherpaCat, foundryCatalog] = await Promise.all([
            getSherpaOnnxAsrCatalog(),
            getFoundryLocalAsrCatalog(),
          ]);
          setSherpaCatalog(sherpaCat);
          const hasSherpa = sherpaCat.some(m => m.cached);
          const hasFoundry = foundryCatalog.some(m => m.cached);
          setHasAnyDownloadedModel(hasSherpa || hasFoundry);
        } else if (isMac) {
          // macOS 使用 local-qwen3，暂不检查（或可扩展）
          setHasAnyDownloadedModel(false);
        }
      } catch (err) {
        console.warn('[settings] failed to check downloaded models', err);
        setHasAnyDownloadedModel(false);
      }
    };
    void checkDownloadedModels();
  }, [isWin, isMac]);

  const platformSupported = platformCaps?.supportsLocalAsr === true;
  const switchSeqRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<AsrPresetId | null>(null);

  const activeAsrProvider = (prefs?.activeAsrProvider ?? 'volcengine') as AsrPresetId;
  const isOnLocalQwen3 = activeAsrProvider === 'local-qwen3';
  const isOnFoundry = activeAsrProvider === 'foundry-local-whisper';
  const isOnSherpaOnnx = activeAsrProvider === 'sherpa-onnx-local';
  const isOnAnyLocal = isOnLocalQwen3 || isOnFoundry || isOnSherpaOnnx;

  // 当前选中的引擎（下拉框的值）
  const currentEngine: LocalEngineId = isOnLocalQwen3
    ? 'local-qwen3'
    : isOnFoundry
      ? 'foundry-local-whisper'
      : isOnSherpaOnnx
        ? 'sherpa-onnx-local'
        : (isMac ? 'local-qwen3' : 'foundry-local-whisper');

  const engineOptions = isMac ? ENGINE_OPTIONS_MAC : ENGINE_OPTIONS_WIN;

  const requestEnable = (target: AsrPresetId) => {
    setPendingTarget(target);
  };

  const performSwitch = async (target: AsrPresetId) => {
    setBusy(true);
    const seq = ++switchSeqRef.current;
    try {
      await setActiveAsrProvider(target);
      if (seq !== switchSeqRef.current) return;
      if (prefs) {
        await updatePrefs({ ...prefs, activeAsrProvider: target });
      }
    } catch (err) {
      console.error('[settings] switch local ASR provider failed', err);
    } finally {
      if (seq === switchSeqRef.current) {
        setBusy(false);
        setPendingTarget(null);
      }
    }
  };

  const pendingNameKey =
    pendingTarget === 'local-qwen3' ? 'asrLocalQwen3'
    : pendingTarget === 'foundry-local-whisper' ? 'asrFoundryLocalWhisper'
    : pendingTarget === 'sherpa-onnx-local' ? 'asrSherpaOnnxLocal'
    : null;

  // 主开关切换
  const onMainToggle = (next: boolean) => {
    if (busy || pendingTarget !== null) return;
    if (next) {
      // 开启：使用当前选中引擎（或平台默认引擎）请求启用
      requestEnable(currentEngine);
    } else {
      // 关闭：切回云端
      void performSwitch('volcengine');
    }
  };

  // 引擎下拉切换
  const onEngineChange = (nextId: string) => {
    if (busy || pendingTarget !== null) return;
    const target = nextId as AsrPresetId;
    if (isOnAnyLocal) {
      // 已在本地模式下，直接切换引擎（需要确认）
      requestEnable(target);
    } else {
      // 不在本地模式，启用新引擎
      requestEnable(target);
    }
  };

  return (
    <>
      {/* ─── 确认 modal ────────────────────────────────────────────── */}
      {pendingTarget && pendingNameKey && (
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
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setPendingTarget(null);
          }}>
          <Card
            style={{
              background: 'rgba(255, 188, 60, 0.12)',
              border: '1px solid rgba(220, 110, 0, 0.55)',
              maxWidth: 360,
              width: '100%',
            }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#A04500', marginBottom: 6 }}>
              {t('settings.advanced.confirmEnableLocalTitle')}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ol-ink-2)', lineHeight: 1.6, marginBottom: 10 }}>
              {t('settings.advanced.confirmEnableLocalBody', {
                target: t(`settings.providers.presets.${pendingNameKey}`),
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn variant="ghost" size="sm" disabled={busy} onClick={() => setPendingTarget(null)}>
                {t('common.cancel')}
              </Btn>
              <Btn
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => void performSwitch(pendingTarget)}>
                {t('settings.advanced.confirm')}
              </Btn>
            </div>
          </Card>
        </div>
      )}

      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>
              {t('settings.advanced.localAsrTitle')}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ol-ink-4)', marginTop: 4, lineHeight: 1.55 }}>
              {t('settings.advanced.localAsrDesc')}
            </div>
          </div>
        </div>

        {!platformSupported ? (
          <div style={{ fontSize: 12.5, color: 'var(--ol-ink-3)', lineHeight: 1.6, padding: '8px 0' }}>
            {t('settings.advanced.platformNotSupported')}
          </div>
        ) : (
          <>
            {/* 主开关 */}
            <SettingRow label={t('settings.advanced.localAsrToggleLabel', '启用离线语音识别')}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                <Toggle
                  on={isOnAnyLocal}
                  onToggle={onMainToggle}
                  disabled={!hasAnyDownloadedModel && !isOnAnyLocal}
                />
              </div>
            </SettingRow>

            {/* 引擎选择（仅在开启或有多个选项时显示） */}
            {isOnAnyLocal && engineOptions.length > 1 && (
              <SettingRow label={t('settings.advanced.localAsrEngineLabel', '识别引擎')}>
                <SelectLite
                  value={currentEngine}
                  onChange={onEngineChange}
                  options={engineOptions.map(opt => ({
                    value: opt.id,
                    label: t(opt.labelKey),
                  }))}
                  ariaLabel={t('settings.advanced.localAsrEngineLabel', '识别引擎')}
                  style={{ ...inputStyle, width: '100%', maxWidth: 220 }}
                />
              </SettingRow>
            )}

            {/* 当前引擎状态提示 */}
            {isOnAnyLocal ? (
              <div style={{
                fontSize: 11,
                color: 'var(--ol-ok, #2a8)',
                lineHeight: 1.5,
                padding: '6px 0 0',
              }}>
                {t('settings.advanced.localAsrActiveHint', '当前使用本地引擎，关闭开关可切回云端识别')}
              </div>
            ) : !hasAnyDownloadedModel ? (
              <div style={{
                fontSize: 11,
                color: 'var(--ol-ink-4)',
                lineHeight: 1.5,
                padding: '6px 0 0',
              }}>
                {t('settings.advanced.localAsrNoModelHint', '请先下载模型后再启用离线语音识别')}
              </div>
            ) : null}
          </>
        )}

        {/* 模型尺寸摘要（仅在没有已下载模型时显示） */}
        {platformSupported && !hasAnyDownloadedModel && isWin && sherpaCatalog.length > 0 && (
          <div style={{
            marginTop: 12,
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.03)',
            fontSize: 12,
            color: 'var(--ol-ink-3)',
            lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>
              {t('settings.advanced.modelSizeSummary', '模型存储空间预估')}
            </div>
            {SHERPA_ONNX_ASR_MODELS.map(model => {
              const catalog = sherpaCatalog.find(m => m.alias === model.alias);
              const sizeMb = catalog?.fileSizeMb;
              return sizeMb ? (
                <div key={model.alias}>
                  • {t(model.labelKey)}: ~{sizeMb} MB
                </div>
              ) : null;
            })}
          </div>
        )}

        {/* 模型下载 / 管理 */}
        {platformSupported && (
          <div style={{ marginTop: 16, borderTop: '0.5px solid var(--ol-line)', paddingTop: 16 }}>
            <LocalAsr embedded />
          </div>
        )}
      </Card>
    </>
  );
}
