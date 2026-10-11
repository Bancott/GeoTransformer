# architecture · GeoTransformer

本文档说明 `geo-transformer` 的架构设计、目录职责、核心数据流，以及关键算法与已知取舍。面向后续开发和维护者。

---

## 1. 设计原则

- **单一中间标准：GeoJSON。** 所有输入格式先被解析成 `FeatureCollection`（GeoJSON），所有输出格式都由 GeoJSON 序列化而来。新增一个格式只需实现「解析」和「写出」两个函数，即可和任意既有格式互通（如 Shapefile ↔ KML），无需为每种组合写桥接。
- **例外：同格式转换走就地改写。** KML / GPX 这类携带丰富结构的文本格式，`源 → GeoJSON → 同名格式` 的往返会丢数据（`gx:Track` 轨迹退化成单点或普通折线，`<when>` / `<Style>` / `<ele>` / `<extensions>` 全部丢弃）。因此坐标互转工具在同格式输出时改用 `convertKmlText()` / `convertGpxText()` 直接改写原文本，只替换坐标数字。
- **核心与 UI 分离。** 纯算法与格式逻辑放在 `src/core/`、`src/format/`；可交互的「功能模块」放在 `src/tools/`；通用 UI 控件在 `src/ui/`。核心层不引用任何 DOM。
- **不可变数据 + 坐标系标签。** 数据坐标永远是 WGS-84 基准（除非用户显式选择源坐标系）。地图显示时按需转换为 GCJ-02，绝不回写源数据。
- **浏览器端、无后端。** 全部处理在本地完成；第三方库均为浏览器可用实现。

---

## 2. 目录职责

```
src/
├─ core/        纯业务逻辑（无 UI/无 DOM）
│   ├─ types.ts               坐标系与投影常量、内置 EPSG 表、坐标对类型
│   ├─ coordTransform.ts      WGS-84 ↔ GCJ-02 ↔ BD-09 偏移互转（含境外判定、FeatureCollection 批处理）
│   ├─ reproject.ts           proj4 投影转换，含 GCJ/BD 墨卡托复合投影与自定义 proj4 定义
│   ├─ datum.ts               CGCS2000 / PZ-90 / GRS-80 等基准的 Helmert 变换
│   ├─ coordFormat.ts         DMS / 度分 / UTM / MGRS ↔ 十进制度
│   ├─ coordBounds.ts         坐标形态与范围：经纬度范围校验、Z 降维（dropZ）
│   └─ detect.ts              坐标系检测：锚点表决 + 参考点校准 + 球面距离
│
├─ format/      各格式「解析/写出」（输入输出均为 GeoJSON）
│   ├─ geojson.ts             GeoJSON 读、边界、统计
│   ├─ csv.ts                 CSV → FeatureCollection（坐标列识别）
│   ├─ csvFlat.ts             GeoJSON → 扁平 CSV / 属性表 CSV
│   ├─ wkt.ts / wkb.ts        WKT（文本）/ WKB（二进制或 hex）↔ GeoJSON
│   ├─ gpx.ts / gml.ts        GPX / GML ↔ GeoJSON（几何子集）；GPX 另含就地改写
│   ├─ dxf.ts                 DXF 常见实体 ↔ GeoJSON
│   ├─ osmxml.ts              OSM XML ↔ GeoJSON（node/way，面积与线）
│   ├─ excel.ts               .xlsx → GeoJSON（依赖 xlsx 库）
│   ├─ postgis.ts             PostGIS dump 的 COPY 块 → GeoJSON（WKT/hex-WKB 几何）
│   ├─ kml.ts                 KML ↔ GeoJSON（读取复用 @tmcw/togeojson）+ 就地改写
│   ├─ xmlText.ts             XML 就地改写公共工具（数字格式化、按 localName 收集、序列化）
│   ├─ shapefile.ts           Shapefile ↔ GeoJSON（读用 shpjs；写出用自实现的 shpWrite）
│   ├─ shpWrite.ts            自实现 Shapefile 写出（SHP/SHX/DBF/CPG，逐要素一条记录）
│   ├─ topojson.ts            TopoJSON ↔ GeoJSON（topojson-server/client）
│   └─ index.ts               聚合导出所有格式函数
│
├─ map/         地图封装（依赖 Leaflet）
│   ├─ basemaps.ts            底图配置（高德/OSM/Esri/Carto 浅色与深色/OpenTopo + 坐标基准 system）
│   ├─ mapStyle.ts            地图数据符号样式（刻意与界面主题解耦的常量）
│   └─ mapController.ts       Leaflet 封装：底图、数据图层、坐标拾取、GCJ-02 纠偏
│
├─ tools/       功能模块（UI 层，调用 core/format）
│   ├─ formatConvert.ts       格式转换（目标格式下拉 + 写出）
│   ├─ coordConvert.ts        多坐标系互转（单点 / 批量 / 文件）
│   ├─ reprojectTool.ts       投影坐标转换（EPSG / 自定义 proj4）
│   ├─ outputTargets.ts       输出格式清单 + 写出逻辑 + 写出前校验（各工具共用）
│   ├─ coordFileCard.ts       「坐标转换 · 文件模式」卡片（两个坐标工具共用）
│   ├─ coordFormatTool.ts     坐标格式解析与格式化（DMS/度分/UTM/MGRS）
│   ├─ picker.ts              地图坐标拾取器（含底图切换）
│   ├─ detector.ts            坐标系检测器
│   ├─ previewer.ts           数据预览器（拖放文件 → 地图 + 属性表）
│   └─ fileParsers.ts         统一「任意文件 → FeatureCollection」分派（含内容嗅探）
│
├─ ui/          通用 UI 组件
│   ├─ dom.ts  modal.ts  toast.ts  dropzone.ts  download.ts
│   ├─ form.ts               表单控件：field / select（支持 optgroup 分组）/ segmented / 输入框
│   ├─ theme.ts               主题模式（浅色 / 深色 / 跟随系统）、持久化、系统联动
│   └─ themeSwitch.ts         顶栏主题切换控件（基于 form.ts 的 segmented）
├─ styles/
│   ├─ theme.css              主题 token 层：浅 / 深两套语义变量 + color-scheme
│   └─ main.css               组件样式层：只引用 token，不含颜色字面量
├─ app.ts       应用外壳：头部 / 侧边栏 / 主区域 / 工具装载
├─ toolRegistry.ts   工具清单 + 分类元信息（地理空间数据 / 坐标投影转换 / 辅助工具）
└─ main.ts      启动入口
```

