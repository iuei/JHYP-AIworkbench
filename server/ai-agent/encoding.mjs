/**
 * 文本编码候选列表。
 *
 * 单独成文件的原因：`csv.mjs` 的编码回退逻辑需要这个列表，
 * 而 node 的 TextDecoder 在缺少完整 ICU 的环境下可能不支持某些编码，
 * 因此调用方必须对每个候选做 try/catch。
 *
 * 顺序即优先级：GBK 覆盖中文 Windows Excel 导出，
 * gb18030 是 GBK 的超集（生僻字更全），big5 覆盖繁体环境。
 */
export const TEXT_ENCODINGS = ['gb18030', 'gbk', 'big5']

/** 该环境下 TextDecoder 是否支持指定编码。 */
export function supportsEncoding(encoding) {
  try {
    new TextDecoder(encoding)
    return true
  } catch {
    return false
  }
}
