import { describe, it, expect } from 'vitest';
import { parseCsv, csvToGeoJSON, findLngLatColumns } from '@/format/csv';

describe('parseCsv', () => {
  it('解析带引号与逗号的字段', () => {
    const data = parseCsv('name,desc\na,"hello, world"\n');
    expect(data.headers).toEqual(['name', 'desc']);
    expect(data.rows[0]).toEqual(['a', 'hello, world']);
  });

  it('处理制表符分隔', () => {
    const data = parseCsv('lng\tlat\n116\t40\n');
    expect(data.headers).toEqual(['lng', 'lat']);
    expect(data.rows[0]).toEqual(['116', '40']);
  });

  it('去掉 BOM', () => {
    const data = parseCsv('\uFEFFlng,lat\n1,2\n');
    expect(data.headers).toEqual(['lng', 'lat']);
  });
});

describe('findLngLatColumns', () => {
  it('识别常用经纬度列名', () => {
    expect(findLngLatColumns(['x', 'y'])).toEqual({ lngIndex: 0, latIndex: 1 });
    expect(findLngLatColumns(['经度', '纬度'])).toEqual({ lngIndex: 0, latIndex: 1 });
    expect(findLngLatColumns(['lon', 'lat'])).toEqual({ lngIndex: 0, latIndex: 1 });
  });
});

describe('csvToGeoJSON', () => {
  it('生成点要素并保留其它属性', () => {
    const fc = csvToGeoJSON('lng,lat,name\n116.39,39.9,beijing\n121.47,31.23,shanghai\n');
    expect(fc.features).toHaveLength(2);
    const f0 = fc.features[0];
    expect((f0.geometry as { coordinates: number[] }).coordinates).toEqual([116.39, 39.9]);
    expect((f0.properties as Record<string, unknown>).name).toBe('beijing');
  });

  it('缺少经纬度列时抛错', () => {
    expect(() => csvToGeoJSON('a,b\n1,2\n')).toThrow();
  });
});
