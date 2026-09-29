// Safari 15.0–15.3 lack these built-ins used by the website. This script only
// supplies missing standard APIs; it does not advertise a native feature bridge.
(() => {
  'use strict';
  if (typeof Object.hasOwn !== 'function') {
    Object.defineProperty(Object, 'hasOwn', {
      configurable: true, writable: true,
      value: function hasOwn(object, key) {
        if (object === null || object === undefined) throw new TypeError('Cannot convert null or undefined to object');
        return Object.prototype.hasOwnProperty.call(object, key);
      }
    });
  }
  if (typeof Array.prototype.at !== 'function') {
    Object.defineProperty(Array.prototype, 'at', {
      configurable: true, writable: true,
      value: function at(index) {
        if (this === null || this === undefined) throw new TypeError('Cannot convert null or undefined to object');
        const object = Object(this);
        const rawLength = +object.length;
        const length = Number.isNaN(rawLength) || rawLength <= 0 ? 0 : Math.min(Math.floor(rawLength), Number.MAX_SAFE_INTEGER);
        const number = +index;
        const integer = Number.isNaN(number) ? 0 : Math.trunc(number);
        const offset = integer < 0 ? length + integer : integer;
        return offset < 0 || offset >= length ? undefined : object[offset];
      }
    });
  }
})();
