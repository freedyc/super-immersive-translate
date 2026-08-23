/**
 * 试听句库。
 *
 * 每句针对一个具体的发音难点，不是随便凑十句话——引擎之间的差距
 * 恰恰体现在这些地方：多音字读不读得对、数字念不念得顺、语调有没有起伏。
 * 拿「你好世界」试听，四个引擎听起来都一样。
 *
 * 内置而不是 AI 生成：AI 引擎在默认配置下根本不可用（这正是音标和词性
 * 之前永远为空的原因），试听功能不该继承同一个毛病。
 */

export const TTS_SAMPLES = {
  'en-US': [
    { label: '全字母句', text: 'The quick brown fox jumps over the lazy dog.' },
    { label: '数字与时间', text: 'Flight 447 departs at 6:30 a.m. on March 3rd, 2026.' },
    { label: '缩写', text: 'Dr. Smith works at the U.N. headquarters in N.Y.C.' },
    { label: '疑问语调', text: 'Could you tell me where the nearest station is?' },
    { label: '长句停顿', text: 'Although it was raining heavily, they decided to continue the hike.' },
    { label: '连续咝音', text: 'She sells seashells by the seashore.' },
    { label: 'th 音', text: 'I thought the three thieves threw it over there.' },
    { label: '同形异读', text: 'Please record the record before the concert begins.' },
    { label: '日常口语', text: "Thanks a lot! I really appreciate your help, it means a lot." },
    { label: '技术词汇', text: 'Download the file, then restart your computer to apply the update.' },
  ],
  'zh-CN': [
    { label: '日常问候', text: '你好，很高兴认识你，希望我们合作愉快。' },
    { label: '数字与时间', text: '三月十五日下午三点二十分，会议将准时开始。' },
    { label: '多音字', text: '他在银行行长面前，重复了一遍那件很重要的事。' },
    { label: '疑问语调', text: '请问，最近的地铁站应该怎么走？' },
    { label: '儿化与轻声', text: '小孩儿在门口玩儿了一会儿就回家了。' },
    { label: '长句停顿', text: '尽管外面下着大雨，他们还是决定按原计划出发。' },
    { label: '声调对比', text: '妈妈骑马，马慢，妈妈骂马。' },
    { label: '中英混排', text: '请把这个 PDF 文件下载到 Downloads 文件夹里。' },
    { label: '书面语', text: '学而不思则罔，思而不学则殆。' },
    { label: '致谢', text: '谢谢你的帮助，我真的非常感激。' },
  ],
};

/** 试听支持的语种，顺序即设置页里的展示顺序 */
export const SAMPLE_LANGS = [
  { lang: 'en-US', label: '英文' },
  { lang: 'zh-CN', label: '中文' },
];
