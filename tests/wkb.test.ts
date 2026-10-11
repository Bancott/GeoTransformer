import { describe, it, expect } from 'vitest';
import { geoJSONToWKBHex, wkbToGeometry, wkbToGeoJSON } from '@/format/wkb';

const pointFC = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [116.391, 39.907] } }],
} as never;

describe('WKB 十六进制往返', () => {
  it('Point 写出为小端 hex，且可解析', () => {
    const hex = geoJSONToWKBHex(pointFC);
    expect(/^01/.test(hex)).toBe(true); // 小端字节序标志
    const g = wkbToGeometry(hex) as { type: string; coordinates: number[] };
    expect(g.type).toBe('Point');
    expect(g.coordinates[0]).toBeCloseTo(116.391, 6);
    expect(g.coordinates[1]).toBeCloseTo(39.907, 6);
  });

  it('LineString 往返一致', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 0]] } },
      ],
    } as never;
    const hex = geoJSONToWKBHex(fc);
    const back = wkbToGeometry(hex) as { type: string; coordinates: number[][] };
    expect(back.type).toBe('LineString');
    expect(back.coordinates).toEqual([[0, 0], [1, 1], [2, 0]]);
  });

  it('Polygon 往返一致', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        },
      ],
    } as never;
    const hex = geoJSONToWKBHex(fc);
    const back = wkbToGeometry(hex) as { type: string; coordinates: number[][][] };
    expect(back.type).toBe('Polygon');
    expect(back.coordinates).toEqual([[[0, 0], [1, 0], [1, 1], [0, 0]]]);
  });
});

describe('wkbToGeoJSON', () => {
  it('生成 FeatureCollection', () => {
    const hex = geoJSONToWKBHex(pointFC);
    const fc = wkbToGeoJSON(hex);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
  });
});
