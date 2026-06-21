// 快捷键设置：开始/停止、翻译、问答、切风格、唤起 App、以及只读取消/确认提示。

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ShortcutRecorder } from '../../components/ShortcutRecorder';
import { defaultLessComputerShortcut, defaultOpenAppShortcut, defaultQaShortcut, defaultSwitchStyleShortcut, defaultToggleMiniShortcut } from '../../lib/hotkey';
import {
  setDictationHotkey,
  setOpenAppHotkey,
  setQaHotkey,
  setSwitchStyleHotkey,
  setToggleMiniHotkey,
  setTranslationHotkey,
} from '../../lib/ipc';
import { getPlatformCapabilities } from '../../lib/platform';
import type { PlatformCapabilities } from '../../lib/types';
import { useHotkeySettings } from '../../state/HotkeySettingsContext';
import { Card } from '../_atoms';
import { SettingRow } from './shared';
import { detectOS } from '../../components/WindowChrome';

const enableBtnStyle: CSSProperties = {
  alignSelf: 'flex-start',
  fontSize: 12,
  padding: '5px 14px',
  background: 'var(--ol-blue)',
  color: '#fff',
  border: 0,
  borderRadius: 6,
  fontFamily: 'inherit',
  fontWeight: 500,
  cursor: 'pointer',
};

