import { isWritable } from './entitlement.service';

const now = new Date('2026-10-01T00:00:00Z');
const past = new Date('2026-09-01T00:00:00Z');
const future = new Date('2026-11-01T00:00:00Z');
const sub = (status: string, extra: { trialEndsAt?: Date | null; graceEndsAt?: Date | null } = {}) =>
  ({ status, trialEndsAt: null, graceEndsAt: null, ...extra }) as Parameters<typeof isWritable>[0];

describe('subscription writability', () => {
  it.each([
    ['ACTIVE', {}, true],
    ['PAST_DUE', {}, true],
    ['TRIALING', { trialEndsAt: future }, true],
    ['TRIALING', { trialEndsAt: past }, false],
    ['GRACE', { graceEndsAt: future }, true],
    ['GRACE', { graceEndsAt: past }, false],
    ['GRACE', {}, false],
    ['RESTRICTED', {}, false],
    ['CANCELED', {}, false],
    ['EXPIRED', {}, false],
  ])('%s %o -> %s', (status, extra, expected) => {
    expect(isWritable(sub(status, extra), now)).toBe(expected);
  });
});
