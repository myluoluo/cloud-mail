# Cloud Mail 邮件删除与已读接口补充文档

本文档基于当前仓库源码整理，用于补充线上文档 `https://doc.skymail.ink/api/api-doc.html` 中尚未列出的邮件操作接口。

适用仓库版本：当前工作区源码

适用范围：用户邮箱页面、邮件详情页、管理员全局邮件页面

## 结论

当前网页中的相关操作，后端支持情况如下：

| 操作 | 是否可直接作为 API 调用 | 接口 | 说明 |
| --- | --- | --- | --- |
| 删除邮件（普通用户邮箱） | 可以 | `DELETE /api/email/delete` | 由同步删除配置决定：关闭时逻辑删除，开启时物理删除 |
| 标为已读 | 可以 | `PUT /api/email/read` | 将指定邮件设为已读 |
| 标为未读 | 可以 | `PUT /api/email/unread` | 将指定邮件恢复为未读 |
| 删除邮件（管理员全局邮件） | 可以 | `DELETE /api/allEmail/delete` | 物理删除，会删除邮件、附件、星标记录 |
| 按条件批量删除邮件（管理员） | 可以 | `DELETE /api/allEmail/batchDelete` | 物理删除，按筛选条件批量清理 |

## 代码依据

以下源码可以直接证明上述结论：

- 前端用户邮件请求封装：
  [mail-vue/src/request/email.js](../mail-vue/src/request/email.js)
- 前端管理员邮件请求封装：
  [mail-vue/src/request/all-email.js](../mail-vue/src/request/all-email.js)
- 用户邮件后端路由：
  [mail-worker/src/api/email-api.js](../mail-worker/src/api/email-api.js)
- 管理员全局邮件后端路由：
  [mail-worker/src/api/all-email-api.js](../mail-worker/src/api/all-email-api.js)
- 邮件删除与已读服务实现：
  [mail-worker/src/service/email-service.js](../mail-worker/src/service/email-service.js)
- 权限控制：
  [mail-worker/src/security/security.js](../mail-worker/src/security/security.js)

## 通用规则

### 路径说明

仓库内部 Hono 路由注册时使用的是不带 `/api` 的路径，例如 `/email/delete`。

但实际部署入口会把外部请求的 `/api/*` 重写到内部路由，因此对外调用应使用：

```text
/api/email/delete
/api/email/read
/api/email/unread
/api/allEmail/delete
/api/allEmail/batchDelete
```

对应入口实现见：
[mail-worker/src/index.js](../mail-worker/src/index.js)

### 认证方式

除公开接口外，邮件相关接口统一通过请求头传递 JWT：

```http
Authorization: <token>
```

前端默认还会带上语言头：

```http
accept-language: zh
```

其中 `Authorization` 对应源码常量：
[mail-worker/src/const/constant.js](../mail-worker/src/const/constant.js)

### 统一返回结构

成功时：

```json
{
  "code": 200,
  "message": "success",
  "data": null
}
```

带数据时：

```json
{
  "code": 200,
  "message": "success",
  "data": {}
}
```

失败时：

```json
{
  "code": 401,
  "message": "身份认证失效,请重新登录"
}
```

常见状态码：

| code | 含义 |
| --- | --- |
| `200` | 请求成功 |
| `401` | 登录失效或 token 无效 |
| `403` | 权限不足 |
| `502` | 运行环境绑定异常，例如 D1 或 KV 未绑定 |

### 邮件状态字段

邮件表中与本文相关的两个字段：

| 字段 | 含义 | 取值 |
| --- | --- | --- |
| `unread` | 已读状态 | `0` 未读，`1` 已读 |
| `isDel` | 删除状态 | `0` 正常，`1` 已删除 |

对应常量定义见：
[mail-worker/src/const/entity-const.js](../mail-worker/src/const/entity-const.js)

## 1. 删除邮件（普通用户邮箱）

### 接口信息

- 方法：`DELETE`
- 路径：`/api/email/delete`
- 权限：需要登录，且需要 `email:delete`

### 请求参数

使用 query 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `emailIds` | `string` | 是 | 邮件 ID 列表，逗号分隔，例如 `1,2,3` |

请求示例：

```bash
curl -X DELETE 'https://你的域名/api/email/delete?emailIds=101,102,103' \
  -H 'Authorization: 你的JWT'
```

### 成功响应

```json
{
  "code": 200,
  "message": "success",
  "data": null
}
```

### 实际行为

这个接口根据同步删除配置 `syncDelete` 决定删除方式：

- 关闭时，仅把当前用户自己的邮件 `isDel` 改成 `1`，属于逻辑删除。
- 开启时（`syncDelete === settingConst.syncDelete.OPEN`，值为 `0`），先筛选当前用户拥有的邮件，再调用 `physicsDelete`，删除对应附件、星标记录和邮件数据。

### 影响范围

- 只能删除当前登录用户自己的邮件
- 条件里带了 `eq(email.userId, userId)`
- 删除后，普通用户的 `/email/list` 查询结果将不再返回这封邮件
- 仅逻辑删除时，数据仍保留在数据库中，管理员可以在全局邮件查询里看到 `type=delete` 的记录；开启同步删除后数据会被物理清理

### 相关源码

- 路由：
  [mail-worker/src/api/email-api.js](../mail-worker/src/api/email-api.js)
- 服务实现：
  [mail-worker/src/service/email-service.js](../mail-worker/src/service/email-service.js)
- 权限映射：
  [mail-worker/src/security/security.js](../mail-worker/src/security/security.js)

## 2. 标为已读

### 接口信息

