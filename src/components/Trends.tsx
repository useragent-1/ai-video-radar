import type { Trend } from '../types';

/**
 * 热搜风向条。
 * 视频和文章反映的是「已经被生产出来的内容」，热搜反映的是「正在发酵的话题」——
 * 后者往往比前者早半天到一天。条目不多时也照常展示，空着才隐藏。
 */
export function Trends({ trends }: { trends: Trend[] }) {
  if (!trends || trends.length === 0) return null;

  return (
    <section className="trends" aria-label="热搜风向">
      <div className="trends__label">
        <span className="trends__pulse" aria-hidden="true" />
        风向
      </div>
      <div className="trends__track">
        {trends.map((t) => (
          <a
            key={`${t.source}-${t.keyword}`}
            className="trends__item"
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${t.source}热搜${t.rank ? ` 第 ${t.rank} 位` : ''}`}
          >
            <span className="trends__src">{t.source}</span>
            {t.keyword.replace(/^#|#$/g, '')}
          </a>
        ))}
      </div>
    </section>
  );
}
