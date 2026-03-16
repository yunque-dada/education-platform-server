const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const app = express();
const PORT = 3000;
const JWT_SECRET = "edu-platform-2024-dev-fallback";
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");

const dataFile = path.join(__dirname, "../data.json");
let data = {users:[],projects:[]};
try { if (fs.existsSync(dataFile)) { const c = fs.readFileSync(dataFile, "utf8").trim(); if (c) data = JSON.parse(c); } } catch(e) {}
if (!data.users) data.users = [];
if (!data.projects) data.projects = [];
if (!data.users.find(u => u.role === "admin")) {
  const adminPwd = bcrypt.hashSync("123456", 10);
  data.users.push({id:1,username:"admin",password:adminPwd,role:"admin",nickname:"Admin",createdAt:new Date().toISOString()});
  try { fs.writeFileSync(dataFile, JSON.stringify(data, null, 2)); } catch(e) {}
}

function saveData() { fs.writeFileSync(dataFile, JSON.stringify(data, null, 2)); }
const uploadsDir = path.join(__dirname, "../uploads/projects");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, {recursive:true});

app.use(cors());

// Custom JSON parser to bypass express 5.x bug
app.use((req, res, next) => {
  if (req.headers["content-type"] === "application/json") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try { req.body = body ? JSON.parse(body) : {}; } catch(e) { req.body = {}; }
      next();
    });
  } else {
    next();
  }
});

app.use(express.urlencoded({extended:true}));

const ipCounts = new Map();
function rateLimit(max, window) {
  return (req,res,next) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    const rec = ipCounts.get(ip) || {count:0, reset:now+window};
    if (now > rec.reset) { rec.count = 1; rec.reset = now+window; }
    else rec.count++;
    ipCounts.set(ip, rec);
    if (rec.count > max) return res.status(429).json({error:"too many requests"});
    next();
  };
}

app.get("/api/health", (req,res) => res.json({status:"ok"}));

app.post("/api/auth/login", rateLimit(10,900000), async (req,res) => {
  const {username,password} = req.body || {};
  if (!username || !password) return res.status(400).json({error:"need username and password"});
  const user = data.users.find(u => u.username === username);
  if (!user) return res.status(401).json({error:"invalid credentials"});
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({error:"invalid credentials"});
  const token = jwt.sign({id:user.id, username:user.username, role:user.role}, JWT_SECRET, {expiresIn:"7d"});
  res.json({token, user:{id:user.id, username:user.username, role:user.role, nickname:user.nickname}});
});

app.post("/api/admin/login", rateLimit(10,900000), async (req,res) => {
  const {username,password} = req.body || {};
  if (!username || !password) return res.status(400).json({error:"need username and password"});
  const user = data.users.find(u => u.username === username && u.role === "admin");
  if (!user) return res.status(401).json({error:"invalid credentials"});
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({error:"invalid credentials"});
  const token = jwt.sign({id:user.id, username:user.username, role:user.role}, JWT_SECRET, {expiresIn:"7d"});
  res.json({token, user:{id:user.id, username:user.username, role:user.role, nickname:user.nickname}});
});

function auth(req,res,next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({error:"login required"});
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { res.status(401).json({error:"token expired"}); }
}

app.get("/api/admin/users", rateLimit(60,60000), auth, (req,res) => {
  if (req.user.role !== "admin") return res.status(403).json({error:"no permission"});
  res.json(data.users.map(u => ({id:u.id, username:u.username, nickname:u.nickname, role:u.role, createdAt:u.createdAt})));
});

app.post("/api/admin/users", rateLimit(60,60000), auth, async (req,res) => {
  if (req.user.role !== "admin") return res.status(403).json({error:"no permission"});
  const {username,password,role,nickname} = req.body || {};
  if (!username || !password) return res.status(400).json({error:"need username and password"});
  if (data.users.find(u => u.username === username)) return res.status(400).json({error:"user exists"});
  const user = {id:Date.now(), username, password:bcrypt.hashSync(password,10), role:role||"student", nickname:nickname||username, createdAt:new Date().toISOString()};
  data.users.push(user);
  saveData();
  res.json({message:"success", userId:user.id});
});

app.delete("/api/admin/users/:id", rateLimit(60,60000), auth, (req,res) => {
  if (req.user.role !== "admin") return res.status(403).json({error:"no permission"});
  const idx = data.users.findIndex(u => u.id == req.params.id);
  if (idx === -1) return res.status(404).json({error:"user not found"});
  if (data.users[idx].role === "admin") return res.status(400).json({error:"cannot delete admin"});
  data.users.splice(idx,1);
  saveData();
  res.json({message:"success"});
});

const storage = multer.diskStorage({
  destination: (req,file,cb) => cb(null, uploadsDir),
  filename: (req,file,cb) => cb(null, Date.now() + "-" + Math.round(Math.random()*1E9) + path.extname(file.originalname))
});
const upload = multer({storage, limits:{fileSize:10*1024*1024}});

app.get("/api/projects", rateLimit(60,60000), auth, (req,res) => {
  res.json(data.projects.filter(p => p.userId === req.user.id));
});

app.post("/api/projects", rateLimit(60,60000), auth, upload.single("file"), (req,res) => {
  const {name,description,projectId} = req.body || {};
  if (!name) return res.status(400).json({error:"need name"});
  const filePath = req.file ? "/uploads/projects/" + req.file.filename : null;
  if (projectId) {
    const p = data.projects.find(p => p.id == projectId && p.userId === req.user.id);
    if (p) { p.name = name; if (filePath) p.filePath = filePath; p.updatedAt = new Date().toISOString(); saveData(); return res.json({message:"updated", projectId:p.id}); }
  }
  const project = {id:Date.now(), userId:req.user.id, name, filePath, description:description||"", createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()};
  data.projects.push(project);
  saveData();
  res.json({message:"saved", projectId:project.id});
});

// Serve static files
app.use(express.static(path.join(__dirname, "../public")));

app.listen(PORT, "0.0.0.0", () => console.log("Server: "+PORT));
