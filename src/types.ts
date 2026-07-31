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
  /** 可动手复现的教学内容。与 topic 正交 —— AIGC 里也有教程 */
  isTutorial?: boolean;
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
  servedVia?: 'baked' | 'asset-fallback' | 'github-raw';
  /** 两条通道各自的产出量，用于判断是哪一侧退化 */
  channels?: { edge: number; snapshot: number; snapshotAt: string | null };
  sourceStats?: Record<string, number>;
  dropped?: Record<string, number>;
  topics: { id: string; label: string }[];
  summary: {
    total: number;
    freshLast24h: number;
    byPlatform: Record<string, number>;
    byTopic: Record<string, number>;
    byKind?: Record<string, number>;
    /** 教程内容总量，用于在筛选器上直接标数 */
    tutorials?: number;
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
/**
 * 「教程」是横切筛选，不是第四种 kind —— 它可以和视频/资讯任意组合。
 * 单独一个开关比塞进 KindFilter 更诚实，也不会让用户以为教程不是视频。
 */
export type KindFilter = 'all' | 'video' | 'article';
