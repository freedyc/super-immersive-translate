/**
 * PDF / 文档文本提取 —— 从原 viewer.js 原样抽出来的纯函数，逻辑未改动。
 *
 * 注意：这是"文本提取"，不是"保留版式渲染"。架构蓝图里的
 * docs/superpowers/specs/2026-08-22-platform-architecture-design.md 第二节
 * 计划用 pdf.js 做保留原版式的渲染子系统，那是另一套东西，会替换掉这里的实现。
 */

async function inflateData(data) {
  const collect = async (format) => {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    writer.write(data);
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
    return collect('raw');
  }
}

function decodePDFString(str) {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
    .replace(/\\([()])/g, '$1');
}

function extractTextOperators(content) {
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

function cleanExtractedText(text) {
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .replace(/([a-z])-\n([a-z])/g, '$1$2')
    .trim();
}

async function extractPDFText(file) {
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
export async function extractTextFromFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();

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
