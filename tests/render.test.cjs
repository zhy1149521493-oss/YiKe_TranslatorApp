const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-ts.cjs');
const { ConnectedMain } = require('../src/interface/ConnectedMain.tsx');
const { FloatingChrome, FloatingHint, FloatingOpacity } = require('../src/interface/FloatingChrome.tsx');
const floatingAppearance = load('interface/floatingAppearance');
global.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

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
function mount(mode, component = 'MainWindow', layout = 'studio', overrides = {}) {
  const states = {}; const calls = [];
  let hookIndex = 0;
  const ctx = {
    React, ConnectedMain, FloatingChrome, FloatingHint, FloatingOpacity,
    useFloatingAppearance: (surface, defaults) => ({ ready: true, tone: 'light', opacity: 88, setOpacity() {}, style: floatingAppearance.floatingThemeVariables(floatingAppearance.restoreFloatingAppearance({}, defaults), surface, false) }),
    ...floatingAppearance, ...load('audio-sensitivity'),
    useFrontendReady: () => {}, ...load('config-writer'),
    useStyleWindowSize: () => {}, appVersion: require('../src-tauri/tauri.conf.json').version, exports: {}, ...load("interface/preferences"), ...load('latest-task'), ...load('audio-tasks'), ...load('text-tools'), ...load('request'),
    getCurrentWebviewWindow: () => ({ label: component === 'AudioFloatingWindow' ? 'audio-floating' : 'main', close: async () => calls.push(['close']), startDragging: async () => calls.push(['drag']) }),
    invoke: async (command, args) => { calls.push([command, args]); },
    readText: async () => 'Clipboard original', writeText: async text => { calls.push(['clipboard-write', text]); },
    getCurrentWebview: () => ({}),
    useState: initial => {
      const name = hookNames[hookIndex++];
      const value = component === 'MainWindow' && Object.hasOwn(overrides, name) ? overrides[name] : initial === 'text' ? mode : initial === 'studio' ? layout : typeof initial === 'function' ? initial() : initial;
      states[name] = value;
      return [value, next => { states[name] = typeof next === "function" ? next(states[name]) : next; }];
    },
    useRef: initial => ({ current: initial }), useCallback: fn => fn, useEffect: () => {},
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return { element: ctx[component](), states, calls, ctx };
}
function render(mode, component = 'MainWindow', layout = 'studio', overrides = {}) {
  return renderToStaticMarkup(mount(mode, component, layout, overrides).element);
}

test('all main translation modes render safely with empty startup history', () => {
  for (const mode of ['text', 'audio', 'subtitle', 'screenshot']) assert.match(render(mode), /译刻/);
  assert.match(render('audio'), /电脑音频|听见的原文/);
});

test('audio floating window renders safely before the first recognition event', () => {
  assert.match(render('audio', 'AudioFloatingWindow'), /电脑音频/);
});

test('translation and audio floats share chrome while retaining all real task controls', () => {
  const translation = render('text', 'FloatingWindow');
  const audio = render('audio', 'AudioFloatingWindow');
  for (const html of [translation, audio]) {
    assert.match(html, /floating-card/); assert.match(html, /floating-bar/);
    assert.match(html, /floating-resize-zone/); assert.match(html, /悬浮窗设置/);
    assert.match(html, /--floating-card-bg:rgba\(249, 247, 244, 0.88\)/);
  }
  for (const label of ['开始视频字幕', '调整字幕区域', '截图翻译', '关闭翻译悬浮窗']) assert.ok(translation.includes(label));
  assert.match(audio, /关闭电脑音频并停止此音源/);
});

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !node.props) return [];
  return [node, ...elements(node.props.children)];
}

