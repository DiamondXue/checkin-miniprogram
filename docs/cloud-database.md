# 云数据库说明

## 数据库集合概览

| 集合 | 说明 | 创建方式 |
|------|------|---------|
| `users` | 所有用户（管理员 + 普通用户） | `initUsers` 云函数 |
| `activities` | 活动信息 | `initActivities` 云函数 |
| `activities/{_id}/participants` | 活动的参与者（子集合） | `initActivities` 云函数自动创建 |

---

## 集合：`users`

存储所有小程序用户，通过 `role` 字段区分管理员和普通用户。

### 字段结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `_id` | String | 自动生成 | 文档 ID |
| `staffId` | String | ✅ | 员工工号（8位数字，唯一索引） |
| `name` | String | ✅ | 员工姓名 |
| `dept` | String | 推荐 | 部门名称 |
| `role` | String | ✅ | 角色：`admin`（管理员）/ `user`（普通用户，默认） |
| `createdAt` | Date | 自动 | 创建时间 |

### 示例数据

```json
// 管理员
{ "staffId": "43334382", "name": "管理员", "dept": "行政部", "role": "admin" }

// 普通用户
{ "staffId": "10000001", "name": "张伟", "dept": "研发部", "role": "user" }
```

### 初始化

编辑 `cloudfunctions/initUsers/index.js` 中的 `USERS` 数组，部署后触发即可。

---

## 集合：`activities`

存储活动信息，每个活动通过 `participantStaffIds` 关联参与用户的工号。

### 字段结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `_id` | String | 自动生成 | 文档 ID |
| `name` | String | ✅ | 活动名称 |
| `location` | String | ✅ | 活动地点 |
| `latitude` | Number | 可选 | 活动地点纬度（用于位置签到） |
| `longitude` | Number | 可选 | 活动地点经度 |
| `checkinRadius` | Number | 可选 | 签到有效半径（米），0 = 不限制 |
| `date` | String | ✅ | 活动日期（YYYY-MM-DD） |
| `startTime` | String | ✅ | 开始时间（HH:mm） |
| `endTime` | String | ✅ | 结束时间（HH:mm） |
| `organizer` | String | ✅ | 主办方 |
| `participantStaffIds` | Array | ✅ | 参与者工号列表（用于普通用户查询） |
| `createdAt` | Date | 自动 | 创建时间 |

### 示例数据

```json
{
  "name": "2026 Q2 团建 · 户外拓展",
  "location": "广州市从化区流溪河国家森林公园",
  "latitude": 23.7486,
  "longitude": 113.5833,
  "checkinRadius": 500,
  "date": "2026-04-25",
  "startTime": "09:00",
  "endTime": "18:00",
  "organizer": "行政部",
  "participantStaffIds": ["43334382", "10000001", "10000002"]
}
```

---

## 子集合：`activities/{_id}/participants`

每个活动下的参与者列表及签到状态。

### 字段结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `_id` | String | 自动生成 | 文档 ID |
| `staffId` | String | ✅ | 员工工号 |
| `name` | String | ✅ | 姓名 |
| `dept` | String | 可选 | 部门 |
| `checked` | Boolean | ✅ | 是否已签到（默认 false） |
| `checkedAt` | String | 可选 | 签到时间（如 "09:15"） |

### 示例数据

```json
{
  "staffId": "10000001",
  "name": "张伟",
  "dept": "研发部",
  "checked": false,
  "checkedAt": ""
}
```

---

## 权限设置

在微信云开发控制台，建议将以下集合设置为**自定义安全规则**：

### users 集合
```json
{ "read": true, "write": false }
```

### activities 集合
```json
{ "read": true, "write": false }
```

### participants 子集合
```json
{ "read": true, "write": false }
```

> ⚠️ 所有写操作通过云函数或管理员操作完成，小程序端不开放写权限。

---

## 初始化步骤

### 1. 创建集合

在云开发控制台手动创建：
- `users`
- `activities`

`participants` 子集合会在初始化活动时自动创建。

### 2. 部署云函数

在微信开发者工具中：
1. 右键 `cloudfunctions/initUsers` → **上传并部署：云端安装依赖**
2. 右键 `cloudfunctions/initActivities` → **上传并部署：云端安装依赖**

### 3. 触发初始化

在云开发控制台 → 云函数中，依次手动触发：
1. **initUsers** — 录入用户（先执行）
2. **initActivities** — 录入活动及参与者（后执行）

### 4. 验证

在云开发控制台 → 数据库中检查：
- `users` 集合是否已有用户数据
- `activities` 集合是否已有活动数据
- 点击某个活动文档 → 子集合 `participants` 是否有参与者数据

---

## 云开发环境 ID

在 `app.js` 的 `globalData.cloudEnvId` 中已配置：

```js
cloudEnvId: 'cloud1-d9gq1b47d1a6184ac'
```

如需更换环境，修改此值即可。