---

## 3. 数据流：统一格式转换

```
任意源文件（SHP / KML / GPX / WKT / WKB / CSV / XLSX / DXF / OSM / GML / TopoJSON / PostGIS dump）
        │
        ▼
   src/tools/fileParsers.ts  ── 嗅探（sniffKind）后调用对应 format/* 解析
        │
        ▼
   FeatureCollection（WGS-84 基准）
        │
        ▼
   src/core/* 处理（投影 / 基准 / 坐标系偏移 / 坐标格式化）
        │
        ▼
   FeatureCollection（处理后的结果）
        │
        ▼
   src/tools/formatConvert.ts  ── 调用对应 format/* 写出
        │
        ▼
   目标文件（SHP / GeoJSON / KML / CSV / WKT / ...）
```

**三处扩展点：**

1. **新增输入格式** → 在 `src/format/` 写 `xxxToGeoJSON()`，登记到 `fileParsers.ts` 的 `sniffKind` 与 `SourceType`。
2. **新增输出格式** → 在 `src/format/` 写 `geoJSONToXxx()`，登记到 `src/tools/outputTargets.ts` 的 `TARGETS`（两个工具会自动同时出现该格式）。
3. **新增坐标/投影能力** → 在 `src/core/` 扩展坐标系或投影定义，`src/tools/` 里接入。

### 3.1 例外路径：同格式就地改写（KML / GPX）

```
KML / GPX 原文本
        │  （仅同格式转换时）
        ▼
   convertKmlText() / convertGpxText()   ── 解析 XML → 只改坐标数字 → 序列化
        │
        ▼
   结构与元素顺序不变的输出文件（Folder / Style / gx:Track / when / ele / time / extensions 原样保留）
```