test('floating settings open actual windows without starting audio capture', async () => {
  const h = mount('text', 'MainWindow', 'poetry', { settingsOpen: true, settingsPage: 'floating' });
  const nodes = elements(h.element.props.settings);
  for (const text of ['打开翻译窗', '打开电脑音频窗', '打开麦克风窗']) {
    const button = nodes.find(node => node.type === 'button' && renderToStaticMarkup(node).includes(text));
    assert.ok(button, text); await button.props.onClick();
  }
  assert.equal(h.states.floatingOpen, true);
  assert.deepEqual(h.calls.map(([command]) => command), ['open_floating_window', 'open_audio_floating_window', 'open_audio_floating_window']);
  assert.equal(h.calls[1][1].source, 'system'); assert.equal(h.calls[2][1].source, 'mic');
});

test('a Settings auxiliary opacity slider updates every float while keeping main opacity independent', () => {
  const h = mount('text', 'MainWindow', 'poetry', { settingsOpen: true, settingsPage: 'floating' });
  const groups = elements(h.element.props.settings).filter(node => node.props.className === 'appearance-group');
  const microphone = groups.find(node => renderToStaticMarkup(node).includes('麦克风窗'));
  const slider = elements(microphone).find(node => node.type === 'input' && node.props.type === 'range');
  slider.props.onChange({ target: { value: '54' } });
  for (const key of floatingAppearance.FLOATING_SURFACES) assert.equal(h.states.appearance[key].opacity, 54);
  assert.equal(h.states.appearance.main.opacity, 100);
});

test('the opt-in shared theme action keeps main appearance, opacity and font sizes', () => {
  const custom = Object.fromEntries(['main', 'floating', 'audio', 'audioMic', 'subtitle'].map((key, index) => [key, { bg: '#123456', textColor: '#ABCDEF', opacity: 70 + index, fontSize: 14 + index }]));
  const h = mount('text', 'MainWindow', 'poetry', { settingsOpen: true, settingsPage: 'floating', appearance: custom });
  const button = elements(h.element.props.settings).find(node => node.type === 'button' && renderToStaticMarkup(node).includes('统一跟随主题'));
  button.props.onClick();
  assert.deepEqual(h.states.appearance.main, custom.main);
  for (const key of floatingAppearance.FLOATING_SURFACES) {
    assert.equal(h.states.appearance[key].bg, ''); assert.equal(h.states.appearance[key].textColor, '');
    assert.equal(h.states.appearance[key].opacity, custom[key].opacity); assert.equal(h.states.appearance[key].fontSize, custom[key].fontSize);
  }
});

test('classic retains all four modes, with layout switching only in settings', () => {
  for (const mode of ['text', 'audio', 'subtitle', 'screenshot']) {
    const html = render(mode, 'MainWindow', 'classic');
    assert.doesNotMatch(html, /studio-rail|layout-switch/);
    for (const label of ['文本翻译', '音频翻译', '视频字幕', '截图翻译']) assert.match(html, new RegExp(label));
  }
  const settings = render('text', 'MainWindow', 'classic', { settingsOpen: true });
  for (const label of ['诗集', '工作台', '经典', '常驻导航', '悬停展开']) assert.match(settings, new RegExp(label));
});

test('a pending text translation does not mark other modes as translating', () => {
  assert.match(render('text', 'MainWindow', 'studio', { translating: true }), /正在翻译/);
  for (const mode of ['audio', 'subtitle', 'screenshot']) {
    const html = render(mode, 'MainWindow', 'studio', { translating: true });
    assert.doesNotMatch(html, /正在翻译|翻译中…|译文会在这里逐步呈现/);
  }
});


test('live styles render real text and isolate simultaneous audio data without demo fixtures', () => {
  const history = [
    { id: '1:0', source: 'system', text: 'Computer original', result: '电脑译文', isFinal: true },
    { id: '2:0', source: 'mic', text: 'Microphone original', result: '麦克风译文', isFinal: true },
  ];
  for (const layout of ['poetry', 'studio', 'classic']) {
    const html = render('audio', 'MainWindow', layout, { audioMode: 'both', audioHist: history });
    for (const text of ['Computer original', '电脑译文', 'Microphone original', '麦克风译文']) assert.match(html, new RegExp(text));
    assert.doesNotMatch(html, /开始监听演示|演示译文|Good design|predict the future/);
    const text = render('text', 'MainWindow', layout, { input: 'Live original', modeOutput: { text: '真实译文', audio: '', screenshot: '', subtitle: '' } });
    assert.match(text, /Live original/); assert.match(text, /真实译文/);
  }
});

