const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const multer   = require('multer');
const { v4: uuid } = require('uuid');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 4000;
const SECRET = process.env.JWT_SECRET || 'edivideo_secret_2026';

// ─── PERSISTENT JSON DATABASE ───────────────────────────────────
const DB_FILE = path.join(__dirname, 'db.json');
function loadDB() {
  if (fs.existsSync(DB_FILE)) {
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
  }
  return { users:[], videos:[], comments:[], notifications:[], apikeys:[] };
}
function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2)); }
let DB = loadDB();
setInterval(saveDB, 30000);

// ─── FOLDERS ────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const AVATAR_DIR = path.join(__dirname, 'avatars');
[UPLOAD_DIR, AVATAR_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── MIDDLEWARE ──────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/avatars', express.static(AVATAR_DIR));

// ─── RATE LIMITER ────────────────────────────────────────────────
const ratemap = {};
function rateLimit(max, ms) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    ratemap[key] = (ratemap[key] || []).filter(t => now - t < ms);
    if (ratemap[key].length >= max) return res.status(429).json({ error: 'Too many requests. Wait and try again.' });
    ratemap[key].push(now);
    next();
  };
}

// ─── JWT ─────────────────────────────────────────────────────────
const makeToken = (id) => jwt.sign({ id }, SECRET, { expiresIn: '7d' });
const safe = (u) => { const { password: _, ...s } = u; return s; };

const auth = (req, res, next) => {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { id } = jwt.verify(h.replace('Bearer ', ''), SECRET);
    req.user = DB.users.find(u => u.id === id);
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    next();
  } catch { res.status(401).json({ error: 'Session expired. Please login again.' }); }
};

const adminAuth = (req, res, next) => {
  auth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  });
};

function addNotif(userId, type, message, data = {}) {
  DB.notifications.push({ id: uuid(), userId, type, message, data, read: false, created: Date.now() });
  saveDB();
}

