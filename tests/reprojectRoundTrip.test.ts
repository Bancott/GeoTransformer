// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import proj4 from 'proj4';
import { PROJECTIONS } from '@/core/types';
import {
  reprojectCoord,
  reprojectFeatureCollection,
  assertPlausibleReproject,
  projectionKind,
  MERC_CODE_GCJ,
} from '@/core/reproject';
import { wgs84ToGcj02, wgs84ToBd09 } from '@/core/coordTransform';
import { assertWritableCoords } from '@/tools/outputTargets';
import type { FeatureCollection } from 'geojson';

for (const p of PROJECTIONS) if (!proj4.defs(p.code)) proj4.defs(p.code, p.proj4);

function fcOf(coords: number[][]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: coords.map((c) => ({
      type: 'Feature',
      properties: { ELEV: c[2] ?? null },
      geometry: { type: 'Point', coordinates: c },
    })),
  };
}

describe('投影 → 地理：往返精度', () => {
  const cases: Array<[string, [number, number]]> = [
    ['EPSG:4526', [114.0, 30.5]], // 38 带带内（CM 114E）
    ['EPSG:4526', [116.39, 39.9]], // 38 带带外（北京，设计范围 112.5–115.5E）
    ['EPSG:4547', [114.0, 30.5]], // 无带号变体
    ['EPSG:3857', [116.39, 39.9]], // Web 墨卡托
    ['EPSG:32650', [117.0, 39.0]], // UTM 50N
    ['EPSG:32750', [117.0, -33.0]], // UTM 50S（南半球）
    ['EPSG:4490', [114.0, 30.5]], // CGCS2000 经纬度（地理）
  ];

  it.each(cases)('%s 往返回到原点（误差 < 1e-9 度）', (code, wgs) => {
    const projected = proj4('EPSG:4326', code, wgs);
    const back = reprojectCoord([projected[0], projected[1]], code, 'EPSG:4326');
    expect(back[0]).toBeCloseTo(wgs[0], 9);
    expect(back[1]).toBeCloseTo(wgs[1], 9);
  });

  it('输出的顺序是 (经度, 纬度)，不是 (纬度, 经度)', () => {
    const projected = proj4('EPSG:4326', 'EPSG:4526', [114.0, 30.5]);
    const [lng, lat] = reprojectCoord([projected[0], projected[1]], 'EPSG:4526', 'EPSG:4326');
    expect(lng).toBeCloseTo(114, 8);
    expect(lat).toBeCloseTo(30.5, 8);
    expect(Math.abs(lng)).toBeGreaterThan(90); // 反了的话这里会是一个很小的纬度值
  });

  it('南半球投影回地理后纬度仍为负', () => {
    const projected = proj4('EPSG:4326', 'EPSG:32750', [117.0, -33.0]);
    const [, lat] = reprojectCoord([projected[0], projected[1]], 'EPSG:32750', 'EPSG:4326');
    expect(lat).toBeLessThan(0);
  });
});

describe('投影 → 地理（含 GCJ/BD 目标）与直接换算链一致', () => {
  const wgs: [number, number] = [114.0, 30.5];
  const projected = proj4('EPSG:4326', 'EPSG:4526', wgs) as [number, number];

  it('目标 GCJ02 = 先转 WGS84 再加 GCJ 偏移', () => {
    const out = reprojectCoord([projected[0], projected[1]], 'EPSG:4526', 'GCJ02');
    const expect0 = wgs84ToGcj02(wgs[0], wgs[1]);
    expect(out[0]).toBeCloseTo(expect0[0], 9);
    expect(out[1]).toBeCloseTo(expect0[1], 9);
  });

  it('目标 BD09 同理', () => {
    const out = reprojectCoord([projected[0], projected[1]], 'EPSG:4526', 'BD09');
    const expect0 = wgs84ToBd09(wgs[0], wgs[1]);
    expect(out[0]).toBeCloseTo(expect0[0], 9);
    expect(out[1]).toBeCloseTo(expect0[1], 9);
  });

  it('目标火星墨卡托 = GCJ02 之上的 Web 墨卡托', () => {
    const out = reprojectCoord([projected[0], projected[1]], 'EPSG:4526', MERC_CODE_GCJ);
    const gcj = wgs84ToGcj02(wgs[0], wgs[1]);
    const expectMerc = proj4('EPSG:4326', 'EPSG:3857', gcj as never) as number[];
    expect(out[0]).toBeCloseTo(expectMerc[0], 6);
    expect(out[1]).toBeCloseTo(expectMerc[1], 6);
  });
});