test('Poetry audio pairs each source with its own translation without changing landscape layouts', () => {
  const audioHist = [
    { id: '1:0', source: 'system', text: 'Computer original', result: 'Computer result', isFinal: true },
    { id: '2:0', source: 'mic', text: 'Microphone original', result: 'Microphone result', isFinal: true },
  ];
  const html = render('audio', 'MainWindow', 'poetry', { audioMode: 'both', audioHist });
  assert.ok(html.indexOf('Computer original') < html.indexOf('Computer result'));
  assert.ok(html.indexOf('Computer result') < html.indexOf('Microphone original'));
  assert.ok(html.indexOf('Microphone original') < html.indexOf('Microphone result'));
  assert.match(html, /audio-passages/);
  for (const layout of ['studio', 'classic']) assert.doesNotMatch(render('audio', 'MainWindow', layout), /audio-passages/);
});

test('all existing settings categories render in all three connected layouts', () => {
  for (const layout of ['poetry', 'studio', 'classic']) for (const settingsPage of ['general', 'translate', 'audio', 'subtitle', 'floating', 'providers', 'shortcuts', 'about']) {
    const html = render('text', 'MainWindow', layout, { settingsOpen: true, settingsPage });
    assert.match(html, /settings-center/);
    assert.doesNotMatch(html, /设计 Demo|未接真实功能/);
  }
});

test('OCR pages remove the duplicate preview while preserving real controls and complete results', () => {
  const longSource = 'Recognized line. '.repeat(180);
  const longResult = '完整译文。'.repeat(180);
  for (const layout of ['poetry', 'studio', 'classic']) for (const mode of ['screenshot', 'subtitle']) {
    const html = render(mode, 'MainWindow', layout, {
      screenshotSrc: longSource,
      subCurrent: { text: longSource, result: longResult },
      modeOutput: { text: '', audio: '', screenshot: longResult, subtitle: longResult },
    });
    assert.doesNotMatch(html, /capture-stage/);
    assert.match(html, /识别原文内容/);
    assert.ok(html.includes(longSource));
    assert.ok(html.includes(longResult));
    assert.match(html, /目标语言/);
    assert.match(html, /复制/);
    for (const label of mode === 'screenshot' ? ['截图翻译'] : ['字幕区域', '开始视频字幕', '字幕识别频率', '系统 OCR 测试']) {
      assert.ok(html.includes(label), `${layout}/${mode} retains ${label}`);
    }
  }
});

