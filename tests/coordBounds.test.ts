// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { checkLngLatRange, isLngLatDegrees, rangeErrorHint } from '@/core/coordBounds';
import { projectionKind, MERC_CODE_GCJ, GEO_CODE_GCJ } from '@/core/reproject';
import { requiresLngLat, assertWritableCoords, DEGREE_ONLY_TARGETS } from '@/tools/outputTargets';
import { kmlToGeoJSON, geoJSONToKML } from '@/format/kml';
import { reprojectFeatureCollection } from '@/core/reproject';
import type { FeatureCollection } from 'geojson';

function fcWith(coords: number[][]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: coords.map((c) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: c },
    })),
  };
}

describe('projectionKind', () => {
  it('EPSG:4326 是地理坐标系（回归：proj4.defs 返回对象而非字符串）', () => {
    expect(projectionKind('EPSG:4326')).toBe('geographic');
  });

  it('EPSG:4490（CGCS2000 经纬度）是地理坐标系', () => {
    expect(projectionKind('EPSG:4490')).toBe('geographic');
  });

  it('EPSG:3857 是投影坐标系', () => {
    expect(projectionKind('EPSG:3857')).toBe('projected');
  });

  it('伪代码：GCJ02 为地理，GCJ02 墨卡托为投影', () => {
    expect(projectionKind(GEO_CODE_GCJ)).toBe('geographic');
    expect(projectionKind(MERC_CODE_GCJ)).toBe('projected');
  });

  it('未注册代码返回 unknown', () => {
    expect(projectionKind('EPSG:999999')).toBe('unknown');
  });

  it('自定义 proj4 字符串按投影类型识别', () => {
    expect(projectionKind('+proj=longlat +datum=WGS84 +no_defs')).toBe('geographic');
    expect(projectionKind('+proj=merc +a=6378137 +b=6378137 +units=m +no_defs')).toBe('projected');
  });
});

describe('checkLngLatRange', () => {
  it('经纬度坐标通过校验', () => {
    const r = checkLngLatRange(fcWith([[116.39, 39.9], [-74.0, 40.7], [180, 90]]));
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(3);
  });

  it('投影米制坐标被拦下并给出越界点', () => {
    const r = checkLngLatRange(fcWith([[116.39, 39.9], [12956609.11, 4852509.52]]));
    expect(r.ok).toBe(false);
    expect(r.offender).toEqual([12956609.11, 4852509.52]);
    expect(rangeErrorHint(r)).toContain('12956609.11');
  });

  it('纬度超出 ±90 也算越界', () => {
    expect(isLngLatDegrees(fcWith([[116.39, 391.5]]))).toBe(false);
  });

  it('空集合视为通过', () => {
    expect(checkLngLatRange({ type: 'FeatureCollection', features: [] }).ok).toBe(true);
  });

  it('嵌套几何（线/面）里的坐标同样被检查', () => {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'MultiPolygon',
            coordinates: [[[[116.1, 39.1], [12956609, 39.1], [116.2, 39.2], [116.1, 39.1]]]],
          },
        },
      ],
    };
    expect(isLngLatDegrees(fc)).toBe(false);
  });

  it('高程不影响判断', () => {
    expect(isLngLatDegrees(fcWith([[116.39, 39.9, 12345]]))).toBe(true);
  });
});

describe('requiresLngLat / assertWritableCoords', () => {
  it('KML / GPX / OSM 要求经纬度，其它格式不要求', () => {
    expect(DEGREE_ONLY_TARGETS).toEqual(['KML', 'GPX', 'OSM']);
    expect(requiresLngLat('KML')).toBe(true);
    expect(requiresLngLat('GPX')).toBe(true);
    expect(requiresLngLat('OSM')).toBe(true);
    expect(requiresLngLat('GeoJSON')).toBe(false);
    expect(requiresLngLat('WKT')).toBe(false);
    expect(requiresLngLat('Shapefile')).toBe(false);
  });

  it('投影坐标写 KML 时抛错并给出可操作提示', () => {
    const projected = fcWith([[12956609.11, 4852509.52]]);
    expect(() => assertWritableCoords(projected, 'KML')).toThrow(/只能表示经纬度/);
    expect(() => assertWritableCoords(projected, 'GPX')).toThrow(/EPSG:4326/);
    // 同样数据写 GeoJSON / WKT 不受限制
    expect(() => assertWritableCoords(projected, 'GeoJSON')).not.toThrow();
    expect(() => assertWritableCoords(projected, 'WKT')).not.toThrow();
  });

  it('经纬度数据写 KML 正常通过', () => {
    expect(() => assertWritableCoords(fcWith([[116.39, 39.9]]), 'KML')).not.toThrow();
  });
});

describe('端到端：投影后再写 KML', () => {
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>点</name>
<Point><coordinates>116.3912,39.9075,0</coordinates></Point></Placemark></Document></kml>`;

  it('WGS84 → EPSG:3857（米）之后不能再写 KML', () => {
    const projected = reprojectFeatureCollection(kmlToGeoJSON(kml), 'EPSG:4326', 'EPSG:3857');
    expect(() => assertWritableCoords(projected, 'KML')).toThrow(/超出经纬度范围/);
    // 说明如果没有拦截，就会写出这样的坏文件
    expect(geoJSONToKML(projected, 'x')).toContain('12956609');
  });

  it('WGS84 → GCJ02（度）之后可以正常写 KML', () => {
    const shifted = reprojectFeatureCollection(kmlToGeoJSON(kml), 'EPSG:4326', 'GCJ02');
    expect(() => assertWritableCoords(shifted, 'KML')).not.toThrow();
    const out = geoJSONToKML(shifted, 'x');
    expect(out).toContain('116.39744');
  });
});
