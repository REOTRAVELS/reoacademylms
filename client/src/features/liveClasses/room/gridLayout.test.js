import { describe, expect, it } from 'vitest';
import { computeGrid, maxTilesPerPage, paginate, promoteSpeakers } from './gridLayout.js';

describe('computeGrid', () => {
  it('gives a single participant the largest 16:9 tile that fits', () => {
    const grid = computeGrid(1, 1280, 720, 8);
    expect(grid.cols).toBe(1);
    expect(grid.tileW).toBe(1280);
    expect(grid.tileH).toBe(720);
  });

  it('never exceeds the container and keeps the 16:9 ratio', () => {
    for (const count of [2, 3, 4, 5, 6, 9, 16]) {
      for (const [w, h] of [[1920, 900], [1024, 600], [390, 600], [768, 1000]]) {
        const grid = computeGrid(count, w, h, 8);
        expect(grid.cols * grid.tileW + (grid.cols - 1) * 8).toBeLessThanOrEqual(w);
        expect(grid.rows * grid.tileH + (grid.rows - 1) * 8).toBeLessThanOrEqual(h);
        expect(Math.abs(grid.tileW / grid.tileH - 16 / 9)).toBeLessThan(0.05);
      }
    }
  });

  it('stacks tiles on a portrait phone instead of making them tiny', () => {
    const grid = computeGrid(2, 390, 700, 8);
    expect(grid.cols).toBe(1);
  });

  it('handles empty input', () => {
    expect(computeGrid(0, 800, 600).tileW).toBe(0);
  });
});

describe('paging', () => {
  it('caps tiles per page by screen size', () => {
    expect(maxTilesPerPage(390, 800)).toBe(6);
    expect(maxTilesPerPage(1440, 800)).toBe(16);
  });

  it('paginates and clamps the page', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: String(i) }));
    expect(paginate(items, 0, 16).items).toHaveLength(16);
    expect(paginate(items, 9, 16).page).toBe(1);
    expect(paginate(items, 1, 16).items).toHaveLength(4);
  });

  it('moves a hidden speaker onto the first page without displacing the local user or host', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ id: String(i), isLocal: i === 0, isHost: i === 1 }));
    const result = promoteSpeakers(items, new Set(['7']), 4);
    expect(result.slice(0, 4).map((i) => i.id)).toContain('7');
    expect(result[0].id).toBe('0');
    expect(result[1].id).toBe('1');
  });
});