- **为什么需要**：`gx:Track` 轨迹经 GeoJSON 往返会退化成**单个 Point**（`@tmcw/togeojson` 对点数 ≤ 2 的 track 返回 Point）或普通 `LineString`，`<when>` / `<Style>` / `<ele>` 全部丢失，导出文件在两步路、Google Earth 里无法正常使用。
- **解析策略**：先按 `localName` 递归收集 `coordinates` / `coord` 元素（不依赖命名空间前缀，兼容 `gx:`），改完用 `XMLSerializer` 序列化；XML 无法解析（如 `<description>` 含未定义实体）时退化为按标签名/属性的正则替换兜底。
- **坐标文本**：`<coordinates>` 处理 `lng,lat[,alt]` 逗号三元组，`<gx:coord>` 处理空格三元组；**高程原样保留不换算**，点间的换行与缩进不变。
- **数值格式**：经纬度定点 7 位小数（约 1cm）并去掉多余 0，避免出现 `1e-7` 这类指数写法。
- 若就地改写失败，工具会提示并自动回退到 GeoJSON 重写管线，保证仍能产出文件。

### 3.2 「坐标投影转换」与「投影坐标转换」的文件模式

两个坐标类工具**共用同一张文件转换卡片**（`src/tools/coordFileCard.ts`），行为完全一致：

- 输出格式**默认跟随源文件**（`sourceTargetOf()`；Excel 无写出器回落 CSV，PostGIS 回落 GeoJSON），也可另选 `TARGETS` 中的任意格式；
- 源与目标**同为地理坐标系**且目标格式与源相同、且源为 KML / GPX 时，走 3.1 的就地改写；
- 其余情况走「GeoJSON 转换 + 重写」管线。

> ⚠️ 两个工具名称相近，注意区分：**坐标投影转换**（`coord-convert`）是 WGS84 / GCJ02 / BD09 / CGCS2000 等**地理坐标系互转**；**投影坐标转换**（`reproject`）是 **EPSG 投影转换**（如 4326 ↔ 3857，结果为米）。

### 3.3 写出前的坐标合规校验

KML / GPX / OSM XML 三种格式**按规范只能表示经纬度（度）**。把投影坐标（如 EPSG:3857 的 `12956609, 4852509`）写进去会得到任何软件都打不开的文件，因此加了双重防护：

| 位置 | 行为 |
| --- | --- |
| 格式下拉（`coordFileCard`） | 目标坐标系为投影坐标系时，从列表中**移除** KML / GPX / OSM，并说明原因与补救方式 |
| 写出层（`outputTargets.writeTarget` → `assertWritableCoords`） | 写出前用 `core/coordBounds.ts` 校验所有坐标是否落在 ±180 / ±90 内，越界则**抛错并提示改为地理坐标系**，绝不产出坏文件 |

这一层校验对所有工具生效（含「格式转换」），因此「投影 GeoJSON → KML」这类会产出坏文件的链路现在会被明确拦下并解释原因，而不是静默生成无法使用的文件。

### 3.4 高程（Z）的传递与降维

- **不凭空生成 Z**：`geoJSONToKML` 的高程缺省时不写第三个分量。此前实现会补 `,0`，导致
  「KML（无高程）→ GeoJSON → KML」往返后数据变成三维，QGIS 随即判定为 EPSG:4979。
- **可选降维**：文件卡片提供「高程（Z 值）：保留 / 丢弃」。丢弃时：
  - 走重写管线 → `core/coordBounds.dropZ()` 去掉坐标的第三个分量；
  - 走就地改写 → `convertKmlText(..., { dropAltitude })` / `convertGpxText(..., { dropAltitude })`，
    只删除高程（KML 去掉坐标第三个数、GPX 移除 `<ele>`），其余结构不变。
- **为什么需要**：GDAL / QGIS 依据坐标是否含 Z 决定图层 CRS（含 Z → EPSG:4979），
  三维图层在切换项目坐标系时需要 3D→2D 换算，容易出现异常。需要二维输出时用该选项即可。

---

## 4. 高德 GCJ-02 显示纠偏

高德瓦片使用 **GCJ-02 基准**，而通用地理数据以 **WGS-84** 为准。两者在中国大陆存在数百米的不一致（椭圆体偏转）。`MapController` 采用「显示时换算、源不动」的策略：

