# GeoTransformer · 地理数据处理箱

浏览器端地理数据处理工具集。**免费、开源、全程本地处理，数据不出浏览器。**

> 核心设计：所有功能都基于 **GeoJSON** 这一中间标准，按「解析 → 处理 → 写出」的流水线设计。核心业务逻辑（`src/core`、`src/format`）与 UI（`src/tools`、`src/ui`）严格分离，并配有单元测试。

## 功能一览

### 地理空间数据（Geospatial Data）

| 模块 | 功能 | 输入 | 输出 |
| --- | --- | --- | --- |
| 格式转换 | GeoJSON ↔ Shapefile（ZIP 打包） | GeoJSON / SHP | SHP / GeoJSON |
| 格式转换 | GeoJSON ↔ KML | GeoJSON / KML | KML / GeoJSON |
| 格式转换 | GeoJSON ↔ TopoJSON | GeoJSON / TopoJSON | TopoJSON / GeoJSON |
| 格式转换 | GeoJSON ↔ WKT（熟知文本） | GeoJSON / WKT | WKT / GeoJSON |
| 格式转换 | GeoJSON ↔ WKB（二进制/十六进制） | GeoJSON / WKB | WKB / GeoJSON |
| 格式转换 | GeoJSON ↔ GPX（GPS 轨迹） | GeoJSON / GPX | GPX / GeoJSON |
| 格式转换 | GeoJSON ↔ GML（地理标记语言） | GeoJSON / GML | GML / GeoJSON |
| 格式转换 | GeoJSON ↔ DXF（CAD） | GeoJSON / DXF | DXF / GeoJSON |
| 格式转换 | GeoJSON ↔ OSM XML | GeoJSON / OSM | OSM / GeoJSON |
| 格式转换 | CSV（含坐标）→ GeoJSON | CSV | GeoJSON |
| 格式转换 | Excel（.xlsx，含坐标）→ GeoJSON | Excel | GeoJSON |
| 格式转换 | PostGIS Dump → GeoJSON | pg_dump SQL | GeoJSON |
| 格式转换 | Shapefile / GeoJSON → CSV 属性表 | SHP / GeoJSON | CSV |
| 格式转换 | GeoJSON → CSV 扁平表 | GeoJSON | CSV |

> 由于采用「任意源 → GeoJSON → 任意目标」的流水线，上述任意两种格式之间都可以互相转换（例如 Shapefile ↔ KML、CSV → Shapefile 等），只需把源先解析为 GeoJSON，再输出为目标格式。

### 坐标投影转换（Coordinate & Projected）

| 模块 | 功能 | 输入 | 输出 |
| --- | --- | --- | --- |
| 地理坐标系互转 | WGS-84 ↔ GCJ-02 / BD-09 / CGCS2000 / PZ-90 / GRS-80 | 单点 / 批量 / 文件 | 转换后结果 |
| 投影坐标转换 | EPSG 之间转换（如 3857 ↔ 4326，自定义 proj4） | GeoJSON / 单点 | 转换后文件 |
| 复合投影 | EPSG:4326 ↔ 火星墨卡托 / 百度墨卡托 | GeoJSON / 单点 | 转换后结果 |
| 坐标格式解析 | DMS（度分秒）/ 度分 / 十进制 互转 | 文本 | 十进制度 |
| 坐标格式解析 | UTM ↔ WGS-84 | 50N 123456 789012 | 经纬度 |
| 坐标格式解析 | MGRS ↔ WGS-84 | 50SMK4796917670 | 经纬度 |
| 偏移修复 | GCJ-02 → WGS-84（反算）、BD-09 → WGS-84（反算） | 火星/百度坐标 | 真实坐标（近似） |

