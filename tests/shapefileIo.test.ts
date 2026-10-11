// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { geoJSONToShapefile, shapefilePartsToGeoJSON, shapefileToGeoJSON } from '@/format/shapefile';
import { parseFilesToFeatureCollection } from '@/tools/fileParsers';
import type { FeatureCollection } from 'geojson';

/** 造一份带属性的等高线数据，写出为真实的 Shapefile ZIP */
async function makeShpZip(fc: FeatureCollection): Promise<{ zipBlob: Blob; parts: Record<string, ArrayBuffer> }> {
  const zipBlob = await geoJSONToShapefile(fc, 'contour');
  const buf = await zipBlob.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const parts: Record<string, ArrayBuffer> = {};
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    // 带内层目录时只取文件名
    parts[ext] = await entry.async('arraybuffer');
  }
  return { zipBlob, parts };
}

const contourFC: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { ELEV: 120, NAME: '等高线A' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [114.0, 30.5],
          [114.01, 30.51],
          [114.02, 30.52],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { ELEV: 140, NAME: '等高线B' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [114.03, 30.53],
          [114.04, 30.54],
        ],
      },
    },
  ],
};

function asFile(name: string, data: ArrayBuffer | string, type = ''): File {
  const body = typeof data === 'string' ? [data] : [new Uint8Array(data)];
  return new File(body as BlobPart[], name, { type });
}

describe('Shapefile 写出（拿真实二进制做后续测试的基础）', () => {
  it('geoJSONToShapefile 产出 zip，且含 .shp/.shx/.dbf', async () => {
    const { parts } = await makeShpZip(contourFC);
    expect(parts.shp).toBeDefined();
    expect(parts.dbf).toBeDefined();
    // shx（索引）通常也由 writer 生成
    console.log('导出的 shapefile 组件:', Object.keys(parts).sort().join(', '));
    expect(parts.shp.byteLength).toBeGreaterThan(100);
  });
});

describe('Shapefile ZIP 导入（既有路径）', () => {
  it('zip 经 shapefileToGeoJSON 能读回几何与属性', async () => {
    const { zipBlob } = await makeShpZip(contourFC);
    const fc = await shapefileToGeoJSON(await zipBlob.arrayBuffer());
    expect(fc.features).toHaveLength(2);
    const props = fc.features.map((f) => f.properties as Record<string, unknown>);
    expect(props.map((p) => p.ELEV).sort()).toEqual([120, 140]);
    expect(props.map((p) => p.NAME).sort()).toEqual(['等高线A', '等高线B']);
  });

  it('通过统一入口（parseFilesToFeatureCollection）拖入单个 zip 也可用', async () => {
    const { zipBlob } = await makeShpZip(contourFC);
    const files = [new File([zipBlob], 'contour.zip', { type: 'application/zip' })];
    const parsed = await parseFilesToFeatureCollection(files);
    expect(parsed.sourceType).toBe('Shapefile');
    expect(parsed.count).toBe(2);
    expect(parsed.geometryTypes).toEqual(['LineString']);
  });
});

describe('Shapefile 组件一起拖入（.shp/.dbf/.prj/.shx）', () => {
  it('几何与属性被正确拼装', async () => {
    const { parts } = await makeShpZip(contourFC);
    const fc = await shapefilePartsToGeoJSON({ shp: parts.shp, dbf: parts.dbf, cpg: parts.cpg });
    expect(fc.features).toHaveLength(2);
    const props = fc.features.map((f) => f.properties as Record<string, unknown>);
    expect(props.map((p) => p.ELEV).sort()).toEqual([120, 140]);
  });

  it('走统一入口：一组文件被识别为一个数据集', async () => {
    const { parts } = await makeShpZip(contourFC);
    const files = [
      asFile('contour.shp', parts.shp),
      asFile('contour.dbf', parts.dbf as ArrayBuffer),
      ...(parts.shx ? [asFile('contour.shx', parts.shx)] : []),
      asFile('contour.prj', 'GEOGCS["GCS_WGS_1984"]'),
    ];
    const parsed = await parseFilesToFeatureCollection(files);
    expect(parsed.sourceType).toBe('Shapefile');
    expect(parsed.count).toBe(2);
    expect(parsed.fileName).toBe('contour.shp');
    expect(parsed.geometryTypes).toEqual(['LineString']);
  });

  it('文件名大小写不影响分组', async () => {
    const { parts } = await makeShpZip(contourFC);
    const files = [asFile('Contour.SHP', parts.shp), asFile('contour.DBF', parts.dbf as ArrayBuffer)];
    const parsed = await parseFilesToFeatureCollection(files);
    expect(parsed.count).toBe(2);
  });

  it('缺 .dbf 时只保留几何，不整体失败', async () => {
    const { parts } = await makeShpZip(contourFC);
    const fc = await shapefilePartsToGeoJSON({ shp: parts.shp });
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].properties).toEqual({});
  });

  it('缺 .shp 时给出明确提示（而不是逐个文件报错）', async () => {
    const { parts } = await makeShpZip(contourFC);
    const files = [asFile('contour.dbf', parts.dbf as ArrayBuffer), asFile('notes.txt', 'hello')];
    await expect(parseFilesToFeatureCollection(files)).rejects.toThrow(/需要包含 Shapefile 的 \.shp 组件/);
    await expect(parseFilesToFeatureCollection(files)).rejects.toThrow(/zip/);
  });

  it('多个 Shapefile 一起拖入时合并要素', async () => {
    const { parts } = await makeShpZip(contourFC);
    const files = [
      asFile('a.shp', parts.shp),
      asFile('a.dbf', parts.dbf as ArrayBuffer),
      asFile('b.shp', parts.shp),
      asFile('b.dbf', parts.dbf as ArrayBuffer),
    ];
    const parsed = await parseFilesToFeatureCollection(files);
    expect(parsed.count).toBe(4); // 两份 × 2 个要素
    expect(parsed.fileName).toContain('2 个 Shapefile');
  });

  it('单独一个 .shp（没有 .dbf）也能读，属性为空', async () => {
    const { parts } = await makeShpZip(contourFC);
    const parsed = await parseFilesToFeatureCollection([asFile('contour.shp', parts.shp)]);
    expect(parsed.sourceType).toBe('Shapefile');
    expect(parsed.count).toBe(2);
    expect(parsed.fc.features[0].properties).toEqual({});
  });
});