function checkLimit(user) {
  const now = new Date();
  const used = DB.videos.filter(v => {
    const d = new Date(v.created);
    return v.userId === user.id && v.source !== 'upload' &&
           d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const limits = { free: 3, creator: 999, business: 9999 };
  const limit = limits[user.plan] || 3;
  if (used >= limit) return { ok: false, error: user.plan === 'free' ? 'Free plan: 3 videos/month limit reached. Upgrade to Creator for unlimited.' : 'Monthly limit reached.' };
  return { ok: true, used, limit };
}

// ─── VOICES DATA ─────────────────────────────────────────────────
const VOICES = [
  { id:'priya',  name:'Priya',  language:'Hindi',   gender:'female', tone:'warm-professional',  emoji:'👩',   flag:'🇮🇳', preview:'नमस्ते, मेरा नाम प्रिया है। मैं आपकी कैसे मदद कर सकती हूँ?', plan:'free'    },
  { id:'kavya',  name:'Kavya',  language:'Hindi',   gender:'female', tone:'soft-storytelling',  emoji:'👧',   flag:'🇮🇳', preview:'नमस्ते, मैं कव्या हूँ। आज की कहानी बहुत रोचक है।',           plan:'free'    },
  { id:'ananya', name:'Ananya', language:'Hindi',   gender:'female', tone:'energetic-young',    emoji:'👩‍🎤',flag:'🇮🇳', preview:'हे! मैं अनन्या हूँ। चलो शुरू करते हैं!',                     plan:'creator' },
  { id:'meera',  name:'Meera',  language:'Hindi',   gender:'female', tone:'calm-teacher',       emoji:'👩‍🏫',flag:'🇮🇳', preview:'नमस्ते, मैं मीरा हूँ। आज हम सीखेंगे...',                      plan:'creator' },
  { id:'arjun',  name:'Arjun',  language:'Hindi',   gender:'male',   tone:'confident-clear',    emoji:'👨',   flag:'🇮🇳', preview:'नमस्ते, मेरा नाम अर्जुन है। आइए शुरू करते हैं।',             plan:'free'    },
  { id:'rohan',  name:'Rohan',  language:'Hindi',   gender:'male',   tone:'deep-authoritative', emoji:'🧔',   flag:'🇮🇳', preview:'नमस्ते, मैं रोहन हूँ। यह एक महत्वपूर्ण संदेश है।',           plan:'free'    },
  { id:'vikram', name:'Vikram', language:'Hindi',   gender:'male',   tone:'formal-news',        emoji:'👨‍💼',flag:'🇮🇳', preview:'नमस्ते, मैं विक्रम हूँ। आज की मुख्य खबरें...',               plan:'creator' },
  { id:'kabir',  name:'Kabir',  language:'Hindi',   gender:'male',   tone:'storyteller-warm',   emoji:'🧑',   flag:'🇮🇳', preview:'नमस्ते दोस्तों, एक कहानी सुनो...',                            plan:'creator' },
  { id:'sarah',  name:'Sarah',  language:'English', gender:'female', tone:'professional',       emoji:'👩‍💼',flag:'🇬🇧', preview:'Hello! I am Sarah, your professional AI presenter.',           plan:'free'    },
  { id:'james',  name:'James',  language:'English', gender:'male',   tone:'broadcast',          emoji:'👨‍💼',flag:'🇺🇸', preview:'Hello, I am James. Ready to create amazing content.',          plan:'free'    },
  { id:'emma',   name:'Emma',   language:'English', gender:'female', tone:'friendly-casual',    emoji:'👱‍♀️',flag:'🇺🇸', preview:'Hey there! I am Emma, your friendly AI host.',                 plan:'creator' },
  { id:'oliver', name:'Oliver', language:'English', gender:'male',   tone:'elegant',            emoji:'🎩',   flag:'🇬🇧', preview:'Good day! I am Oliver, at your service.',                     plan:'creator' },
  { id:'sofia',  name:'Sofia',  language:'Spanish', gender:'female', tone:'warm',               emoji:'👩',   flag:'🇪🇸', preview:'Hola, soy Sofía. ¿Cómo puedo ayudarte hoy?',                  plan:'free'    },
  { id:'carlos', name:'Carlos', language:'Spanish', gender:'male',   tone:'confident',          emoji:'👨',   flag:'🇪🇸', preview:'Hola, soy Carlos. Empecemos.',                                 plan:'creator' },
  { id:'pierre', name:'Pierre', language:'French',  gender:'male',   tone:'elegant',            emoji:'🎭',   flag:'🇫🇷', preview:'Bonjour, je suis Pierre.',                                    plan:'creator' },
];

const AVATARS = [
  { id:'priya-av',  name:'Priya',   gender:'female', nationality:'Indian',   language:'Hindi',   emoji:'👩',   bg:'linear-gradient(160deg,#1a0533,#4a0e9a)', plan:'free'    },
  { id:'arjun-av',  name:'Arjun',   gender:'male',   nationality:'Indian',   language:'Hindi',   emoji:'👨',   bg:'linear-gradient(160deg,#0a2a1a,#1a6a3a)', plan:'free'    },
  { id:'kavya-av',  name:'Kavya',   gender:'female', nationality:'Indian',   language:'Hindi',   emoji:'👧',   bg:'linear-gradient(160deg,#2a0a1a,#6a1a4a)', plan:'free'    },
  { id:'rohan-av',  name:'Rohan',   gender:'male',   nationality:'Indian',   language:'Hindi',   emoji:'🧔',   bg:'linear-gradient(160deg,#0a1a2a,#1a4a6a)', plan:'free'    },
  { id:'ananya-av', name:'Ananya',  gender:'female', nationality:'Indian',   language:'Hindi',   emoji:'👩‍🎤',bg:'linear-gradient(160deg,#2a0a2a,#6a0a6a)', plan:'creator' },
  { id:'vikram-av', name:'Vikram',  gender:'male',   nationality:'Indian',   language:'Hindi',   emoji:'👨‍💼',bg:'linear-gradient(160deg,#1a1a0a,#4a4a1a)', plan:'creator' },
  { id:'sarah-av',  name:'Sarah',   gender:'female', nationality:'British',  language:'English', emoji:'👩‍💼',bg:'linear-gradient(160deg,#1a1a2e,#2a2a4e)', plan:'free'    },
  { id:'james-av',  name:'James',   gender:'male',   nationality:'American', language:'English', emoji:'👨‍💼',bg:'linear-gradient(160deg,#2e1a1a,#4e2a2a)', plan:'free'    },
  { id:'mei-av',    name:'Mei',     gender:'female', nationality:'Chinese',  language:'Chinese', emoji:'👩',   bg:'linear-gradient(160deg,#1a2a0a,#3a5a1a)', plan:'creator' },
  { id:'sofia-av',  name:'Sofia',   gender:'female', nationality:'Spanish',  language:'Spanish', emoji:'👩',   bg:'linear-gradient(160deg,#2a1a0a,#5a3a1a)', plan:'creator' },
];

const PLANS = [
  { id:'free',     name:'Free',     price:0,   priceYearly:0,   features:['3 videos/month','720p export','4 Hindi voices','50+ avatars','Watermark'],            limits:{videos:3,resolution:'720p',storage:512}   },
  { id:'creator',  name:'Creator',  price:29,  priceYearly:24,  features:['Unlimited videos','1080p HD','8 Hindi voices','700+ avatars','No watermark','20 langs'], limits:{videos:999,resolution:'1080p',storage:5120} },
  { id:'business', name:'Business', price:149, priceYearly:120, features:['Everything + 4K','All Hindi voices','1100+ avatars','175+ languages','API access','Team','Digital Twin'], limits:{videos:9999,resolution:'4k',storage:51200} },
];

// ══════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════

app.get('/api/health', (_, res) => res.json({ ok:true, version:'2.0', users:DB.users.length, videos:DB.videos.length, uptime:Math.floor(process.uptime())+'s' }));

// AUTH
app.post('/api/register', rateLimit(10, 60000), async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name||!email||!password) return res.status(400).json({ error:'Name, email and password required' });
    if (password.length < 6) return res.status(400).json({ error:'Password min 6 characters' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error:'Invalid email address' });
    if (DB.users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error:'Email already registered' });
    const user = { id:uuid(), name:name.trim(), email:email.toLowerCase().trim(), password: await bcrypt.hash(password, 12), role: DB.users.length === 0 ? 'admin' : 'user', plan:'free', bio:'', website:'', avatar:null, totalVideos:0, created:Date.now(), lastLogin:Date.now() };
    DB.users.push(user);
    addNotif(user.id, 'welcome', 'Welcome to EdiVideo! 🎉 Create your first video now.');
    saveDB();
    res.status(201).json({ ok:true, token:makeToken(user.id), user:safe(user) });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/login', rateLimit(20, 60000), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email||!password) return res.status(400).json({ error:'Email and password required' });
    const user = DB.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error:'Wrong email or password' });
    user.lastLogin = Date.now(); saveDB();
    res.json({ ok:true, token:makeToken(user.id), user:safe(user) });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/me', auth, (req, res) => res.json({ ok:true, user:safe(req.user) }));

