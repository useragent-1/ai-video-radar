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

/**
 * 教程向搜索词。
 *
 * 通用词（'大模型'、'AI'）按 pubdate 排序召回的是资讯与评论，教程会被淹没：
 * 实测 300 条里只有 6 条教学内容。教程有自己的检索语言 —— 用户搜的是
 * 「ComfyUI 工作流」「本地部署大模型」而不是「AI」，所以单独建一张词表，
 * 用「工具名 + 动作」的组合去检索，命中的天然就是实操内容。
 *
 * 排序原则：工具名靠前（意图最明确），泛化的「XX教程」靠后（引流号密集）。
 */
export const TUTORIAL_KEYWORDS = [
  // 图像 / 视频生成工具链：教程需求最旺，且内容可验证
  'ComfyUI 工作流', 'ComfyUI 教程', 'Stable Diffusion 教程', 'LoRA 训练', 'AI绘画 教程',
  '即梦 教程', '可灵 教程', 'AI视频 制作教程',
  // 编程 / Agent 工具链
  'Cursor 教程', 'Claude Code 教程', 'AI编程 实战', 'Codex 使用',
  'Coze 搭建', 'Dify 部署', 'n8n 工作流', 'MCP 服务器',
  // 本地部署与工程化：技术含量最高的一档
  '本地部署 大模型', 'Ollama 部署', '大模型 微调', 'RAG 实战', '知识库 搭建',
  'vLLM 部署', 'LangChain 教程', 'AI Agent 开发',
  // 通用技法
  '提示词 技巧', 'Prompt 工程', 'AI工具 使用教程', '大模型 入门',
];

/**
 * B 站分区：抓最新投稿后用 AI 词过滤，保证「新」而不只是「热」。
 * 230「软件应用」是 AI 工具类教程的主阵地（ComfyUI / Cursor / 本地部署都投这里），
 * 原先漏掉它，等于把最对口的一个分区关在门外。
 */
