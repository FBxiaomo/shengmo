// 关于 → 声墨品牌信息 + 二创说明。
// 原项目的 QQ 群号、外链（GitHub / 文档 / 反馈）已全部清除——URL 均为空字符串，无意义。

import { useTranslation } from 'react-i18next';
import { APP_VERSION_LABEL } from '../../lib/appVersion';
import { Card } from '../_atoms';

export function AboutSection() {
  const { t } = useTranslation();

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <img
          src="AppIcon.png"
          alt=""
          style={{ width: 56, height: 56, borderRadius: 13, boxShadow: '0 4px 10px rgba(0,0,0,.10), 0 0 0 0.5px rgba(0,0,0,.06)' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>声墨</div>
          <div style={{ fontSize: 12, color: 'var(--ol-ink-3)', marginTop: 2 }}>
            {t('modal.about.tagline')} · {APP_VERSION_LABEL}
          </div>
        </div>
      </div>
      <div style={{
        marginTop: 14,
        paddingTop: 14,
        borderTop: '0.5px solid var(--ol-line)',
        fontSize: 12.5,
        color: 'var(--ol-ink-3)',
        lineHeight: 1.7,
      }}>
        {t('modal.about.derivativeNote', '基于')}{' '}
        <a
          href="https://github.com/appergb/openless"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--ol-blue)', textDecoration: 'none' }}
        >
          OpenLess
        </a>
        {' '}{t('modal.about.derivativeSuffix', '开源项目二次创作')}
      </div>
    </Card>
  );
}
