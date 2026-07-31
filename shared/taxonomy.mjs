/**
 * AI 内容分类学 —— 信号识别、主题归类、噪音治理。
 * 纯 ESM、零依赖，Node 抓取脚本与 Cloudflare Worker 共用同一份规则，
 * 避免线上实时接口和离线快照出现口径漂移。
 *
 * 设计要点：英文词一律走词边界匹配。朴素的 includes('ai') 会命中
 * said / main / air / wait / detail，是相关性判断里最常见的隐性 bug。
 */

/** 搜索关键词：按召回价值排序，quick 模式只取前若干个 */
export const SEARCH_KEYWORDS = [
  '大模型', 'AI', '人工智能', 'AIGC', 'DeepSeek', 'ChatGPT', 'AI Agent', '具身智能',
  'AI编程', '多模态', '开源模型', 'Sora', 'Gemini', 'Claude', '通义千问', '文心一言',
  '豆包', 'Kimi', '智谱', '可灵', 'Stable Diffusion', 'Midjourney', 'AI绘画',
  '机器学习', 'Transformer', 'RAG', '算力', '英伟达',
];

/** B 站分区：抓最新投稿后用 AI 词过滤，保证「新」而不只是「热」 */
export const BILI_ZONES = [
  { rid: 188, name: '科技·数码' },
  { rid: 95, name: '科技·计算机技术' },
  { rid: 231, name: '科技·极客DIY' },
  { rid: 122, name: '知识·野生技术协会' },
  { rid: 201, name: '知识·科学科普' },
  { rid: 207, name: '知识·财经商业' },
];

/* --------------------------- 匹配器：中文直配，英文词边界 --------------------------- */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 把词表编译成一个正则。纯 ASCII 词加词边界，含中文的词直接匹配。 */
function compile(words) {
  const parts = words.map((w) => {
    const e = escapeRe(w.toLowerCase());
    if (/^[a-z0-9 .\-+]+$/.test(w.toLowerCase())) {
      // 前后不能紧邻其它英文字母，避免 ai 命中 said / air / main
      return `(?<![a-z0-9])${e}(?![a-z0-9])`;
    }
    return e;
  });
  return new RegExp(parts.join('|'), 'i');
}

/** 强信号：出现即可确认是 AI 内容 */
const STRONG = compile([
  '大模型', '大语言模型', '大語言模型', '人工智能', 'AIGC', 'LLM', 'AGI', '通用人工智能',
  'ChatGPT', 'GPT-4', 'GPT-5', 'GPT4', 'GPT5', 'GPT', 'OpenAI', 'DeepSeek', 'Claude',
  'Gemini', 'Llama', 'Qwen', '通义', '文心一言', '豆包', 'Kimi', '智谱', 'GLM', 'MiniMax',
  '混元', '讯飞星火', '盘古大模型', 'Sora', 'Midjourney', 'Stable Diffusion', 'ComfyUI',
  '可灵', '即梦', '海螺AI', 'Runway', 'Suno', 'Copilot', 'Cursor', 'Claude Code',
  '具身智能', '机器学习', '深度学习', '神经网络', 'Transformer', '扩散模型', 'Diffusion',
  '多模态', 'RAG', '向量数据库', '提示词', 'Prompt', 'HuggingFace', 'Hugging Face',
  '开源模型', 'MoE', '端侧模型', '强化学习', 'RLHF', '模型蒸馏', '智能体', 'AI Agent',
  '生成式AI', '生成式人工智能', 'AI绘画', 'AI视频', 'AI编程', 'AI眼镜', 'AI手机',
  'Vibe Coding', 'AI工具', 'AI应用', 'AI模型', 'AI芯片', 'AI技术', '自动驾驶', 'FSD',
]);

/** 弱信号：需要出现在标题里，或配合科技/知识类分区才算数 */
const WEAK = compile([
  'AI', 'A.I.', 'Agent', '机器人', '人形机器人', '宇树', '算力', '英伟达', 'NVIDIA',
  'H100', 'H200', 'A100', 'TPU', 'LoRA', '微调', '量化', '推理', '训练', '数据集',
  '图像生成', '语音合成', '数字人', '智能驾驶', '昇腾', '寒武纪',
]);

