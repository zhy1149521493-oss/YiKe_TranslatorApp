const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { boundedRequest } = require('./load-ts.cjs')('request');
const source = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['translateStream', 'translateFull'].includes(node.name?.text));
assert.equal(functions.length, 2);
const script = ts.transpileModule(functions.map(node => node.getText(ast)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

function harness(kind = 'local') {
  const calls = []; let ready;
  const ctx = { boundedRequest, DOMException, localModelsReady: false, localModelStore: [], engineCfg: { providers: [] },
    localModelDiscovery: new Promise(resolve => { ready = resolve; }),
    resolveEngine: () => ({ kind, provider: {} }),
  };
  for (const name of ['fetchOllamaStream', 'fetchOllamaFull', 'fetchApiStream', 'fetchApiFull']) ctx[name] = async () => { calls.push(name); return 'fixture'; };
  vm.createContext(ctx); vm.runInContext(script, ctx);
  return { ctx, calls, ready };
}

test('first local stream and full requests wait for discovery without blocking API requests', async () => {
  for (const route of ['translateStream', 'translateFull']) {
    const local = harness();
    const pending = local.ctx[route]('fixture', 'en', 'zh', 'hello', 1024, ...(route === 'translateStream' ? [() => {}] : []));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(local.calls, []);
    local.ctx.localModelStore = [{ name: 'fixture' }]; local.ctx.localModelsReady = true; local.ready();
    assert.equal(await pending, 'fixture');
    assert.deepEqual(local.calls, [route === 'translateStream' ? 'fetchOllamaStream' : 'fetchOllamaFull']);
    const api = harness('api');
    assert.equal(await api.ctx[route]('fixture', 'en', 'zh', 'hello', 1024, ...(route === 'translateStream' ? [() => {}] : [])), 'fixture');
    assert.deepEqual(api.calls, [route === 'translateStream' ? 'fetchApiStream' : 'fetchApiFull']);
  }
});

test('cancelling first-use discovery prevents a late local inference request', async () => {
  for (const route of ['translateStream', 'translateFull']) {
    const h = harness(); const controller = new AbortController();
    const pending = h.ctx[route]('fixture', 'en', 'zh', 'hello', 1024, ...(route === 'translateStream' ? [() => {}, controller.signal] : [controller.signal]));
    controller.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
    h.ready(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.calls, []);
  }
});

test('a completed empty discovery uses the existing missing-model message', async () => {
  const h = harness(); h.ctx.localModelsReady = true; h.ready();
  await assert.rejects(h.ctx.translateFull('fixture', 'en', 'zh', 'hello', 1024), /还没有配置任何翻译模型/);
  assert.deepEqual(h.calls, []);
});
