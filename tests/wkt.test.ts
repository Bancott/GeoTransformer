import { describe, it, expect } from 'vitest';
import { wktToGeometry, geometryToWKT, wktToGeoJSON, geoJSONToWKT } from '@/format/wkt';

describe('WKT 解析', () => {
  it('POINT', () => {
    const g = wktToGeometry('POINT (116.391 39.907)') as { type: string; coordinates: number[] };
    expect(g.type).toBe('Point');
    expect(g.coordinates[0]).toBeCloseTo(116.391, 6);
    expect(g.coordinates[1]).toBeCloseTo(39.907, 6);
  });
  it('LINESTRING', () => {
    const g = wktToGeometry('LINESTRING (0 0, 1 1, 2 0)') as { type: string; coordinates: number[][] };
    expect(g.type).toBe('LineString');
    expect(g.coordinates).toHaveLength(3);
    expect(g.coordinates[1]).toEqual([1, 1]);
  });
  it('POLYGON', () => {
    const g = wktToGeometry('POLYGON ((0 0, 1 0, 1 1, 0 0))') as { coordinates: number[][][] };
    expect(g.coordinates).toHaveLength(1);
    expect(g.coordinates[0]).toHaveLength(4);
  });
  it('GeometryCollection', () => {
    const g = wktToGeometry('GEOMETRYCOLLECTION (POINT (1 2), LINESTRING (0 0, 1 1))') as {
      type: string;
      geometries: { type: string }[];
    };
    expect(g.geometries).toHaveLength(2);
  });
  it('支持 Z 维度（忽略）', () => {
    const g = wktToGeometry('POINT (116.391 39.907 12.5)') as { coordinates: number[] };
    expect(g.coordinates[0]).toBeCloseTo(116.391, 6);
    expect(g.coordinates[1]).toBeCloseTo(39.907, 6);
  });
});

describe('WKT 写出', () => {
  it('Point -> POINT', () => {
    expect(geometryToWKT({ type: 'Point', coordinates: [116.391, 39.907] })).toMatch(/^POINT \(/);
  });
  it('往返一致', () => {
    const src = { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 0]] } as never;
    const back = wktToGeometry(geometryToWKT(src));
    expect((back as { coordinates: number[][] }).coordinates).toEqual([[0, 0], [1, 1], [2, 0]]);
  });
});

describe('WKT <-> GeoJSON', () => {
  it('多行解析为多要素', () => {
    const fc = wktToGeoJSON('POINT (1 2)\nLINESTRING (0 0, 1 1)');
    expect(fc.features).toHaveLength(2);
  });
  it('geoJSONToWKT 单要素', () => {
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } }] };
    expect(geoJSONToWKT(fc as never)).toMatch(/^POINT/);
  });
});
