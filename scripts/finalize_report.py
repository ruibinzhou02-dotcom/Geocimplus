"""Attach actual delivery evidence to the latest local audit report."""
import json,re,datetime
from pathlib import Path
root=Path(__file__).resolve().parents[1]
cat=json.loads((root/'config/data_catalog.json').read_text(encoding='utf-8'));out=Path(cat['report_directory'])
tables=json.loads((out/'workbook_data.json').read_text(encoding='utf-8'));checks=json.loads((out/'交付验证.json').read_text(encoding='utf-8'))
report=out/'数据体检报告.md';text=report.read_text(encoding='utf-8')
pop=next(x for x in tables['图层概览'] if x['图层']=='人口网格')
text=re.sub(r'^- 人口网格：.*$', '- 人口网格：边界内占比{:.6%}，相交{}条，覆盖研究边界面积{:.6%}。'.format(pop['边界内占比_去重长度或面积'],pop['与边界相交要素数'],pop['覆盖研究边界面积比例']),text,flags=re.MULTILINE)
text+='\n\n## 首版开发验收补充\n本地网页已实际运行与浏览器验证，详细记录见同目录《开发验收报告.md》和截图。EXE实际构建前置检查失败：缺Rust/Cargo；没有可交付EXE。\n'
report.write_text(text,encoding='utf-8')
sizes=checks['logical_directory_bytes_excluding_link_targets']
rows=['# GeoCIM 首版开发验收报告','',f'记录时间：{datetime.datetime.now().isoformat(timespec="seconds")}。审计状态：READY_WITH_LIMITS。','','## 已实际运行验证','- React/Vite生产构建成功，浏览器实际显示MapLibre三维高度拉伸，未同时绘制重复建筑图层。','- 当前源值height为用户确认的米制离地高度；程序不声称独立测量精度。','- 同一高度阈值通过按钮与预设对话得到一致结果：'+str(checks['filtered_count'])+'条。测试脚本直接对实际GeoJSON全量属性复算。','- 无效的最低/最高阈值组合被拒绝，地图记录计数保持不变；缺失年代/用途、动态人口与消防请求不能执行。','- WebMCP已注册，合法请求切换2D/灰度影像/人口图层，非法请求被拒绝。功能与按钮共用executeAction。','- 点击属性卡的源FID、objectid_1、高度与原始审计副本核对一致。详见browser_checks.json和交付验证.json。','- 影像、人口、2D与3D切换、缩放和复位实际操作；MapLibre提供旋转/倾斜交互。','- start.ps1、stop.ps1实际完成停止和恢复；服务仅监听127.0.0.1:8765。','- API白名单路径可访问，未知图层、实际catalog路径、backend源码不可通过静态服务读取。','- Excel共13个工作表，逐一检查冻结表头和筛选；'+str(sum(x['source_text_cells_verified'] for x in checks['xlsx']))+'个原始文本单元格在最终XLSX XML逐字一致，没有公式。','- 原始80个文件SHA256未变，无新增原始辅助文件。','','## 真实功能范围','建筑三维、二维、高度着色和筛选、ID属性查询、道路显示、单期人口图和111c1灰度底图均可演示。建筑年代/用途/层数不存在，明确禁用相关功能；人口只有一个日期时段，没有虚构时间变化。网格不裁剪分配给建筑，也不直接把全网格人数称为边界内独立人数。','人口grid的面积口径：完整网格保留，约79.8%网格并集面积位于边界内，不据此计算人口面积分配。','三处图像检查仅支持基础视觉对应，部分屋顶/轮廓可见偏离；没有控制点残差，未确认米级精度或进行坐标平移。RGB未证实，影像显示为明确标注的单波段灰度。','','## 未完成与阻塞','- 实时OpenAI API：没有可用OPENAI_API_KEY，仅检查变量是否存在，未读取或打印密钥；未集成实时模型，预设模式明确标识。','- EXE：实际运行build-exe.ps1，在缺少Cargo的前置检查处失败。未发现MSVC构建工具；Tauri代码已编写，但Rust编译、后端PyInstaller打包、桌面启动、无开发环境机器验证均未完成。','- Tauri前置要求：https://v2.tauri.app/start/prerequisites/ 。构建脚本与README提供后续步骤，不以配置文件存在冒充EXE交付。','- 公共演示包未生成，没有包含真实数据的分发包。','','## 运行位置与截图',f'- 本地网址：http://127.0.0.1:8765/','- 项目目录：'+str(root),'- 最新报告：'+str(out),'- 主截图：首版_三维总览.png、首版_影像与人口.png、首版_建筑属性卡.png、首版_筛选与异常校验.png。','- 启动/关闭/恢复/构建说明：项目README.md。','','## 体积实测','以下为目录文件逻辑字节数，跳过目录链接目标，不表示NTFS物理分配块或外部包缓存大小：']
rows += ['- '+k+'：'+f'{v/1048576:.2f} MiB' for k,v in sizes.items()]
rows += ['- 合计：'+f'{sum(sizes.values())/1048576:.2f} MiB','- D盘剩余：'+f"{checks['disk_free_bytes']['D:/']/1024**3:.2f} GiB",'- 原始数据31.15 MiB；三个3632×3436 Int16波段解压约71.41 MiB。保守GIS转换峰值约1 GiB，估算公式见审计报告。未转换全幅全层级瓦片。','','## 需要用户核对','1. RGB顺序或提供原影像的波段颜色说明。','2. 原始建筑与影像的坐标转换记录/精度控制点，及影像采集日期。','3. 人口0910时段含义、时区、去重/扩样口径，以及性别/年龄分组加总差异。','4. 如需年代和用途着色，补充相应字段及来源。','', '本地Git只记录源码、脚本、模板和说明，数据/报告/实际路径配置被忽略，没有远程仓库或互联网部署。']
(out/'开发验收报告.md').write_text('\n'.join(rows),encoding='utf-8')
print(out)