describe('Shapefile 往返后可继续做坐标转换', () => {
  it('导出 → 重新导入 → 坐标一致', async () => {
    const { zipBlob } = await makeShpZip(contourFC);
    const back = await shapefileToGeoJSON(await zipBlob.arrayBuffer());
    const ring = (back.features[0].geometry as { coordinates: number[][] }).coordinates;
    expect(ring[0][0]).toBeCloseTo(114.0, 6);
    expect(ring[0][1]).toBeCloseTo(30.5, 6);
    expect(ring).toHaveLength(3);
  });
});

describe('写出不再丢要素（回归：shp-write 会合并所有折线）', () => {
  const many: FeatureCollection = {
    type: 'FeatureCollection',
    features: Array.from({ length: 12 }, (_, i) => ({
      type: 'Feature' as const,
      properties: { ELEV: 100 + i * 10, NAME: `等高线-${i}`, ID: i },
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [114.0 + i * 0.01, 30.5],
          [114.005 + i * 0.01, 30.505],
          [114.01 + i * 0.01, 30.51],
        ],
      },
    })),
  };

  it('12 条折线写出后仍是 12 个要素、12 行属性，且几何类型不退化', async () => {
    const blob = await geoJSONToShapefile(many, 'contours');
    const back = await shapefileToGeoJSON(await blob.arrayBuffer());
    expect(back.features).toHaveLength(12);
    expect(back.features.every((f) => f.geometry?.type === 'LineString')).toBe(true);
    const elevs = back.features.map((f) => (f.properties as Record<string, unknown>).ELEV).sort((a, b) => Number(a) - Number(b));
    expect(elevs).toEqual(Array.from({ length: 12 }, (_, i) => 100 + i * 10));
    const names = back.features.map((f) => (f.properties as Record<string, unknown>).NAME).sort();
    expect(names).toContain('等高线-0');
    expect(names).toContain('等高线-11');
  });

  it('每条线的坐标各自独立，没有被并成多段线', async () => {
    const blob = await geoJSONToShapefile(many, 'contours');
    const back = await shapefileToGeoJSON(await blob.arrayBuffer());
    const first = (back.features[0].geometry as { coordinates: number[][] }).coordinates;
    expect(first[0][0]).toBeCloseTo(114.0, 6);
    expect(first[0][1]).toBeCloseTo(30.5, 6);
  });

  it('点 / 线 / 面混合时按类型分文件，全部要素都保留', async () => {
    const mixed: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { K: 1 }, geometry: { type: 'Point', coordinates: [114, 30.5] } },
        { type: 'Feature', properties: { K: 2 }, geometry: { type: 'MultiPoint', coordinates: [[114.1, 30.6], [114.2, 30.7]] } },
        { type: 'Feature', properties: { K: 3 }, geometry: { type: 'LineString', coordinates: [[114, 30.5], [114.1, 30.6]] } },
        { type: 'Feature', properties: { K: 4 }, geometry: { type: 'Polygon', coordinates: [[[114, 30.5], [114.1, 30.5], [114.1, 30.6], [114, 30.5]]] } },
        { type: 'Feature', properties: { K: 5 }, geometry: { type: 'MultiPolygon', coordinates: [[[[114, 30.5], [114.05, 30.5], [114.05, 30.55], [114, 30.5]]], [[[114.1, 30.6], [114.15, 30.6], [114.15, 30.65], [114.1, 30.6]]]] } },
      ],
    };
    const blob = await geoJSONToShapefile(mixed, 'mixed');
    const back = await shapefileToGeoJSON(await blob.arrayBuffer());
    const ks = back.features.map((f) => (f.properties as Record<string, unknown>).K).sort((a, b) => Number(a) - Number(b));
    expect(ks).toEqual([1, 2, 3, 4, 5]);
  });

  it('缺少属性的要素也能写出', async () => {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [114, 30.5] } }],
    };
    const blob = await geoJSONToShapefile(fc, 'p');
    const back = await shapefileToGeoJSON(await blob.arrayBuffer());
    expect(back.features).toHaveLength(1);
  });

  it('含中文与超长字段名时属性不丢字', async () => {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { '这是一个很长的字段名名称': '中文属性值测试', ELEVATION: 1234.5 },
          geometry: { type: 'Point', coordinates: [114, 30.5] },
        },
      ],
    };
    const blob = await geoJSONToShapefile(fc, 'cn');
    const back = await shapefileToGeoJSON(await blob.arrayBuffer());
    const props = back.features[0].properties as Record<string, unknown>;
    expect(Object.values(props)).toContain('中文属性值测试');
    expect(Object.values(props)).toContain(1234.5);
  });
});
