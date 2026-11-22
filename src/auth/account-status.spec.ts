import { isAccountActive } from './account-status';

describe('isAccountActive', () => {
  it('accepts an active login and employee', () => {
    expect(
      isAccountActive({ auth: { isActive: true }, staff: { isActive: true } }),
    ).toBe(true);
  });

  it('accepts a user without an employee record', () => {
    expect(isAccountActive({ auth: { isActive: true }, staff: null })).toBe(
      true,
    );
  });

  it('rejects a deactivated employee', () => {
    expect(
      isAccountActive({ auth: { isActive: true }, staff: { isActive: false } }),
    ).toBe(false);
  });

  it('rejects a closed login', () => {
    expect(
      isAccountActive({ auth: { isActive: false }, staff: { isActive: true } }),
    ).toBe(false);
  });
});
