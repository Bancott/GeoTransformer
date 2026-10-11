// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { kmlToGeoJSON, geoJSONToKML, convertKmlText } from '@/format/kml';
import { convertGpxText, gpxToGeoJSON } from '@/format/gpx';
import { dropZ, hasZ } from '@/core/coordBounds';
import { projectionKind, GEO_CODE_GCJ, GEO_CODE_BD09, MERC_CODE_GCJ } from '@/core/reproject';
import type { CoordShift } from '@/core/types';
import type { FeatureCollection } from 'geojson';

const IDENTITY: CoordShift = (lng, lat) => [lng, lat];

/* --------------------------- KML 写出不再凭空补 Z --------------------------- */

const kmlNoAlt = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>
<LineString><coordinates>116.3912,39.9075 116.3940,39.9090</coordinates></LineString></Placemark></Document></kml>`;

const kmlWithAlt = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>
<LineString><coordinates>116.3912,39.9075,45.5 116.3940,39.9090,46.1</coordinates></LineString></Placemark></Document></kml>`;

describe('KML 高程（Z）写出', () => {
  it('二维 GeoJSON 写出的 KML 不带第三个分量（回归：以前会补 ,0）', () => {
    const out = geoJSONToKML(kmlToGeoJSON(kmlNoAlt), 'x');
    expect(out).toContain('<coordinates>116.3912000,39.9075000 116.3940000,39.9090000</coordinates>');
    expect(out).not.toMatch(/39\.9075000,0\b/);
  });

  it('三维 GeoJSON 的高程被保留', () => {
    const out = geoJSONToKML(kmlToGeoJSON(kmlWithAlt), 'x');
    expect(out).toContain('116.3912000,39.9075000,45.500');
    expect(out).toContain('116.3940000,39.9090000,46.100');
  });

  it('KML → GeoJSON → KML 往返不再引入 Z（这是 QGIS 显示 4979 的根因之一）', () => {
    const fc = kmlToGeoJSON(kmlNoAlt);
    expect(hasZ(fc)).toBe(false);
    const back = kmlToGeoJSON(geoJSONToKML(fc, 'x'));
    expect(hasZ(back)).toBe(false);
  });

  it('原本带高程的数据往返后仍是三维', () => {
    const fc = kmlToGeoJSON(kmlWithAlt);
    expect(hasZ(fc)).toBe(true);
    expect(hasZ(kmlToGeoJSON(geoJSONToKML(fc, 'x')))).toBe(true);
  });
});

/* ------------------------------ 降维 dropZ ------------------------------ */

describe('dropZ', () => {
  const fcz: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'p' },
        geometry: { type: 'MultiPolygon', coordinates: [[[[116.1, 39.1, 5], [116.2, 39.1, 6]]]] },
      },
    ],
  };

  it('去掉嵌套几何里的第三个分量', () => {
    const out = dropZ(fcz);
    expect(hasZ(out)).toBe(false);
    const ring = (out.features[0].geometry as { coordinates: number[][][][] }).coordinates[0][0][0];
    expect(ring).toEqual([116.1, 39.1]);
  });

  it('属性与几何类型保持不变', () => {
    const out = dropZ(fcz);
    expect(out.features[0].properties).toEqual({ name: 'p' });
    expect(out.features[0].geometry?.type).toBe('MultiPolygon');
  });

  it('无几何的要素不受影响', () => {
    // 刻意构造 null 几何：@types/geojson 的默认泛型不表达 null，但真实数据里存在
    const input = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: null }],
    } as unknown as FeatureCollection;
    const out = dropZ(input);
    expect(out.features[0].geometry).toBeNull();
  });
});

/* ------------------------ 就地改写的高程丢弃选项 ------------------------ */

describe('就地改写 dropAltitude', () => {
  const gxKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><Placemark>
<gx:Track><when>2026-01-01T08:00:00Z</when>
<gx:coord>116.3912 39.9075 45.5</gx:coord>
<gx:coord>116.3940 39.9090 46.1</gx:coord></gx:Track></Placemark></Document></kml>`;

  it('保留高程时坐标不变', () => {
    const out = convertKmlText(gxKml, IDENTITY);
    expect(out).toContain('116.3912 39.9075 45.5');
  });

  it('丢弃高程时 gx:coord 只剩经纬度，其它结构不变', () => {
    const out = convertKmlText(gxKml, IDENTITY, { dropAltitude: true });
    expect(out).toContain('116.3912 39.9075<');
    expect(out).not.toContain('45.5');
    expect(out).toContain('<when>2026-01-01T08:00:00Z</when>');
    expect(out).toContain('gx:Track');
  });

  it('<coordinates> 也会去掉高程', () => {
    const out = convertKmlText(kmlWithAlt, IDENTITY, { dropAltitude: true });
    expect(out).toContain('116.3912,39.9075 116.394,39.909<');
  });

  it('GPX 丢弃高程时移除 <ele>，保留 <time>', () => {
    const gpx = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
<trkpt lat="39.9" lon="116.39"><ele>45.5</ele><time>2026-01-01T08:00:00Z</time></trkpt>
<trkpt lat="39.91" lon="116.41"><ele>46.1</ele><time>2026-01-01T08:00:10Z</time></trkpt>
</trkseg></trk></gpx>`;
    const kept = convertGpxText(gpx, IDENTITY);
    expect(kept).toContain('<ele>45.5</ele>');

    const dropped = convertGpxText(gpx, IDENTITY, { dropAltitude: true });
    expect(dropped).not.toContain('ele');
    expect(dropped).toContain('<time>2026-01-01T08:00:00Z</time>');
    // 仍然是有效的 GPX，能解析出坐标，且解析结果不含 Z
    const fc = gpxToGeoJSON(dropped);
    expect(fc.features).toHaveLength(1);
    expect(hasZ(fc)).toBe(false);
  });
});

/* --------------------- 投影坐标转换新增的经纬度坐标系 --------------------- */

describe('可选的经纬度（非米制）坐标系', () => {
  it('GCJ02 / BD09 地理伪代码被识别为地理坐标系（可用于输出 KML）', () => {
    expect(projectionKind(GEO_CODE_GCJ)).toBe('geographic');
    expect(projectionKind(GEO_CODE_BD09)).toBe('geographic');
  });

  it('同名的墨卡托伪代码是投影坐标系（不能输出 KML）', () => {
    expect(projectionKind(MERC_CODE_GCJ)).toBe('projected');
  });

  it('内置 EPSG 中经纬度与投影分组正确', () => {
    expect(projectionKind('EPSG:4326')).toBe('geographic');
    expect(projectionKind('EPSG:4490')).toBe('geographic');
    expect(projectionKind('EPSG:3857')).toBe('projected');
    expect(projectionKind('EPSG:4547')).toBe('projected');
    expect(projectionKind('EPSG:32650')).toBe('projected');
  });
});