```
WGS-84 数据 ──(toDisplay: wgs84ToGcj02)──▶ GCJ-02 坐标 ──▶ 渲染到高德瓦片
高德点击坐标 ──(fromDisplay: gcj02ToWgs84)──▶ WGS-84 坐标 ──▶ 拾取器输出
```

- **不污染源数据**：用 `displayFC`（`convertFeatureCollection(fc, sourceSystem, baseSystem)`）生成独立副本渲染，`sourceFC` 始终保持原始坐标。
- **源坐标系由调用方声明**：`setData(fc, fit, sourceSystem)`。默认 WGS-84；若数据本身是 GCJ-02 却没有声明，会被当成 WGS-84 **再偏移一次**（实测北京约 556 m），这正是「预览器里 GCJ-02 轨迹错位」的原因。数据预览器因此提供「源坐标系」选择（含自动检测），切换时**不重新适配视野**，便于直接看出数据相对底图平移了多少。
- **底图切换自动重投影**：`baseSystem` 记录当前底图基准（`'WGS84' | 'GCJ02'`），切换底图时按 `sourceSystem → baseSystem` 重算；切到 OSM/Esri/Carto 等 WGS-84 底图即可逐点校验。
- **纠偏有方向性**：`wgs84ToGcj02` 是精确正算，`gcj02ToWgs84` 用迭代/近似反算，二者往返误差通常 < 1e-6 度。
- 出于 OSM 许可与一致性考虑，默认底图已切换为高德街图（`DEFAULT_BASEMAP_ID='gaode-street'`）。

---

## 5. 坐标系与投影

### 5.1 地理坐标系（`src/core/coordTransform.ts` / `datum.ts`）

| 代号 | 名称 | 备注 |
| --- | --- | --- |
| WGS84 | World Geodetic System 1984 | 全球基准，所有数据默认基准 |
| GCJ02 | 火星坐标（高德） | 中国大陆加密，专业格式的基础 |
| BD09 | 百度坐标 | 在 GCJ-02 上再做一次偏移 |
| CGCS2000 | 2000 国家大地坐标系 | 与 WGS-84 差异很小，用近似视为一致 |
| PZ-90 | 俄罗斯 GLONASS | 用 Helmert 7 参数做基准变换 |
| GRS-80 | Geodetic Reference System 1980 | 近似视为与 WGS-84 一致 |

### 5.2 投影坐标系（`src/core/reproject.ts`）

- 内置常用 EPSG：4326 / 3857 / 4490 / 32650 等，以及复合伪代码 `GCJ02-WEBMERC`、`BD09-WEBMERC`。
- **CGCS2000 高斯-克吕格分带系列**（`core/types.ts` 按系列生成，避免手抄出错）：
  3 度带 4513–4533（带带号）/ 4534–4554（无带号），6 度带 4491–4501（带带号）/ 4502–4512（无带号）。
  两套编码中央经线相同、假东坐标相差 `带号 × 1e6` 米，是本项目最需要防错的点，见下。
- `reprojectCoord` 会先判断是「地理坐标系」（走 `coordTransform`/`datum` 链）还是「投影方式」（走 proj4），再拼成统一的 到 WGS-84 → 从 WGS-84 链路。
- 允许输入自定义 proj4 定义字符串做任意投影。

**三层防错**（分带编码选错会导致完全错误的位置，必须拦住）：

| 层 | 函数 | 作用 |
| --- | --- | --- |
| 预检 | `suggestGaussKrugerVariant(fc, from)` | 比较数据东坐标中位数与该编码的假东坐标，量级不符（差 > 1e6）时**指出同中央经线应使用的编码**并中断 |
| 换算 | `reprojectFeatureCollection` 内部 try/catch | 参数不匹配时 proj4 会因无解抛出晦涩的英文异常，这里换成带 from→to 与排查方向的提示 |
| 结果 | `assertPlausibleReproject(out, to)` | 目标为经纬度时校验 ±180/±90，为 Web 墨卡托时校验 ±20037509；越界即报错，绝不产出位置荒谬的文件 |

