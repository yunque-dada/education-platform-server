const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data.db');
const db = new (require('sqlite3').verbose()).Database(dbPath);

db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT "student", nickname TEXT, avatar TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  db.run('CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, cover_image TEXT, teacher_id INTEGER, duration INTEGER DEFAULT 0, level TEXT DEFAULT "入门", status TEXT DEFAULT "draft", created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  db.run('CREATE TABLE IF NOT EXISTS enrollments (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, course_id INTEGER NOT NULL, progress INTEGER DEFAULT 0, status TEXT DEFAULT "enrolled", enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  db.run('CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, course_id INTEGER, name TEXT NOT NULL, file_path TEXT, cover_path TEXT, description TEXT, status TEXT DEFAULT "draft", created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  
  db.get("SELECT * FROM users WHERE username = 'admin'", (err, row) => {
    if (!row) {
      require('bcryptjs').hash('123456', 10).then(hash => {
        db.run('INSERT INTO users (username, password, role, nickname) VALUES (?, ?, ?, ?)', ['admin', hash, 'admin', '管理员']);
        console.log('默认管理员: admin / 123456');
      });
    }
  });
  
  db.get("SELECT COUNT(*) as cnt FROM courses", (err, row) => {
    if (!row || row.cnt === 0) {
      db.run("INSERT INTO courses (title, description, level, duration, status) VALUES ('Scratch趣味编程', '适合零基础学员，通过拖拽式编程培养逻辑思维', '入门', 20, 'published')");
      db.run("INSERT INTO courses (title, description, level, duration, status) VALUES ('Python基础', 'Python编程入门，学习变量、循环、函数等基础概念', '入门', 30, 'published')");
      console.log('示例课程已创建');
    }
  });
  console.log('数据库初始化完成');
});

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'education-platform-secret-key-2024';

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(path.join(uploadsDir, 'projects'))) fs.mkdirSync(path.join(uploadsDir, 'projects'));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// 健康检查
app.get('/api/health', (req, res) => res.json({status:'ok', time:new Date()}));

// 注册
app.post('/api/auth/register', async (req, res) => {
  const {username, password, role='student', nickname} = req.body;
  try {
    const hashed = await require('bcryptjs').hash(password, 10);
    db.run('INSERT INTO users (username, password, role, nickname) VALUES (?, ?, ?, ?)', [username, hashed, role, nickname||username], function(err) {
      if(err) return res.status(400).json({error:'用户名已存在'});
      res.json({message:'注册成功', userId:this.lastID});
    });
  } catch(e) { res.status(500).json({error:'注册失败'}); }
});

// 登录
app.post('/api/auth/login', async (req, res) => {
  const {username, password} = req.body;
  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if(err||!user) return res.status(401).json({error:'用户不存在'});
    const valid = await bcrypt.compare(password, user.password);
    if(!valid) return res.status(401).json({error:'密码错误'});
    const token = jwt.sign({id:user.id, username:user.username, role:user.role}, JWT_SECRET, {expiresIn:'7d'});
    res.json({token, user:{id:user.id, username:user.username, role:user.role, nickname:user.nickname}});
  });
});

// 获取用户信息
app.get('/api/auth/user', (req, res) => {
  const jwt = require('jsonwebtoken');
  const token = req.headers.authorization?.replace('Bearer ', '');
  if(!token) return res.status(401).json({error:'请先登录'});
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    db.get('SELECT id, username, role, nickname, avatar FROM users WHERE id = ?', [decoded.id], (err, user) => {
      if(err||!user) return res.status(404).json({error:'用户不存在'});
      res.json(user);
    });
  } catch(e) { res.status(401).json({error:'登录已过期'}); }
});

// 管理员中间件
const requireAdmin = (req, res, next) => {
  const jwt = require('jsonwebtoken');
  const token = req.headers.authorization?.replace('Bearer ', '');
  if(!token) return res.status(401).json({error:'请先登录'});
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if(decoded.role !== 'admin') return res.status(403).json({error:'需要管理员权限'});
    req.adminUser = decoded;
    next();
  } catch(e) { res.status(401).json({error:'登录已过期'}); }
};

// 老师中间件
const requireTeacher = (req, res, next) => {
  const jwt = require('jsonwebtoken');
  const token = req.headers.authorization?.replace('Bearer ', '');
  if(!token) return res.status(401).json({error:'请先登录'});
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if(decoded.role !== 'admin' && decoded.role !== 'teacher') return res.status(403).json({error:'需要老师权限'});
    req.user = decoded;
    next();
  } catch(e) { res.status(401).json({error:'登录已过期'}); }
};

