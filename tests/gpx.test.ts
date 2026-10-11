// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { gpxToGeoJSON, geoJSONToGPX } from '@/format/gpx';

const sample = `<?xml version="1.0"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="39.9075" lon="116.3912"><name>天安门</name></wpt>
  <trk><name>轨迹</name><trkseg>
    <trkpt lat="39.9" lon="116.39"/>
    <trkpt lat="39.91" lon="116.41"/>
  </trkseg></trk>
</gpx>`;

describe('GPX 解析', () => {
  it('解析航点与轨迹', () => {
    const fc = gpxToGeoJSON(sample);
    const types = fc.features.map((f) => f.geometry.type);
    expect(types).toContain('Point');
    expect(types).toContain('LineString');
  });
  it('读取航点坐标与名称', () => {
    const fc = gpxToGeoJSON(sample);
    const wpt = fc.features.find((f) => f.geometry.type === 'Point')!;
    const c = (wpt.geometry as { coordinates: number[] }).coordinates;
    expect(c[0]).toBeCloseTo(116.3912, 6);
    expect(c[1]).toBeCloseTo(39.9075, 6);
    expect((wpt.properties as Record<string, unknown>).name).toBe('天安门');
  });
});

describe('GeoJSON -> GPX -> 往返', () => {
  it('写出并能读回', () => {
    const fc = gpxToGeoJSON(sample);
    const gpx = geoJSONToGPX(fc, '测试');
    expect(gpx).toContain('<gpx');
    expect(gpx).toContain('trkpt');
    const back = gpxToGeoJSON(gpx);
    expect(back.features.length).toBeGreaterThanOrEqual(fc.features.length);
  });
});
