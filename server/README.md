# 航迹协作服务端

面向钉钉企业内部小程序的 Node.js 20 + MySQL 8 API，负责免登、角色权限、订单状态流转、阿里云 OSS 图片存储和工作通知。

## 已实现能力

- `dd.getAuthCode` 授权码换取钉钉用户身份
- `/pc/` 桌面端工作台，支持钉钉 PC 免登、订单、采购、发货、费用报销、OSS 图片和超级管理员审批
- 管理后台打开或刷新成员列表时，会分页同步钉钉根部门（`dept_id=1`）直属员工；需要应用开通“通讯录部门成员读权限”
- 钉钉返回 `admin=true` 的员工自动成为超级管理员，并使用外贸经理业务角色；其他新员工默认为业务员，之后可由超级管理员调整系统角色
- 新建订单支持导入 `.xlsx` PI 报价单，自动识别客户、产品、规格、体积、数量、单价及嵌入式产品图片；图片会转存至 OSS
- 应用 accessToken 内存缓存及提前刷新
- 业务、采购、物流、外贸经理四类业务权限；外贸经理可查看三个业务视角，钉钉超级管理员另有成员管理与报销审批权限
- 一个订单包含多个产品和颜色款式
- 产品采购逐行完成，自动汇总订单状态
- 已采购订单创建物流记录并转为已发货
- 产品图片、付款凭证和物流凭证安全上传至阿里云 OSS 私有 Bucket
- 数据库保存 OSS Object Key，查询订单时生成短时签名访问地址
- 状态历史和操作人审计
- 可选钉钉工作通知
- JWT 会话、限流、日志脱敏、事务与参数校验

## 快速部署

服务器需安装 Docker 和 Docker Compose。

```bash
cd server
cp .env.example .env
```

修改 `.env`，至少填写：

```dotenv
DB_PASSWORD=数据库业务账号密码
MYSQL_ROOT_PASSWORD=数据库root密码
JWT_SECRET=至少32位随机字符串
DING_APP_KEY=企业内部应用Client ID
DING_APP_SECRET=企业内部应用Client Secret
DING_CORP_ID=企业CorpId
DING_AGENT_ID=应用AgentId
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=Bucket名称
OSS_ACCESS_KEY_ID=RAM用户AccessKey ID
OSS_ACCESS_KEY_SECRET=RAM用户AccessKey Secret
OSS_CUSTOM_DOMAIN=https://img.example.com
```

可使用 `openssl rand -hex 32` 生成 JWT 密钥。然后启动：

```bash
docker compose up -d --build
curl http://127.0.0.1:3000/health
```

正常响应：

```json
{"status":"ok","service":"hangji-api"}
```

生产环境应使用 Nginx 和 HTTPS，示例见 `nginx/hangji.conf`。部署完成后，把 API 域名加入钉钉小程序的 HTTP 安全域名。

PI 导入接口允许最大 20 MB 的 `.xlsx` 文件，因此 Nginx 站点配置需要设置 `client_max_body_size 22m;`。

PC 网页生产资源会在 Docker 构建时自动生成。非 Docker 部署需要在重启服务前执行：

```bash
npm install
npm run web:build
```

部署后的入口为 `https://你的API域名/pc/`。在钉钉开发者后台将该地址配置为 PC 端应用首页，并确保 `.env` 已填写 `DING_CORP_ID`。

## 角色初始化

在环境变量中填写钉钉 `userId`，多个 ID 使用英文逗号：

```dotenv
DING_ADMIN_USER_IDS=managerUserId
DING_PURCHASE_USER_IDS=buyer1,buyer2
DING_LOGISTICS_USER_IDS=warehouse1
```

未命中名单的首次登录用户默认为业务员。超级管理员可以通过管理接口修改角色；服务端每次请求都会读取数据库中的最新角色和钉钉管理员身份，因此旧 JWT 不会保留已撤销权限。

## 主要接口

所有业务接口使用 `Authorization: Bearer <token>`。

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| POST | `/api/auth/dingtalk` | 公开 | 使用 `{ "code": "..." }` 免登 |
| GET | `/api/auth/me` | 登录用户 | 获取当前用户 |
| POST | `/api/uploads/image` | 登录用户 | 上传不超过 10 MB 的图片至 OSS |
| GET | `/api/orders` | 登录用户 | 按角色查询订单 |
| POST | `/api/orders` | 业务、外贸经理 | 创建多产品订单 |
| POST | `/api/imports/pi` | 业务、外贸经理 | 解析 PI 报价单并返回可编辑订单草稿 |
| GET | `/api/orders/:id` | 相关角色 | 查询完整订单 |
| PUT | `/api/orders/:id` | 超级管理员 | 修改订单、负责人和全部产品明细 |
| DELETE | `/api/orders/:id` | 超级管理员 | 删除订单及其数据库关联数据 |
| POST | `/api/orders/:id/purchase-complete` | 采购、外贸经理 | 完成指定或全部产品采购 |
| POST | `/api/orders/:id/shipments` | 物流、外贸经理 | 创建发货记录 |
| PUT | `/api/orders/:id/shipment` | 超级管理员 | 修改物流记录 |
| DELETE | `/api/orders/:id/shipment` | 超级管理员 | 删除物流记录并按产品采购进度恢复订单状态 |
| GET | `/api/admin/users` | 超级管理员 | 同步根部门直属员工并返回系统用户列表 |
| PATCH | `/api/admin/users/:id/role` | 超级管理员 | 修改业务角色 |
| GET | `/api/expenses` | 登录用户 | 员工查看本人申请；超级管理员查看全员申请 |
| POST | `/api/expenses` | 登录用户 | 提交费用报销及 OSS 凭证 |
| PATCH | `/api/expenses/:id/decision` | 超级管理员 | 通过或驳回待审批报销 |

上传接口返回的 OSS 附件格式，可直接用于创建订单：

```json
{
  "provider": "oss",
  "objectKey": "hangji/product/2026/08/uuid.jpg",
  "url": "短时签名访问地址",
  "fileName": "product.jpg",
  "fileSize": 1024,
  "fileType": "image/jpeg",
  "sourceType": "oss"
}
```

采购接口不传 `productIds` 时完成该订单全部待采购产品：

```json
{}
```

只完成指定产品：

```json
{"productIds":["产品UUID"]}
```

## 本地开发

```bash
npm install
npm run migrate
npm run dev
```

测试和语法检查：

```bash
npm test
npm run check
```

## 安全说明

- `DING_APP_SECRET`、OSS AccessKey、数据库密码和 JWT 密钥不得写入小程序代码。
- OSS AccessKey 应属于最小权限 RAM 用户，只授权目标 Bucket 所需的读写权限。
- Bucket 可以保持私有；服务端会在读取订单时生成短时签名 URL。
- 自定义域名必须先在 OSS Bucket 中完成绑定并配置 HTTPS 证书；`OSS_CUSTOM_DOMAIN` 不要以 `/` 结尾。
- 配置自定义域名后，上传请求和签名访问地址都会使用该域名；未配置时回退到 Bucket 默认域名。
- MySQL 默认不映射到宿主机公网端口。
- 建议服务器安全组只开放 80、443 和运维所需的 SSH 来源地址。
- `.env` 不应提交到版本控制。