/** 硬噪音：命中即剔除，基本都是引流号与灰产 */
const HARD_NOISE = compile([
  '不翻墙', '免翻墙', '无需翻墙', '免费使用教程', '共享账号', '账号共享', '镜像站',
  '中文版下载', '破解版', '绿色版', '直装版', '免费领取', '加微信', '私信我', '扫码',
  '兼职', '副业月入', '日入过万', '月入过万', '躺赚', '带货', '优惠券', '代练', '刷单',
  '福利姬', '擦边', '算命', '风水', '塔罗', '星座运势', '一键生成爆款', '无限次使用',
  '永久免费使用', '内部渠道', '白嫖教程',
  // 代充值 / 代开通类引流，B 站 AI 关键词下的最大污染源
  '会员开通', '开通教程', '开通会员', '充值教程', '代充', '境外卡', '虚拟卡',
  '订阅教程', '无脑入手', '免费教程', '注册教程', '国内使用教程', '平替网站',
  '国内直连', '免费用上', '免费白嫖', '解锁会员', '国内如何使用',
  // 盗版网课引流：爱奇艺「教育」频道下最大的污染源，标题多形如
  // 「（搜XX it）AI大模型应用专家实战训练营-18期」
  '实战训练营', '全栈工程师第', '训练营-', '期-完整版', '完整版无密',
  '网盘自取', '课程分享', '资料自取', '视频教程全集', '培训班',
  // 这类标题会把联系方式伪装成搜索词塞进括号：「（搜闪 学it）迪哥全套...」
  '（搜', '(搜', '全套教程', '全套课程', '迪哥', '完整无密',
]);

/** 软噪音：不剔除但降权，多为重复刷屏的资源分发内容 */
const SOFT_NOISE = compile([
  '整合包', '一键安装包', '安装包', '汉化包', '最全最细', '2026最新版', '保姆级',
  '看完就会', '全套教程', '从入门到精通', '干货满满', '建议收藏', '速看', '搬运',
]);

/**
 * 分区三档制。黑名单挡不住「拿 AI 玩梗」的内容 —— 洛克王国里让 ChatGPT 对战、
 * DeepSeek 娘二创、Gemini 陪看番剧，标题都硬命中强信号，却没有任何情报价值。
 * 所以改成白名单：分区本身就是最强的意图信号。
 */
const CORE_CHANNELS = new Set([
  '计算机技术', '软件应用', '科学科普', '数码', '科工机械', '野生技能协会',
  '财经商业', '职业职场', '设计·创意', '预告·资讯', '资讯', '演讲·公开课',
  '机械', '极客DIY', '人工智能', '编程', '绘画', '数字生命',
]);

/** 中性分区：真假参半，要求标题强信号且整体降权 */
const NEUTRAL_CHANNELS = new Set([
  '日常', '校园学习', '人文历史', '社科·法律·心理', '新能源车', '汽车生活',
  '学习', '知识', '手工', '摄影摄像', '影视杂谈',
]);

/** 政论、时评类内容与 AI 情报无关，一律剔除 */
const POLITICAL = compile([
  '政论', '时评', '统独', '台海', '两岸关系', '大选', '选举', '蓝绿', '绿营', '蓝营',
  '赵少康', '唐湘龙', '郭正亮', '邱毅', '黄智贤', '政治评论员', '名嘴',
]);

const norm = (parts) => parts.filter(Boolean).join(' ').toLowerCase();

export function isPolitical(...parts) {
  return POLITICAL.test(norm(parts));
}

/**
 * 相关性评估。
 *
 * 分区白名单是为 B 站设计的，直接套到别的平台会误伤：爱奇艺的频道叫
 * 「科技,30」「资讯,25」，AcFun 压根不返回分区。早期版本对这两家一律
 * 判 casual/unknown，导致 AcFun 抓 240 条只入选 2 条。
 * 现在允许源适配器通过 tierHint 自己声明可信度，B 站之外不再套用它的分区表。
 *
 * @param {{title?:string, description?:string, channel?:string, tierHint?:string}} item
 * @returns {{score:number, strong:boolean, tier:string}} score >= 1.5 视为可收录
 */
