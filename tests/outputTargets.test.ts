// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { sourceTargetOf, targetLabel, TARGETS } from '@/tools/outputTargets';
import type { SourceType } from '@/tools/fileParsers';

describe('sourceTargetOf', () => {
  it('输入什么格式就默认输出什么格式', () => {
    const same: SourceType[] = [
      'GeoJSON',
      'Shapefile',
      'KML',
      'GPX',
      'GML',
      'DXF',
      'OSM',
      'WKT',
      'WKB',
      'CSV',
      'TopoJSON',
    ];
    for (const s of same) expect(sourceTargetOf(s)).toBe(s);
  });

  it('没有对应写出器的格式回落到等价格式', () => {
    expect(sourceTargetOf('Excel')).toBe('CSV');
    expect(sourceTargetOf('PostGIS')).toBe('GeoJSON');
  });

  it('每个映射结果都是可写出的目标格式', () => {
    const available = new Set(TARGETS.map((t) => t.value));
    const all: SourceType[] = [
      'GeoJSON', 'Shapefile', 'KML', 'GPX', 'GML', 'DXF', 'OSM',
      'WKT', 'WKB', 'CSV', 'TopoJSON', 'Excel', 'PostGIS',
    ];
    for (const s of all) expect(available.has(sourceTargetOf(s))).toBe(true);
  });
});

describe('targetLabel', () => {
  it('返回带扩展名的中文标签', () => {
    expect(targetLabel('KML')).toBe('KML (.kml)');
    expect(targetLabel('GeoJSON')).toBe('GeoJSON (.geojson)');
  });
});
