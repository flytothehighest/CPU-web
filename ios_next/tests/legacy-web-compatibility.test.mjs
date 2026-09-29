import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../CpuTime/CpuTime/Resources/LegacyWebCompatibility.js', import.meta.url), 'utf8');
function oldSafari() {
  const context = vm.createContext({});
  vm.runInContext('delete Object.hasOwn; delete Array.prototype.at;', context);
  vm.runInContext(source, context);
  return context;
}

test('iOS 15 fallback matches native at for indexes and array-like receivers', () => {
  const context = oldSafari();
  const at = vm.runInContext('Array.prototype.at', context);
  for (const value of [[1, 2, 3], [], {0: 'a', 1: 'b', length: 2}, 'abc', {0: 4, length: NaN}]) {
    for (const index of [undefined, NaN, 0, -0, 1.9, -1.9, -1, -8, 8, Infinity, -Infinity, '1']) {
      assert.equal(at.call(value, index), Array.prototype.at.call(value, index));
    }
  }
  for (const value of [null, undefined]) assert.throws(() => at.call(value, 0), {name: 'TypeError'});
  for (const index of [1n, Symbol('index')]) assert.throws(() => at.call([1], index), {name: 'TypeError'});
  assert.equal(vm.runInContext('Object.getOwnPropertyDescriptor(Array.prototype, "at").enumerable', context), false);
});

test('iOS 15 hasOwn supports null prototypes, symbols and shadowed methods', () => {
  const context = oldSafari();
  const hasOwn = vm.runInContext('Object.hasOwn', context);
  const key = Symbol('key');
  const values = [{a: undefined, hasOwnProperty: null}, Object.assign(Object.create(null), {a: 1}), {[key]: 2}, 'abc'];
  for (const value of values) for (const property of ['a', 'toString', 'hasOwnProperty', '0', key]) {
    assert.equal(hasOwn(value, property), Object.hasOwn(value, property));
  }
  assert.throws(() => hasOwn(null, 'a'), {name: 'TypeError'});
  assert.throws(() => hasOwn(undefined, 'a'), {name: 'TypeError'});
});

test('newer WebKit built-ins remain unchanged', () => {
  const context = vm.createContext({});
  const originalAt = vm.runInContext('Array.prototype.at', context);
  const originalHasOwn = vm.runInContext('Object.hasOwn', context);
  vm.runInContext(source, context);
  assert.equal(vm.runInContext('Array.prototype.at', context), originalAt);
  assert.equal(vm.runInContext('Object.hasOwn', context), originalHasOwn);
});
