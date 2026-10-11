// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { convertKmlText } from '@/format/kml';
import { wgs84ToGcj02 } from '@/core/coordTransform';
import type { CoordShift } from '@/core/types';

/** 固定 +0.1 / +0.05 的假偏移，便于断言 */
const shift: CoordShift = (lng, lat) => [lng + 0.1, lat + 0.05];

const gxTrackKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document>
  <name>两步路轨迹</name>
  <Style id="line-1"><LineStyle><color>ff000000</color><width>4</width></LineStyle></Style>
  <Placemark>
    <name>徒步</name>
    <styleUrl>#line-1</styleUrl>
    <gx:Track>
      <when>2026-01-01T08:00:00Z</when>
      <when>2026-01-01T08:00:10Z</when>
      <gx:coord>116.3912 39.9075 45.5</gx:coord>
      <gx:coord>116.3940 39.9090 46.1</gx:coord>
    </gx:Track>
  </Placemark>
</Document>
</kml>`;

const plainKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>
<LineString><coordinates>
  116.3912,39.9075,45.5
  116.3940,39.9090,0
</coordinates></LineString></Placemark></Document></kml>`;

const polygonKml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><Polygon>
<outerBoundaryIs><LinearRing><coordinates>116.1,39.1 116.2,39.1 116.2,39.2 116.1,39.2 116.1,39.1</coordinates></LinearRing></outerBoundaryIs>
<innerBoundaryIs><LinearRing><coordinates>116.15,39.15 116.16,39.15 116.16,39.16 116.15,39.15</coordinates></LinearRing></innerBoundaryIs>
</Polygon></Placemark></Document></kml>`;

function coordsOf(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const out: string[] = [];
  const walk = (el: Element): void => {
    for (const c of Array.from(el.children)) {
      if (c.localName === 'coord') out.push((c.textContent ?? '').trim());
      walk(c);
    }
  };
  walk(doc.documentElement);
  return out;
}

function textOf(xml: string, localName: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const out: string[] = [];
  const walk = (el: Element): void => {
    for (const c of Array.from(el.children)) {
      if (c.localName === localName) out.push((c.textContent ?? '').trim());
      walk(c);
    }
  };
  walk(doc.documentElement);
  return out;
}

describe('convertKmlText', () => {
  it('gx:Track 轨迹：保留 when / Style / 点数，只改坐标', () => {
    const out = convertKmlText(gxTrackKml, shift);

    // 点数不丢（旧实现会把整条轨迹退化成单个 Point）
    expect(coordsOf(out)).toHaveLength(2);
    // 高程原样保留，经纬度偏移
    expect(coordsOf(out)[0]).toBe('116.4912 39.9575 45.5');
    expect(coordsOf(out)[1]).toBe('116.494 39.959 46.1');

    // 时间戳、样式、文档名原样保留
    expect(textOf(out, 'when')).toEqual(['2026-01-01T08:00:00Z', '2026-01-01T08:00:10Z']);
    expect(textOf(out, 'styleUrl')).toEqual(['#line-1']);
    expect(textOf(out, 'color')).toEqual(['ff000000']);
    expect(textOf(out, 'name')).toEqual(['两步路轨迹', '徒步']);
    // gx:Track 与 gx 命名空间保留
    expect(out).toContain('gx:Track');
    expect(out).toContain('xmlns:gx="http://www.google.com/kml/ext/2.2"');
    expect(out).toContain('<?xml version="1.0" encoding="UTF-8"?>');
  });

  it('普通 coordinates：保留换行缩进与高程', () => {
    const out = convertKmlText(plainKml, shift);
    const body = textOf(out, 'coordinates')[0];
    expect(body).toContain('116.4912,39.9575,45.5');
    expect(body).toContain('116.494,39.959,0');
    // 两个点之间的换行与缩进原样保留
    expect(body).toMatch(/45\.5\n\s+116\.494/);
  });

  it('多环 Polygon：所有环都被偏移', () => {
    const out = convertKmlText(polygonKml, shift);
    const rings = textOf(out, 'coordinates');
    expect(rings).toHaveLength(2);
    expect(rings[0]).toContain('116.2,39.15');
    expect(rings[0]).toContain('116.3,39.15');
    expect(rings[1]).toContain('116.25,39.2');
    expect(rings[1]).not.toContain('116.15,39.15');
  });

  it('接入真实 WGS84→GCJ02 时：境内偏移、境外原样', () => {
    // 就地改写忠实套用传入的偏移函数；境外判定由 coordTransform 负责
    const realShift: CoordShift = (lng, lat) => wgs84ToGcj02(lng, lat);
    const tokyo = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><Point>
<coordinates>139.7671,35.6812,0</coordinates></Point></Placemark></Document></kml>`;
    expect(textOf(convertKmlText(tokyo, realShift), 'coordinates')[0]).toBe('139.7671,35.6812,0');

    const out = convertKmlText(gxTrackKml, realShift);
    expect(coordsOf(out)).toHaveLength(2);
    const [lng, lat] = coordsOf(out)[0].split(' ').slice(0, 2).map(Number);
    expect(lng).toBeCloseTo(116.39744, 4);
    expect(lat).toBeCloseTo(39.9089, 4);
    // 高程与时间戳仍然保留
    expect(coordsOf(out)[0]).toContain('45.5');
    expect(textOf(out, 'when')).toHaveLength(2);
  });

  it('找不到坐标节点时报错', () => {
    const empty = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>空</name></Document></kml>`;
    expect(() => convertKmlText(empty, shift)).toThrow(/未在 KML 中找到/);
  });

  it('XML 无法解析时退化为正则改写', () => {
    // 未闭合标签，DOM 解析必然失败，走正则兜底
    const broken = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><description>a&amp;b</description>
<Point><coordinates>116.3912,39.9075,0</coordinates></Point>`;
    const out = convertKmlText(broken, shift);
    expect(out).toContain('116.4912,39.9575,0');
    expect(out).toContain('a&amp;b');
  });

  it('gx:coord 用正则兜底时同样按空格三元组处理', () => {
    const broken = `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Placemark><gx:Track><gx:coord>116.3912 39.9075 45.5</gx:coord>`;
    const out = convertKmlText(broken, shift);
    expect(out).toContain('116.4912 39.9575 45.5');
  });

  it('XML 声明只出现一次', () => {
    const out = convertKmlText(gxTrackKml, shift);
    expect(out.match(/<\?xml/g)).toHaveLength(1);
    expect(out.startsWith('<?xml')).toBe(true);
    // 声明与根元素之间必须有换行
    expect(out).toMatch(/^<\?xml[^>]*\?>\n</);
  });

  it('源文件没有 XML 声明时不额外添加', () => {
    expect(convertKmlText(polygonKml, shift).match(/<\?xml/g)).toBeNull();
  });
});
