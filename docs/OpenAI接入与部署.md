# GeoCIM：OpenAI API 接入与部署

## 当前状态

已完成服务端 OpenAI Responses API 适配、网页模式切换、连接测试、操作参数校验和中英双语。当前没有配置用户API Key，尚未进行真实OpenAI连通性或模型行为验收。测试中的模拟响应只验证接口逻辑，不表示真实API已接通。

项目现只监听 `127.0.0.1:8765`，没有发布到域名。核密度分析尚未实现。

## 账号和计费

API与ChatGPT订阅单独计费。可以使用同一登录账号，为GeoCIM建立专用API项目和密钥；API费用不会由ChatGPT订阅额度支付。网页使用者不需要登录这个ChatGPT账号，也不能使用密钥访问你的ChatGPT对话。

你自己在OpenAI平台开通API计费并创建项目密钥，支付的是API调用费用，不是向第三方购买共享Key。默认试用模型为 `gpt-4.1-mini`，可配置为自己项目可用且支持结构化输出的模型。费用以平台当时公布的价格和实际用量为准。

官方资料：

- [API入门及密钥](https://developers.openai.com/api/docs/quickstart)
- [ChatGPT与API单独计费](https://help.openai.com/en/articles/9039756)
- [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)

## 在当前电脑配置

在PowerShell中执行：

```powershell
Set-Location D:\GeoCIM_Demo
.\configure-ai.ps1
```

按提示选择模型、输入自己的Key。Key输入不回显；脚本存入 `config/local_ai.json`，将此文件的权限限制为当前Windows用户。该文件已被Git忽略，不能随网站、安装包或截图公开。运行后，网页顶部点“AI设置 → 刷新配置 → 连接测试”。连接测试会发起一次小额计费请求。验证成功后，把助手模式从“本地预设”切换为“OpenAI API”。本地命令模式不调用API。

如果后台服务由其他系统用户运行，应由该服务用户配置密钥，或通过正式部署环境的秘密管理设施注入。支持标准环境变量 `OPENAI_API_KEY`、`OPENAI_MODEL`；环境变量优先于本地配置，修改环境变量后需重启服务。不要用 `VITE_` 前缀保存Key。

可尝试：

- 选择高度超过50米的建筑，把选中建筑的透明度调到80%。
- Show the population grid and open its attribute table.
- 这批建筑的平均高度是多少？

模型只返回允许的显示/选择操作；执行结果由真实地图数据计算。没有匹配的字段或未实现的分析应返回解释。无法保证每次模型理解都正确，实际试用需要继续核对。

## 数据和费用边界

网页向本服务发送文字请求；服务向固定的 `https://api.openai.com/v1/responses` 发送最近最多8条对话、图层名称/字段/数量、已选数量及建筑汇总统计。不会自动发送几何坐标、卫星图片、完整属性行或磁盘路径。用户自己输入到对话的内容会随请求发送。请求设置 `store:false`，这不等同于OpenAI的零数据保留承诺。

API Key只由Python服务读取，网页不会获取它。服务每分钟最多接受10次AI调用、同时只运行一个，每次最多1500输出token；这些是原型保护措施，不是完整的财务硬限额或公网滥用防护。

## 中国市场和域名

截至本次核对，中国大陆不在 [OpenAI API官方支持地区列表](https://developers.openai.com/api/docs/supported-countries) 中。购买域名或API Key不会改变地区支持条件；面向国内市场需要另行评估当地可用的模型服务。现有前端与AI适配分离，后续可添加DeepSeek适配，但本轮没有实现或验证DeepSeek。

域名是访问地址，还需要承载前端、Python服务和GIS数据的服务器。推荐部署结构为：

`其他电脑浏览器 → 你的域名与HTTPS → 登录/访问控制 → GeoCIM服务 → 模型API`

用户电脑不安装Python、不保存Key；Key由服务器统一管理。正式部署前还需确定服务器位置和供应商、用户登录、上传数据隔离、API用量配额，以及反向代理的请求大小与超时配置。不要将当前无登录的本地原型直接开放公网。更换电脑/服务器时，重新配置专用Key，并迁移运行环境、派生数据和目录配置；当前 `data_catalog.json` 包含本机绝对路径，需要更新到目标位置。

## 修改网页与检查

双语文案集中在 `src/i18n.jsx`，界面入口为 `src/main.jsx`。语言切换会保留当前地图选择，并在浏览器记住语言偏好。原始字段名、属性值和上传文件名保留原文。

修改前端后执行 `pnpm run build` 再刷新网页；修改Python后运行 `stop.ps1`、`start.ps1`。

验证命令：

```powershell
pnpm test
.\geocim-dev\Scripts\python.exe tests\uploads_test.py
.\geocim-dev\Scripts\python.exe tests\ai_test.py
```