export function aiRelevance({ title = '', description = '', channel = '', tierHint = '' } = {}) {
  const t = norm([title]);
  const d = norm([description]);

  const titleStrong = STRONG.test(t);
  const titleWeak = WEAK.test(t);
  const descStrong = STRONG.test(d);

  const tier =
    tierHint ||
    (CORE_CHANNELS.has(channel)
      ? 'core'
      : NEUTRAL_CHANNELS.has(channel)
        ? 'neutral'
        : channel
          ? 'casual'
          : 'unknown');

  let score = 0;
  if (titleStrong) score = 2;
  else if (titleWeak) score = 1.6;
  else if (descStrong) score = 1.1;

  if (tier === 'neutral') score = titleStrong ? 1.7 : 0.6;
  // 娱乐分区无论标题多硬都不收 —— 它们是「用 AI 做梗」，不是「关于 AI 的消息」
  if (tier === 'casual') score = 0;
  // 分区信息缺失（如 AcFun）：标题弱信号也放行，靠噪音词表与热度排序兜底，
  // 否则整个平台等于没接。
  if (tier === 'unknown' && !titleStrong && !titleWeak) score = Math.min(score, 1.1);

  return { score, strong: titleStrong, tier };
}

/** 兼容旧调用：宽松判断是否 AI 相关 */
export function isAiRelated(...parts) {
  const text = norm(parts);
  return STRONG.test(text) || WEAK.test(text);
}

/** 噪音等级：2 = 剔除，1 = 降权，0 = 干净 */
export function noiseLevel(...parts) {
  const text = norm(parts);
  if (HARD_NOISE.test(text)) return 2;
  if (SOFT_NOISE.test(text)) return 1;
  return 0;
}

/** 作者名里带这些特征的基本是 AI 引流号 */
const SPAM_AUTHOR = compile([
  'GPT官网', 'GPT中文', 'chatgpt中文', 'AI导航', 'AI工具箱推荐', 'AI副业',
  'AI变现', 'AI掘金', '免费GPT', 'GPT-校长', 'AI资源库',
]);

export function isSpamAuthor(author = '') {
  return SPAM_AUTHOR.test(String(author).toLowerCase());
}

/* --------------------------------- 主题归类 --------------------------------- */

const TOPIC_RULES = [
  {
    id: 'model',
    label: '模型发布',
    match: ['发布会', '正式发布', '开源发布', '新模型', '正式推出', '重磅发布', '首发',
      'deepseek', 'gpt-5', 'gpt-4', 'claude', 'gemini', 'llama', 'qwen', '通义', '文心',
      '豆包', 'kimi', '智谱', 'glm', '混元', 'moe', '端侧模型', '开源模型', '模型对比',
      '模型评测', '跑分'],
  },
  {
    id: 'aigc',
    label: 'AIGC 创作',
    match: ['绘画', '作画', '生成图', '视频生成', 'sora', 'midjourney', 'stable diffusion',
      'comfyui', '可灵', '即梦', 'runway', 'suno', '配音', '数字人', '换脸', '剪辑',
      '文生图', '文生视频', '图生视频', 'lora', '写真', '分镜', 'ai动画', 'ai短片'],
  },
  {
    id: 'agent',
    label: 'Agent 与应用',
    match: ['agent', '智能体', 'workflow', '工作流', 'mcp', 'rag', '知识库', '自动化',
      'copilot', 'cursor', 'claude code', 'codex', 'ai编程', 'vibe coding', '插件',
      '工具链', 'api', '接入', '部署应用', '搭建'],
  },
  {
    id: 'embodied',
    label: '具身智能与机器人',
    match: ['具身智能', '机器人', '人形', '宇树', '波士顿动力', '自动驾驶', '无人车',
      '机械臂', '四足', 'fsd', '端到端驾驶', '智能驾驶'],
  },
  {
    id: 'infra',
    label: '芯片与算力',
    match: ['算力', '芯片', '英伟达', 'nvidia', 'gpu', 'h100', 'h200', 'a100', 'tpu',
      '显卡', '推理成本', '数据中心', '国产芯片', '寒武纪', '昇腾', '光模块'],
  },
  {
    id: 'research',
    label: '学术前沿',
    match: ['论文', 'arxiv', '原理', '数学', '推导', '架构解析', 'transformer', '注意力',
      '强化学习', 'rlhf', '蒸馏', '量化', '综述', '本质', 'scaling law', '缩放定律'],
  },
  {
    id: 'tutorial',
    label: '教程实操',
    match: ['教程', '入门', '保姆级', '手把手', '零基础', '部署', '安装', '踩坑',
      '实战', '课程', '从零', '教学', '技巧', '整合包', '使用方法'],
  },
  {
    id: 'industry',
    label: '行业动态',
    match: ['融资', '财报', '裁员', '收购', '估值', '创业', '政策', '监管', '市场',
      '竞争', '访谈', '对话', '观点', '预测', '趋势', '股价', '板块', '大厂'],
  },
];