// ===== 管理员API =====
// 仪表盘
app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
  db.get('SELECT COUNT(*) as total FROM users', (e,r1) => {
    db.get('SELECT COUNT(*) as c FROM users WHERE role="admin"', (e,r2) => {
      db.get('SELECT COUNT(*) as c FROM users WHERE role="teacher"', (e,r3) => {
        db.get('SELECT COUNT(*) as c FROM users WHERE role="student"', (e,r4) => {
          db.get('SELECT COUNT(*) as c FROM courses', (e,r5) => {
            db.get('SELECT COUNT(*) as c FROM projects', (e,r6) => {
              res.json({totalUsers:r1.total||0, admins:r2.c||0, teachers:r3.c||0, students:r4.c||0, totalCourses:r5.c||0, totalProjects:r6.c||0});
            });
          });
        });
      });
    });
  });
});

// 用户管理
app.get('/api/admin/users', requireAdmin, (req, res) => {
  db.all('SELECT id,username,role,nickname,created_at FROM users ORDER BY id DESC', [], (err,users) => {
    if(err) return res.status(500).json({error:'获取失败'});
    res.json(users.map(u=>({id:u.id, username:u.username, role:u.role, nickname:u.nickname, createdAt:u.created_at})));
  });
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const {username, password, role='student', nickname} = req.body;
  if(!username||!password) return res.status(400).json({error:'用户名和密码必填'});
  const hashed = await require('bcryptjs').hash(password, 10);
  db.run('INSERT INTO users (username, password, role, nickname) VALUES (?, ?, ?, ?)', [username, hashed, role, nickname||username], function(err) {
    if(err) return res.status(400).json({error:'用户名已存在'});
    res.json({message:'添加成功', userId:this.lastID});
  });
});

app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const {id} = req.params;
  const {password, role, nickname} = req.body;
  if(password) {
    const hashed = await require('bcryptjs').hash(password, 10);
    db.run('UPDATE users SET role=?,password=?,nickname=? WHERE id=?', [role||'student', hashed, nickname||null, id], e=>e?res.status(500).json({error:'更新失败'}):res.json({message:'更新成功'}));
  } else {
    db.run('UPDATE users SET role=?,nickname=? WHERE id=?', [role||'student', nickname||null, id], e=>e?res.status(500).json({error:'更新成功'}):res.json({message:'更新成功'}));
  }
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const {id} = req.params;
  if(parseInt(id) === req.adminUser.id) return res.status(400).json({error:'不能删除自己'});
  db.run('DELETE FROM users WHERE id=?', [id], e=>e?res.status(500).json({error:'删除失败'}):res.json({message:'删除成功'}));
});

// ===== 课程API =====
// 课程列表
app.get('/api/courses', (req, res) => {
  db.all('SELECT c.*, u.nickname as teacher_name FROM courses c LEFT JOIN users u ON c.teacher_id = u.id WHERE c.status = "published" ORDER BY c.id DESC', [], (err, courses) => {
    if(err) return res.status(500).json({error:'获取失败'});
    res.json(courses);
  });
});

// 课程详情
app.get('/api/courses/:id', (req, res) => {
  db.get('SELECT c.*, u.nickname as teacher_name FROM courses c LEFT JOIN users u ON c.teacher_id = u.id WHERE c.id = ?', [req.params.id], (err, course) => {
    if(err||!course) return res.status(404).json({error:'课程不存在'});
    res.json(course);
  });
});

// 老师课程管理
app.get('/api/teacher/courses', requireTeacher, (req, res) => {
  const sql = req.user.role === 'admin' 
    ? 'SELECT c.*, u.nickname as teacher_name FROM courses c LEFT JOIN users u ON c.teacher_id = u.id ORDER BY c.id DESC'
    : 'SELECT c.*, u.nickname as teacher_name FROM courses c LEFT JOIN users u ON c.teacher_id = u.id WHERE c.teacher_id = ? ORDER BY c.id DESC';
  const params = req.user.role === 'admin' ? [] : [req.user.id];
  db.all(sql, params, (err, courses) => {
    if(err) return res.status(500).json({error:'获取失败'});
    res.json(courses);
  });
});

app.post('/api/admin/courses', requireAdmin, (req, res) => {
  const {title, description, cover_image, teacher_id, duration, level} = req.body;
  if(!title) return res.status(400).json({error:'课程标题必填'});
  db.run('INSERT INTO courses (title, description, cover_image, teacher_id, duration, level, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [title, description||'', cover_image||'', teacher_id||null, duration||0, level||'入门', 'published'], function(err) {
    if(err) return res.status(500).json({error:'创建失败'});
    res.json({message:'创建成功', courseId:this.lastID});
  });
});

app.put('/api/admin/courses/:id', requireAdmin, (req, res) => {
  const {title, description, cover_image, teacher_id, duration, level, status} = req.body;
  db.run('UPDATE courses SET title=?, description=?, cover_image=?, teacher_id=?, duration=?, level=?, status=? WHERE id=?', [title, description, cover_image, teacher_id, duration, level, status, req.params.id], function(err) {
    if(err) return res.status(500).json({error:'更新失败'});
    res.json({message:'更新成功'});
  });
});

