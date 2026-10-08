const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-ts.cjs');

// Render the actual JSX with empty startup state and effects/IPC disabled.
const source = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8').replace(/^import .*;\r?\n/gm, '');
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
} }).outputText;
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const main = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'MainWindow');
const hookNames = main.body.statements.filter(ts.isVariableStatement).flatMap(statement =>
  statement.declarationList.declarations.filter(d => ts.isCallExpression(d.initializer) && d.initializer.expression.getText(ast) === 'useState').map(d => d.name.elements[0]?.name?.text)
);
function render(mode, component = 'MainWindow', layout = 'studio', overrides = {}) {
  let hookIndex = 0;
  const ctx = {
    React, exports: {}, ...load('latest-task'), ...load('audio-tasks'), ...load('text-tools'), ...load('request'),
    getCurrentWebviewWindow: () => ({ label: component === 'AudioFloatingWindow' ? 'audio-floating' : 'main' }),
    getCurrentWebview: () => ({}),
    useState: initial => {
      const name = hookNames[hookIndex++];
      const value = component === 'MainWindow' && Object.hasOwn(overrides, name) ? overrides[name] : initial === 'text' ? mode : initial === 'studio' ? layout : typeof initial === 'function' ? initial() : initial;
      return [value, () => {}];
    },
    useRef: initial => ({ current: initial }), useCallback: fn => fn, useEffect: () => {},
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return renderToStaticMarkup(ctx[component]());
}

test('all main translation modes render safely with empty startup history', () => {
  for (const mode of ['text', 'audio', 'subtitle', 'screenshot']) assert.match(render(mode), /译刻/);
  assert.match(render('audio'), /暂无译文/);
});

test('audio floating window renders safely before the first recognition event', () => {
  assert.match(render('audio', 'AudioFloatingWindow'), /电脑音频/);
});

test('classic rollback retains all four modes and the switch back to studio', () => {
  for (const mode of ['text', 'audio', 'subtitle', 'screenshot']) {
    const html = render(mode, 'MainWindow', 'classic');
    assert.doesNotMatch(html, /studio-rail/);
    for (const label of ['文本翻译', '音频翻译', '视频字幕', '截图翻译', '工作台界面']) assert.match(html, new RegExp(label));
  }
});

test('a pending text translation does not mark other modes as translating', () => {
  assert.match(render('text', 'MainWindow', 'studio', { translating: true }), /正在翻译/);
  for (const mode of ['audio', 'subtitle', 'screenshot']) {
    const html = render(mode, 'MainWindow', 'studio', { translating: true });
    assert.doesNotMatch(html, /正在翻译|翻译中…|译文会在这里逐步呈现/);
  }
});
