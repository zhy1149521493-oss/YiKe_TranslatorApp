const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const { detectLang, similarity } = load('text-tools');
const { boundedRequest } = load('request');

test('distinctive scripts win over ASCII words and Latin-language evidence is bounded', () => {
  for (const [text, expected] of [
    ['한국어 test', 'ko'], ['日本語です test', 'ja'], ['你好 test', 'zh'],
    ['Привет test', 'ru'], ['مرحبا test', 'ar'], ['नमस्ते test', 'hi'], ['สวัสดี test', 'th'],
    ['Bonjour tout le monde', 'fr'], ['Hola amigo', 'es'], ['Hello world', 'en'],
    ['Guten Morgen', 'de'], ['Obrigado', 'pt'], ['Ciao grazie', 'it'],
    ['Xin chào', 'vi'], ['123456', 'auto'], ['API JSON CPU', 'auto'], ['hallo', 'auto'],
  ]) assert.equal(detectLang(text), expected, text);
});

test('subtitle deduplication preserves order, repetitions and short meaningful changes', () => {
  assert.equal(similarity('你 喜欢我', '你喜欢我'), 1);
  for (const [a, b] of [['你喜欢我', '我喜欢你'], ['100元', '1000元'], ['yes', 'yes yes'], ['I can', 'I cannot']]) {
    assert.equal(similarity(a, b), 0);
  }
  assert.equal(similarity('', ''), 0);
});

test('deadline rejects a hung request and aborts its transport without a new event', async () => {
  let transport;
  await assert.rejects(boundedRequest(signal => {
    transport = signal;
    return new Promise(() => {});
  }, undefined, 15), /翻译请求超时/);
  assert.equal(transport.aborted, true);
});

test('outer cancellation settles even when the native transport ignores abort', async () => {
  const outer = new AbortController();
  let complete;
  const request = boundedRequest(() => new Promise(resolve => { complete = resolve; }), outer.signal);
  outer.abort();
  await assert.rejects(request, error => error.name === 'AbortError');
  complete('late native result');
});

test('pre-cancelled requests never start and successful/error requests settle normally', async () => {
  const outer = new AbortController(); outer.abort();
  let started = false;
  await assert.rejects(boundedRequest(async () => { started = true; }, outer.signal), /cancelled/);
  assert.equal(started, false);
  assert.equal(await boundedRequest(async () => 'ok', undefined, 30), 'ok');
  await assert.rejects(boundedRequest(async () => { throw new Error('API 401'); }, undefined, 30), /API 401/);
});
