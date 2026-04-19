# 团建签到小程序

公司团建活动现场签到工具，支持多活动同时签到。

## 功能

- 📋 **活动列表**：按状态（进行中/即将开始/已结束）展示多个活动
- 📍 **位置签到**：基于地理位置验证，超出活动范围无法签到
- 🔍 **搜索筛选**：按姓名/部门搜索，按签到状态筛选
- ↩️ **撤销签到**：支持撤销误操作签到

## 项目结构

```
checkin-miniprogram/
├── app.js              # 全局逻辑
├── app.json            # 全局配置
├── app.wxss            # 全局样式
├── project.config.json # 项目配置
├── sitemap.json
├── utils/
│   ├── mockData.js     # Mock 数据（可替换为 API）
│   └── location.js     # 地理位置工具
└── pages/
    ├── index/          # 活动列表页
    └── detail/         # 活动详情 & 签到页
```

## 使用

1. 用微信开发者工具打开项目
2. 在 `project.config.json` 中填入 AppID
3. 点击预览即可

## 配置说明

每个活动支持以下位置签到参数：

| 字段 | 说明 | 示例 |
|------|------|------|
| latitude | 活动地点纬度 | 23.7486 |
| longitude | 活动地点经度 | 113.5833 |
| checkinRadius | 签到有效半径（米），0 不限制 | 500 |

## 对接真实 API

将 `utils/mockData.js` 中的数据替换为后端 API 请求即可，UI 层无需改动。
