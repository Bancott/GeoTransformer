import { describe, it, expect } from 'vitest';
import { convertGeographicCoord, convertGeographicFeatureCollection } from '@/core/datum';

const closePair = (a: [number, number], b: [number, number], eps = 1e-6) =>
  Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;

describe('地理坐标系（含基准）互转', () => {
  it('WGS84 -> GCJ02 与协调系一致', () => {
    const out = convertGeographicCoord('WGS84', 'GCJ02', [116.39128, 39.90752]) as [number, number];
    expect(out[0]).toBeGreaterThan(116.391);
    expect(out[1]).toBeGreaterThan(39.907);
  });
  it('CGCS2000 / GRS80 近似恒等（亚米级）', () => {
    const p: [number, number] = [116.39128, 39.90752];
    expect(closePair(convertGeographicCoord('WGS84', 'CGCS2000', p) as [number, number], p)).toBe(true);
    expect(closePair(convertGeographicCoord('WGS84', 'GRS80', p) as [number, number], p)).toBe(true);
  });
  it('PZ90 产生数米级偏移', () => {
    const p: [number, number] = [37.62, 55.75]; // 莫斯科
    const out = convertGeographicCoord('WGS84', 'PZ90', p) as [number, number];
    const d = Math.hypot(out[0] - p[0], out[1] - p[1]);
    expect(d).toBeGreaterThan(1e-6); // 非零
  });
  it('PZ90 与 WGS84 往返一致', () => {
    const p: [number, number] = [116.39, 39.9];
    const toPz = convertGeographicCoord('WGS84', 'PZ90', p) as [number, number];
    const back = convertGeographicCoord('PZ90', 'WGS84', toPz) as [number, number];
    expect(closePair(back, p, 1e-7)).toBe(true);
  });
});

describe('convertGeographicFeatureCollection', () => {
  it('转换点要素', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [116.39, 39.9] } },
      ],
    } as never;
    const out = convertGeographicFeatureCollection(fc, 'WGS84', 'GCJ02');
    const c = (out.features[0].geometry as { coordinates: number[] }).coordinates;
    expect(c[0]).toBeGreaterThan(116.39);
  });
});
