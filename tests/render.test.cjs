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
function render(mode, component = 'MainWindow') {
  const ctx = {
    React, exports: {}, ...load('latest-task'), ...load('audio-tasks'), ...load('text-tools'), ...load('request'),
    getCurrentWebviewWindow: () => ({ label: component === 'AudioFloatingWindow' ? 'audio-floating' : 'main' }),
    getCurrentWebview: () => ({}),
    useState: initial => [initial === 'text' ? mode : typeof initial === 'function' ? initial() : initial, () => {}],
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