> 「文件转换」默认**输入什么格式就输出什么格式**，并可另选其它格式（与「格式转换」共用同一份格式清单）。
> 其中 **KML / GPX 同格式转换采用就地改写**：只替换坐标数字，完整保留 `gx:Track`、`<when>` 时间戳、`<Style>`、
> `<Folder>`、`<ele>` 高程、`<extensions>` 等结构，避免「任意源 → GeoJSON → 任意目标」往返造成的数据丢失
> （例如两步路 / Google Earth 的 `gx:Track` 轨迹若走 GeoJSON 往返会退化成单点或普通折线）。
>
> ⚠️ **注意区分两个名字相近的工具**：**坐标投影转换**是 WGS84 / GCJ02 / BD09 / CGCS2000 等**地理坐标系互转**
> （结果仍是经纬度）；**投影坐标转换**是 **EPSG 投影转换**（如 4326 ↔ 3857，结果是米）。两者都支持文件模式，
> 且输出格式都默认跟随输入格式。
>
> **KML / GPX / OSM XML 只能表示经纬度**。当目标坐标系是投影坐标系（单位为米）时，这三种格式会从输出列表中
> 移除；如果强行把投影坐标（如 `12956609, 4852509`）写成 KML，工具会直接拦下并提示先转到地理坐标系，
> 而不是生成一个打不开的文件。
>
> 坐标系下拉按单位分为**地理坐标系（经纬度）**与**投影坐标系（单位：米）**两组，避免选错。经纬度组除了
> EPSG:4326 / EPSG:4490，还提供 **GCJ02 / BD09** 这两个无 EPSG 编号的中国偏移坐标系，因此可以在本工具里
> 直接完成「投影坐标 → GCJ-02 经纬度 → KML」这类链路。

### 高程（Z 值）与 QGIS 的三维识别

KML / GPX 里的高程会成为 GeoJSON 坐标的第三个分量。**GDAL / QGIS 只要看到第三个分量，就会把图层声明为
EPSG:4979（WGS 84 三维）**，而不是 EPSG:4326（二维）—— 这是 QGIS 的既定行为，不是文件损坏。三维图层在切换
项目坐标系（如改为 EPSG:3857）时，需要 3D→2D 的换算，容易失败或错位。

因此「文件转换」卡片提供**高程（Z 值）**选项：

- **保留高程（默认）**——轨迹高程是有用数据，原样保留，输出 2D 与 3D 取决于源数据本身；
- **丢弃高程**——输出二维坐标，QGIS 会正常识别为 EPSG:4326，之后切换到 EPSG:3857 也不会出问题。
  该选项对就地改写的 KML / GPX 同样生效（只去掉高程，`gx:Track` / `<when>` / `<Style>` 照旧保留）。

另外，工具**不会再凭空补 Z**：源数据没有高程时，输出的 KML 也不会写 `,0`（此前会补，导致往返一次就变成三维）。

### 辅助工具（Helper）

| 模块 | 功能 | 输入 | 输出 |
| --- | --- | --- | --- |
| 坐标拾取器 | 点击地图获取坐标（支持坐标系切换） | 地图点击 | 坐标（可切换坐标系） |
| 坐标系检测器 | 判断数据是 WGS-84 / GCJ-02 / BD-09（自动锚点 + 参考点校准） | GeoJSON / KML / CSV / 坐标 | 检测结果 + 置信度 |
| 数据预览器 | 拖入文件自动渲染（可指明源坐标系） | GeoJSON / KML / GPX / CSV 等 | 地图预览 + 属性表 |

### Shapefile（shp）怎么导入导出

Shapefile **不是单个文件**：几何在 `.shp`、属性在 `.dbf`、索引用 `.shx`、坐标系在 `.prj`、编码提示在 `.cpg`。
因此导入有两种方式，两种都支持：

| 方式 | 操作 | 说明 |
| --- | --- | --- |
| **打包成 zip** | 把整套文件压成一个 `.zip` 后拖入 | 最省事，推荐 |
| **整套一起拖入** | 一次选中（或拖入）`.shp` + `.dbf`（+ `.shx`/`.prj`/`.cpg`） | 文件名基名要一致，会自动归组拼装；多个 Shapefile 一起拖入会合并要素 |
| 只给 `.shp` | 单独拖入 `.shp` | 能读到几何，但**属性为空**（属性在 .dbf 里） |
| 只给 `.dbf` 等 | —— | 会提示「需要和同名的 .shp 一起拖入」 |

导出时得到的是一个 zip，内含 `.shp / .shx / .dbf / .cpg`，解压即得标准 Shapefile 套件。

