/**
 * 朗读设置。
 *
 * 中英文分开配：有道只有英文真人录音，Google 的中文更自然，系统语音包也是
 * 分语种装的——用一套设置同时管中英文，必然有一边在将就。
 *
 * 每个引擎的能力（要不要 Key、支不支持中文、单次上限）都来自
 * utils/tts-engines.js 的注册表，这里不再各写一份。
 */
import { useEffect, useState } from 'react';
import { Card, SelectField, RangeField, type Option } from '../components/Field.tsx';
import { TtsPreview } from '../components/TtsPreview.tsx';
import { OPENAI_VOICES } from '../../utils/translation-options.ts';
import { TTS_ENGINES, getEngine, isChinese, resolveTts, supportsLang } from '../../utils/tts-engines.js';
import { SAMPLE_LANGS } from '../../utils/tts-samples.js';
import type { TabProps } from '../lib/types.ts';

type Settings = TabProps['settings'];
type Update = TabProps['update'];

/** 一个语种的完整配置块：选引擎 → 配该引擎 → 试听 */
function LangSection({ lang, label, voices, settings, update }: {
  lang: string;
  label: string;
  voices: SpeechSynthesisVoice[];
  settings: Settings;
  update: Update;
}) {
  const zh = isChinese(lang);
  const { engine: engineId, voiceURI } = resolveTts(settings, lang);
  const engine = getEngine(engineId);
  const usable = supportsLang(engineId, lang);

  const engineKey = zh ? 'ttsEngineZh' : 'ttsEngineEn';
  const voiceKey = zh ? 'ttsBrowserVoiceZh' : 'ttsBrowserVoiceEn';

  // 只列这个语种的音色。把几十个别的语言的音色混在一起，等于让用户自己筛
  const matching = voices.filter((v) => isChinese(v.lang) === zh);
  const voiceOptions: Option[] = [
    ['', '自动匹配 (默认)'],
    ...matching.map((v): Option => [v.voiceURI, `${v.name} (${v.lang})`]),
  ];

  return (
    <Card title={`${label}朗读`}>
      <SelectField
        label="引擎"
        value={engineId}
        // 读不了这个语种的引擎直接不给选，而不是选完再提示「不支持」
        options={TTS_ENGINES
          .filter((e) => supportsLang(e.id, lang))
          .map((e): Option => [e.id, e.label])}
        hint={engine.note}
        onChange={(v) => update({ [engineKey]: v })}
      />

      {!usable && (
        <p className="text-xs text-warning">
          当前引擎没有{label}发音，会自动改用浏览器内置语音。
        </p>
      )}

      {engineId === 'browser' && (
        <>
          {matching.length === 0 && (
            <p className="text-xs text-warning">
              系统里没有{label}语音包，{label}会读不出来。
              可改用「Google 翻译语音」，或在系统设置里安装{label}语音。
            </p>
          )}
          <SelectField
            label="音色"
            value={voiceURI}
            options={voiceOptions}
            onChange={(v) => update({ [voiceKey]: v })}
          />
        </>
      )}

      {engineId === 'google' && (
        <p className="text-xs text-base-content/50">
          用的是 Google 翻译网页版的取音频接口，不需要 API Key。
          朗读时会把这段文本发给 Google。单次上限约 200 字，长文本自动分段连读。
        </p>
      )}

      {engineId === 'youdao' && (
        <>
          <SelectField
            label="口音"
            value={settings.ttsYoudaoAccent}
            options={[['us', '美式'], ['uk', '英式']]}
            onChange={(v) => update({ ttsYoudaoAccent: v })}
          />
          <p className="text-xs text-base-content/50">
            真人录音，读单词最自然，适合背单词。不需要 API Key。
            朗读时会把这段文本发给有道。
          </p>
        </>
      )}

      {engineId === 'openai' && (
        <>
          <SelectField
            label="音色"
            value={settings.ttsOpenaiVoice}
            options={OPENAI_VOICES.map((v): Option => [v, v])}
            onChange={(v) => update({ ttsOpenaiVoice: v })}
          />
          <p className="text-xs text-base-content/40">
            复用「常规」里配置的 OpenAI API Key 和地址。这是 API Key（在
            platform.openai.com 单独充值），跟 ChatGPT Plus 订阅是两套计费，
            订阅不含 API 额度。没配 Key 时会退回浏览器语音。
          </p>
        </>
      )}

      <TtsPreview lang={lang} engine={engineId} voiceURI={voiceURI} />
    </Card>
  );
}

export function TtsTab({ settings, update }: Pick<TabProps, 'settings' | 'update'>) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  // 浏览器语音列表是异步加载的，首次读经常是空数组，要等 voiceschanged
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  return (
    <>
      {SAMPLE_LANGS.map(({ lang, label }) => (
        <LangSection
          key={lang}
          lang={lang}
          label={label}
          voices={voices}
          settings={settings}
          update={update}
        />
      ))}

      <Card title="通用">
        <p className="text-xs text-base-content/50">
          语速和音调是主观偏好，跟语言无关，中英文共用一套。仅对浏览器内置语音
          和 Google 生效——有道是固定语速的真人录音，OpenAI 有自己的语速设置。
        </p>
        <RangeField
          label="语速"
          value={settings.ttsBrowserRate}
          min="0.5" max="2" step="0.1"
          onChange={(v) => update({ ttsBrowserRate: v }, { debounce: true })}
        />
        <RangeField
          label="音调"
          value={settings.ttsBrowserPitch}
          min="0.5" max="2" step="0.1"
          onChange={(v) => update({ ttsBrowserPitch: v }, { debounce: true })}
        />
        <RangeField
          label="OpenAI 语速"
          value={settings.ttsOpenaiSpeed}
          min="0.25" max="4" step="0.05"
          onChange={(v) => update({ ttsOpenaiSpeed: v }, { debounce: true })}
        />
      </Card>
    </>
  );
}
