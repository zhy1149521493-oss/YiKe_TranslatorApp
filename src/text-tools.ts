/** Only return a language when the lightweight heuristic has useful evidence. */
export function detectLang(text: string): string {
  if (/[\u3040-\u30ff]/u.test(text)) return "ja";
  if (/[\uac00-\ud7af\u1100-\u11ff]/u.test(text)) return "ko";
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/u.test(text)) return "zh";
  if (/[\u0400-\u04ff]/u.test(text)) return "ru";
  if (/[\u0600-\u06ff]/u.test(text)) return "ar";
  if (/[\u0900-\u097f]/u.test(text)) return "hi";
  if (/[\u0e00-\u0e7f]/u.test(text)) return "th";
  if (/[\u1ea0-\u1ef9]/u.test(text)) return "vi";
  if (/[ñ¿¡]/iu.test(text)) return "es";
  if (/[ß]/iu.test(text)) return "de";
  if (/[ãõ]/iu.test(text)) return "pt";
  if (/[ąćęłńśźż]/iu.test(text)) return "pl";
  if (/[ıİşğ]/u.test(text)) return "tr";
  const words = new Set(text.toLowerCase().match(/[\p{L}]+/gu) ?? []);
  const hints: Record<string, string[]> = {
    en: ["hello", "world", "the", "this", "that", "is", "are", "you", "your", "please", "thanks", "thank", "with"],
    fr: ["bonjour", "merci", "avec", "est", "vous", "tout", "monde", "salut", "pour", "une"],
    es: ["hola", "gracias", "amigo", "buenos", "buenas", "usted", "quiero", "pero", "estoy"],
    de: ["hallo", "danke", "guten", "morgen", "ich", "nicht", "ist", "und", "bitte"],
    pt: ["olá", "obrigado", "obrigada", "você", "bom", "muito", "não", "uma"],
    it: ["ciao", "grazie", "buongiorno", "sono", "della", "questo", "prego"],
    nl: ["hallo", "dank", "dankjewel", "goedemorgen", "het", "een", "niet"],
    sv: ["hej", "tack", "god", "morgon", "och", "inte", "jag"],
    tr: ["merhaba", "teşekkür", "ben", "bir", "için"],
    pl: ["cześć", "dziękuję", "jest", "nie", "proszę"],
    vi: ["xin", "chào", "cảm", "ơn", "tôi"],
  };
  const scores = Object.entries(hints).map(([lang, list]) => ({ lang, score: list.filter(word => words.has(word)).length }));
  scores.sort((a, b) => b.score - a.score);
  return scores[0].score > 0 && scores[0].score > scores[1].score ? scores[0].lang : "auto";
}

/** Conservative OCR deduplication: preserve order, punctuation and repetitions. */
export function similarity(a: string, b: string): number {
  const normalize = (text: string) => text.normalize("NFC").replace(/\s+/gu, "");
  const left = normalize(a), right = normalize(b);
  return left && left === right ? 1 : 0;
}