const COMPILED_TOPICS = TOPIC_RULES.map((r) => ({ ...r, re: compile(r.match) }));

export function classifyTopic(...parts) {
  const text = norm(parts);
  for (const rule of COMPILED_TOPICS) {
    if (rule.re.test(text)) return { id: rule.id, label: rule.label };
  }
  return { id: 'industry', label: '行业动态' };
}

export const TOPICS = TOPIC_RULES.map(({ id, label }) => ({ id, label }));

/* ------------------------------- 爱奇艺频道白名单 ------------------------------- */

/**
 * 爱奇艺搜索结果的频道字段形如「科技,30」「教育,12」。
 * 实测「教育」频道 90% 是盗版网课引流，「短剧/少儿/生活」全是蹭 AI 标签的水视频，
 * 真正有情报价值的只有科技与资讯两个频道，因此在源头就做白名单，
 * 而不是指望后面的噪音词表把它们一条条捞出来。
 */
export const IQIYI_CHANNELS = new Set(['科技', '资讯']);

export function iqiyiChannelName(raw = '') {
  return String(raw).split(',')[0].trim();
}

/* --------------------------------- 资讯媒体源 --------------------------------- */

/**
 * AI 与科技媒体 RSS。视频平台能给「大家在看什么」，媒体源给「到底发生了什么」，
 * 两者互补 —— 只有视频的话，重大发布往往要滞后半天才有 UP 主跟进。
 */
export const MEDIA_FEEDS = [
  { id: 'qbitai', name: '量子位', url: 'https://www.qbitai.com/feed', weight: 1.25 },
  { id: 'leiphone', name: '雷峰网', url: 'https://www.leiphone.com/feed', weight: 1.1 },
  { id: 'ithome', name: 'IT之家', url: 'https://www.ithome.com/rss/', weight: 1.0 },
  { id: 'ifanr', name: '爱范儿', url: 'https://www.ifanr.com/feed', weight: 1.0 },
  { id: 'tmtpost', name: '钛媒体', url: 'https://www.tmtpost.com/feed', weight: 0.95 },
  { id: 'sspai', name: '少数派', url: 'https://sspai.com/feed', weight: 0.9 },
  // 新浪科技 rollnews.xml 已停更（实测仍返回 2018 年条目），不要再加回来
];

/* ------------------------------ 有反爬墙的平台 ------------------------------ */

/**
 * 这些平台的公开接口都需要私有签名或人机验证，无凭证环境下拿不到数据：
 *   抖音 / 西瓜  → a_bogus 签名 + JS 挑战
 *   快手        → graphql 返回 400002，要求滑块验证
 *   腾讯视频     → 搜索接口返回 ret 10401，缺少签名参数
 *   优酷 / 搜狐 / 好看 → 直接判爬虫
 * 与其假装覆盖，不如老实告诉用户抓不到，并给一个站内 AI 搜索直达入口。
 */
export const WALLED_PLATFORMS = [
  { id: 'douyin', name: '抖音', reason: 'a_bogus 签名 + JS 挑战', search: 'https://www.douyin.com/search/人工智能' },
  { id: 'kuaishou', name: '快手', reason: '滑块人机验证', search: 'https://www.kuaishou.com/search/video?searchKey=人工智能' },
  { id: 'tencent', name: '腾讯视频', reason: '搜索接口需签名', search: 'https://v.qq.com/x/search/?q=人工智能' },
  { id: 'xigua', name: '西瓜视频', reason: 'a_bogus 签名', search: 'https://www.ixigua.com/search/人工智能/' },
  { id: 'youku', name: '优酷', reason: '接口判爬虫', search: 'https://so.youku.com/search_video/q_人工智能' },
  { id: 'douban', name: '好看视频', reason: '接口判爬虫', search: 'https://haokan.baidu.com/web/search/page?query=人工智能' },
];