app.delete('/api/admin/courses/:id', requireAdmin, (req, res) => {
  db.run('DELETE FROM courses WHERE id=?', [req.params.id], e=>e?res.status(500).json({error:'删除失败'}):res.json({message:'删除成功'}));
});

// ===== 报名API =====
// 报名课程
app.post('/api/student/enroll', (req, res) => {
  const jwt = require('jsonwebtoken');
  const token = req.headers.authorization?.replace('Bearer ', '');
  if(!token) return res.status(401).json({error:'请先登录'});
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const {course_id} = req.body;
    if(!course_id) return res.status(400).json({error:'课程ID必填'});
    db.get('SELECT * FROM enrollments WHERE student_id = ? AND course_id = ?', [decoded.id, course_id], (err, existing) => {
      if(existing) return res.status(400).json({error:'已报名此课程'});
      db.run('INSERT INTO enrollments (student_id, course_id) VALUES (?, ?)', [decoded.id, course_id], function(err) {
        if(err) return res.status(500).json({error:'报名失败'});
        res.json({message:'报名成功'});
      });
    });
  } catch(e) { res.status(401).json({error:'登录已过期'}); }
});

// 我的课程
app.get('/api/student/my-courses', (req, res) => {
  const jwt = require('jsonwebtoken');
  const token = req.headers.authorization?.replace('Bearer ', '');
  if(!token) return res.status(401).json({error:'请先登录'});
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    db.all("SELECT e.*, c.title, c.description, c.cover_image, c.level, c.duration FROM enrollments e JOIN courses c ON e.course_id = c.id WHERE e.student_id = ? ORDER BY e.enrolled_at DESC", [decoded.id], (err, courses) => {
      if(err) return res.status(500).json({error:'获取失败'});
      res.json(courses);
    });
  } catch(e) { res.status(401).json({error:'登录已过期'}); }
});

// ===== 作品API =====
// 获取作品
app.get('/api/projects', (req, res) => {
  const jwt = require('jsonwebtoken');
  const token = req.headers.authorization?.replace('Bearer ', '');
  if(!token) return res.status(401).json({error:'请先登录'});
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    db.all('SELECT p.*, u.username FROM projects p JOIN users u ON p.user_id = u.id WHERE p.user_id = ? ORDER BY p.updated_at DESC', [decoded.id], (err, projects) => {
      if(err) return res.status(500).json({error:'获取失败'});
      res.json(projects);
    });
  } catch(e) { res.status(401).json({error:'登录已过期'}); }
});

// 老师待审核作品
app.get('/api/teacher/projects', requireTeacher, (req, res) => {
  db.all("SELECT p.*, u.username, c.title as course_title FROM projects p JOIN users u ON p.user_id = u.id LEFT JOIN courses c ON p.course_id = c.id WHERE p.status = 'pending' ORDER BY p.created_at DESC", [], (err, projects) => {
    if(err) return res.status(500).json({error:'获取失败'});
    res.json(projects);
  });
});

// 保存作品
const multer = require('multer');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(uploadsDir, 'projects')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random()*1E9) + path.extname(file.originalname))
});
const upload = multer({ storage });

app.post('/api/projects', upload.single('file'), (req, res) => {
  const jwt = require('jsonwebtoken');
  const token = req.headers.authorization?.replace('Bearer ', '');
  if(!token) return res.status(401).json({error:'请先登录'});
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const {name, description, projectId, course_id, status} = req.body;
    const filePath = req.file ? '/uploads/projects/' + req.file.filename : null;
    
    if(projectId) {
      db.run('UPDATE projects SET name=?, file_path=?, description=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?', [name, filePath, description, status||'draft', projectId, decoded.id], function(err) {
        if(err) return res.status(500).json({error:'保存失败'});
        res.json({message:'更新成功', projectId});
      });
    } else {
      db.run('INSERT INTO projects (user_id, course_id, name, file_path, description, status) VALUES (?, ?, ?, ?, ?, ?)', [decoded.id, course_id||null, name, filePath, description, status||'draft'], function(err) {
        if(err) return res.status(500).json({error:'保存失败'});
        res.json({message:'保存成功', projectId:this.lastID});
      });
    }
  } catch(e) { res.status(401).json({error:'登录已过期'}); }
});

// 审核作品
app.put('/api/teacher/projects/:id', requireTeacher, (req, res) => {
  const {status} = req.body;
  if(!status) return res.status(400).json({error:'状态必填'});
  db.run('UPDATE projects SET status=? WHERE id=?', [status, req.params.id], function(err) {
    if(err) return res.status(500).json({error:'审核失败'});
    res.json({message:'审核成功'});
  });
});

app.listen(PORT, () => {
  console.log('教育平台服务已启动: http://localhost:' + PORT);
});
