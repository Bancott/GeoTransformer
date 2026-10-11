import { describe, it, expect } from 'vitest';
import { reprojectCoord, reprojectFeatureCollection } from '@/core/reproject';

const EPS = 1e-4;
const close = (a: number, b: number, eps = EPS) => Math.abs(a - b) < eps;

describe('reprojectCoord (proj4)', () => {
  it('EPSG:4326 -> EPSG:3857 原点不变', () => {
    const out = reprojectCoord([0, 0], 'EPSG:4326', 'EPSG:3857');
    expect(close(out[0], 0)).toBe(true);
    expect(close(out[1], 0)).toBe(true);
  });

  it('4326 <-> 3857 往返一致', () => {
    const src: [number, number] = [116.39128, 39.90752];
    const to3857 = reprojectCoord(src, 'EPSG:4326', 'EPSG:3857');
    const back = reprojectCoord(
      [to3857[0], to3857[1]],
      'EPSG:3857',
      'EPSG:4326'
    );
    expect(close(back[0], src[0], 1e-5)).toBe(true);
    expect(close(back[1], src[1], 1e-5)).toBe(true);
  });

  it('投影坐标系输出使用米单位（数值远大于经纬度）', () => {
    const out = reprojectCoord([116.39, 39.9], 'EPSG:4326', 'EPSG:3857');
    expect(Math.abs(out[0])).toBeGreaterThan(1e6);
    expect(Math.abs(out[1])).toBeGreaterThan(1e5);
  });
});

describe('reprojectFeatureCollection', () => {
  it('转换点并返回相同数量的要素', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [116.39, 39.9] },
        },
      ],
    };
    const out = reprojectFeatureCollection(fc as never, 'EPSG:4326', 'EPSG:3857');
    expect(out.features).toHaveLength(1);
    const c = (out.features[0].geometry as { coordinates: number[] }).coordinates;
    expect(Math.abs(c[0])).toBeGreaterThan(1e6);
  });

  it('annotate 会写入 source/target CRS', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { x: 1 },
          geometry: { type: 'Point', coordinates: [116, 40] },
        },
      ],
    };
    const out = reprojectFeatureCollection(fc as never, 'EPSG:4326', 'EPSG:3857', {
      annotate: true,
    });
    const p = out.features[0].properties as Record<string, unknown>;
    expect(p['*sourceCRS']).toBe('EPSG:4326');
    expect(p['*targetCRS']).toBe('EPSG:3857');
  });
});
