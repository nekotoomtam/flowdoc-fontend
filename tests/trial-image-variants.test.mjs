import assert from 'node:assert/strict';
import test from 'node:test';
import { planTrialImageVariants } from '../scripts/trial-preview-images.mjs';

test('repeated image fields follow their own print frame at Service resolution', () => {
  const source = '11111111-1111-4111-8111-111111111111';
  const sources = new Map([[source, { width: 1800, height: 18 }]]);
  const frame = (value, unit) => ({
    props: { resourceId: source, width: { value, unit }, height: { value: 2.88, unit: 'pt' } },
  });
  const nodes = [frame(293.04, 'pt'), frame(293.04, 'pt'), frame(25.4, 'mm')];
  const original = structuredClone(nodes);
  const variants = [...planTrialImageVariants(nodes, sources)];
  assert.deepEqual(variants.map(({ width, height }) => [width, height]), [[814, 8], [200, 8]]);
  assert.equal(nodes[0].props.resourceId, nodes[1].props.resourceId);
  assert.notEqual(nodes[0].props.resourceId, nodes[2].props.resourceId);
  assert.deepEqual([...planTrialImageVariants(original, sources)], variants);
});
