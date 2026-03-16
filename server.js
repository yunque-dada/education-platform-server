const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "edu-platform-2024-dev-fallback";

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");

const dataFile = path.join(__dirname, "data.json");
let data = {users:[],projects:[]};

try {
  if (fs.existsSync(dataFile)) {
    const content = fs.readFileSync(dataFile, "utf8").trim();
    if (content) data = JSON.parse(content);
  }
} catch(e) {}

if (!data.users) data.users = [];
if (!data.projects) data.projects = [];

// 创建默认管理员
if (!data.users.find(u => u.role === "admin")) {
  const adminPwd = bcrypt.hashSync("123456", 10);
  data.users.push({
    id: 1,
    username: "admin",
    password: adminPwd,
    role: "admin",
    nickname: "管理员",
    createdAt: new Date().toISOString()
  });
  try { fs.writeFileSync(dataFile, JSON.stringify(data, null, 2)); } catch(e) {}
}

function saveData() {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

const uploadsDir = path.join(__dirname, "uploads/projects");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, {recursive:true});

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname, "public")));

// Rate Limiting
const ipCounts = new Map();
function rateLimit(max, window) {
  return (req, res, next) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    const rec = ipCounts.get(ip) || {count:0, reset:now+window};
    if (now > rec.reset) { rec.count = 1; rec.reset = now+window; }
    else rec.count++;
    ipCounts.set(ip, rec);
    if (rec.count > max) return res.status(429).json({error:"请求过于频繁，请稍后再试"});
    next();
  };
}

// 健康检查
app.get("/api/health", (req,res) => res.json({status:"ok"}));

// 用户登录
app.post("/api/auth/login", rateLimit(10,900000), async (req,res) => {
  const {username,password} = req.body || {};
  if (!username || !password) return res.status(400).json({error:"请输入用户名和密码"});
  const user = data.users.find(u => u.username === username);
  if (!user) return res.status(401).json({error:"用户名或密码错误"});
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({error:"用户名或密码错误"});
  const token = jwt.sign({id:user.id, username:user.username, role:user.role}, JWT_SECRET, {expiresIn:"7d"});
  res.json({token, user:{id:user.id, username:user.username, role:user.role, nickname:user.nickname}});
});

// 管理员登录
app.post("/api/admin/login", rateLimit(10,900000), async (req,res) => {
  const {username,password} = req.body || {};
  if (!username || !password) return res.status(400).json({error:"请输入用户名和密码"});
  const user = data.users.find(u => u.username === username && u.role === "admin");
  if (!user) return res.status(401).json({error:"用户名或密码错误"});
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({error:"用户名或密码错误"});
  const token = jwt.sign({id:user.id, username:user.username, role:user.role}, JWT_SECRET, {expiresIn:"7d"});
  res.json({token, user:{id:user.id, username:user.username, role:user.role, nickname:user.nickname}});
});

// JWT验证中间件
function auth(req,res,next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({error:"请先登录"});
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { res.status(401).json({error:"登录已过期"}); }
}

// 获取用户列表
app.get("/api/admin/users", rateLimit(60,60000), auth, (req,res) => {
  if (req.user.role !== "admin") return res.status(403).json({error:"权限不足"});
  res.json(data.users.map(u => ({id:u.id, username:u.username, nickname:u.nickname, role:u.role, createdAt:u.createdAt})));
});

// 添加用户
app.post("/api/admin/users", rateLimit(60,60000), auth, async (req,res) => {
  if (req.user.role !== "admin") return res.status(403).json({error:"权限不足"});
  const {username,password,role,nickname} = req.body || {};
  if (!username || !password) return res.status(400).json({error:"请提供用户名和密码"});
  if (username.length < 3 || username.length > 20) return res.status(400).json({error:"用户名长度需在3-20个字符之间"});
  if (password.length < 6) return res.status(400).json({error:"密码长度至少6个字符"});
  if (data.users.find(u => u.username === username)) return res.status(400).json({error:"用户名已存在"});
  const user = {
    id: Date.now(),
    username,
    password: bcrypt.hashSync(password, 10),
    role: role || "student",
    nickname: nickname || username,
    createdAt: new Date().toISOString()
  };
  data.users.push(user);
  saveData();
  res.json({message:"添加成功", userId:user.id});
});

// 删除用户
app.delete("/api/admin/users/:id", rateLimit(60,60000), auth, (req,res) => {
  if (req.user.role !== "admin") return res.status(403).json({error:"权限不足"});
  const idx = data.users.findIndex(u => u.id == req.params.id);
  if (idx === -1) return res.status(404).json({error:"用户不存在"});
  if (data.users[idx].role === "admin") return res.status(400).json({error:"不能删除管理员"});
  data.users.splice(idx, 1);
  saveData();
  res.json({message:"删除成功"});
});

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req,file,cb) => cb(null, uploadsDir),
  filename: (req,file,cb) => cb(null, Date.now() + "-" + Math.round(Math.random()*1E9) + path.extname(file.originalname))
});
const upload = multer({storage, limits:{fileSize:10*1024*1024}});

// 获取作品列表
app.get("/api/projects", rateLimit(60,60000), auth, (req,res) => {
  res.json(data.projects.filter(p => p.userId === req.user.id));
});

// 保存作品
app.post("/api/projects", rateLimit(60,60000), auth, upload.single("file"), (req,res) => {
  const {name,description,projectId} = req.body || {};
  if (!name) return res.status(400).json({error:"请输入项目名称"});
  const filePath = req.file ? "/uploads/projects/" + req.file.filename : null;
  
  if (projectId) {
    const p = data.projects.find(p => p.id == projectId && p.userId === req.user.id);
    if (p) {
      p.name = name;
      if (filePath) p.filePath = filePath;
      if (description) p.description = description;
      p.updatedAt = new Date().toISOString();
      saveData();
      return res.json({message:"更新成功", projectId:p.id});
    }
  }
  
  const project = {
    id: Date.now(),
    userId: req.user.id,
    name,
    filePath,
    description: description || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  data.projects.push(project);
  saveData();
  res.json({message:"保存成功", projectId:project.id});
});

// 启动服务器
app.listen(PORT, "0.0.0.0", () => {
  console.log("教育平台服务器已启动: http://0.0.0.0:" + PORT);
});
