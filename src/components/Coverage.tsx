import { useState } from 'react';
import type { FeedMeta } from '../types';

/**
 * 覆盖度说明。
 *
 * 聚合类站点最容易犯的错是假装自己什么都有。这个组件把话说清楚：
 * 哪些平台真的在抓、抓到多少条，哪些平台抓不到、为什么抓不到，
 * 并对抓不到的给一个站内搜索直达链接 —— 至少省用户一次手动输入。
 */
export function Coverage({ meta }: { meta: FeedMeta | null }) {
  const [open, setOpen] = useState(false);
  if (!meta) return null;

  const live = Object.entries(meta.summary.byPlatform).sort((a, b) => b[1] - a[1]);
  const walled = meta.walled ?? [];

  return (
    <section className="coverage">
      <button className="coverage__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>
          覆盖 <b className="num">{live.length}</b> 个信源
          {walled.length > 0 && (
            <>
              ，另有 <b className="num">{walled.length}</b> 个平台有反爬墙
            </>
          )}
        </span>
        <span className="coverage__caret" data-open={open} aria-hidden="true">
          ›
        </span>
      </button>

      {open && (
        <div className="coverage__panel">
          <div className="coverage__col">
            <h4>正在抓取</h4>
            <ul className="coverage__list">
              {live.map(([name, count]) => (
                <li key={name}>
                  <span className="coverage__dot coverage__dot--on" aria-hidden="true" />
                  {name}
                  <span className="num">{count}</span>
                </li>
              ))}
            </ul>
          </div>

          {walled.length > 0 && (
            <div className="coverage__col">
              <h4>抓不到（点击直达站内搜索）</h4>
              <ul className="coverage__list">
                {walled.map((w) => (
                  <li key={w.id}>
                    <span className="coverage__dot" aria-hidden="true" />
                    <a href={w.search} target="_blank" rel="noopener noreferrer">
                      {w.name}
                    </a>
                    <span className="coverage__reason">{w.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
