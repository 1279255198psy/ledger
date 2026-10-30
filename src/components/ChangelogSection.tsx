import { ExternalLink, Tag } from 'lucide-react'
import { CHANGELOG } from '../lib/changelog'
import { GITHUB_RELEASES_URL, normalizeVersion } from '../lib/github'
import { openExternalUrl } from '../lib/links'

/** The bundled release history, reachable from 设置 → 关于账页. */
export function ChangelogSection() {
  const currentVersion = normalizeVersion(__APP_VERSION__)

  return (
    <section className="settings-section changelog-section">
      <div className="settings-heading">
        <h3>历史更新</h3>
        <p>
          账页每个正式版本的主要变化。历史记录随安装包一起保存，没有网络也能查看。
        </p>
      </div>

      <div className="changelog-list">
        {CHANGELOG.map((entry) => {
          const isCurrent = entry.version === currentVersion
          return (
            <article
              key={entry.version}
              className={`changelog-entry${isCurrent ? ' is-current' : ''}`}
            >
              <header className="changelog-entry-head">
                <div className="changelog-entry-title">
                  <strong>v{entry.version}</strong>
                  {isCurrent ? (
                    <span className="changelog-current">当前版本</span>
                  ) : null}
                  {entry.title ? (
                    <span className="changelog-title">{entry.title}</span>
                  ) : null}
                </div>
                {entry.date ? (
                  <time dateTime={entry.date}>{entry.date}</time>
                ) : null}
              </header>
              {entry.items.length > 0 ? (
                <ul>
                  {entry.items.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="changelog-empty">这一版没有留下条目。</p>
              )}
            </article>
          )
        })}
      </div>

      <div className="data-actions">
        <button
          type="button"
          className="data-row"
          onClick={() => void openExternalUrl(GITHUB_RELEASES_URL)}
        >
          <span className="data-row-icon">
            <Tag size={18} />
          </span>
          <span className="data-row-text">
            <strong>在 GitHub 查看全部版本</strong>
            <small>安装包与完整发布记录</small>
          </span>
          <ExternalLink size={15} className="data-row-external" />
        </button>
      </div>
    </section>
  )
}
