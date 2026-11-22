import assert from 'node:assert/strict';
import test from 'node:test';
import { BASE_POSITIONS, baseLayout } from '../docs/ui/base-layout.js';

for (const [viewportWidth, viewportHeight] of [
  [1920, 1080], [1366, 768], [1024, 768], [2560, 1080], [844, 390], [915, 412], [390, 844],
]) {
  test(`base artwork covers ${viewportWidth}×${viewportHeight} with aligned foundations`, () => {
    const { width, height, left, top } = baseLayout(viewportWidth, viewportHeight);
    const epsilon = .001;
    assert.ok(Math.abs(width / height - 1536 / 858) < epsilon, 'artwork is undistorted');
    assert.ok(left <= epsilon && top <= epsilon, 'no gap at top or left');
    assert.ok(left + width >= viewportWidth - epsilon && top + height >= viewportHeight - epsilon,
      'no gap at bottom or right');
    if (viewportWidth < viewportHeight) return;
    for (const [x, y, plotWidth, plotHeight] of BASE_POSITIONS) {
      assert.ok(left + width * (x - plotWidth / 2) / 100 >= 0);
      assert.ok(left + width * (x + plotWidth / 2) / 100 <= viewportWidth);
      assert.ok(top + height * (y - plotHeight / 2) / 100 >= 0);
      assert.ok(top + height * (y + plotHeight / 2) / 100 <= viewportHeight);
    }
  });
}
