# 账页 · 生活账簿

一款安静、清晰的 Windows 桌面记账应用。使用 Tauri 2 + React + Rust 构建，双击安装后的应用即可运行，**不需要打开浏览器，也不需要安装 Node.js**。

![账页概览](docs/preview.png)

## 桌面版特性

- **独立应用**：可安装的 Windows 程序，拥有自己的窗口、任务栏图标和桌面快捷方式。
- **数据留在本机**：账本只写入本机应用数据目录，不上传任何账目。唯一的联网行为是启动后静默检查 GitHub Releases 是否有新版本。
- **自动更新**：启动后自动检查，失败会自动重试，并在应用保持打开时定期在后台复查，发现新版本直接弹窗，可选择「立刻更新」或「下次再说」；下载过程中可切到后台继续记账，下载完成后再询问是否立即安装。安装前会先把账本完整写入磁盘，安装完成后自动重启。
- **快速记账**：金额、收支类型、分类、账户、日期与备注；按 `N` 随时打开记账面板。
- **流水管理**：按月分组浏览，支持关键词、类型、分类、账户筛选，随时编辑或删除；筛选里的分类按收入、支出分组展示。
- **自定义分类**：收入和支出各有独立的分类列表。内置分类也可改名、换颜色和图标，自定义分类与内置分类完全同级；已被流水或项目预算使用的分类不能删除或改变收支类型。
- **项目账**：左侧「项目」页以日历为底板，点选日期设定开始与截止（也可不设截止、结束后手动结束），项目以彩色日期条铺在日历上。项目可设总预算与分类预算；项目本身不设分类，每笔消费保留自己的分类并归入项目。共用支出可同时计入日常和多个项目，项目详情只显示归入本项目的金额。项目无论进行中、已结束还是已归档都可以删除，删除后原归入该项目的金额会自动转为日常支出。
- **月度概览**：结余、收入、支出、预算进度、日均支出、最大单笔与最近流水；另有总结余卡片，可选本月、近 6 个月、今年、全部或自定义月份范围，并在起始资金（从零开始或使用账页前的已有资金）基础上计算区间结余。
- **统计分析**：近六个月收支对照、每日支出走势、分类排行，以及支出重心、月末预计、最费钱的星期和最大单笔四条月度观察。
- **月度预算**：设置统一月度预算，查看使用比例、剩余额度与日均可用金额。
- **本地备份**：导出/导入完整 JSON 备份，导出可被 Excel 打开的 CSV 流水表。
- **四套完整主题**：松烟绿、琥珀金、远山蓝、玫瑰紫，均含浅色纸页与深色夜读两种模式。每套主题不只是换背景：收入/支出、趋势、图表、分类色、金额卡与提示色都会随之调整，并各有专属纹样——松烟绿的纸纤维与年轮、琥珀金的日轮光束与金粉、远山蓝的山岚等高线与星点、玫瑰紫的窗格棱线与同心环。纹样同时出现在页底、侧栏留白和分类卡片上；设置中带实时预览，选中即生效并记住选择。
- **阅读偏好**：字体大小提供小、标准、大、超大四档，只放大文字而不打乱布局；货币支持人民币、美元、英镑、欧元、日元、韩元，切换只更换金额符号，不会换算已有账目。
- **响应式界面**：窄窗口下自动切换为底部导航与浮动记账按钮。

首次打开是一张空白账页。想先看看完整效果，可以在空状态中一键载入六个月示例流水；之后也能在「设置与数据管理」中重新载入或导入自己的备份。

## 安装桌面版

在项目根目录的 `release/` 中获取构建好的安装包，双击安装即可：

```text
release/
  账页-Setup-2.1.1.exe        Windows 安装包
```

只提供安装版，不再提供便携版。安装版才能使用应用内自动更新，也能避免安装版与便携版混用造成两份数据。

系统要求：Windows 10/11 64 位。Windows 11 已内置 WebView2 运行时；旧版 Windows 若缺少该运行时，安装程序会提示安装。

> 应用暂未使用商业代码签名证书，首次运行时 Windows SmartScreen 可能显示“未知发布者”提示。这是未签名应用的正常现象。

## 从源码运行

### 构建环境

- Node.js 18 或更高版本
- Rust stable（MSVC toolchain）
- Visual Studio Build Tools 2022，含“使用 C++ 的桌面开发”工作负载
- WebView2 Runtime

当前机器已配置好以上环境，可以直接构建。项目内的 `.cargo/config.toml` 将 crates.io 指向 rsproxy 镜像，避免在当前网络下拉取 Rust 依赖时卡住；若能直连 crates.io，可以删除这个文件。

```bash
npm install
npm run desktop:dev
```

Tauri 会启动 Vite 开发服务器并打开原生应用窗口。纯浏览器预览仍可使用 `npm run dev`，但它不是最终交付形态。

## 打包