**投影 → 地理的正确性边界**（`reprojectRoundTrip.test.ts` 固化）：

- **换算精确**：内置各投影往返误差约 `1e-14` 度（浮点极限），经纬度顺序为 (lng, lat)，南半球纬度保持为负。
- **伪代码目标链路正确**：`投影 → GCJ02/BD09/火星墨卡托` 的结果与「先转 WGS84 再加偏移」逐位一致。
- **数据完整性**：Z 与属性原样保留（Z 不做高程基准改正）。
- **带外数据的固有变形**：高斯投影尺度比 `k = 1 + (Δλ·cosφ)²/2`（Δλ 为到中央经线的经差，弧度）。
  38 带内 2.4° 处约 0.5 m/km；远离 16° 处达 29 m/km。此时位置仍能精确还原（正反算可逆），
  但**在投影坐标系里量得的长度/面积本身偏大**，且不会因转换而修正。工具不对此报警 —— 属于投影的既有性质，非换算错误。
- **高程**：仅变换 x/y，Z 原样搬运；椭球高与海拔的换算需要重力场模型，不在范围内。

### 5.3 坐标格式（`src/core/coordFormat.ts`）

- 十进制 / 度分（`41 54.5`）/ 度分秒（`41 54 30`）互转。
- UTM 分区与 `WGS-84 ↔ UTM`。
- MGRS（依赖 `mgrs` 库）`WGS-84 ↔ MGRS`。

---

## 6. 关键算法

- **WGS-84 ↔ GCJ-02**：国内地图通用偏移公式，由椭球偏转系数构成，带中国大陆矩形边界（`outOfChina`），境外原样返回，避免对境外数据造成错误偏移。
- **GCJ-02 ↔ BD-09**：百度在 GCJ-02 上叠加的二次偏移公式。
- **Helmert 7 参数（PZ-90）**：`[tx, ty, tz, rx, ry, rz, s]` 刚体变换，`datum.ts` 中实现了正/逆变换。
- **坐标系检测（`detect.ts`）**：两条路径，因为**只凭坐标值无法判定**（GCJ-02/BD-09 是平滑平移约 500 m 的双射，同一点在三套坐标系下都是合法数值）。
  - `detectFromCoords()` 锚点法：内置 20 个精确城市地标 WGS-84 坐标，比较样本与各地标三种候选的距离投票。
    可信半径 0.001°（≈110 m，必须明显小于候选间距的一半，否则「离哪个候选最近」会指错）；放宽到 0.004° 时标记 `tier='rough'` 并折半置信度。样本不在锚点附近时返回 `UNKNOWN` 并说明出路。
  - `classifyByReference()` 参考点法：用户在地图上点击某地物的真实 WGS-84 位置，比较三种假设下数据与该参考点的距离，取最小者；三种假设相距约 500 m，远大于点击误差。最近距离 > `REFERENCE_TOLERANCE_M`(100 m) 时标记 `reliable=false`，UI 不给结论而是提示重点。

---

## 7. 测试覆盖

`tests/`（Vitest，`@/` 别名指向 `src/`）：

