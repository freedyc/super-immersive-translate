/**
 * 朗读设置。
 *
 * 每个引擎的能力（要不要 Key、支不支持中文、单次上限）都来自
 * utils/tts-engines.js 的注册表，这里不再各写一份。
 */
import { useEffect, useState } from 'react';
import { Card, SelectField, RangeField, type Option } from '../components/Field.tsx';
import { TtsPreview } from '../components/TtsPreview.tsx';
import { OPENAI_VOICES } from '../../utils/translation-options.ts';
import { TTS_ENGINES, getEngine } from '../../utils/tts-engines.js';
import type { TabProps } from '../lib/types.ts';

export function TtsTab({ settings, update }: Pick<TabProps, 'settings' | 'update'>) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  // 浏览器语音列表是异步加载的，首次读经常是空数组，要等 voiceschanged
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const engineId = settings.ttsEngine;
  const engine = getEngine(engineId);

  // 中英文分组：混在一个几十项的列表里找中文音色很痛苦
  const chineseVoices = voices.filter((v) => /^zh/i.test(v.lang));
  const otherVoices = voices.filter((v) => !/^zh/i.test(v.lang));
  const voiceOptions: Option[] = [
    ['', '自动匹配 (默认)'],
    ...chineseVoices.map((v): Option => [v.voiceURI, `【中文】${v.name} (${v.lang})`]),
    ...otherVoices.map((v): Option => [v.voiceURI, `${v.name} (${v.lang})`]),
  ];

  return (
    <>
      <Card title="朗读引擎">
        <SelectField
          value={engineId}
          options={TTS_ENGINES.map((e): Option => [e.id, e.label])}
          hint={engine.note}
          onChange={(v) => update({ ttsEngine: v })}
        />
        {engine.langs !== 'all' && (
          <p className="text-xs text-warning">
            这个引擎没有中文发音，遇到中文会自动改用浏览器内置语音。
          </p>
        )}
        <TtsPreview />
      </Card>

      {engineId === 'browser' && (
        <Card title="浏览器语音">
          {voices.length === 0 ? (
            <p className="text-xs text-base-content/50">
              正在读取系统语音…如果一直是空的，说明系统没有安装语音包。
            </p>
          ) : chineseVoices.length === 0 && (
            <p className="text-xs text-warning">
              系统里没有中文语音包，中文会读不出来。可改用「Google 翻译语音」，
              或在系统设置里安装中文语音。
            </p>
          )}
          <SelectField
            label="音色"
            value={settings.ttsBrowserVoiceURI}
            options={voiceOptions}
            hint="「自动匹配」会按被朗读文本的语言挑选，中英混排时更省心"
            onChange={(v) => update({ ttsBrowserVoiceURI: v })}
          />
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
        </Card>
      )}

      {engineId === 'google' && (
        <Card title="Google 翻译语音">
          <p className="text-xs text-base-content/50">
            用的是 Google 翻译网页版的取音频接口，不需要 API Key，中英文都支持。
            朗读时会把这段文本发给 Google。单次上限约 200 字，长文本会自动分段连读。
          </p>
        </Card>
      )}

      {engineId === 'youdao' && (
        <Card title="有道词典发音">
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
        </Card>
      )}

      {engineId === 'openai' && (
        <Card title="OpenAI TTS">
          <SelectField
            label="音色"
            value={settings.ttsOpenaiVoice}
            options={OPENAI_VOICES.map((v): Option => [v, v])}
            onChange={(v) => update({ ttsOpenaiVoice: v })}
          />
          <RangeField
            label="语速"
            value={settings.ttsOpenaiSpeed}
            min="0.25" max="4" step="0.05"
            onChange={(v) => update({ ttsOpenaiSpeed: v }, { debounce: true })}
          />
          <p className="text-xs text-base-content/40">
            复用「常规」里配置的 OpenAI API Key 和地址。没配 Key 时会退回浏览器语音。
          </p>
        </Card>
      )}
    </>
  );
}