> **不含 .prj**：GCJ-02、火星墨卡托等没有权威 EPSG/WKT 定义，写一个错的比不写更糟。
> 导入 QGIS / ArcGIS 后请**手动指定坐标系**。同理，读取时不把 `.prj` 交给解析器 ——
> 现实中不少 `.prj` 是过时或不规范的 WKT，会让整个文件读不出来。

### 常见任务：把地方坐标系数据转到高德底图上

国内测绘成果常见 **CGCS2000 高斯-克吕格分带投影**（如等高线、DLG、地形图），要叠加到高德底图时：

1. **先确认分带编码**。3 度带、6 度带各有两套并存的 EPSG 编码，中央经线相同但**东坐标是否含带号前缀**不同，
   两者相差 `带号 × 1,000,000` 米：

   | 数据形态 | 编码系列 | 东坐标示例 | 说明 |
   | --- | --- | --- | --- |
   | 带带号 | EPSG:4513–4533（3 度带）/ 4491–4501（6 度带） | `385xxxxx`（38 带 / CM 114°E） | 东坐标 = 带号×1e6 + 500000 |
   | 无带号 | EPSG:4534–4554（3 度带）/ 4502–4512（6 度带） | `5xxxxx` | 东坐标 = 500000 + 偏移 |

   工具会**自动预检**：数据东坐标量级与所选编码不符时直接报错，并指出同中央经线应使用的编码。

2. **在「投影坐标转换」里转换**。源投影选数据实际的分带编码；目标投影按用途二选一：
   - **`GCJ02`（GCJ-02 经纬度）** —— 需要经纬度时用（如高德 JS API、多数国内软件）；
   - **`GCJ02-WEBMERC`（火星墨卡托）** —— 与**高德瓦片同一投影**（米制 Web 墨卡托 + GCJ-02 基准），
     用于 GIS 叠加分析或与 Web 墨卡托管线对接。

   输出格式默认跟随输入（SHP → SHP、DXF → DXF、GeoJSON → GeoJSON 等）；等高线的**高程值会原样保留**。

3. **验证**。把结果拖进「数据预览器」，若结果是 GCJ-02 经纬度，把「源坐标系」设为 GCJ-02、底图用高德，
   轨迹/等高线应贴合道路与地物。

> 关于分带范围：每个 3 度带的**设计范围是中央经线 ±1.5°**（38 带即 112.5–115.5°E）。
> 超出范围的数据虽然仍能算出数值，但变形会明显增大，这时应改用相邻分带的编码。

> 精度说明：链路是 `CGCS2000 高斯投影 → CGCS2000 经纬度 → WGS-84 经纬度 → GCJ-02`。
> CGCS2000 与 WGS-84 的差异在厘米级（本工具按等同处理），真正的误差来源是 GCJ-02 加密算法本身
> —— 它是不可逆的非线性偏移，任何工具都无法做到「精确还原」。另外转换后**不要用长度/面积统计**，
> 投影换算是等角变换，长度比例会改变。

#### 投影 → 地理：会不会出问题

**换算本身是精确的**：实测 4526 / 4547 / 3857 / UTM 50N / UTM 50S 往返误差约 `1e-14` 度（浮点精度极限），
经纬度顺序、高程与属性都正确。真正需要留意的是这四件事：

1. **源编码选错**（最常见）：带带号 / 无带号混用会差整整几千万米。工具会预检并直接告诉你该用哪个编码。
2. **带外数据的尺度变形**：高斯投影离中央经线越远变形越大。带内 2.4° 处约 0.5 m/km（可忽略），
   而在 16° 处可达 **29 m/km（约 2.9%）**。此时**位置仍能精确还原**（因为是正反算），
   但如果你之前在投影坐标系里量过长度或面积，那些值本身是偏大的。
   经验法则：3 度带用于中央经线 ±1.5° 以内，超出就该换带。
3. **目标是 GCJ-02 / BD-09 时**：结果会带上约 500 m 的偏移（这是「火星坐标」的定义）。
   若把这种结果当作 WGS-84 喂给 QGIS 等软件，看起来就是整体偏移——需要在软件里正确指定坐标系。
4. **高程不做改正**：第三个分量原样搬运。投影坐标系的高程通常是**椭球高**，转成经纬度后仍是椭球高，
   不会自动变成海拔（大地水准面改正需要重力场模型，本工具不做）。