export const BILI_ZONES = [
  { rid: 188, name: '科技·数码' },
  { rid: 95, name: '科技·计算机技术' },
  { rid: 230, name: '科技·软件应用' },
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

/**
 * 硬噪音：命中即剔除，基本都是引流号与灰产。
 *
 * 这里刻意不放任何单纯的教学词。早期版本把「免费教程」「全套教程」「实战训练营」
 * 一类词直接当硬噪音，结果是正经教程被连坐 —— 实测 32 条教学内容里只留下 6 条，
 * 且留下的反而是没触发词表的引流视频。真正的区分点不是「教不教」，
 * 而是「教的是技术，还是教你怎么白嫖 / 怎么变现」，所以拆成下面三类精确打击。
 */
const HARD_NOISE = compile([
  // 一、破解与账号灰产：与技术教学无关，命中即走
  '不翻墙', '免翻墙', '无需翻墙', '共享账号', '账号共享', '镜像站', '中文版下载',
  '破解版', '绿色版', '直装版', '解锁会员', '无限次使用', '永久免费使用', '内部渠道',
  '平替网站', '国内直连', '免费用上', '免费白嫖',
  // 破解词的规避变体。这类号会把「破解版」写成「解破版」「破j版」来绕词表，
  // 「免费无限生成」则是同一套话术换了皮 —— 一并按原词处理。
  '解破版', '破j版', '破解补丁', '免费无限', '无限生成', '不限次数', '额度无限',
  '车队', '拼车', '低价开通', '一元开',
  // 二、代充值 / 代开通引流，B 站 AI 关键词下的最大污染源
  '会员开通', '开通会员', '代充', '境外卡', '虚拟卡', '无脑入手',
  '免费使用教程', '开通教程', '充值教程', '订阅教程', '注册教程', '国内使用教程',
  '国内如何使用', '白嫖教程',
  // 三、变现与引流：教的是「怎么赚钱」，不是「怎么做」
  '免费领取', '加微信', '私信我', '扫码', '兼职', '副业月入', '日入过万', '月入过万',
  '躺赚', '带货', '优惠券', '代练', '刷单', '一键生成爆款',
  // 四、纯灰产 / 无关内容
  '福利姬', '擦边', '算命', '风水', '塔罗', '星座运势',
  // 五、盗版网课引流：标题多形如「（搜XX it）AI大模型应用专家实战训练营-18期」
  '实战训练营', '全栈工程师第', '训练营-', '期-完整版', '完整版无密',
  '网盘自取', '资料自取', '视频教程全集', '培训班', '课程分享',
  '（搜', '(搜', '迪哥', '完整无密',
]);

/**
 * 盗版课程的组合特征。
 *
 * 「全套教程」「全套课程」本身不足以定罪 —— UP 主做的系列教程也这么叫。
 * 但它一旦和「网盘 / 领取 / 私信 / 加V」同时出现，就是课程搬运号无疑。
 * 用组合判定替代单词黑名单，既拦住引流，又不误伤系列教程。
 */
const COURSE_BAIT = compile(['全套教程', '全套课程', '全套资料', '完整版课程', '配套资料']);
const BAIT_CONTACT = compile([
  '网盘', '百度云', '夸克', '领取', '自取', '私信', '加v', '加微', '关注领', '评论区',
  '三连', '免费送', '无偿分享',
]);

/**
 * 软噪音：不剔除但降权，多为重复刷屏的资源分发内容。
 *
 * 注意这里已经移除了「保姆级」「从入门到精通」「整合包」「安装包」。
 * 它们是中文技术教程最典型的自我标注方式 ——「ComfyUI 保姆级安装教程」
 * 恰恰是用户来这个站想找的东西，把它降权 45% 等于自断教程供给。
 */
const SOFT_NOISE = compile([
  '最全最细', '干货满满', '建议收藏', '速看', '搬运', '看完就会', '震惊',
  '99%的人不知道', '再不学就晚了', '一键搞定一切',
]);

/**
 * 课程搬运号的标题模板。
 *
 * 放宽教程词表后浮上来一批「整整168集」「吊打付费」「B站最全最细」类内容。
 * 它们确实是教程，但通常是被搬运的存量付费课，跟「最新 AI 动态」这个主题
 * 不搭 —— 一门讲 2023 年 Transformer 的 168 集课程，今天投稿也不算新消息。
 * 所以判降权而非剔除：想找系统课的人翻两页还能看到，
 * 但首屏应该留给「本周新出的工具怎么用」。
 */
const COURSE_REPOST = new RegExp(
  [
    '整整\\s*\\d+\\s*集', '全\\s*\\d+\\s*集', '\\d+\\s*天(就能|从)', '从小白到大神',
    '吊打付费', '天花板教程', '必刷', '不愧是', '吹爆', '别再走弯路', '一口气看完',
    'b站最(好|全|强|细)', '付费课程', '价值\\d+', '打包带走',
  ].join('|'),
  'i',
);

/** 课程分集：「13-深度学习之激活函数」这类编号开头的条目会把首屏刷满 */
const COURSE_EPISODE = /^\s*(第)?\d{1,3}\s*[-.、·：:]\s*\S/;

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
  // 「全套教程」+「网盘领取」= 课程搬运号；只出现前者则视为系列教程，放行
  if (COURSE_BAIT.test(text)) return BAIT_CONTACT.test(text) ? 2 : 1;
  if (SOFT_NOISE.test(text) || COURSE_REPOST.test(text)) return 1;
  // 分集编号只看标题（parts[0]），描述里出现数字编号很正常
  if (COURSE_EPISODE.test(String(parts[0] || '').trim())) return 1;
  return 0;
}

/** 作者名里带这些特征的基本是 AI 引流号 */
const SPAM_AUTHOR = compile([
  'GPT官网', 'GPT中文', 'chatgpt中文', 'AI导航', 'AI工具箱推荐', 'AI副业',
  'AI变现', 'AI掘金', '免费GPT', 'GPT-校长', 'AI资源库',
  // 冒名号：把知名学者 / 论文站的名字当账号名，内容全是搬运的付费课。
  // 真正的吴恩达不会在 B 站叫「吴恩达RAG」，arXiv 也不会投「胎教级入门」。
  '吴恩达RAG', '吴恩达AI', '李沐AI', 'Arxiv论文', '论文精读官方',
  // 课程搬运号的通用命名法
  '大模型课程', 'AI课堂', 'AI教程分享', '人工智能教程', '大模型学习',
]);

export function isSpamAuthor(author = '') {
  return SPAM_AUTHOR.test(String(author).toLowerCase());
}

/* -------------------------------- 教学意图识别 -------------------------------- */

/**
 * 强教学标记：标题里出现即可确认这是一条「教你做」的内容。
 * 这些词在中文技术视频里几乎没有歧义用法。
 */
const TEACH_STRONG = compile([
  '教程', '手把手', '保姆级', '零基础', '从零开始', '从零搭建', '从零实现', '新手入门',
  '小白必看', '小白也能', '上手指南', '使用指南', '安装指南', '避坑指南', '入门到精通',
  '实操演示', '完整流程', '全流程演示', '一步步', '跟我做', '带你做', '教你',
]);