- 方法：`PUT`
- 路径：`/api/email/read`
- 权限：需要登录

说明：当前权限表里没有把 `/email/read` 放入额外权限校验列表，因此登录用户即可调用，但仍然只能修改自己的邮件。

### 请求体

`Content-Type: application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `emailIds` | `number[]` | 是 | 邮件 ID 数组 |

请求示例：

```bash
curl -X PUT 'https://你的域名/api/email/read' \
  -H 'Authorization: 你的JWT' \
  -H 'Content-Type: application/json' \
  -d '{"emailIds":[101,102,103]}'
```

### 成功响应

```json
{
  "code": 200,
  "message": "success",
  "data": null
}
```

### 实际行为

接口会把指定邮件的 `unread` 统一更新为 `1`，也就是“已读”：

```js
await orm(c).update(email).set({ unread: emailConst.unread.READ })
```

### 影响范围

- 只能更新当前登录用户自己的邮件
- 条件里带了 `eq(email.userId, userId)`
- 支持批量已读
- 页面打开邮件详情时，也会自动调用这个接口把当前邮件标为已读

### 相关源码

- 前端请求：
  [mail-vue/src/request/email.js](../mail-vue/src/request/email.js)
- 邮件详情页自动已读：
  [mail-vue/src/views/content/index.vue](../mail-vue/src/views/content/index.vue)
- 后端路由：
  [mail-worker/src/api/email-api.js](../mail-worker/src/api/email-api.js)
- 服务实现：
  [mail-worker/src/service/email-service.js](../mail-worker/src/service/email-service.js)

## 3. 标为未读

### 接口信息

- 方法：`PUT`
- 路径：`/api/email/unread`
- 权限：需要登录，只能修改自己的邮件

### 请求体

与标为已读相同，使用 `Content-Type: application/json`：

```json
{"emailIds":[101,102,103]}
```

### 实际行为

接口将指定邮件的 `unread` 更新为 `0`。查询条件包含当前登录用户的 `userId`，支持批量恢复未读；成功响应与标为已读一致。

对应实现为后端 `/email/unread` 路由、`emailService.unread(...)` 和前端 `emailUnread(emailIds)` 请求封装。

## 4. 删除邮件（管理员全局邮件）

这个能力虽然不在普通用户邮箱页，但网页后台也有删除操作，实际对应的是另一组接口。

### 4.1 单个或批量物理删除

- 方法：`DELETE`
- 路径：`/api/allEmail/delete`
- 权限：需要 `all-email:delete`

请求参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `emailIds` | `string` | 是 | 邮件 ID 列表，逗号分隔 |

示例：

```bash
curl -X DELETE 'https://你的域名/api/allEmail/delete?emailIds=101,102' \
  -H 'Authorization: 管理员JWT'
```

实际行为：

- 删除附件
- 删除星标记录
- 从 `email` 表物理删除邮件

### 4.2 按条件批量删除

- 方法：`DELETE`
- 路径：`/api/allEmail/batchDelete`
- 权限：需要 `all-email:delete`

此接口按筛选条件批量物理删除，适合后台管理清理历史数据。

## 5. 相关查询接口

为了实际使用删除与已读能力，通常还需要配合查询接口。

### 5.1 用户邮箱列表

- 方法：`GET`
- 路径：`/api/email/list`

常用参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `accountId` | `number` | 当前邮箱账号 ID |
| `allReceive` | `0 \| 1` | 是否查询全部收件账号 |
| `emailId` | `number` | 游标 ID |
| `timeSort` | `0 \| 1` | `0` 倒序分页，`1` 正序拉取最新 |
| `size` | `number` | 每页数量，后端最大 `50` |
| `type` | `number` | 邮件类型，`0` 收件，`1` 发件 |

返回项中可直接使用：

| 字段 | 说明 |
| --- | --- |
| `emailId` | 邮件 ID |
| `unread` | 未读状态，`0` 未读，`1` 已读 |
| `isDel` | 删除状态，但普通列表接口默认只返回未删除邮件 |

### 5.2 用户邮箱最新邮件轮询

- 方法：`GET`
- 路径：`/api/email/latest`

页面会用它做新邮件轮询，但它本身不修改已读状态。

## 6. 推荐调用方式

### JavaScript 示例

```js
const token = '你的JWT';
const baseUrl = 'https://你的域名';

async function deleteEmails(emailIds) {
  const query = encodeURIComponent(emailIds.join(','));
  const res = await fetch(`${baseUrl}/api/email/delete?emailIds=${query}`, {
    method: 'DELETE',
    headers: {
      Authorization: token
    }
  });
  return await res.json();
}

async function markAsRead(emailIds) {
  const res = await fetch(`${baseUrl}/api/email/read`, {
    method: 'PUT',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ emailIds })
  });
  return await res.json();
}
```

## 7. 使用建议

### 删除接口选择

- 普通用户前台删除邮件，使用 `/api/email/delete`
- 管理员后台彻底删除邮件，使用 `/api/allEmail/delete`
- 需要按条件批量清理，使用 `/api/allEmail/batchDelete`

### 已读状态接口选择

- 标为已读使用 `PUT /api/email/read`
- 恢复未读使用 `PUT /api/email/unread`
- 两个接口均接受 `emailIds` 数组，并仅修改当前用户自己的邮件

## 8. 最终判断

基于当前仓库源码，可以直接作为 API 调用的只有：

- `DELETE /api/email/delete`
- `PUT /api/email/read`
- `PUT /api/email/unread`
- `DELETE /api/allEmail/delete`
- `DELETE /api/allEmail/batchDelete`

“标为已读”和“标为未读”均已有对应接口。