test('Poetry keeps long input and output in separate accessible reading areas with editing actions', () => {
  const input = 'A long original passage. '.repeat(200);
  const result = '完整译文。'.repeat(200);
  const html = render('text', 'MainWindow', 'poetry', { input, modeOutput: { text: result, audio: '', screenshot: '', subtitle: '' } });
  assert.ok(html.includes(input));
  assert.ok(html.includes(result));
  for (const label of ['待翻译原文', '译文内容', '粘贴剪贴板文本', '交换语言方向', '清空', '重新翻译', '复制']) {
    assert.ok(html.includes(label));
  }
  assert.doesNotMatch(html, /style="height:/);
});

test('compact screenshot status never labels recognition errors as completed', () => {
  const html = render('screenshot', 'MainWindow', 'poetry', { screenshotSrc: '识别失败：OCR 未安装' });
  assert.match(html, /role="status">识别失败：OCR 未安装/);
  assert.doesNotMatch(html, /识别完成/);
});


test('connected controls dispatch to real model, language, clipboard and native handlers', async () => {
  const h = mount('text', 'MainWindow', 'studio', {providers:[{id:'mock',alias:'Mock',model:'first',models:['first','second'],baseUrl:'http://example.invalid',apiKey:'dummy'}]});
  const p = h.element.props; const c = p.controller;
  c.dispatch({type:'model',model:'api:mock::second'});
  assert.equal(h.states.engineMode,'api'); assert.equal(h.states.activeProviderId,'mock');
  assert.equal(h.states.providers[0].model,'second');
  c.dispatch({type:'language',side:'src',value:'ja'}); assert.equal(h.states.sourceLang,'ja');
  await c.copy('only this translation'); await c.paste();
  assert.ok(h.calls.some(([cmd,value]) => cmd === 'clipboard-write' && value === 'only this translation'));
  assert.equal(h.states.input,'Clipboard original');
  p.onMinimize(); p.onMaximize(); p.onClose(); await new Promise(r=>setImmediate(r));
  for (const command of ['minimize_main_window','toggle_maximize_main_window','close']) assert.ok(h.calls.some(([cmd])=>cmd===command));
});

test('dual audio language controls edit only their channel and running source is protected', () => {
  const h = mount('audio', 'MainWindow', 'studio', {audioMode:'both',audioChannelLanguages:{system:{src:'en',tgt:'zh'},mic:{src:'ja',tgt:'en'}},audioSubOn:{system:true}});
  const c = h.element.props.controller;
  c.dispatch({type:'audio-language',channel:'system',side:'src',value:'ko'});
  assert.equal(h.states.audioChannelLanguages.system.src,'en');
  c.dispatch({type:'audio-language',channel:'mic',side:'tgt',value:'zh'});
  assert.deepEqual(h.states.audioChannelLanguages.system,{src:'en',tgt:'zh'});
  assert.deepEqual(JSON.parse(JSON.stringify(h.states.audioChannelLanguages.mic)),{src:'ja',tgt:'zh'});
});

test('closing a workspace is independent of stopping real tasks', () => {
  const h = mount('audio', 'MainWindow', 'studio', {audioMode:'both',audioSubOn:{system:true,mic:true}});
  h.element.props.onMode('screenshot');
  assert.equal(h.states.activeMode,'screenshot');
  assert.deepEqual(h.states.audioSubOn,{system:true,mic:true});
  assert.ok(!h.calls.some(([cmd])=>cmd==='audio_subtitle_stop'));
});


test('rendering keeps the real inference router synchronized with provider and model state', () => {
  const providers=[{id:'mock',model:'chosen',models:['chosen'],baseUrl:'http://example.invalid',apiKey:'dummy'}];
  const h=mount('text','MainWindow','poetry',{engineMode:'api',activeProviderId:'mock',providers,localModelsLoaded:true,localModels:[{name:'installed'}]});
  assert.equal(vm.runInContext('engineCfg.mode',h.ctx),'api');
  assert.equal(vm.runInContext('engineCfg.activeProviderId',h.ctx),'mock');
  assert.equal(vm.runInContext('engineCfg.providers[0].model',h.ctx),'chosen');
  assert.equal(vm.runInContext('localModelsReady',h.ctx),true);
  assert.equal(vm.runInContext('localModelStore[0].name',h.ctx),'installed');
});


test('actual text debounce waits for IME composition to finish', () => {
  let effect;
  function find(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast)==='useEffect' && node.arguments[0].getText(ast).includes('DEBOUNCE_MS')) effect=node.arguments[0];
    ts.forEachChild(node,find);
  }
  find(main);assert.ok(effect);
  const scheduled=[];
  const ctx={input:'正在组字',inputRef:{current:'正在组字'},composing:true,translationTask:{invalidate(){}},setTranslating(){},setApiThinking(){},timerRef:{current:null},clearTimeout(){},setTimeout:(fn,delay)=>{scheduled.push([fn,delay]);return 1;},runTranslation(){},DEBOUNCE_MS:600};
  vm.createContext(ctx);vm.runInContext(ts.transpileModule('var effect='+effect.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,ctx);
  ctx.effect();assert.equal(scheduled.length,0);
  ctx.composing=false;ctx.effect();assert.equal(scheduled.length,1);assert.equal(scheduled[0][1],600);
});
