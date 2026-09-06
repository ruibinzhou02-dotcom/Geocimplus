# GeoCIM 本地首版

这是使用真实本地数据的 React + Vite + MapLibre GL JS 原型，Python/FastAPI 仅监听回环地址。运行时从 `config/data_catalog.json` 读取本地审计副本，不把真实数据编进前端或安装包。

## 本地启动、关闭与恢复

在项目目录用 PowerShell 执行 `./start.ps1`，然后打开 http://127.0.0.1:8765/ 。关闭服务执行 `./stop.ps1`。服务在隐藏窗口运行，关闭浏览器不会自动停止服务。脚本会检查已运行实例，停止时核对进程命令行，避免停止其他程序。

再次运行 `./start.ps1` 即可恢复。选择、透明度和相机状态仅保存在当前页面，刷新回到初始状态；上传图层、数据、报告和稳定ID映射保存在磁盘。出错查看 `reports/server.stderr.log`。端口被其他程序占用时请先解决冲突，不要直接结束不明进程。

## 可用功能

- 真实建筑二维/三维、height 离地高度着色、全字段属性表和按属性选择。
- 道路显示、单期完整人口网格专题图、灰度卫星底图切换。
- 点击查看原始属性及持久稳定ID，缩放、旋转、倾斜、复位和清除选择。
- 分别调节图层、选中要素、统计卡与图例的透明度；0% 不透明，100% 完全透明。
- 上传 Shapefile、带坐标的卫星影像，自动添加到地图并保存到本机。
- 明确标识的本地预设指令。没有接入实时AI；API连通性未验证，不会上传空间数据。
- 按钮、预设指令和可选WebMCP共享同一参数校验与执行逻辑。没有任意Python、SQL或Shell执行入口。

不存在的建筑年代/用途字段不会生成模拟值。没有多时段人口播放、消防服务区或人口向建筑的空间分配。高度单位、人口口径的用户确认保存在忽略的本地配置中；物理位置精度和RGB顺序的限制见审计报告。

“超过50米”使用严格 `height > 50`，选择结果为1,701栋。选中项以金色显示，其余要素保留。属性表支持等于、不等于、大小比较、文本包含、空值与非空；也可逐行勾选。顶部统计针对原有全部5,306栋建筑，统计排除null，0保持为0。

## 上传与属性表

点击右上角“上传数据”或右侧“上传”：

- Shapefile：上传一个 ZIP，或同时选中同名 `.shp / .shx / .dbf / .prj`；有 `.cpg` 时一起选中。中文乱码时可指定 UTF-8、GBK 或 GB18030。每次一个图层，最多100,000个要素。
- 卫星影像：支持 GeoTIFF，也支持带世界文件和 `.prj` 的 PNG/JPEG，或完整 ArcInfo Grid 目录 ZIP。影像必须有可识别的坐标系和地理定位。RGB仅按文件标记识别；其他波段以灰度预览。预览最大2048像素，非8位数据必要时只对预览作2–98%拉伸。
- 单次上传最大256 MiB，ZIP展开最大512 MiB。上传副本、派生预览与元数据保存在 `data/uploads/独立ID/`；刷新或重启仍可加载。原始文件不改动。

打开右侧“属性表”，选择图层、字段、比较方式和值，点击“按属性选择”。下方有“图层透明度”和“已选要素透明度”；“仅查看已选”只改变表中显示的行，地图仍保留其余要素。图层页还可调整每张影像的透明度。统计卡和图例默认62%透明，也可滑动调整。

本轮为本地界面与数据导入。后续 API 与核密度分析尚未实现；可以在现有参数校验与GIS后端之上增加模型适配和受控分析工具。

## 环境与复现

现有独立环境名为 `geocim-dev`（venv）。锁定版本见 `requirements-lock.txt` 与 `pnpm-lock.yaml`。不修改Anaconda base。

重新配置时，使用可用的64位Python 3.12：

```powershell
python -m venv geocim-dev
./geocim-dev/Scripts/python.exe -m pip install --only-binary=:all: -r requirements-lock.txt
pnpm install --frozen-lockfile
pnpm run build
```

审计：

```powershell
./geocim-dev/Scripts/python.exe scripts/audit_data.py --source "原始数据目录" --project "$PWD"
```

每次生成独立的 `reports/时间戳`、`data/时间戳`，不覆盖历史。`config/data_catalog.json` 指向最新一次，历史目录保留快照。原始目录以只读方式访问，关闭GDAL PAM写入，前后校验SHA256、修改时间和文件清单。

Excel构建使用Codex提供的 `@oai/artifact-tool` 和Node环境。当前 `scripts/node_modules` 是通向Codex依赖的本地目录链接；换机器时需重新建立此链接，不能把Codex内部依赖打包或提交。`audit_data.py` 会调用 `scripts/build_workbook.mjs`；无依赖时明确生成阻塞说明，不能以JSON代替Excel。生成的Excel按全量属性统计，不包含动态公式；DBF文本以文本存储，保留前导零。

开发模式可在服务运行时执行 `pnpm dev`，打开该命令报告的本地地址，`/api` 代理至8765。发布构建使用 `pnpm build`；服务直接读取 `dist`，无需Node运行前端。开发服务器仅监听回环地址，不部署互联网。

验证：`pnpm test` 直接依据本地审计数据核对属性选择、ID映射、空值与透明度校验。`./geocim-dev/Scripts/python.exe tests/uploads_test.py` 在独立临时目录验证投影转换、中文与前导零、SHP/ZIP/GeoTIFF导入、重启恢复及错误文件处理。没有本地目录和真实数据时这些验证会明确失败。

## Windows EXE：构建未通过环境检查

当前未提供可运行EXE。Tauri源代码和 `build-exe.ps1` 已编写，但当前机器未检出Rust/Cargo或MSVC构建工具。实际执行构建脚本在Cargo前置检查处失败，因此不能宣称Rust代码编译、桌面启动或安装包验证成功。

按 https://v2.tauri.app/start/prerequisites/ 配置Rust MSVC工具链、Microsoft C++ Build Tools和WebView2，并在独立环境安装PyInstaller后运行：

```powershell
./geocim-dev/Scripts/python.exe -m pip install pyinstaller
./build-exe.ps1
```

该脚本先构建前端，再把Python服务打成独立后端程序，Tauri打包两者。运行桌面程序前设置 `GEOCIM_PROJECT` 为已审计工作目录，并先停止浏览器版服务；桌面程序启动后端并在退出时结束它。未设置目录或端口被占用时应失败退出。

构建产物预计位于 `src-tauri/target/release/bundle/nsis`。这些路径表示构建方案，不表示已有可交付文件。构建成功后还必须实际测试启动、退出、数据加载及无开发环境机器运行。真实数据始终从本地路径读取。公共演示包当前未生成；没有分发授权前不得包含真实数据，可另行提供明确合成的示例。

## 本地Git与隐私

只跟踪脚本、前端/后端源码、模板、锁文件和使用说明。报告、属性样例、影像、衍生数据、实际catalog/确认记录、环境、缓存、密钥和构建产物均被忽略。没有远程仓库，没有上传或互联网部署。

报告中的地名来自本地元数据，地图范围由本地边界动态计算；业务源码不包含研究区坐标或原始属性记录。当前不需要API密钥。
