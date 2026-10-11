/** 常见的坐标系标识 */
export type CoordSystem = 'WGS84' | 'GCJ02' | 'BD09';

/** 坐标偏移函数：输入经纬度，返回偏移后的经纬度 */
export type CoordShift = (lng: number, lat: number) => [number, number];

/** 坐标系元信息与展示名 */
export const COORD_SYSTEMS: Record<CoordSystem, { name: string; full: string }> = {
  WGS84: { name: 'WGS84', full: '国际标准 / GPS / 谷歌(国外) / OSM' },
  GCJ02: { name: 'GCJ-02', full: '火星坐标 / 国内互联网地图（高德、腾讯、天地图）' },
  BD09: { name: 'BD-09', full: '百度坐标 / 百度地图' },
};

/** 常见投影（EPSG）到 Proj4 定义的映射 */
export interface ProjectionDef {
  code: string;
  name: string;
  proj4: string;
  /** 可选分组名（用于下拉框按系列归类） */
  group?: string;
}

/**
 * CGCS2000 高斯-克吕格分带投影。
 *
 * 注意 3 度带有两套并存的 EPSG 编码，中央经线相同、**东坐标是否含带号前缀**不同，
 * 两者相差 `带号 × 1,000,000` 米（38 带即 3800 万米），用错会得到完全错误的位置：
 * - 「带带号」：EPSG:4513–4533（25–45 带），x_0 = 带号×1e6 + 500000，东坐标形如 `385xxxxx`
 * - 「无带号」：EPSG:4534–4554（CM 75E–135E），x_0 = 500000，东坐标形如 `5xxxxx`
 * 6 度带同理：4491–4501（带带号）、4502–4512（无带号）。
 *
 * 定义按系列生成，避免手抄出错；如需扩充其它分带系列，照此追加即可。
 */
function cgcs2000GaussKruger(): ProjectionDef[] {
  const out: ProjectionDef[] = [];
  const tmerc = (lon0: number, x0: number): string =>
    `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=1 +x_0=${x0} +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs`;

  const series = (
    codeStart: number,
    count: number,
    step: number, // 分带宽（度）
    withZone: boolean,
    group: string
  ): void => {
    for (let i = 0; i < count; i++) {
      // 3 度带：25–45 带，CM 75°E–135°E；6 度带：13–23 带，CM 75°E–135°E
      const zoneStart = step === 3 ? 25 : 13;
      const zone = zoneStart + i;
      const lon0 = step === 3 ? zone * 3 : zone * 6 - 3;
      const x0 = withZone ? zone * 1e6 + 500000 : 500000;
      out.push({
        code: `EPSG:${codeStart + i}`,
        name: withZone
          ? `CGCS2000 / ${step}度带高斯克吕格 带号${zone}（CM ${lon0}E，东坐标含带号）`
          : `CGCS2000 / ${step}度带高斯克吕格 CM ${lon0}E（东坐标不含带号）`,
        proj4: tmerc(lon0, x0),
        group,
      });
    }
  };

  series(4513, 21, 3, true, 'CGCS2000 3度带（带带号）');
  series(4534, 21, 3, false, 'CGCS2000 3度带（无带号）');
  series(4491, 11, 6, true, 'CGCS2000 6度带（带带号）');
  series(4502, 11, 6, false, 'CGCS2000 6度带（无带号）');
  return out;
}

export const PROJECTIONS: ProjectionDef[] = [
  {
    code: 'EPSG:4326',
    name: '经纬度（WGS84）',
    proj4: '+proj=longlat +datum=WGS84 +no_defs',
  },
  {
    code: 'EPSG:3857',
    name: 'Web 墨卡托（Google / 常见瓦片）',
    proj4: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs +type=crs',
  },
  {
    code: 'EPSG:4490',
    name: 'CGCS2000 经纬度',
    proj4: '+proj=longlat +ellps=GRS80 +no_defs +type=crs',
  },
  ...cgcs2000GaussKruger(),
  {
    code: 'EPSG:32650',
    name: 'WGS84 / UTM 50N',
    proj4: '+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs +type=crs',
  },
  {
    code: 'EPSG:32750',
    name: 'WGS84 / UTM 50S',
    proj4: '+proj=utm +zone=50 +south +datum=WGS84 +units=m +no_defs +type=crs',
  },
];

/** 内置的中国大陆边界约束，用于辅助判断是否可能为各坐标系 */
export const CHINA_BBOX: [number, number, number, number] = [73, 18, 135, 54];