app.put('/api/me', auth, async (req, res) => {
  try {
    const { name, email, password, bio, website } = req.body;
    const u = req.user;
    if (name && name.trim().length >= 2) u.name = name.trim();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (DB.users.find(x => x.email === email.toLowerCase() && x.id !== u.id)) return res.status(400).json({ error:'Email already in use' });
      u.email = email.toLowerCase();
    }
    if (password && password.length >= 6) u.password = await bcrypt.hash(password, 12);
    if (bio !== undefined) u.bio = bio;
    if (website !== undefined) u.website = website;
    saveDB();
    res.json({ ok:true, user:safe(u) });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

const avatarUpload = multer({ dest:AVATAR_DIR, limits:{ fileSize: 5*1024*1024 } });
app.post('/api/me/avatar', auth, avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error:'No image provided' });
  req.user.avatar = '/avatars/' + req.file.filename;
  saveDB();
  res.json({ ok:true, avatarUrl: req.user.avatar });
});

app.delete('/api/me', auth, (req, res) => {
  const id = req.user.id;
  DB.users = DB.users.filter(u => u.id !== id);
  DB.videos = DB.videos.filter(v => v.userId !== id);
  DB.comments = DB.comments.filter(c => c.userId !== id);
  DB.notifications = DB.notifications.filter(n => n.userId !== id);
  DB.apikeys = DB.apikeys.filter(k => k.userId !== id);
  saveDB();
  res.json({ ok:true, message:'Account deleted' });
});

