jest.mock('../prisma', () => ({ __esModule: true, default: {} }));

import { hashSnapshotPayload, stableJson } from './professionalOnboarding.service';

describe('professional onboarding snapshot canonicalization', () => {
  it('produce JSON y hash estables sin depender del orden de claves', () => {
    const first = { z: 1, nested: { b: ['x', { y: true, x: null }], a: 2 } };
    const second = { nested: { a: 2, b: ['x', { x: null, y: true }] }, z: 1 };
    expect(stableJson(first)).toBe(stableJson(second));
    expect(hashSnapshotPayload(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSnapshotPayload(first)).toBe(hashSnapshotPayload(second));
  });

  it('omite campos undefined del payload canónico', () => {
    expect(stableJson({ included: 1, omitted: undefined })).toBe('{"included":1}');
  });
});
