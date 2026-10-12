const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restoreDesign, restoreAudioLanguages, mergeSavedConfig, actionInk } = require('./load-ts.cjs')('interface/preferences');

test('new design settings restore independently of the legacy fallback', () => {
  assert.deepEqual(restoreDesign({uiLayout:'classic',design:{mainStyle:'poetry',navigation:'hover'}}),{mainStyle:'poetry',navigation:'hover'});
  assert.deepEqual(restoreDesign({uiLayout:'classic'}),{mainStyle:'classic',navigation:'persistent'});
  assert.deepEqual(restoreDesign({uiLayout:'studio',design:{mainStyle:'bad',navigation:'bad'}}),{mainStyle:'workbench',navigation:'persistent'});
});
test('audio language overrides validate each channel and reject auto target', () => {
  assert.deepEqual(restoreAudioLanguages({system:{src:'ja',tgt:'zh'},mic:{src:'ko',tgt:'en'}}),{system:{src:'ja',tgt:'zh'},mic:{src:'ko',tgt:'en'}});
  assert.deepEqual(restoreAudioLanguages({system:{src:'bad',tgt:'zh'},mic:{src:'auto',tgt:'auto'}}),{system:null,mic:null});
  for (const value of [null,42,'broken']) assert.deepEqual(restoreAudioLanguages(value),{system:null,mic:null});
});
test('saving design preferences preserves unrelated config and nested settings', () => {
  const old={custom:'keep',settings:{custom:'keep',audio:{custom:true,denoise:false},translate:{numCtx:2048},design:{future:true}}};
  const next=mergeSavedConfig(old,{configVersion:3,settings:{uiLayout:'studio',design:{mainStyle:'poetry'},audio:{denoise:true}}});
  assert.equal(next.custom,'keep');assert.equal(next.settings.audio.custom,true);assert.equal(next.settings.audio.denoise,true);
  assert.equal(next.settings.translate.numCtx,2048);assert.equal(next.settings.design.future,true);
  assert.equal(old.settings.audio.denoise,false);
});
test('accent button text chooses the stronger contrast', () => {
  assert.equal(actionInk('#ffffff'),'#171513');assert.equal(actionInk('#000000'),'#ffffff');
  assert.equal(actionInk('#C8886D'),'#171513');
});
