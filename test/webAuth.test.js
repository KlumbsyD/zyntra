const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Both the top-level and nested copies ship this module; guard both.
const copies = {
  'root src': require('../src/webAuth'),
  'nested zyntra/src': require('../zyntra/src/webAuth'),
};

for (const [label, { resolveWebAuth }] of Object.entries(copies)) {
  describe(label, () => {
    test('disables the dashboard when WEB_PASSWORD is unset', () => {
      const result = resolveWebAuth('');
      assert.equal(result.enabled, false);
      assert.match(result.reason, /not set/i);
    });

    test('disables the dashboard when WEB_PASSWORD is whitespace only', () => {
      assert.equal(resolveWebAuth('   ').enabled, false);
    });

    test('disables the dashboard for the insecure "changeme" default (any case)', () => {
      assert.equal(resolveWebAuth('changeme').enabled, false);
      assert.equal(resolveWebAuth('ChangeMe').enabled, false);
    });

    test('disables the dashboard for other obvious weak defaults', () => {
      assert.equal(resolveWebAuth('password').enabled, false);
      assert.equal(resolveWebAuth('admin').enabled, false);
    });

    test('enables the dashboard for a strong password and preserves it', () => {
      const result = resolveWebAuth('a-Str0ng-p@ssphrase');
      assert.equal(result.enabled, true);
      assert.equal(result.password, 'a-Str0ng-p@ssphrase');
    });
  });
}
