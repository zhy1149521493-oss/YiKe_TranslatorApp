# 译刻 (YiKe) — 全场景翻译助手 · v1.2.0

诗集、工作台、经典三套界面，在设置中切换，共享主题配色。支持收起为导航或图标、拖动品牌区域移动窗口，以及矩形悬浮窗的边缘磁吸和共享透明度。

v1.2.0 整合新版界面，并修复翻译竞态、音频状态管理、置顶缩窗与设置保存问题。开发与验证记录见 [docs/README.md](docs/README.md)。

译刻是一款 Windows 桌面翻译软件：文本翻译、划词翻译、截图翻译、视频实时字幕、音频实时翻译（电脑音频 / 麦克风）一个应用全搞定。本地模型离线可用，也可以接 DeepSeek、Kimi、通义等云端 API。

## 特性

- **文本翻译**：19 种语言选项，实时流式输出；源语言可手动选择或自动检测（不确定时由模型判断）
- **三套可切换界面**：诗集竖版阅读、工作台双栏对照、经典布局；样式只在设置中切换，切换保留内容和任务
- **可展开导航与磁吸悬浮窗**：导航可常驻或悬停展开，支持保持置顶，三个矩形悬浮窗支持不同尺寸的边缘拼接
- **划词翻译**：选中任意文字即译，透明悬浮窗显示（Ctrl+Shift+D）
- **截图翻译**：框选屏幕区域直接识别并翻译（Ctrl+Shift+S）
- **视频实时字幕**：系统 OCR / RapidOCR 双引擎，看视频带实时字幕
- **音频实时翻译**：抓取电脑播放的声音或麦克风，实时识别 + 翻译（支持 中/英/日/韩 识别）
- **本地推理**：可搭配 Ollama 引擎与已下载的模型离线使用；无显卡也可纯 CPU 运行，轻量版需自行准备引擎
- **外接 API**：OpenAI 兼容接口，预设 DeepSeek / Kimi / 通义 / 智谱 / OpenAI，一键切换
- **绿色便携**：解压即用，不写注册表，删除文件夹即卸载

## 下载与安装

到 [Releases](https://github.com/zhy1149521493-oss/YiKe_TranslatorApp/releases/latest) 下载 `YiKe-Lite-v1.2.0.zip`。从本版本开始，后续仅发布轻量版，不再上传包含大型运行库或模型的完整版；历史版本仍保留。

新版使用标准 ZIP，Windows 自带解压即可。解压后进入文件夹，双击 `译刻.exe`。轻量版保留全部业务功能，但不附带 Ollama、翻译模型和 OCR／ASR／降噪模型。

- **API 用户**：在设置中配置 OpenAI 兼容接口即可使用文本翻译。
- **本地翻译用户**：保留旧完整版的 `ollama/` 与 `models/`，或自行准备完整的便携 Ollama 引擎；仅下载翻译模型不能代替引擎。
- **截图／字幕／音频用户**：按需在设置 → 模型下载识别组件。Windows 系统 OCR 取决于系统安装的识别语言。

升级前先保存输入并从托盘退出旧版，再用新版文件覆盖原目录的程序和同名 DLL。保留 `config.json`、`ollama/`、`models/`、`ocr/` 和 `asr/`；压缩包不包含这些个人配置或数据。详见 [轻量版发布与升级说明](docs/RELEASES.md)。

## 首次使用：下载或导入模型

轻量版不内置 AI 模型；本地翻译需先准备程序旁的完整 `ollama/` 引擎目录，再操作以下步骤。只使用 API 时可跳过：

1. 打开应用 → 右上角 ⚙ 设置 → 模型；
2. 点「下载 HY-MT2（推荐，约 1.1GB）」或「下载 gemma3（约 3.3GB）」，可实时查看进度 / 速度 / 剩余时间；
3. 也可以导入自己的 `.gguf` 模型：把文件拖入「导入本地 GGUF 模型」区域（或粘贴路径），填写模型名，点「开始导入」。

下载走 Ollama 官方模型库（registry.ollama.ai），国内一般可直接下载；如果很慢，可以用加速器，或从网上下载 `.gguf` 文件后走「导入」方式（本地复制，不走网络）。

## 系统要求

- Windows 10/11 64 位
- 需要 WebView2 运行时（Win11 自带；缺失时应用会弹窗引导安装）
- 本地翻译：有 NVIDIA / AMD 显卡更快；没有显卡也能用（纯 CPU 模式，应用内会提示）

## 快捷键

| 功能 | 快捷键（可在设置中修改） |
|---|---|
| 划词翻译（悬浮窗开关） | Ctrl+Shift+D |
| 截图翻译 | Ctrl+Shift+S |
| 视频字幕 | Ctrl+Shift+U |

## 外接 API（可选）

设置 → 模型 → 外接 API：可配置任意 OpenAI 兼容服务（Base URL + API Key + 模型），支持按预设一键新建、检测模型列表、测试连接、禁用思考等。配置后无需本地显卡。

## 隐私与安全

- 软件完全本地运行，翻译数据不出本机（外接 API 模式会把文本发给对应服务商，属于正常使用）
- API Key 保存在本机应用目录的 `config.json` 中，调用 API 时用于所选服务的身份验证；发布包不包含个人密钥
- 未签名的 exe 可能被杀毒软件（如火绒）拦截，请将 `译刻.exe` 加入信任/白名单

## 卸载

删除整个应用文件夹即可，不残留注册表或系统垃圾。

## 从源码构建（开发者）

Developer setup, configuration, verification and the current code review are documented in [docs/README.md](docs/README.md).

```bash
git clone https://github.com/zhy1149521493-oss/YiKe_TranslatorApp.git
cd YiKe_TranslatorApp
npm install
npm run tauri dev      # 开发模式
npm run tauri build    # 构建 release
```

技术栈：Tauri 2（Rust）+ React 19 + TypeScript + Ollama（本地推理）+ sherpa-onnx（流式语音识别）+ RapidOCR（离线 OCR）。