/**
 * 弱教学标记：单独出现有歧义，必须配合技术具体性才算数。
 *
 * 典型误判：「面对 Kimi 冲击，日本正常人与糖豆人的教学」—— 中文语境里
 * 「XX 教学」常被用作玩梗（意思是「看看 XX 什么德行」），并非真的在教。
 * 「实战」也一样，既出现在盗版训练营标题里，也出现在正经项目复盘里。
 */
const TEACH_WEAK = compile([
  '教学', '入门', '实战', '实操', '踩坑', '避坑', '详解', '讲解', '精讲', '上手',
  '指南', '怎么用', '如何使用', '使用方法', '技巧', '攻略', '演示', '拆解',
]);

/**
 * 技术具体性佐证词：出现说明内容落到了具体工具或工程动作上。
 *
 * 这是区分「真教程」与「泛泛而谈」的关键信号。一条视频只要提到了
 * ComfyUI、部署、微调这类词，就说明它有可复现的操作对象，
 * 而不是在讲「AI 将如何改变世界」。
 */
const TECH_ANCHOR = compile([
  // 具体工具与框架
  'comfyui', 'stable diffusion', 'webui', 'ollama', 'lm studio', 'dify', 'coze', '扣子',
  'langchain', 'llamaindex', 'n8n', 'cursor', 'claude code', 'codex', 'copilot', 'cline',
  'vllm', 'llama.cpp', 'open-webui', 'anythingllm', 'flowise', 'trae', 'windsurf',
  'lora', 'controlnet', 'flux', 'wan2', '即梦', '可灵', 'runway', 'suno', 'midjourney',
  // 工程动作
  '部署', '搭建', '安装', '配置', '微调', '训练', '接入', '调用', '集成', '封装',
  '本地化', '私有化', '容器', 'docker', '环境配置', '整合包', '一键包',
  // 技术对象
  'api', 'sdk', 'mcp', 'rag', '知识库', '向量', '工作流', '提示词', 'prompt',
  '智能体', 'agent', '插件', '脚本', '开源', '显存', '量化', '算子', '数据集',
]);

/**
 * 判断一条内容是不是教程。
 *
 * 规则：强标记直接成立；弱标记必须有技术锚点佐证。
 * 描述文本只参与佐证，不参与判定 —— 很多资讯视频会在简介里顺带写
 * 「更多教程见主页」，拿它当判定依据会引入大量假阳性。
 *
 * @returns {{is:boolean, strong:boolean}}
 */
export function teachingIntent(title = '', description = '') {
  const t = norm([title]);
  const anchored = TECH_ANCHOR.test(t) || TECH_ANCHOR.test(norm([description]));
  if (TEACH_STRONG.test(t)) return { is: true, strong: true };
  if (TEACH_WEAK.test(t) && anchored) return { is: true, strong: false };
  return { is: false, strong: false };
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
      '实战', '课程', '从零', '教学', '技巧', '整合包', '使用方法', '搭建', '微调',
      '配置', '实操', '上手', '避坑', '演示'],
  },
  {
    id: 'industry',
    label: '行业动态',
    match: ['融资', '财报', '裁员', '收购', '估值', '创业', '政策', '监管', '市场',
      '竞争', '访谈', '对话', '观点', '预测', '趋势', '股价', '板块', '大厂'],
  },
];

const COMPILED_TOPICS = TOPIC_RULES.map((r) => ({ ...r, re: compile(r.match) }));

/**
 * 主题归类。
 *
 * 规则表是「首次命中即返回」的，顺序敏感 —— 而教程规则排在第 7 位，
 * 于是「ComfyUI 保姆级教程」先被第 2 条 aigc 的 'comfyui' 命中，
 * 「Transformer 入门到进阶教程」先被第 6 条 research 的 'transformer' 命中，
 * 结果 32 条教学内容只有 2 条落进「教程实操」。
 *
 * 修法不是简单把 tutorial 提到最前面 —— 那会让「DeepSeek 发布会实录」里的
 * 「实录」误伤成教程。这里只让**强教学标记**插队：标题明写「教程 / 手把手 /
 * 零基础」的内容，它的第一属性就是教程，主题该归教程；
 * 弱标记（实战、详解）仍走原规则表，只在 isTutorial 标志位上体现。
 */
export function classifyTopic(...parts) {
  const [title = '', description = ''] = parts;
  if (teachingIntent(title, description).strong) {
    return { id: 'tutorial', label: '教程实操' };
  }
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
