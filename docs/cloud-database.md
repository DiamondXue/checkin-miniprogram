# 云数据库说明

## 集合：`administrators`

存储有签到管理权限的员工工号信息。

### 字段结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `_id` | String | 自动生成 | 文档 ID |
| `staffId` | String | ✅ | 员工工号（8位数字，如 `43334382`） |
| `name` | String | 推荐 | 员工姓名，登录后展示 |
| `dept` | String | 可选 | 部门名称 |

### 示例数据

```json
{
  "_id": "auto-generated",
  "staffId": "43334382",
  "name": "张伟",
  "dept": "行政部"
}
```

### 权限设置

在微信云开发控制台，将 `administrators` 集合的**数据库权限**设置为：
- **读**：仅创建者可读（或自定义安全规则）
- 推荐使用**安全规则**，允许小程序端查询：

```json
{
  "read": true,
  "write": false
}
```

> ⚠️ 生产环境建议通过云函数查询，避免暴露数据库结构。

### 如何添加管理员

1. 登录[微信云开发控制台](https://console.cloud.tencent.com/tcb)
2. 进入对应环境 → 数据库 → 新建集合 `administrators`
3. 手动插入文档，填写 `staffId`、`name`、`dept` 字段

---

## 云开发环境 ID 配置

在 `app.js` 的 `globalData.cloudEnvId` 中填入你的环境 ID：

```js
cloudEnvId: 'your-env-id-here'  // 例如：prod-1g2h3j4k
```

环境 ID 可在云开发控制台 → 环境 → 环境 ID 处找到。
