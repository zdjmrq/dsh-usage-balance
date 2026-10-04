> [!WARNING]
> **本仓库已废弃** —— 相关能力已随 dsh 正式版本内置发布，无需再安装本插件；仓库仅作历史存档，不再维护。

# dsh-usage-balance

**DeepSeek Harness 侧边栏「用量 / 余额」插件**

在侧边栏底部「设置」按钮上方显示一条简洁的 **用量 | 余额** 标签行，鼠标悬停时在右侧展开玻璃拟态详情卡。

## 功能

- **标签行**：仪表盘图标 + 「用量 / 余额」标签（跟随界面中英文），与设置、Cordis 面板同一排位风格；与 Cordis 面板纵向堆叠、互不冲突
- **详情卡（悬停展开）**：
  - 运行时长（xxmxxs，每秒跳动）
  - Token（输入/输出）
  - 估算金额（≈，按内置价格表计算）
  - 官方账户余额（真实接口数据）
- **门帘式滑杆开关**：卡片底部的椭圆滑杆控制详情「悬停显示 ↔ 固定常驻」
- **自适应**：详情卡不超出桌面范围，右侧空间不足时自动翻转到左侧展开；侧边栏折叠成竖条时显示 ¥ 徽标
- **风格**：全部使用 DSH 主题变量（`--dsw-*`），跟随亮/暗主题；玻璃拟态（高级灰 + 透明度 + 背景模糊）

## 数据说明

- 用量：读取会话的 `tokenUsage` 投影（与内置统计同源）
- 金额：按内置价格表估算（`src/index.js` 顶部可修改单价）
- 余额：调用官方 `GET {baseURL}/user/balance`，复用 `llm-deepseek` 设置里的同一把 API Key，60 秒缓存；优先 Node fetch，失败自动回退 curl

## 安装

> 需求：Node.js ≥ 20 + DeepSeek Harness（带 `dsh plugin` 命令）

```sh
dsh plugin --profile web add github:zdjmrq/dsh-usage-balance
```

安装后重启 `dsh web` 生效。

更新 / 卸载：

```sh
dsh plugin --profile web update dsh-usage-balance   # 更新
dsh plugin --profile web remove dsh-usage-balance   # 卸载
```

## 已知限制

- 金额为估算值，实际账单以官方为准
- 余额查询需要可访问 `api.deepseek.com` 的网络与有效 API Key

## 📖 文字开源描述

本插件在「文字开源」枢纽仓库 [dsh-text-open-source](https://github.com/zdjmrq/dsh-text-open-source) 中配有完整描述（功能 / 技术路线 / 结构 / 关键实现 / 复刻提示词，不依赖代码即可复刻、便于理解与微调）：[plugins/dsh-usage-balance.md](https://github.com/zdjmrq/dsh-text-open-source/blob/main/plugins/dsh-usage-balance.md)。

## License

[MIT](LICENSE)
