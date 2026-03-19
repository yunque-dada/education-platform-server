const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data.db');
const db = new (require('sqlite3').verbose()).Database(dbPath);

// 初始化数据库
db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT "student", nickname TEXT, avatar TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  db.run('CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, file_path TEXT NOT NULL, cover_path TEXT, description TEXT, is_public INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))');
  
  // 创建默认管理员
  db.get("SELECT * FROM users WHERE username = 'admin'", (err, row) => {
    if (!row) {
      const bcrypt = require('bcryptjs');
      bcrypt.hash('123456', 10).then(hash => {
        db.run('INSERT INTO users (username, password, role, nickname) VALUES (?, ?, ?, ?)', ['admin', hash, 'admin', '管理员']);
        console.log('默认管理员账号已创建: admin / 123456');
      });
    }
  });
  console.log('数据库初始化完成');
});

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'education-platform-secret-key-2024';

// 确保上传目录存在
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(path.join(uploadsDir, 'projects'))) fs.mkdirSync(path.join(uploadsDir, 'projects'));

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// 路由：健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// 路由：注册
app.post('/api/auth/register', async (req, res) => {
  const { username, password, role = 'student', nickname } = req.body;
  try {
    const hashedPassword = await require('bcryptjs').hash(password, 10);
    db.run('INSERT INTO users (username, password, role, nickname) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, role, nickname || username],
      function(err) {
        if (err) return res.status(400).json({ error: '用户名已存在' });
        res.json({ message: '注册成功', userId: this.lastID });
      });
  } catch (error) {
    res.status(500).json({ error: '注册失败' });
  }
});

// 路由：登录
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');
  
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) return res.status(401).json({ error: '用户不存在' });
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: '密码错误' });
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, nickname: user.nickname, avatar: user.avatar } });
  });
});

// 路由：获取用户信息
app.get('/api/auth/user', (req, res) => {
  const jwt = require('jsonwebtoken');
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '请先登录' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    db.get('SELECT id, username, role, nickname, avatar FROM users WHERE id = ?', [decoded.id], (err, user) => {
      if (err || !user) return res.status(404).json({ error: '用户不存在' });
      res.json(user);
    });
  } catch (e) {
    res.status(401).json({ error: '登录已过期' });
  }
});

// 中间件：验证管理员权限
const requireAdmin = (req, res, next) => {
  const jwt = require('jsonwebtoken');
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '请先登录' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
    req.adminUser = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: '登录已过期' });
  }
};

// ===== 管理员API =====
// 获取仪表盘数据
app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
  db.get('SELECT COUNT(*) as total FROM users', (err, r1) => {
    db.get('SELECT COUNT(*) as admins FROM users WHERE role = "admin"', (err, r2) => {
      db.get('SELECT COUNT(*) as teachers FROM users WHERE role = "teacher"', (err, r3) => {
        db.get('SELECT COUNT(*) as students FROM users WHERE role = "student"', (err, r4) => {
          res.json({
            total: r1.total || 0,
            admins: r2.admins || 0,
            teachers: r3.teachers || 0,
            students: r4.students || 0
          });
        });
      });
    });
  });
});

// 获取所有用户
app.get('/api/admin/users', requireAdmin, (req, res) => {
  db.all('SELECT id, username, role, nickname, avatar, created_at FROM users ORDER BY id DESC', [], (err, users) => {
    if (err) return res.status(500).json({ error: '获取失败' });
    const formatted = users.map(u => ({
      id: u.id,
      username: u.username,
      role: u.role,
      nickname: u.nickname,
      avatar: u.avatar,
      createdAt: u.created_at
    }));
    res.json(formatted);
  });
});

// 添加用户
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { username, password, role = 'student', nickname } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  try {
    const hashedPassword = await require('bcryptjs').hash(password, 10);
    db.run('INSERT INTO users (username, password, role, nickname) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, role, nickname || username],
      function(err) {
        if (err) return res.status(400).json({ error: '用户名已存在或其他错误' });
        res.json({ message: '添加成功', userId: this.lastID });
      });
  } catch (error) {
    res.status(500).json({ error: '添加失败' });
  }
});

// 编辑用户
app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { password, role } = req.body;
  
  if (!role) return res.status(400).json({ error: '至少需要提供角色' });
  
  try {
    if (password) {
      const hashedPassword = await require('bcryptjs').hash(password, 10);
      db.run('UPDATE users SET role = ?, password = ? WHERE id = ?', [role, hashedPassword, id], function(err) {
        if (err) return res.status(500).json({ error: '更新失败' });
        res.json({ message: '更新成功' });
      });
    } else {
      db.run('UPDATE users SET role = ? WHERE id = ?', [role, id], function(err) {
        if (err) return res.status(500).json({ error: '更新失败' });
        res.json({ message: '更新成功' });
      });
    }
  } catch (error) {
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除用户
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.adminUser.id) {
    return res.status(400).json({ error: '不能删除自己的账号' });
  }
  db.run('DELETE FROM users WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: '删除失败' });
    res.json({ message: '删除成功' });
  });
});

// 路由：获取作品列表
app.get('/api/projects', (req, res) => {
  const jwt = require('jsonwebtoken');
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '请先登录' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    db.all('SELECT id, name, cover_path, description, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC', [decoded.id], (err, projects) => {
      if (err) return res.status(500).json({ error: '获取失败' });
      res.json(projects);
    });
  } catch (e) {
    res.status(401).json({ error: '登录已过期' });
  }
});

// 路由：保存作品
const multer = require('multer');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(uploadsDir, 'projects')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage });

app.post('/api/projects', upload.single('file'), (req, res) => {
  const jwt = require('jsonwebtoken');
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '请先登录' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { name, description, projectId } = req.body;
    const filePath = req.file ? '/uploads/projects/' + req.file.filename : null;
    
    if (projectId) {
      db.run('UPDATE projects SET name = ?, file_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
        [name, filePath, projectId, decoded.id], function(err) {
          if (err) return res.status(500).json({ error: '保存失败' });
          res.json({ message: '更新成功', projectId });
        });
    } else {
      db.run('INSERT INTO projects (user_id, name, file_path, description) VALUES (?, ?, ?, ?)',
        [decoded.id, name, filePath, description], function(err) {
          if (err) return res.status(500).json({ error: '保存失败' });
          res.json({ message: '保存成功', projectId: this.lastID });
        });
    }
  } catch (e) {
    res.status(401).json({ error: '登录已过期' });
  }
});

app.listen(PORT, () => {
  console.log('教务平台后端服务已启动: http://localhost:' + PORT);
});
