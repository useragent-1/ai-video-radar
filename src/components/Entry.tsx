import { useState } from 'react';
import type { VideoItem } from '../types';
import { formatCount, formatDuration, relativeTime } from '../lib/format';

const FRESH_MS = 6 * 3600_000;

/**
 * 缩略图。媒体 RSS 多数不带图，视频平台的图床也偶发挂掉，
 * 两种情况都要有体面的兜底，否则列表里会散落一堆破图图标。
 */
export function Thumb({ item, className = 'entry__thumb' }: { item: VideoItem; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (!item.cover || failed) {
    // 用信源名做占位，比灰块更有信息量
    return (
      <div className={`${className} thumb--fallback`} aria-hidden="true">
        <span>{item.platformName.slice(0, 3)}</span>
      </div>
    );
  }

  return (
    <img
      className={className}
      src={item.cover}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

/** 时间流中的单条条目 */
export function Entry({ item }: { item: VideoItem }) {
  const fresh = Date.now() - new Date(item.publishedAt).getTime() < FRESH_MS;
  const isArticle = item.kind === 'article';

  return (
    <article className="entry" data-fresh={fresh} data-kind={item.kind}>
      <a href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
        <Thumb item={item} />
      </a>

      <div className="entry__body">
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          <h3 className="entry__title">{item.title}</h3>
        </a>

        {item.description && <p className="entry__desc">{item.description}</p>}

        <div className="entry__meta">
          <span className="tag tag--topic">{item.topicLabel}</span>
          <span className="tag tag--platform" data-kind={item.kind}>
            {item.platformName}
          </span>
          {!isArticle && item.duration > 0 && (
            <span className="dur num">{formatDuration(item.duration)}</span>
          )}

          {item.author &&
            (item.authorUrl ? (
              <a
                className="entry__author"
                href={item.authorUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {item.author}
              </a>
            ) : (
              <span className="entry__author">{item.author}</span>
            ))}

          {/* 文章没有播放量，硬显示「— 播放」只会让人困惑 */}
          {!isArticle && item.views > 0 && (
            <>
              <span className="sep">/</span>
              <span className="num">{formatCount(item.views)} 播放</span>
            </>
          )}
          {!isArticle && item.danmaku > 0 && (
            <>
              <span className="sep">/</span>
              <span className="num">{formatCount(item.danmaku)} 弹幕</span>
            </>
          )}

          <span className="sep">/</span>
          <time dateTime={item.publishedAt} title={item.via}>
            {relativeTime(item.publishedAt)}
          </time>
        </div>
      </div>
    </article>
  );
}