| 文件 | 覆盖 |
| --- | --- |
| coordTransform.test.ts | 境外判定、WGS84↔GCJ02↔BD09 往返、FeatureCollection 批处理 |
| reproject.test.ts | EPSG:4326↔3857 往返、投影米单位、annotate 元数据 |
| reprojectPseudo.test.ts | GCJ/BD 墨卡托复合伪代码 |
| coordFormat.test.ts | DMS / 度分 / UTM / MGRS 解析与格式化 |
| datum.test.ts | PZ-90 Helmert 变换 |
| detect.test.ts | 锚点法（可信/粗略两档、远离锚点判 UNKNOWN、境外判 WGS84、空输入）；参考点法（三种坐标系判对、约 30 m 点击误差仍判对、参考点偏离数据时 `reliable=false`）；球面距离 |
| csv.test.ts / wkt.test.ts / wkb.test.ts / gpx.test.ts | 各格式解析/写出往返（gpx 用 happy-dom） |
| kmlRewrite.test.ts / gpxRewrite.test.ts | KML/GPX 就地改写：`gx:Track`、`when`、`Style`、`ele`/`time`、包围盒保留；境外不偏移；正则兜底；XML 声明不重复 |
| outputTargets.test.ts | 「输入什么格式默认输出什么格式」的映射与回落 |
| coordBounds.test.ts | 坐标范围校验；`projectionKind` 分类（回归：proj4.defs 返回对象而非字符串）；投影坐标写 KML/GPX 被拦截；投影→地理→KML 端到端 |
| elevationAndCrs.test.ts | KML 写出不凭空补 Z（往返回归）；`dropZ` 降维；就地改写丢弃高程（KML `<coordinates>`/`gx:coord`、GPX `<ele>`）；经纬度伪代码分类 |
| epsg4526.test.ts | CGCS2000 分带定义与官方参数一致；4526 与 4547 相差 38,000,000 m；全部分带定义 proj4 往返一致；带号前缀选错的三层拦截；4526 等高线 → GCJ02 / 火星墨卡托 实际链路（含高程与属性保留） |
| reprojectRoundTrip.test.ts | 投影 → 地理往返精度（4526 带内/带外、4547、3857、UTM 50N/50S）；经纬度顺序；伪代码目标链路一致性；Z 与属性完整性；多几何类型；带外尺度变形的量级 |
| shapefileIo.test.ts | Shapefile 组件拼装（.shp+.dbf，含大小写、缺 .dbf、多套合并）；真实二进制往返；**12 条折线写出后仍是 12 个要素 12 行属性**（回归：shp-write 会合并折线并丢属性）；点/线/面混合；中文属性与超长字段名 |
| theme.test.ts | 主题模式校验、存储读写的降级、属性与持久化、订阅/取消订阅、系统配色联动、清理幂等 |
| ui.test.ts | `segmented` 分段控件（初始化不回调、键盘循环、roving tabindex）与 `fillSelect` 重建行为 |

运行：`npm run typecheck && npm test && npm run build`。

---

## 8. 前端架构

`app.ts` 为外壳，`toolRegistry.ts` 以「工具清单」驱动：每个工具实现统一接口（id、名称、分类、图标、`render(container, service)`），将分类映射到左侧导航或顶层标签：

- **地理空间数据** → 格式转换、预览器
- **坐标投影转换** → 坐标系互转、投影转换、坐标格式工具
- **辅助工具** → 坐标拾取器、坐标系检测器

`service`（来自 `mapController`）为各工具提供：地图实例、数据图层渲染、底图切换、坐标拾取回调、`toast`/`download` 等基础设施。

**布局**：`#app` 固定为一屏高度（`100dvh`，`overflow: hidden`），`.gt-layout` 内部再滚动。因此头部与左侧导航常驻不动，只有 `.gt-main`（右侧内容）与 `.gt-sidebar`（导航超出时）各自独立滚动，页面本身不产生滚动条。

**侧栏分组**：每个分类渲染为 `div.gt-nav-group[role=group][aria-label=分类名]`，其中分类标题是可读的**纯标签**（`aria-hidden`、`pointer-events: none`、`cursor: default`），只有工具项是真正的 `<button>`。这样分类名既不会被误点，也不会让读屏软件重复朗读。

---

## 9. 主题系统

```
样式职责分层
├─ styles/theme.css   语义 token（--bg / --surface / --brand / --on-brand …）
│                     :root 为浅色，[data-theme='dark'] 覆盖为深色，并设置 color-scheme
└─ styles/main.css    组件样式，只写 var(--token)

运行时
├─ index.html 内联脚本  首屏前同步写入 <html data-theme>（避免深色模式闪白）
└─ ui/theme.ts         读取 localStorage → 决策 → 写入 data-theme → 通知订阅者
                       「跟随系统」时监听 prefers-color-scheme 变化，并响应 storage 事件跨标签同步
```

**关键约定**

