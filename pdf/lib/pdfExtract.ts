/**
 * PDF / 文档文本提取 —— 从原 viewer.js 原样抽出来的纯函数，逻辑未改动。
 *
 * 注意：这是"文本提取"，不是"保留版式渲染"。架构蓝图里的
 * docs/superpowers/specs/2026-08-22-platform-architecture-design.md 第二节
 * 计划用 pdf.js 做保留原版式的渲染子系统，那是另一套东西，会替换掉这里的实现。
 */

// zlib 包装的 deflate 和裸 deflate 都可能出现在 PDF 流里，先试前者再退到后者。
// 'deflate-raw' 是标准里的名字，但 TS 的 CompressionFormat 联合类型在部分
// lib.dom 版本里没带上，所以这里用字面量联合自己声明。
type InflateFormat = 'deflate' | 'deflate-raw';

async function inflateData(data: Uint8Array): Promise<Uint8Array> {
  const collect = async (format: InflateFormat): Promise<Uint8Array> => {
    const ds = new DecompressionStream(format as CompressionFormat);
    const writer = ds.writable.getWriter();
    writer.write(data as unknown as BufferSource);
    writer.close();

    const reader = ds.readable.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  };

  try {
    return await collect('deflate');
  } catch {
    // 原来这里写的是 'raw'，而 DecompressionStream 只认 'gzip' / 'deflate' / 'deflate-raw'，
    // 传 'raw' 会直接抛 TypeError——也就是说这条降级路径从来没真正生效过，
    // 裸 deflate 流的 PDF 一律提取失败。加类型时被 tsc 揪出来，顺手改成正确的值。
    return collect('deflate-raw');
  }
}

function decodePDFString(str: string): string {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
    .replace(/\\([()])/g, '$1');
}

function extractTextOperators(content: string): string {
  let text = '';
  const tjRegex = /\(([^)]*)\)\s*Tj/g;
  const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;

  let m;
  while ((m = tjRegex.exec(content)) !== null) {
    text += decodePDFString(m[1]);
  }

  while ((m = tjArrayRegex.exec(content)) !== null) {
    const inner = m[1];
    const strRegex = /\(([^)]*)\)/g;
    let s;
    while ((s = strRegex.exec(inner)) !== null) {
      text += decodePDFString(s[1]);
    }
  }

  return text;
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .replace(/([a-z])-\n([a-z])/g, '$1$2')
    .trim();
}

async function extractPDFText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const raw = new TextDecoder('latin1').decode(bytes);

  let allText = '';
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
  let match;

  while ((match = streamRegex.exec(raw)) !== null) {
    let content = match[1];

    const objStart = raw.lastIndexOf('obj', match.index);
    const objHeader = raw.substring(Math.max(0, objStart - 200), match.index);

    if (objHeader.includes('/FlateDecode')) {
      try {
        const compressed = bytes.slice(
          match.index + match[0].indexOf('\n') + 1,
          match.index + match[0].length - 'endstream'.length,
        );
        content = new TextDecoder('latin1').decode(await inflateData(compressed));
      } catch {
        continue;
      }
    }

    const textParts = extractTextOperators(content);
    if (textParts) allText += `${textParts}\n`;
  }

  return cleanExtractedText(allText);
}

/** 从上传的文件里提取纯文本。支持 pdf / txt / md / html。 */
export async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  let text;
  if (ext === 'pdf') {
    text = await extractPDFText(file);
  } else {
    text = await file.text();
    if (ext === 'html' || ext === 'htm') {
      text = new DOMParser().parseFromString(text, 'text/html').body.textContent || '';
    }
  }

  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
