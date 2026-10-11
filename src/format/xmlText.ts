/**
 * XML 文本就地改写的公共工具（KML / GPX 共用）。
 * 只做字符串与 DOM 层面的处理，不涉及任何坐标算法。
 */

/** 匹配浮点数的正则片段（含指数写法） */
export const NUM_SRC = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';

/** 定点输出并去掉多余的 0，避免出现 1e-7 这类指数写法 */
export function fmtNum(v: number): string {
  const s = v.toFixed(7);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** 递归收集 localName 命中的元素（不依赖命名空间前缀，兼容 `gx:` 等写法） */
export function collectByLocalName(elem: Element, name: string, out: Element[]): void {
  for (const child of Array.from(elem.children)) {
    if (child.localName === name) out.push(child);
    collectByLocalName(child, name, out);
  }
}

/**
 * 序列化 XML 文档并保证 XML 声明只出现一次。
 * 浏览器的 XMLSerializer 在部分实现中会自己带上声明，直接拼接会产生两条。
 */
export function serializeXmlDoc(doc: Document, sourceHasDecl: boolean): string {
  const body = new XMLSerializer().serializeToString(doc);
  if (/^\s*<\?xml/i.test(body)) return body.replace(/^(<\?xml[^>]*\?>)\s*/, '$1\n');
  return sourceHasDecl ? '<?xml version="1.0" encoding="UTF-8"?>\n' + body : body;
}

/** 原始文本是否自带 XML 声明 */
export function hasXmlDecl(text: string): boolean {
  return /^\s*<\?xml/i.test(text);
}