describe('投影 → 地理：数据完整性', () => {
  const projectedFC = fcOf([
    [38_500_000, 3_375_541.7, 120],
    [38_503_000, 3_380_000.2, 135],
  ]);

  it('高程 Z 原样保留（不做高程基准改正）', () => {
    const out = reprojectFeatureCollection(projectedFC, 'EPSG:4526', 'EPSG:4326');
    const c = (out.features[0].geometry as { coordinates: number[] }).coordinates;
    const c2 = (out.features[1].geometry as { coordinates: number[] }).coordinates;
    expect(c[2]).toBe(120);
    expect(c2[2]).toBe(135);
  });

  it('属性表原样保留', () => {
    const out = reprojectFeatureCollection(projectedFC, 'EPSG:4526', 'GCJ02');
    expect(out.features[0].properties).toEqual({ ELEV: 120 });
  });

  it('转换结果通过合理性校验，且可以写出 KML（KML 只接受经纬度）', () => {
    const out = reprojectFeatureCollection(projectedFC, 'EPSG:4526', 'GCJ02');
    expect(projectionKind('GCJ02')).toBe('geographic');
    expect(() => assertPlausibleReproject(out, 'GCJ02')).not.toThrow();
    // 投影坐标不能写 KML，转成经纬度之后就可以了
    expect(() => assertWritableCoords(out, 'KML')).not.toThrow();
    expect(() => assertWritableCoords(projectedFC, 'KML')).toThrow(/只能表示经纬度/);
  });

  it('多几何类型（线/面）同样处理', () => {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'MultiPolygon',
            coordinates: [[[[38_500_000, 3_375_541.7], [38_501_000, 3_375_541.7], [38_501_000, 3_376_541.7], [38_500_000, 3_375_541.7]]]],
          },
        },
      ],
    };
    const out = reprojectFeatureCollection(fc, 'EPSG:4526', 'EPSG:4326');
    const ring = (out.features[0].geometry as { coordinates: number[][][][] }).coordinates[0][0];
    expect(ring).toHaveLength(4);
    for (const pos of ring) {
      expect(Math.abs(pos[0])).toBeLessThanOrEqual(180);
      expect(Math.abs(pos[1])).toBeLessThanOrEqual(90);
    }
  });
});

describe('投影 → 地理：何时会真出问题', () => {
  it('源编码选错（带号/无带号）→ 被预检或结果校验拦下', () => {
    const cmData = fcOf([[500_000, 3_375_541.7]]); // 无带号数据
    const out = reprojectFeatureCollection(cmData, 'EPSG:4526', 'EPSG:4326');
    expect(() => assertPlausibleReproject(out, 'EPSG:4326')).toThrow(/源坐标系选错了/);
  });

  it('远离中央经线时仍能精确还原位置，但原投影的尺度变形会保留下来', () => {
    // 带外 16°（130E 用 CM 114E）：位置仍能精确还原
    const wgs: [number, number] = [130, 30];
    const projected = proj4('EPSG:4326', 'EPSG:4526', wgs) as [number, number];
    const back = reprojectCoord([projected[0], projected[1]], 'EPSG:4526', 'EPSG:4326');
    expect(back[0]).toBeCloseTo(130, 8);

    // 但该处的高斯投影尺度比 k = 1 + (Δλ·cosφ)²/2 ≈ 1.029 → 长度每公里差约 29 m
    const dLam = ((130 - 114) * Math.PI) / 180;
    const k = 1 + (dLam * Math.cos((30 * Math.PI) / 180)) ** 2 / 2;
    expect(k).toBeGreaterThan(1.02);
    expect((k - 1) * 1000).toBeGreaterThan(20); // > 20 m/km
  });

  it('带内的尺度变形很小（38 带中心区远小于 1%）', () => {
    const dLam = ((116.39 - 114) * Math.PI) / 180; // 距中央经线 2.39°
    const k = 1 + (dLam * Math.cos((39.9 * Math.PI) / 180)) ** 2 / 2;
    expect((k - 1) * 1000).toBeLessThan(1); // < 1 m/km
  });
});
