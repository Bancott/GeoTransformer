import { describe, it, expect } from 'vitest';
import {
  outOfChina,
  wgs84ToGcj02,
  gcj02ToWgs84,
  gcj02ToBd09,
  bd09ToGcj02,
  wgs84ToBd09,
  bd09ToWgs84,
  convertCoord,
  convertFeatureCollection,
} from '@/core/coordTransform';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const closePair = (a: [number, number], b: [number, number], eps = 1e-6) =>
  close(a[0], b[0], eps) && close(a[1], b[1], eps);

describe('outOfChina', () => {
  it('中国境外返回 true', () => {
    expect(outOfChina(0, 0)).toBe(true);
    expect(outOfChina(-73, 40)).toBe(true);
  });
  it('中国境内返回 false', () => {
    expect(outOfChina(116.39, 39.9)).toBe(false);
  });
});

describe('wgs84 <-> gcj02', () => {
  it('北京天安门 WGS84 -> GCJ-02 产生约 0.006 度的偏移', () => {
    const [gcjLng, gcjLat] = wgs84ToGcj02(116.39128, 39.90752);
    expect(Math.abs(gcjLng - 116.39128)).toBeGreaterThan(0.001);
    expect(Math.abs(gcjLat - 39.90752)).toBeGreaterThan(0.001);
  });

  it('GCJ-02 <-> WGS-84 往返一致', () => {
    for (const p of [
      [116.397428, 39.90923],
      [121.47332, 31.23042],
      [113.27436, 23.10909],
    ] as [number, number][]) {
      const wgs = gcj02ToWgs84(p[0], p[1]);
      const back = wgs84ToGcj02(wgs[0], wgs[1]);
      expect(closePair(back as [number, number], p, 1e-6)).toBe(true);
    }
  });
});

describe('wgs84 <-> bd09', () => {
  it('BD-09 <-> WGS-84 往返一致', () => {
    const p: [number, number] = [116.397, 39.909];
    const bd = wgs84ToBd09(p[0], p[1]);
    const wgs = bd09ToWgs84(bd[0], bd[1]);
    expect(closePair(wgs as [number, number], p, 1e-5)).toBe(true);
  });

  it('GCJ-02 -> BD-09 -> GCJ-02 往返一致', () => {
    const p: [number, number] = [116.397, 39.909];
    const bd = gcj02ToBd09(p[0], p[1]);
    const back = bd09ToGcj02(bd[0], bd[1]);
    expect(closePair(back as [number, number], p, 1e-5)).toBe(true);
  });
});

describe('convertCoord', () => {
  it('相同坐标系原样返回', () => {
    expect(convertCoord('WGS84', 'WGS84', [116, 40])).toEqual([116, 40]);
  });
  it('WGS84 -> GCJ02 -> WGS84 往返一致', () => {
    const to = convertCoord('WGS84', 'GCJ02', [116.39128, 39.90752]);
    const back = convertCoord('GCJ02', 'WGS84', to as [number, number]);
    expect(closePair(back as [number, number], [116.39128, 39.90752], 1e-6)).toBe(true);
  });
});

describe('convertFeatureCollection', () => {
  it('转换点要素坐标', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'a' },
          geometry: { type: 'Point', coordinates: [116.39128, 39.90752] },
        },
      ],
    };
    const out = convertFeatureCollection(fc as never, 'WGS84', 'GCJ02');
    const coord = (out.features[0].geometry as { coordinates: number[] }).coordinates;
    expect(coord[0]).not.toBeCloseTo(116.39128, 3);
    expect(coord[1]).not.toBeCloseTo(39.90752, 3);
  });
});