另外，转成经纬度之后才能输出 **KML / GPX / OSM** —— 这三种格式按规范只接受经纬度，
工具会在目标是投影坐标系时把它们从输出列表里移除。

### 坐标系判断：为什么需要参照物
GCJ-02 / BD-09 只在中国大陆把坐标整体平移约 500 m，且平移量随位置平滑变化。
这意味着**同一个点的三套坐标都是合法数值**，光看坐标值无法判定属于哪一套——必须有外部参照。
因此「坐标系检测器」提供两条路径：

1. **自动检测（锚点法）**：内置 20 个精确的城市地标 WGS-84 坐标，比较样本与各地标在三种坐标系下的
   距离后投票。**只有数据几乎正好经过这些地标时才有效**（判定半径约 110 m）；否则会明确返回「无法判定」
   并说明原因，而不是给一个可能是错的答案。
2. **参考点校准（任何数据都适用）**：在地图上点击轨迹经过的某个明显地物（路口、桥头等）的**真实位置**，
   工具会比较三种假设下数据与这个参考点的距离，取最小者。三种假设彼此相距约 500 m，远大于点击误差，
   因此结论可靠。若参考点明显偏离数据（最近样本仍在 100 m 以上），工具会提示不可信并让你重点，不给出结论。

> 另外「数据预览器」可以直接切换**假定坐标系**（保持视野不动），轨迹贴合底图道路的那一组就是正确答案。

**数据里没有坐标系信息**：KML / GeoJSON 规范上都规定坐标是 WGS-84。国内软件导出的 GCJ-02 数据属于
非标准用法，文件本身不带任何标记 —— 这也是国内数据处理最常见的坑（同一份轨迹用错坐标系会偏移约 500 m）。

### 界面配色

顶栏提供 **浅色 / 深色 / 跟随系统** 三档切换，选择会记住（`localStorage`），「跟随系统」会实时响应操作系统的深浅色变化。
配色由 `src/styles/theme.css` 的语义 token 统一驱动：

- **加主题**：在 `theme.css` 追加一个 `[data-theme='xxx']` 覆盖块即可，组件样式无需改动；
- **加颜色**：在 token 层新增变量，组件层只引用变量（`main.css` 已不含任何颜色字面量）；
- **地图瓦片不随主题变化**：瓦片是数据，深色界面下仍显示原底图，需要深色底图可在底图下拉中选择「Carto 深色」；
- **收款二维码底板**在深色模式下保持浅色（`--qr-surface`），避免反色后无法扫描。

## 技术栈与架构

- **语言/构建**：TypeScript（严格模式 `strict`）+ Vite（生产构建按依赖自动分包）。
- **地图**：Leaflet（默认 **高德地图 GCJ-02 底图**，已做坐标纠偏；支持切换到 OSM / Esri / Carto 等 WGS-84 底图对照）。
- **地理处理**：`proj4`（投影转换）、`shpjs` / `@mapbox/shp-write` / `jszip`（Shapefile 读写与打包）、`topojson-server/client`（TopoJSON）、`@tmcw/togeojson`（KML 读取）、`xlsx`（Excel）、`mgrs`（MGRS 格网）、自研 CSV/WKT/WKB/GPX/GML/DXF/OSM/PostGIS 解析与序列化。
- **测试**：Vitest（覆盖坐标互转、投影往返、基准变换、坐标格式解析、CSV/WKT/WKB/GPX 等核心逻辑）。

### 目录结构

