# 乐造编程教育平台

一个面向青少年的编程学习平台，支持 Scratch、Python 等课程。

## 功能特点

- 用户注册/登录
- 作品管理
- 管理员后台
- 课程体系

## 快速开始

```bash
# 安装依赖
npm install

# 启动服务器
npm start
```

服务器将在 http://localhost:3000 启动。

## 默认账号

- 管理员： admin / 123456

## 目录结构

```
.
├── server.js        # 主服务器
├── data.json        # 数据存储
├── package.json     # 依赖配置
├── uploads/         # 上传文件
└── public/         # 前端页面
    ├── index.html          # 首页
    ├── login.html          # 登录
    ├── register.html       # 注册
    ├── admin-login.html    # 管理员登录
    └── admin-index.html    # 管理后台
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/login | 用户登录 |
| POST | /api/auth/register | 用户注册 |
| POST | /api/admin/login | 管理员登录 |
| GET | /api/admin/users | 获取用户列表 |
| POST | /api/admin/users | 添加用户 |
| DELETE | /api/admin/users/:id | 删除用户 |
| GET | /api/projects | 获取作品列表 |
| POST | /api/projects | 创建作品 |

## 技术栈

- Node.js + Express
- JWT 认证
- bcrypt 密码加密
- Multer 文件上传
