# 译刻 (YiKe) — 本地优先的全场景翻译助手

译刻是一款 Windows 桌面翻译软件：文本翻译、划词翻译、截图翻译、视频实时字幕、音频实时翻译（电脑音频 / 麦克风）一个应用全搞定。本地模型离线可用，也可以接 DeepSeek、Kimi、通义等云端 API。

## 特性

- **文本翻译**：19 种语言，自动检测输入语言，实时流式输出
- **划词翻译**：选中任意文字即译，透明悬浮窗显示（Ctrl+Shift+D）
- **截图翻译**：框选屏幕区域直接识别并翻译（Ctrl+Shift+S）
- **视频实时字幕**：系统 OCR / RapidOCR 双引擎，看视频带实时字幕
- **音频实时翻译**：抓取电脑播放的声音或麦克风，实时识别 + 翻译（支持 中/英/日/韩 识别）
- **本地优先**：内嵌 Ollama 推理引擎，断网也能用；无显卡也可纯 CPU 运行
- **外接 API**：OpenAI 兼容接口，预设 DeepSeek / Kimi / 通义 / 智谱 / OpenAI，一键切换
- **绿色便携**：解压即用，不写注册表，删除文件夹即卸载

## 下载与安装

到 [Releases](https://github.com/zhy1149521493-oss/YiKe_TranslatorApp/releases) 页面下载最新版压缩包（如 `译刻-正式版-v1.0.0.zip`）。

> 注意：压缩包为 7z 格式（因 GitHub 附件限制后缀为 .zip），请用 **7-Zip / Bandizip / WinRAR / 360压缩** 等软件解压，不要使用 Windows 自带的右键“全部解压缩”。

解压后双击 `译刻.exe` 即可运行，无需安装。

## 首次使用：下载或导入模型

发布包不内置 AI 模型（体积原因），第一次使用需要：

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
- API Key 只保存在本机应用目录的 `config.json` 中，不会上传或外发
- 未签名的 exe 可能被杀毒软件（如火绒）拦截，请将 `译刻.exe` 加入信任/白名单

## 卸载

删除整个应用文件夹即可，不残留注册表或系统垃圾。

## 从源码构建（开发者）

```bash
git clone https://github.com/zhy1149521493-oss/YiKe_TranslatorApp.git
cd 译刻
npm install
npm run tauri dev      # 开发模式
npm run tauri build    # 构建 release
```

技术栈：Tauri 2（Rust）+ React 19 + TypeScript + Ollama（本地推理）+ sherpa-onnx（流式语音识别）+ RapidOCR（离线 OCR）。