正式分发包必须带更新签名。先设置 Tauri 更新签名私钥与密码，再构建：

```bash
export TAURI_SIGNING_PRIVATE_KEY=/path/to/zhangye.key
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='你的私钥密码'
npm run desktop:build
```

PowerShell 中对应使用 `$env:TAURI_SIGNING_PRIVATE_KEY = "..."` 和 `$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "..."`。

构建完成后，Tauri 产物位于：

```text
src-tauri/target/release/bundle/nsis/
  账页_2.1.1_x64-setup.exe
  账页_2.1.1_x64-setup.exe.sig
```

`.sig` 是更新签名文件，必须与安装包一起上传到 GitHub Release，否则应用内更新会被拒绝。可将安装包复制到根目录的 `release/` 中分发。

## 发布自动更新

更新源固定为：

```text
https://github.com/1279255198psy/ledger/releases/latest/download/latest.json
```

### 一键发布（推荐）

发布只需要给出一个版本号：

```bash
npm run release            # 按提示输入版本号；直接回车 = 发布下一个补丁版本
npm run release -- 1.2.3   # 也可以在命令行直接指定
```

脚本 `scripts/release.mjs` 会自动完成：同步 `package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`Cargo.lock` 与 README 中的版本号 → 本地构建校验 → 提交并创建 `vX.Y.Z` tag → 推送到 GitHub → 等待 Actions 构建、签名并上传草稿 Release → 校验 `.exe`、`.exe.sig`、`latest.json` 后自动发布并标记 Latest → 校验应用内更新地址。首次运行还会自动初始化 git 仓库、配置 `origin`，并从本机密钥目录上传缺失的签名 Secrets。

前提：已安装 Git、Node.js 与 GitHub CLI，执行过 `gh auth login`，且当前账号对仓库有写权限。想先确认流程可运行 `npm run release -- --dry-run 1.2.3`，试运行只做检查，不改文件、不推送、不发布。

### 手动发布（备用）

仓库内的 `.github/workflows/release.yml` 会在推送 `v*` tag（或手动触发）时构建 Windows 安装版、签名并创建草稿 Release。首次使用前，先把项目提交并推送到 `1279255198psy/ledger` 的默认分支，然后在 GitHub 仓库的 **Settings > Secrets and variables > Actions** 中添加两个仓库密钥：

- `TAURI_SIGNING_PRIVATE_KEY`：更新私钥文件的完整内容。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：生成私钥时设置的密码。

发布步骤：

1. 同步修改 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 中的版本号。
2. 提交改动，在 GitHub Actions 中手动运行 **Release Windows installer**。
3. 检查草稿 Release 中的安装包、`.sig` 与 `latest.json`，确认无误后发布。
4. 已安装的旧版本会在下次启动时自动弹窗提示；也可以在「设置 > 关于账页」中重新打开更新窗口。

首次发布必须是带有更新插件和 `latest.json` 的版本；更早构建、没有更新功能的安装包无法自动升级，只能手动安装一次。`latest.json` 只应指向安装版，不要上传便携版。

更新私钥只保存在本机项目目录之外，不要提交到仓库，也不要写进 README；请单独备份私钥和密码。丢失私钥后，已经安装的用户将无法验证后续更新。

## 数据存储

桌面版将账本保存在：

```text
%APPDATA%\com.zhangye.ledger\ledger.json
%APPDATA%\com.zhangye.ledger\ledger.json.bak
```

- `ledger.json`：流水、预算、明暗模式、主题配色、字体大小、货币与初始化标记，采用临时文件替换方式写入。
- `ledger.json.bak`：每次保存前保留的上一版文件，用于文件损坏时恢复。
- WebView 本地缓存同时保留一份镜像；若程序在写入完成前退出，下次启动会选择较新的数据。

如果此前使用过浏览器版，会有一份旧数据留在浏览器中。可在浏览器版设置里导出 JSON，再在桌面版中导入。

## 技术栈

- Tauri 2（Rust）与 WebView2
- React 18 + TypeScript 5
- Vite 6
- lucide-react 图标
- 原生 CSS 设计系统与 SVG 图表，无图表库依赖

## 目录结构

```text
src/
  components/        导航、弹窗、流水行与图表组件
  components/charts/ 月度趋势、收支对照、每日支出、分类排行与数据表
  hooks/             应用更新检查、下载与安装状态
  lib/               演示数据、存储、桌面桥接、聚合与格式化工具
  pages/             概览、流水、统计
  App.tsx            应用状态与数据流
  styles.css         设计变量、布局、主题与响应式样式
src-tauri/
  src/lib.rs         Tauri 启动、账本文件读写与导出命令
  tauri.conf.json    窗口、打包、更新源与应用标识配置
  icons/             桌面应用图标
.github/
  workflows/release.yml  GitHub Release 自动构建与签名
public/
  favicon.svg        网页预览图标
docs/
  preview.png        界面预览
```
