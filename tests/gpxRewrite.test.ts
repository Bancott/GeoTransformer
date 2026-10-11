// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { convertGpxText, gpxToGeoJSON } from '@/format/gpx';
import { wgs84ToGcj02 } from '@/core/coordTransform';
import { convertGeographicFeatureCollection } from '@/core/datum';
import type { CoordShift } from '@/core/types';

const shift: CoordShift = (lng, lat) => [lng + 0.1, lat + 0.05];

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>轨迹</name><bounds minlat="39.9" minlon="116.39" maxlat="39.91" maxlon="116.41"/></metadata>
  <wpt lat="39.9075" lon="116.3912"><name>天安门</name><ele>45.5</ele></wpt>
  <trk><name>徒步</name><trkseg>
    <trkpt lat="39.9" lon="116.39"><ele>45.5</ele><time>2026-01-01T08:00:00Z</time></trkpt>
    <trkpt lat="39.91" lon="116.41"><ele>46.1</ele><time>2026-01-01T08:00:10Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

function doc(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'text/xml');
}

describe('convertGpxText', () => {
  it('偏移 lat/lon，保留 ele / time / name 与文档结构', () => {
    const out = doc(convertGpxText(sample, shift));
    const pts = Array.from(out.getElementsByTagName('trkpt'));
    expect(pts).toHaveLength(2);
    expect(pts[0].getAttribute('lon')).toBe('116.49');
    expect(pts[0].getAttribute('lat')).toBe('39.95');
    expect(pts[1].getAttribute('lon')).toBe('116.51');
    expect(pts[1].getAttribute('lat')).toBe('39.96');

    // 旧实现会丢掉的高程与时间，现在原样保留
    expect(pts[0].getElementsByTagName('ele')[0].textContent).toBe('45.5');
    expect(pts[1].getElementsByTagName('time')[0].textContent).toBe('2026-01-01T08:00:10Z');
    const names = Array.from(out.getElementsByTagName('name')).map((n) => n.textContent);
    expect(names).toEqual(['轨迹', '天安门', '徒步']);
    expect(convertGpxText(sample, shift)).toContain('creator="test"');
  });

  it('航点同样被偏移', () => {
    const out = doc(convertGpxText(sample, shift));
    const wpt = out.getElementsByTagName('wpt')[0];
    expect(wpt.getAttribute('lon')).toBe('116.4912');
    expect(wpt.getAttribute('lat')).toBe('39.9575');
    expect(wpt.getElementsByTagName('ele')[0].textContent).toBe('45.5');
  });

  it('包围盒跟着一起偏移', () => {
    const b = doc(convertGpxText(sample, shift)).getElementsByTagName('bounds')[0];
    expect(b.getAttribute('minlon')).toBe('116.49');
    expect(b.getAttribute('minlat')).toBe('39.95');
    expect(b.getAttribute('maxlon')).toBe('116.51');
    expect(b.getAttribute('maxlat')).toBe('39.96');
  });

  it('找不到坐标点时抛错', () => {
    const empty = `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>x</name></metadata></gpx>`;
    expect(() => convertGpxText(empty, shift)).toThrow(/未在 GPX 中找到/);
  });

  it('XML 无法解析时退化为正则改写', () => {
    // 未闭合标签，DOM 解析必然失败
    const broken = `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
<bounds minlat="39.9" minlon="116.39" maxlat="39.91" maxlon="116.41"/>
<trkpt lat="39.9" lon="116.39"><ele>45.5</ele>`;
    const out = convertGpxText(broken, shift);
    expect(out).toContain('lat="39.95"');
    expect(out).toContain('lon="116.49"');
    expect(out).toContain('<ele>45.5</ele>');
    // minlat / maxlon 等不属于 lat / lon 属性，不能被误改
    expect(out).toContain('minlat="39.9"');
    expect(out).toContain('maxlon="116.41"');
  });

  it('就地改写与 GeoJSON 管线结果一致', () => {
    const real: CoordShift = (lng, lat) => wgs84ToGcj02(lng, lat);
    const lineOf = (fc: ReturnType<typeof gpxToGeoJSON>): number[][] => {
      const line = fc.features.find((f) => f.geometry?.type === 'LineString');
      return (line?.geometry as { coordinates: number[][] }).coordinates;
    };
    const inPlace = lineOf(gpxToGeoJSON(convertGpxText(sample, real)));
    const viaFc = lineOf(convertGeographicFeatureCollection(gpxToGeoJSON(sample), 'WGS84', 'GCJ02'));
    expect(inPlace).toHaveLength(viaFc.length);
    inPlace.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(viaFc[i][0], 6);
      expect(p[1]).toBeCloseTo(viaFc[i][1], 6);
    });
  });

  it('XML 声明只出现一次', () => {
    const out = convertGpxText(sample, shift);
    expect(out.match(/<\?xml/g)).toHaveLength(1);
    expect(out).toMatch(/^<\?xml[^>]*\?>\n</);
  });

  it('境外轨迹不偏移', () => {
    const real: CoordShift = (lng, lat) => wgs84ToGcj02(lng, lat);
    const tokyo = `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
<trkpt lat="35.6812" lon="139.7671"><ele>10</ele></trkpt></gpx>`;
    const out = convertGpxText(tokyo, real);
    expect(out).toContain('lat="35.6812"');
    expect(out).toContain('lon="139.7671"');
  });
});