// VOICES
app.get('/api/voices', (req, res) => {
  let list = [...VOICES];
  if (req.query.language) list = list.filter(v => v.language.toLowerCase() === req.query.language.toLowerCase());
  if (req.query.gender)   list = list.filter(v => v.gender === req.query.gender);
  list.sort((a,b) => (a.language==='Hindi'?-1:b.language==='Hindi'?1:0));
  res.json({ ok:true, voices:list, total:list.length });
});
app.get('/api/voices/:id', (req, res) => {
  const v = VOICES.find(x => x.id === req.params.id);
  if (!v) return res.status(404).json({ error:'Voice not found' });
  res.json({ ok:true, voice:v });
});
app.post('/api/voices/:id/preview', auth, (req, res) => {
  const v = VOICES.find(x => x.id === req.params.id);
  if (!v) return res.status(404).json({ error:'Voice not found' });
  res.json({ ok:true, voice:v, previewText: req.body.text || v.preview });
});

// AVATARS
app.get('/api/avatars', (req, res) => {
  let list = [...AVATARS];
  if (req.query.gender)      list = list.filter(a => a.gender === req.query.gender);
  if (req.query.language)    list = list.filter(a => a.language.toLowerCase() === req.query.language.toLowerCase());
  if (req.query.nationality) list = list.filter(a => a.nationality.toLowerCase() === req.query.nationality.toLowerCase());
  res.json({ ok:true, avatars:list, total:list.length });
});
app.get('/api/avatars/indian', (_, res) => res.json({ ok:true, avatars: AVATARS.filter(a => a.nationality==='Indian') }));

// VIDEOS
app.get('/api/videos', auth, (req, res) => {
  let list = DB.videos.filter(v => v.userId === req.user.id);
  if (req.query.status)   list = list.filter(v => v.status === req.query.status);
  if (req.query.source)   list = list.filter(v => v.source === req.query.source);
  if (req.query.language) list = list.filter(v => v.language === req.query.language);
  list.sort((a,b) => b.created - a.created);
  const page = Number(req.query.page||1), limit = Number(req.query.limit||20);
  const start = (page-1)*limit;
  res.json({ ok:true, videos:list.slice(start, start+limit), total:list.length, page, pages:Math.ceil(list.length/limit) });
});

app.get('/api/videos/search', auth, (req, res) => {
  const q = (req.query.q||'').toLowerCase();
  if (!q) return res.json({ ok:true, videos:[], total:0 });
  const results = DB.videos.filter(v => v.userId===req.user.id && (v.title.toLowerCase().includes(q)||(v.script||'').toLowerCase().includes(q)));
  res.json({ ok:true, videos:results, total:results.length });
});

app.get('/api/videos/:id', auth, (req, res) => {
  const v = DB.videos.find(x => x.id===req.params.id && x.userId===req.user.id);
  if (!v) return res.status(404).json({ error:'Video not found' });
  res.json({ ok:true, video:v, comments: DB.comments.filter(c => c.videoId===v.id) });
});