```
geo-transformer/
├─ index.html                    # 入口页面
├─ src/
│  ├─ main.ts                    # 应用启动入口
│  ├─ app.ts                     # 应用外壳（头部 / 侧边栏 / 主区域 / 工具切换）
│  ├─ toolRegistry.ts            # 工具模块接口 + 分类元信息（地理空间数据 / 坐标投影转换 / 辅助工具）
│  │
│  ├─ core/                      # 纯业务逻辑，无 UI 依赖（核心算法）
│  │  ├─ types.ts                # 坐标系 / 投影定义、常量、内置 EPSG 表
│  │  ├─ coordTransform.ts       # WGS-84 / GCJ-02 / BD-09 互转（偏移算法）
│  │  ├─ reproject.ts            # 基于 proj4 的投影转换，含 GCJ/BD 墨卡托复合投影
│  │  ├─ datum.ts                # 基准（CGCS2000 / PZ-90 / GRS-80）Helmert 变换
│  │  ├─ coordFormat.ts          # DMS / 度分 / UTM / MGRS 解析与格式化
│  │  └─ detect.ts               # 坐标系启发式检测
│  │
│  ├─ format/                    # 各格式解析与写出（输入/输出均转 GeoJSON）
│  │  ├─ geojson.ts              # GeoJSON 解析 / 边界框 / 统计
│  │  ├─ csv.ts                  # CSV 解析 + 坐标列识别 → Point
│  │  ├─ csvFlat.ts              # GeoJSON → 扁平 CSV / 属性表 CSV
│  │  ├─ wkt.ts                  # WKT ↔ GeoJSON
│  │  ├─ wkb.ts                  # WKB（hex/二进制）↔ GeoJSON
│  │  ├─ gpx.ts                  # GPX ↔ GeoJSON
│  │  ├─ gml.ts                  # GML ↔ GeoJSON
│  │  ├─ dxf.ts                  # DXF（常见实体）↔ GeoJSON
│  │  ├─ osmxml.ts               # OSM XML ↔ GeoJSON
│  │  ├─ excel.ts                # Excel(.xlsx) → GeoJSON
│  │  ├─ postgis.ts              # PostGIS dump → GeoJSON
│  │  ├─ kml.ts                  # KML ↔ GeoJSON（读用 @tmcw/togeojson）+ 就地改写坐标
│  │  ├─ shapefile.ts            # Shapefile ↔ GeoJSON
│  │  ├─ topojson.ts             # TopoJSON ↔ GeoJSON
│  │  ├─ xmlText.ts              # XML 就地改写公共工具（数字格式化 / 序列化）
│  │  └─ index.ts                # 聚合导出
│  │
│  ├─ map/
│  │  ├─ basemaps.ts             # 底图配置（高德 / OSM / Esri / Carto / OpenTopo + 坐标基准）
│  │  └─ mapController.ts        # Leaflet 封装：底图、数据图层、坐标拾取、GCJ-02 纠偏
│  │
│  ├─ tools/                     # 功能模块（UI 层，调用 core/format）
│  │  ├─ formatConvert.ts        # 格式转换
│  │  ├─ coordConvert.ts         # 多坐标系互转（单点 / 批量 / 文件）
│  │  ├─ reprojectTool.ts        # 投影坐标转换
│  │  ├─ outputTargets.ts        # 输出格式清单 + 写出 + 写出前校验（共用）
│  │  ├─ coordFileCard.ts        # 坐标转换的文件卡片（两个坐标工具共用）
│  │  ├─ coordFormatTool.ts      # 坐标格式解析 / 格式化
│  │  ├─ picker.ts               # 坐标拾取器
│  │  ├─ detector.ts             # 坐标系检测器
│  │  ├─ previewer.ts            # 数据预览器
│  │  └─ fileParsers.ts          # 统一「文件 → FeatureCollection」分派
│  │
│  ├─ ui/                        # 通用 UI 组件
│  │  ├─ dom.ts  form.ts  modal.ts  toast.ts  dropzone.ts  download.ts
│  │  ├─ theme.ts                # 主题模式（浅色 / 深色 / 跟随系统）与持久化
│  │  └─ themeSwitch.ts          # 顶栏主题切换控件
│  ├─ modules/                   # 捐赠等
│  │  ├─ donation.ts  donationConfig.ts
│  ├─ styles/
│  │  ├─ theme.css               # 主题 token 层（浅 / 深两套语义变量）
│  │  └─ main.css                # 组件样式层（只引用 token，不写颜色字面量）
│  └─ types/                     # 第三方模块类型声明（mgrs / shp-write / qrcode 等）
│
└─ tests/                        # Vitest 单元测试
```

> 各工具与模块的详细分工见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 快速开始

