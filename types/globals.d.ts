/**
 * 通过副作用挂到 window 上的全局单例。
 *
 * utils/tts.js 和 utils/translator.js 在模块加载时把实例赋给 window，
 * 消费方（页面脚本、内容脚本）直接读 window.xxx 而不是 import 实例本身。
 * 这里补上声明，让 TS 知道它们存在。
 *
 * 类型先写成宽松形态：这两个模块本身还是 JS（checkJs 关着），
 * 等它们也迁到 TS 之后，这里应该改成直接引用它们导出的类型。
 */

interface TtsManager {
  init(): Promise<void>;
  /**
   * 念完才 resolve，念不出来 reject。
   * override.engine 供设置页试听用：临时换引擎发声，不改用户的设置。
   */
  speak(text: string, lang: string, override?: { engine?: string }): Promise<void>;
  stop(): void;
  readonly isSpeaking: boolean;
}

interface TranslatorInstance {
  engine: string;
  sourceLang: string;
  targetLang: string;
  init(): Promise<void>;
  translate(text: string): Promise<string>;
  translateBatch(texts: string[]): Promise<string[]>;
  [key: string]: unknown;
}

/**
 * Web Speech API 的识别部分至今没进 TS 的标准 DOM lib（它还是非标准草案），
 * 这里补一份用到的最小声明。
 */
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
}

declare const SpeechRecognition: { new (): SpeechRecognition } | undefined;

interface Window {
  ttsManager: TtsManager;
  translator: TranslatorInstance;
  /** Web Speech API，Chrome 只提供带 webkit 前缀的那个 */
  SpeechRecognition?: { new (): SpeechRecognition };
  webkitSpeechRecognition?: { new (): SpeechRecognition };
}
