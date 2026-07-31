/** 视频平台内容与媒体图文共用同一结构，用 kind 区分展示方式 */
export type ItemKind = 'video' | 'article';

export interface VideoItem {
  id: string;
  platform: string;
  platformName: string;
  kind: ItemKind;
  title: string;
  url: string;
  cover: string;
  author: string;
  authorUrl: string;
  publishedAt: string;
  publishedTs: number;
  duration: number;
  views: number;
  danmaku: number;
  replies: number;
  likes: number;
  description: string;
  topic: string;
  topicLabel: string;
  channel: string;
  via: string;
  score: number;
  hits: number;
}

/** 热搜风向：还没被做成视频、但已经在发酵的话题 */
export interface Trend {
  source: string;
  keyword: string;
  rank: number;
  heat?: number;
  url: string;
}

/** 有反爬墙、抓不到的平台，如实列出并给直达入口 */
export interface WalledPlatform {
  id: string;
  name: string;
  reason: string;
  search: string;
}

export interface FeedMeta {
  generatedAt: string;
  durationMs: number;
  mode: 'full' | 'quick' | 'edge';
  stale: boolean;
  newSinceLastRun?: number;
  cacheAge?: number;
  servedBy?: 'edge' | 'snapshot';
  sourceStats?: Record<string, number>;
  dropped?: Record<string, number>;
  topics: { id: string; label: string }[];
  summary: {
    total: number;
    freshLast24h: number;
    byPlatform: Record<string, number>;
    byTopic: Record<string, number>;
    byKind?: Record<string, number>;
  };
  walled?: WalledPlatform[];
  note?: string;
}

export interface Feed {
  meta: FeedMeta;
  trends?: Trend[];
  items: VideoItem[];
}

export type SortMode = 'smart' | 'latest' | 'hot';
export type WindowMode = '24h' | '72h' | '7d' | 'all';
export type KindFilter = 'all' | 'video' | 'article';