app.post('/api/videos', auth, (req, res) => {
  try {
    const { title, script, language, voiceId, voiceName, avatarId, resolution, subtitles } = req.body;
    if (!title||!title.trim()) return res.status(400).json({ error:'Title is required' });
    if (!script||!script.trim()) return res.status(400).json({ error:'Script is required' });
    if (script.length > 5000) return res.status(400).json({ error:'Script max 5000 characters' });
    const check = checkLimit(req.user);
    if (!check.ok) return res.status(403).json({ error:check.error });
    const voice = VOICES.find(v => v.id===voiceId) || VOICES[0];
    const video = {
      id:uuid(), userId:req.user.id, title:title.trim(), script:script.trim(),
      language:language||'en', voiceId:voice.id, voiceName:voice.name, voiceLanguage:voice.language,
      avatarId:avatarId||'priya-av', resolution:resolution||'1080p', subtitles:subtitles!==false,
      status:'processing', source:'created', videoUrl:null, thumbnailUrl:null,
      duration:null, views:0, shared:false, shareToken:null, tags:[],
      created:Date.now(), updated:Date.now()
    };
    DB.videos.push(video);
    req.user.totalVideos = (req.user.totalVideos||0) + 1;
    setTimeout(() => {
      video.status = 'completed';
      video.duration = Math.floor(Math.random()*90)+15;
      addNotif(req.user.id, 'video_ready', `Your video "${video.title}" is ready!`, { videoId:video.id });
      saveDB();
    }, 3000 + Math.random()*2000);
    saveDB();
    res.status(201).json({ ok:true, video, message:'Video queued — ready in ~3 seconds' });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.put('/api/videos/:id', auth, (req, res) => {
  const v = DB.videos.find(x => x.id===req.params.id && x.userId===req.user.id);
  if (!v) return res.status(404).json({ error:'Video not found' });
  if (req.body.title) v.title = req.body.title.trim();
  if (req.body.tags && Array.isArray(req.body.tags)) v.tags = req.body.tags;
  v.updated = Date.now(); saveDB();
  res.json({ ok:true, video:v });
});

app.delete('/api/videos/:id', auth, (req, res) => {
  const i = DB.videos.findIndex(x => x.id===req.params.id && x.userId===req.user.id);
  if (i===-1) return res.status(404).json({ error:'Video not found' });
  const v = DB.videos[i];
  if (v.filename) { const fp=path.join(UPLOAD_DIR,v.filename); if(fs.existsSync(fp)) fs.unlinkSync(fp); }
  DB.videos.splice(i,1); saveDB();
  res.json({ ok:true, message:'Video deleted' });
});

app.get('/api/videos/:id/status', auth, (req, res) => {
  const v = DB.videos.find(x => x.id===req.params.id && x.userId===req.user.id);
  if (!v) return res.status(404).json({ error:'Video not found' });
  res.json({ ok:true, id:v.id, status:v.status, videoUrl:v.videoUrl, duration:v.duration });
});

app.post('/api/videos/:id/share', auth, (req, res) => {
  const v = DB.videos.find(x => x.id===req.params.id && x.userId===req.user.id);
  if (!v) return res.status(404).json({ error:'Video not found' });
  v.shared=true; v.shareToken = v.shareToken || uuid().replace(/-/g,'').slice(0,12); saveDB();
  res.json({ ok:true, shareUrl:`http://localhost:${PORT}/share/${v.shareToken}`, token:v.shareToken });
});

app.get('/api/share/:token', (req, res) => {
  const v = DB.videos.find(x => x.shareToken===req.params.token && x.shared);
  if (!v) return res.status(404).json({ error:'Shared video not found or link expired' });
  v.views=(v.views||0)+1; saveDB();
  res.json({ ok:true, video:v });
});

// UPLOAD
const videoUpload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 500*1024*1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('video/') || /\.(mp4|mov|avi|webm|mkv|m4v)$/i.test(file.originalname))
});
app.post('/api/upload', auth, videoUpload.single('video'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error:'No video file provided' });
    const ext = path.extname(req.file.originalname)||'.mp4';
    const newName = req.file.filename + ext;
    fs.renameSync(req.file.path, path.join(UPLOAD_DIR, newName));
    const video = {
      id:uuid(), userId:req.user.id,
      title: req.file.originalname.replace(/\.[^.]+$/,''),
      script:'(uploaded video)', language:'en', voiceId:'original', voiceName:'Original Audio',
      avatarId:null, resolution:'1080p', subtitles:false,
      status:'completed', source:'upload',
      videoUrl: '/uploads/'+newName, filename:newName,
      originalName:req.file.originalname, sizeMB:parseFloat((req.file.size/1024/1024).toFixed(2)),
      mimeType:req.file.mimetype, thumbnailUrl:null, duration:null,
      views:0, shared:false, shareToken:null, tags:[],
      created:Date.now(), updated:Date.now()
    };
    DB.videos.push(video);
    req.user.totalVideos=(req.user.totalVideos||0)+1;
    saveDB();
    res.status(201).json({ ok:true, video, message:'Upload successful' });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// TRANSLATE