export function ShortcutsSection() {
  const { t } = useTranslation();
  const os = detectOS();
  const { prefs, hotkey, capability, updatePrefs: savePrefs } = useHotkeySettings();
  const [platformCaps, setPlatformCaps] = useState<PlatformCapabilities | null>(null);

  useEffect(() => {
    void getPlatformCapabilities().then(setPlatformCaps);
  }, []);

  if (!prefs || !hotkey || !capability) {
    return (
      <Card>
        <div style={{ fontSize: 12, color: 'var(--ol-ink-4)' }}>{t('common.loading')}</div>
      </Card>
    );
  }

  if (platformCaps && !platformCaps.supportsDesktopHotkey) {
    return null;
  }

  const readonlyRows: Array<[string, string]> = [
    [t('settings.shortcuts.cancel'), 'Esc'],
    ...(os !== 'linux' ? [[t('settings.shortcuts.confirm'), t('settings.shortcuts.confirmHint')]] as Array<[string, string]> : []),
  ];
  return (
    <Card>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t('settings.shortcuts.title')}</div>
      <SettingRow label={t('settings.shortcuts.startStop')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
          <ShortcutRecorder
            value={prefs.dictationHotkey}
            alignRecordButton
            onSave={async binding => {
              await setDictationHotkey(binding);
              await savePrefs(current => ({ ...current, dictationHotkey: binding }));
            }}
          />
          <div style={{ fontSize: 11, color: 'var(--ol-ink-4)' }}>
            {hotkey.mode === 'hold' ? t('hotkey.modeHoldSuffix') : t('hotkey.modeToggleSuffix')}
          </div>
        </div>
      </SettingRow>
      <SettingRow label={t('translation.hotkey.title', 'Translation shortcut')}>
        <ShortcutRecorder
          value={prefs.translationHotkey}
          alignRecordButton
          onSave={async binding => {
            await setTranslationHotkey(binding);
            await savePrefs(current => ({ ...current, translationHotkey: binding }));
          }}
        />
      </SettingRow>
      <SettingRow label={t('selectionAsk.hotkey.title')}>
        {prefs.qaHotkey ? (
          <ShortcutRecorder
            value={prefs.qaHotkey}
            alignRecordButton
            onSave={async binding => {
              await setQaHotkey(binding);
              await savePrefs(current => ({ ...current, qaHotkey: binding }));
            }}
            onDisable={async () => {
              await setQaHotkey(null);
              await savePrefs(current => ({ ...current, qaHotkey: null }));
            }}
          />
        ) : (
          <button
            onClick={async () => {
              const binding = defaultQaShortcut();
              await setQaHotkey(binding);
              await savePrefs(current => ({ ...current, qaHotkey: binding }));
            }}
            style={{ fontSize: 12, padding: '5px 14px', background: 'var(--ol-blue)', color: '#fff', border: 0, borderRadius: 6, fontFamily: 'inherit', fontWeight: 500, cursor: 'default' }}
          >
            {t('selectionAsk.hotkey.enable', 'Enable')}
          </button>
        )}
      </SettingRow>
      <SettingRow label={t('settings.shortcuts.switchStyle')}>
        {prefs.switchStyleHotkey ? (
          <ShortcutRecorder
            value={prefs.switchStyleHotkey}
            alignRecordButton
            onSave={async binding => {
              await setSwitchStyleHotkey(binding);
              await savePrefs(current => ({ ...current, switchStyleHotkey: binding }));
            }}
            onDisable={async () => {
              await setSwitchStyleHotkey(null);
              await savePrefs(current => ({ ...current, switchStyleHotkey: null }));
            }}
          />
        ) : (
          <button
            onClick={async () => {
              const binding = defaultSwitchStyleShortcut();
              await setSwitchStyleHotkey(binding);
              await savePrefs(current => ({ ...current, switchStyleHotkey: binding }));
            }}
            style={enableBtnStyle}
          >
            {t('settings.shortcuts.enable', 'Enable')}
          </button>
        )}
      </SettingRow>
      <SettingRow label={t('settings.shortcuts.openApp')}>
        {prefs.openAppHotkey ? (
          <ShortcutRecorder
            value={prefs.openAppHotkey}
            alignRecordButton
            onSave={async binding => {
              await setOpenAppHotkey(binding);
              await savePrefs(current => ({ ...current, openAppHotkey: binding }));
            }}
            onDisable={async () => {
              await setOpenAppHotkey(null);
              await savePrefs(current => ({ ...current, openAppHotkey: null }));
            }}
          />
        ) : (
          <button
            onClick={async () => {
              const binding = defaultOpenAppShortcut();
              await setOpenAppHotkey(binding);
              await savePrefs(current => ({ ...current, openAppHotkey: binding }));
            }}
            style={enableBtnStyle}
          >
            {t('settings.shortcuts.enable', 'Enable')}
          </button>
        )}
      </SettingRow>
      <SettingRow label={t('settings.shortcuts.toggleMini')}>
        {prefs.toggleMiniHotkey ? (
          <ShortcutRecorder
            value={prefs.toggleMiniHotkey}
            alignRecordButton
            onSave={async binding => {
              await setToggleMiniHotkey(binding);
              await savePrefs(current => ({ ...current, toggleMiniHotkey: binding }));
            }}
            onDisable={async () => {
              await setToggleMiniHotkey(null);
              await savePrefs(current => ({ ...current, toggleMiniHotkey: null }));
            }}
          />
        ) : (
          <button
            onClick={async () => {
              const binding = defaultToggleMiniShortcut();
              await setToggleMiniHotkey(binding);
              await savePrefs(current => ({ ...current, toggleMiniHotkey: binding }));
            }}
            style={enableBtnStyle}
          >
            {t('settings.shortcuts.enable', 'Enable')}
          </button>
        )}
      </SettingRow>
      {os === 'mac' && (
        <SettingRow label={t('settings.codingAgent.title')} desc={t('settings.codingAgent.voiceHotkeyDesc')}>
          {prefs.codingAgentEnabled && prefs.codingAgentVoiceHotkey ? (
            <ShortcutRecorder
              value={prefs.codingAgentVoiceHotkey}
              alignRecordButton
              onSave={async binding => {
                await savePrefs(current => ({ ...current, codingAgentVoiceHotkey: binding }));
              }}
              onDisable={async () => {
                await savePrefs(current => ({ ...current, codingAgentVoiceHotkey: null }));
              }}
            />
          ) : (
            <button
              onClick={() =>
                void savePrefs(current => ({
                  ...current,
                  codingAgentEnabled: true,
                  codingAgentVoiceHotkey: current.codingAgentVoiceHotkey ?? defaultLessComputerShortcut(),
                }))
              }
              style={enableBtnStyle}
            >
              {t('settings.shortcuts.enable', 'Enable')}
            </button>
          )}
        </SettingRow>
      )}
      {readonlyRows.map(([k, v]) => (
        <SettingRow key={k} label={k}>
          <kbd style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', fontSize: 12, fontFamily: 'var(--ol-font-mono)',
            borderRadius: 6, background: 'var(--ol-surface-2)',
            border: '0.5px solid var(--ol-line-strong)',
            boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
            color: 'var(--ol-ink-2)',
          }}>{v}</kbd>
        </SettingRow>
      ))}
    </Card>
  );
}
