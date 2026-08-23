/**
 * 单词详情抽屉。
 *
 * 渐进展开：常看的（释义、音标、例句）直接铺开，剩下的按需展开。
 * 词库卡片上塞不下这么多字段，全铺开又会让列表变成一堵墙。
 *
 * 用 MUI Drawer 而不是自己写：焦点陷阱、Esc 关闭、滚动锁定这三件事
 * 手写版本经常漏掉其中一件。
 */
import Drawer from '@mui/material/Drawer';
import { X, ExternalLink } from 'lucide-react';
import type { ExerciseType, LearningRecord, Word } from '../../types/models.ts';
import {
  describeNextReview, deriveStatus, masteryPercent, nextReviewAt, STATUS_LABEL,
} from '../../utils/learning/srsService.ts';
import { EXERCISE_LABEL } from '../lib/questions.ts';
import { SpeakButton } from './SpeakButton.tsx';
import { TaggedSentence } from './TaggedSentence.tsx';

const EXERCISES: ExerciseType[] = ['en2zh', 'zh2en', 'listening', 'spelling'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-base-content/40">{title}</h3>
      {children}
    </section>
  );
}

/** 折叠区：默认收起，标题栏显示条数，省得点开才知道是空的 */
function Collapsible({ title, count, children }: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <details className="collapse collapse-arrow bg-base-200/50 rounded-lg">
      <summary className="collapse-title min-h-0 py-2.5 text-sm font-medium flex items-center gap-2">
        {title}
        {count !== undefined && (
          <span className="badge badge-ghost badge-sm tabular-nums">{count}</span>
        )}
      </summary>
      <div className="collapse-content text-sm">{children}</div>
    </details>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t, i) => <span key={i} className="badge badge-outline badge-sm">{t}</span>)}
    </div>
  );
}

export function WordDetailDrawer({ word, record, onClose }: {
  word: Word | null;
  record: LearningRecord | undefined;
  onClose: () => void;
}) {
  const open = !!word;

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <div className="w-[min(92vw,26rem)] h-full overflow-y-auto bg-base-100 text-base-content">
        {word && (
          <div className="flex flex-col gap-5 p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-2xl font-bold break-words">{word.word}</h2>
                  <SpeakButton text={word.word} lang="en-US" title="发音" size="sm" />
                </div>
                <div className="flex gap-3 text-xs font-mono text-base-content/50 flex-wrap">
                  {word.phoneticUK && <span>英 {word.phoneticUK}</span>}
                  {word.phoneticUS && <span>美 {word.phoneticUS}</span>}
                  {!word.phoneticUK && !word.phoneticUS && word.phonetic && (
                    <span>{word.phonetic}</span>
                  )}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm btn-circle shrink-0" onClick={onClose}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <Section title="释义">
              {word.meanings.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {word.meanings.map((m, i) => (
                    <div key={i} className="flex gap-2 items-baseline text-sm">
                      <span className="badge badge-ghost badge-sm shrink-0">{m.partOfSpeech}</span>
                      <span className="text-base-content/80">{m.definitions.join('；')}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-base-content/40">
                  还没有释义。在词库卡片上点「重新生成」可以让 AI 补齐。
                </p>
              )}
            </Section>

            {word.examples.length > 0 && (
              <Section title={`例句（${word.examples.length}）`}>
                <div className="flex flex-col gap-3">
                  {word.examples.map((ex, i) => (
                    <div key={i} className="flex flex-col gap-1 p-3 rounded-lg bg-base-200/50">
                      <div className="flex items-start gap-1.5">
                        <div className="flex-1 text-sm">
                          <TaggedSentence sentence={ex.sentence} tokens={ex.tokens} />
                        </div>
                        <SpeakButton text={ex.sentence} lang="en-US" title="朗读例句" />
                      </div>
                      {ex.translation && (
                        <div className="flex items-start gap-1.5">
                          <span className="flex-1 text-xs text-base-content/50">{ex.translation}</span>
                          <SpeakButton text={ex.translation} lang="zh-CN" title="朗读译文" />
                        </div>
                      )}
                      {/* 来自真实阅读的例句是这个产品的差异点，值得标出来 */}
                      {ex.origin === 'context' && (
                        <span className="text-[10px] text-primary/60">来自你读过的网页</span>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <Section title="学习进度">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`badge ${STATUS_LABEL[deriveStatus(record)].cls} badge-sm`}>
                  {STATUS_LABEL[deriveStatus(record)].text}
                </span>
                <span className="text-xs text-base-content/50">
                  掌握度 {masteryPercent(record)}%
                </span>
              </div>
              <div className="flex flex-col gap-1.5 mt-1">
                {EXERCISES.map((ex) => {
                  const er = record?.byExercise[ex];
                  return (
                    <div key={ex} className="flex items-center gap-2 text-xs">
                      <span className="w-24 shrink-0 text-base-content/60">{EXERCISE_LABEL[ex]}</span>
                      {er ? (
                        <>
                          <span className="tabular-nums text-success">{er.correct} 对</span>
                          <span className="tabular-nums text-warning">{er.wrong} 错</span>
                          <span className="ml-auto text-base-content/40">
                            {describeNextReview(nextReviewAt(record, ex))}
                          </span>
                        </>
                      ) : (
                        <span className="text-base-content/30">还没练过</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>

            {(word.wordForms && Object.keys(word.wordForms).length > 0) && (
              <Collapsible title="词形变化" count={Object.keys(word.wordForms).length}>
                <div className="flex flex-col gap-1 pt-1">
                  {Object.entries(word.wordForms).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="text-base-content/45 w-20 shrink-0">{k}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              </Collapsible>
            )}

            {word.phrases && word.phrases.length > 0 && (
              <Collapsible title="常用搭配" count={word.phrases.length}>
                <div className="pt-1"><Chips items={word.phrases} /></div>
              </Collapsible>
            )}

            {word.synonyms && word.synonyms.length > 0 && (
              <Collapsible title="近义词" count={word.synonyms.length}>
                <div className="pt-1"><Chips items={word.synonyms} /></div>
              </Collapsible>
            )}

            {word.antonyms && word.antonyms.length > 0 && (
              <Collapsible title="反义词" count={word.antonyms.length}>
                <div className="pt-1"><Chips items={word.antonyms} /></div>
              </Collapsible>
            )}

            {(word.roots || word.memoryTip) && (
              <Collapsible title="词根与记忆">
                <div className="flex flex-col gap-2 pt-1">
                  {word.roots && <p className="text-base-content/70">{word.roots}</p>}
                  {word.memoryTip && <p className="text-base-content/70">{word.memoryTip}</p>}
                </div>
              </Collapsible>
            )}

            <Section title="来源">
              <div className="flex flex-col gap-1 text-xs text-base-content/50">
                <span>收藏于 {new Date(word.addedAt).toLocaleString('zh-CN')}</span>
                {word.sourceUrl ? (
                  <a
                    href={word.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="link link-hover inline-flex items-center gap-1 break-all"
                  >
                    <ExternalLink className="w-3 h-3 shrink-0" />
                    {word.sourceTitle || word.sourceUrl}
                  </a>
                ) : (
                  <span className="text-base-content/30">没有记录来源页面</span>
                )}
              </div>
            </Section>
          </div>
        )}
      </div>
    </Drawer>
  );
}