| 约定 | 原因 |
| --- | --- |
| 组件层不得出现颜色字面量 | 否则新增主题必然漏改某处；可用 `grep -E '#[0-9a-f]{3,8}\|rgba?\(' src/styles/main.css` 校验 |
| `--brand` 与 `--brand-fill` 分离 | 深色下「作为文字的绿」需要更亮，「作为按钮底的绿」需要保持饱和以承托白字，混用会导致对比度不足 |
| `color-scheme` 跟随主题 | 让原生 `<select>`、滚动条、自动填充等 UI 与主题一致 |
| 地图瓦片、地图数据符号色不随主题变化 | 瓦片是数据；符号色变亮会在浅色底图上降低对比度（见 `map/mapStyle.ts`） |
| `--qr-surface` 恒为浅色 | 收款二维码反色后可能无法扫描 |

**扩展方式**：新增主题只需在 `theme.css` 追加 `[data-theme='xxx']` 覆盖块，并在 `ui/theme.ts` 的 `ThemeMode` 与 `THEME_MODES` 中登记——切换控件会自动出现该选项（`segmented` 由 `THEME_MODES` 驱动）。

---

## 10. 已知取舍 / 限制

- **DXF**：只支持常见 2D 实体（POINT/LINE/LWPOLYLINE/POLYLINE/CIRCLE/TEXT）；无 3D、块、样式。
- **GML / OSM XML / GPX**：几何子集，不解析 GML 复杂属性、OSM relation、GPX 扩展等。
- **Shapefile 写出**：自实现（`format/shpWrite.ts`），支持点/线/面（含 Multi\*），**逐要素一条记录**。
  不再使用 `@mapbox/shp-write`：它把所有 LineString 合并成一条多段记录，导致多条线并成一个
  MultiLineString、属性表只剩第一行 —— 对等高线这类「每条线各带属性」的数据是数据丢失。
  写出**不含 .prj**（GCJ-02 / 火星墨卡托没有权威 WKT），导入 GIS 后需手动指定坐标系。
- **Shapefile 读入**：`.shp` 必须与同名 `.dbf` 等一起提供（可整套拖入，或打包成 zip）。
  读取时**不解析 .prj** —— 本工具不使用它（坐标系由用户在界面指定），而现实中过时/不规范的
  WKT 会让整个文件读不出来；字段名按 UTF-8 字节截断到 10 字节、字符字段宽度按字节计算，
  因此中文属性不会截断成乱码（`shpWrite.ts` 的 `cutBytes`）。
- **PostGIS dump**：仅 `COPY ... FROM stdin` 几何列；不含 schema/索引/触发器。
- **MBTiles / PBF / GeoTIFF / 3D Tiles**：涉及 SQLite、Protocol Buffers、影像栅格、3D 瓦片的浏览器解码，暂未实现；后续可在 `src/format/` 内按统一接口扩展。
- **坐标系检测**：坐标值本身不含判据，必须借助参照物。锚点法只覆盖 20 个城市地标（数据几乎正好经过地标才有效），因此**任意轨迹请用「参考点校准」**；参考点法依赖用户点准（放大到街道级），最近距离 > 100 m 时工具会拒绝给结论。
- **就地改写（KML / GPX）**：坐标以外的内容经 `XMLSerializer` 重新输出。实测会**保留** CDATA 段、注释、自闭合标签、属性顺序与 `gx:` 前缀，但会：统一属性引号（`id='a'` → `id="a"`）、把数字字符引用还原为字面字符（`&#20013;` → `中`）、并由输出方固定 XML 声明为 UTF-8。语义等价但**非字节级一致**，只在与源文件同格式的 KML / GPX 转换时启用。若上游有对文件做字节比对 / 校验和的需求，可改用纯正则改写路径（`shiftByRegex`，只替换坐标数字、其余字节不动）。
- **就地改写的前置条件**：源与目标**必须都是地理坐标系**。任何一端是投影坐标系（单位为米）时 KML / GPX 在规范上无法表达，因此自动退回「GeoJSON 重写」管线，或在目标格式不合法时直接隐藏 / 拦截（见 3.3）。
- **「格式转换」工具**：仍是「任意源 → GeoJSON → 任意目标」的完整重写管线，`gx:Track` 等结构不保证保留；需要保结构时请用「坐标投影转换 → 文件转换 → 与源文件相同」。
- **gx:Track 点数 ≤ 2 时读取为 Point**：`@tmcw/togeojson` 的既有行为，仅影响预览 / 格式转换等走 GeoJSON 的路径，就地改写不受影响。
