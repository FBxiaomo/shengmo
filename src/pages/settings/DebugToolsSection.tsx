// 高级 → 调试工具：折叠栏，展开后仅有「导出错误日志」按钮。
// 录音保留开关和条数输入对普通用户无用，已移除（原逻辑保留在 git 历史中）。

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { exportErrorLog } from '../../lib/ipc';
import { Btn, Card, Collapsible } from '../_atoms';
import { SettingRow } from './shared';

export function DebugToolsSection() {
  const { t } = useTranslation();
  const [exportStatus, setExportStatus] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const [exportMessage, setExportMessage] = useState<string>('');
  const exportTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
  }, []);

  const onExportLog = async () => {
    setExportStatus('busy');
    setExportMessage('');
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const target = await exportErrorLog(`shengmo-${ts}.log`);
      if (target == null) {
        setExportStatus('idle');
        return;
      }
      setExportStatus('ok');
      setExportMessage(target);
      if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
      exportTimerRef.current = window.setTimeout(() => setExportStatus('idle'), 4000);
    } catch (err) {
      setExportStatus('err');
      setExportMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Collapsible title={t('settings.debug.title')}>
      <Card padding={0}>
        <div style={{ padding: '10px 18px 14px' }}>
          <SettingRow label={t('modal.about.exportErrorLog')}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
              <Btn variant="ghost" size="sm" disabled={exportStatus === 'busy'} onClick={onExportLog}>
                {exportStatus === 'busy' ? t('modal.about.exporting') : t('modal.about.exportErrorLogBtn')}
              </Btn>
              {exportStatus === 'ok' && (
                <span
                  style={{ fontSize: 11, color: 'var(--ol-ok)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}
                  title={exportMessage}
                >
                  {t('modal.about.exportSuccess')}
                </span>
              )}
              {exportStatus === 'err' && (
                <span
                  style={{ fontSize: 11, color: 'var(--ol-err)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}
                  title={exportMessage}
                >
                  {t('modal.about.exportFailed')}
                </span>
              )}
            </div>
          </SettingRow>
        </div>
      </Card>
    </Collapsible>
  );
}