app.post('/api/translate', auth, (req, res) => {
  try {
    const { videoId, targetLanguage, lipSync, voiceClone, subtitles } = req.body;
    if (!videoId||!targetLanguage) return res.status(400).json({ error:'videoId and targetLanguage required' });
    const src = DB.videos.find(v => v.id===videoId && v.userId===req.user.id);
    if (!src) return res.status(404).json({ error:'Source video not found' });
    const langNames = { hi:'Hindi 🇮🇳', en:'English 🇬🇧', es:'Spanish 🇪🇸', fr:'French 🇫🇷', de:'German 🇩🇪', ja:'Japanese 🇯🇵', zh:'Chinese 🇨🇳', ar:'Arabic 🇸🇦', ko:'Korean 🇰🇷', pt:'Portuguese 🇧🇷' };
    const voiceId = targetLanguage==='hi' ? 'priya' : 'sarah';
    const voiceName = targetLanguage==='hi' ? 'Priya (Hindi 🇮🇳)' : 'AI Voice';
    const newVideo = {
      id:uuid(), userId:req.user.id,
      title: src.title+' ['+(langNames[targetLanguage]||targetLanguage.toUpperCase())+']',
      script:src.script, language:targetLanguage,
      voiceId, voiceName, avatarId:src.avatarId, resolution:src.resolution,
      subtitles:subtitles!==false, lipSync:lipSync!==false, voiceClone:voiceClone!==false,
      status:'processing', source:'translated', sourceVideoId:videoId,
      videoUrl:null, thumbnailUrl:null, duration:src.duration,
      views:0, shared:false, shareToken:null, tags:[],
      created:Date.now(), updated:Date.now()
    };
    DB.videos.push(newVideo); saveDB();
    setTimeout(() => {
      newVideo.status='completed'; newVideo.videoUrl=src.videoUrl;
      addNotif(req.user.id, 'translation_ready', `Translation to ${langNames[targetLanguage]||targetLanguage} is ready!`, { videoId:newVideo.id });
      saveDB();
    }, 4000+Math.random()*2000);
    res.status(201).json({ ok:true, video:newVideo, message:'Translation started — ready in ~4 seconds' });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// COMMENTS
app.get('/api/videos/:id/comments', auth, (req, res) => {
  const v = DB.videos.find(x => x.id===req.params.id && x.userId===req.user.id);
  if (!v) return res.status(404).json({ error:'Video not found' });
  res.json({ ok:true, comments: DB.comments.filter(c => c.videoId===req.params.id).sort((a,b)=>b.created-a.created) });
});
app.post('/api/videos/:id/comments', auth, (req, res) => {
  const { text } = req.body;
  if (!text||!text.trim()) return res.status(400).json({ error:'Comment text required' });
  const comment = { id:uuid(), videoId:req.params.id, userId:req.user.id, userName:req.user.name, text:text.trim(), created:Date.now() };
  DB.comments.push(comment); saveDB();
  res.status(201).json({ ok:true, comment });
});
app.delete('/api/comments/:id', auth, (req, res) => {
  const i = DB.comments.findIndex(c => c.id===req.params.id && c.userId===req.user.id);
  if (i===-1) return res.status(404).json({ error:'Comment not found' });
  DB.comments.splice(i,1); saveDB();
  res.json({ ok:true });
});

// NOTIFICATIONS
app.get('/api/notifications', auth, (req, res) => {
  const notifs = DB.notifications.filter(n => n.userId===req.user.id).sort((a,b)=>b.created-a.created).slice(0,50);
  res.json({ ok:true, notifications:notifs, unread:notifs.filter(n=>!n.read).length });
});
app.put('/api/notifications/read-all', auth, (req, res) => {
  DB.notifications.filter(n => n.userId===req.user.id).forEach(n => n.read=true); saveDB();
  res.json({ ok:true });
});
app.delete('/api/notifications/:id', auth, (req, res) => {
  const i = DB.notifications.findIndex(n => n.id===req.params.id && n.userId===req.user.id);
  if (i>-1) { DB.notifications.splice(i,1); saveDB(); }
  res.json({ ok:true });
});

// API KEYS
app.get('/api/keys', auth, (req, res) => {
  const keys = DB.apikeys.filter(k => k.userId===req.user.id).map(k => ({ ...k, key:k.key.slice(0,8)+'••••••••••••' }));
  res.json({ ok:true, keys });
});
app.post('/api/keys', auth, (req, res) => {
  if (DB.apikeys.filter(k=>k.userId===req.user.id).length >= 10) return res.status(400).json({ error:'Max 10 API keys' });
  const key = 'ev_' + uuid().replace(/-/g,'');
  const record = { id:uuid(), userId:req.user.id, name:req.body.name||'My API Key', key, active:true, lastUsed:null, created:Date.now() };
  DB.apikeys.push(record); saveDB();
  res.status(201).json({ ok:true, key, warning:'Save this key now — not shown again!' });
});
app.delete('/api/keys/:id', auth, (req, res) => {
  const i = DB.apikeys.findIndex(k => k.id===req.params.id && k.userId===req.user.id);
  if (i===-1) return res.status(404).json({ error:'Key not found' });
  DB.apikeys.splice(i,1); saveDB(); res.json({ ok:true });
});

// PLANS & BILLING
app.get('/api/plans', (_, res) => res.json({ ok:true, plans:PLANS }));
app.post('/api/billing/upgrade', auth, (req, res) => {
  const { plan } = req.body;
  if (!['creator','business'].includes(plan)) return res.status(400).json({ error:'Choose creator or business' });
  req.user.plan = plan; saveDB();
  addNotif(req.user.id, 'plan_upgraded', `Plan upgraded to ${plan}! 🎉`);
  res.json({ ok:true, user:safe(req.user), message:`Upgraded to ${plan} plan. In production: Stripe payment required.` });
});
app.post('/api/billing/downgrade', auth, (req, res) => {
  req.user.plan='free'; saveDB();
  res.json({ ok:true, user:safe(req.user) });
});

// STATS
app.get('/api/stats', auth, (req, res) => {
  const uid = req.user.id;
  const mine = DB.videos.filter(v => v.userId===uid);
  const now = new Date();
  const thisMonth = mine.filter(v => { const d=new Date(v.created); return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear(); });
  const limits = { free:3, creator:999, business:9999 };
  const limit = limits[req.user.plan]||3;
  res.json({
    ok:true,
    total:mine.length,
    thisMonth:thisMonth.length,
    translated:mine.filter(v=>v.source==='translated').length,
    uploaded:mine.filter(v=>v.source==='upload').length,
    storageMB:parseFloat(mine.filter(v=>v.sizeMB).reduce((s,v)=>s+parseFloat(v.sizeMB||0),0).toFixed(1)),
    plan:req.user.plan,
    monthLimit:limit,
    monthRemaining:Math.max(0,limit-thisMonth.length),
    unreadNotifications: DB.notifications.filter(n=>n.userId===uid&&!n.read).length
  });
});

// ADMIN
app.get('/api/admin/stats', adminAuth, (_, res) => {
  res.json({ ok:true, totalUsers:DB.users.length, totalVideos:DB.videos.length,
    plans:{ free:DB.users.filter(u=>u.plan==='free').length, creator:DB.users.filter(u=>u.plan==='creator').length, business:DB.users.filter(u=>u.plan==='business').length },
    recentUsers:DB.users.slice(-5).map(safe).reverse(),
    recentVideos:DB.videos.slice(-5).reverse()
  });
});
app.get('/api/admin/users', adminAuth, (req, res) => {
  let list = DB.users.map(safe);
  if (req.query.search) { const s=req.query.search.toLowerCase(); list=list.filter(u=>u.name.toLowerCase().includes(s)||u.email.toLowerCase().includes(s)); }
  res.json({ ok:true, users:list, total:list.length });
});
app.put('/api/admin/users/:id/plan', adminAuth, (req, res) => {
  const u = DB.users.find(x=>x.id===req.params.id);
  if (!u) return res.status(404).json({ error:'User not found' });
  u.plan = req.body.plan||'free'; saveDB();
  res.json({ ok:true, user:safe(u) });
});
app.delete('/api/admin/users/:id', adminAuth, (req, res) => {
  if (req.params.id===req.user.id) return res.status(400).json({ error:'Cannot delete yourself' });
  DB.users=DB.users.filter(u=>u.id!==req.params.id);
  DB.videos=DB.videos.filter(v=>v.userId!==req.params.id);
  saveDB(); res.json({ ok:true });
});
app.get('/api/admin/videos', adminAuth, (req, res) => {
  const page=Number(req.query.page||1), limit=Number(req.query.limit||20);
  const sorted=[...DB.videos].sort((a,b)=>b.created-a.created);
  res.json({ ok:true, videos:sorted.slice((page-1)*limit,(page-1)*limit+limit), total:DB.videos.length });
});

// ERRORS
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code==='LIMIT_FILE_SIZE') return res.status(400).json({ error:'File too large. Max 500MB.' });
    return res.status(400).json({ error:'Upload error: '+err.message });
  }
  res.status(500).json({ error: err.message||'Server error' });
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error:'Route not found: '+req.path });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// START
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║      EdiVideo Backend v2.0  RUNNING      ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('\n  🌐  Open:   http://localhost:'+PORT);
  console.log('  💚  Health: http://localhost:'+PORT+'/api/health');
  console.log('  📁  DB:     '+DB_FILE);
  console.log('\n  Routes: auth, voices(Hindi first!), avatars,');
  console.log('  videos, upload, translate, comments,');
  console.log('  notifications, API keys, plans, stats, admin');
  console.log('\n  Press Ctrl+C to stop\n');
});