```bash
npm install        # 安装依赖
npm run dev        # 本地开发（默认 http://localhost:5173）
npm run test       # 运行单元测试
npm run build      # 类型检查 + 生产构建（输出到 dist/）
npm run preview    # 本地预览生产构建
npm run typecheck  # 仅做类型检查
```

## 部署

`dist/` 里是纯静态产物，`base` 已设为相对路径（`./`），因此放在域名根目录或任意子路径下都能正常加载，可：

- 直接扔到任意静态服务器 / 对象存储 / CDN；
- 用 `npx serve dist` 或 `vite preview` 本地预览；
- 托管到 GitHub Pages / Vercel / Netlify 等（无需后端）。

### 部署到 GitHub Pages

本仓库已内置工作流 [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)：推送到 `main` 后自动执行 `npm ci && npm run build`，并把 `dist/` 发布到 Pages。

假设 GitHub 用户名为 `Bancott`、仓库名为 `GeoTransformer`，则访问地址为：

**https://bancott.github.io/GeoTransformer/**

首次部署只需三步：

1. 在 GitHub 上新建**公开**仓库 `GeoTransformer`（不要勾选自动生成 README，保持空仓库）；
2. 本地推送代码：
   ```bash
   git init -b main
   git add .
   git commit -m "chore: initial commit"
   git remote add origin https://github.com/Bancott/GeoTransformer.git
   git push -u origin main
   ```
3. 打开仓库 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**（只需设置一次）。之后每次 `git push` 都会自动重新部署。

> `base` 保持 `'./'` 是关键：若改成 `'/'`，子路径部署时所有 JS/CSS 会 404。
> `public/.nojekyll` 用于在改用「Deploy from a branch」模式时阻止 Jekyll 处理产物。
>
> 想要 `https://Bancott.github.io/` 这样的裸域名，仓库必须命名为 `Bancott.github.io`，本项目的相对路径配置同样适用，无需改动代码。

## 坐标基准说明

- **高德底图**默认使用 GCJ-02 基准的瓦片。为保证地图上的数据仍以 WGS-84 为准且不发生偏移，`MapController` 在「显示」时把 WGS-84 坐标换算为 GCJ-02，点击/拾取时再换算回 WGS-84——源数据始终不变。
- 可在地图类工具中切换回 OSM / Esri / Carto 等 **WGS-84 底图**做对照校验。

## 坐标系检测的说明

WGS-84 / GCJ-02 / BD-09 之间的差异是**中国大陆范围内**一个平滑的小偏移（数百米级）。单个坐标值本身就携带不唯一性，因此「自动检测」本质是**启发式估计**。本实现的策略：

1. 结合内置的中国大陆范围先验（境外数据基本可判定为 WGS-84）；
2. 用一张内置的精确 WGS-84 城市锚点表，对样本点分别比较其在三种坐标系下的距离并投票；
3. 输出最可能的结果、置信度与可判定样本数，并明确提示局限，建议结合 WGS-84 底图对照验证。

## 部分格式的支持程度

浏览器端无法完整实现所有专业格式，本实现聚焦「常用、可离线、算法清晰」的集合，以下为**有限支持**项：

- **DXF**：仅读取常见实体（POINT / LINE / LWPOLYLINE / POLYLINE / CIRCLE / TEXT），不支持 3D、块、样式等。
- **GML / OSM XML**：支持常用几何子集（Point / LineString / Polygon / 各 Multi），不含属性结构、关系（relation）等高级语义。
- **PostGIS dump**：仅解析 `COPY ... FROM stdin` 文本块内的几何列（WKT 或 hex WKB），不解析 schema / 索引 / 触发器。
- **MBTiles / PBF / GeoTIFF / 3D Tiles**：因涉及 SQLite / Protocol Buffers / 影像栅格在浏览器端的解码复杂度，暂未纳入；如需可在 `src/format/` 下按既有接口扩展。

## 隐私

所有数据都在浏览器本地处理，不依赖任何后端接口，也不会把任何文件上传到服务器。

## 许可证

本项目基于 [MIT License](LICENSE) 发布 —— 可自由使用、修改、分发（含商业用途），只需保留版权声明。

欢迎通过页面右上角「捐赠」支持作者；也欢迎在 GitHub 上提交 Issue 或 PR。
