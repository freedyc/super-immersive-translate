import { useEffect, useState } from 'react';
import { Card, SelectField, RangeField } from '../components/Field.jsx';
import { OPENAI_VOICES } from '../lib/constants.js';

export function TtsTab({ settings, update }) {
  const [voices, setVoices] = useState([]);

  // 浏览器语音列表是异步加载的，首次读经常是空数组，要等 voiceschanged
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const voiceOptions = [
    ['', '自动匹配 (默认)'],
    ...voices.map((v) => [v.voiceURI, `${v.name} (${v.lang})`]),
  ];

  return (
    <>
      <Card title="朗读引擎">
        <SelectField
          value={settings.ttsEngine}
          options={[['browser', '浏览器内置语音 (免费)'], ['openai', 'OpenAI TTS (需 API Key)']]}
          onChange={(v) => update({ ttsEngine: v })}
        />
      </Card>

      {settings.ttsEngine === 'browser' ? (
        <Card title="浏览器语音">
          <SelectField
            label="音色"
            value={settings.ttsBrowserVoiceURI}
            options={voiceOptions}
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
      ) : (
        <Card title="OpenAI TTS">
          <SelectField
            label="音色"
            value={settings.ttsOpenaiVoice}
            options={OPENAI_VOICES.map((v) => [v, v])}
            onChange={(v) => update({ ttsOpenaiVoice: v })}
          />
          <RangeField
            label="语速"
            value={settings.ttsOpenaiSpeed}
            min="0.25" max="4" step="0.05"
            onChange={(v) => update({ ttsOpenaiSpeed: v }, { debounce: true })}
          />
          <p className="text-xs text-base-content/40">
            复用「常规」里配置的 OpenAI API Key 和地址。
          </p>
        </Card>
      )}
    </>
  );
}
