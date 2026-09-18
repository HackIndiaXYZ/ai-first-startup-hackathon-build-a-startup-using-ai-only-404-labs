import assert from 'assert';
import { assertNoSensitiveData, SensitiveCredentialError } from '../../src/security/sensitive-data';

console.log('🧪 RUNNING TEST: Sensitive Credentials Unit Test\n');

// Test 1: Safe payload passes
assert.doesNotThrow(() => {
  assertNoSensitiveData({
    amount: 2499,
    merchant: 'TechStore',
    purpose: 'Keyboard purchase',
  });
});
console.log('  ✓ Test 1 Passed: Safe non-sensitive payload passes');

// Test 2: UPI PIN rejected
assert.throws(() => {
  assertNoSensitiveData({
    amount: 2499,
    upi_pin: '1234',
  });
}, (err: any) => err instanceof SensitiveCredentialError && err.code === 'SENSITIVE_CREDENTIAL_REJECTED');
console.log('  ✓ Test 2 Passed: Reject "upi_pin" key in payload');

// Test 3: Nested OTP rejected
assert.throws(() => {
  assertNoSensitiveData({
    user: {
      auth: {
        otp: '987654',
      },
    },
  });
}, (err: any) => err instanceof SensitiveCredentialError && err.code === 'SENSITIVE_CREDENTIAL_REJECTED');
console.log('  ✓ Test 3 Passed: Reject nested "otp" key');

// Test 4: CVV rejected
assert.throws(() => {
  assertNoSensitiveData({
    card: {
      cvv: '123',
    },
  });
}, (err: any) => err instanceof SensitiveCredentialError && err.code === 'SENSITIVE_CREDENTIAL_REJECTED');
console.log('  ✓ Test 4 Passed: Reject "cvv" credential');

// Test 5: String credential pattern rejected
assert.throws(() => {
  assertNoSensitiveData('Please confirm with upi pin: 9988');
}, (err: any) => err instanceof SensitiveCredentialError);
console.log('  ✓ Test 5 Passed: Reject credential pattern inside raw string');

console.log('\n🎉 Sensitive Credentials Unit Test PASSED\n');
