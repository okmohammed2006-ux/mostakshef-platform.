
const express=require("express");
const fs=require("fs");
const path=require("path");
const {Pool}=require("pg");
const helmet=require("helmet");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const app=express();
const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||"";
if(process.env.NODE_ENV==="production" && JWT_SECRET.length<32){throw new Error("JWT_SECRET must be set to a random secret of at least 32 characters in production");}
const DB=path.join(__dirname,"data","db.json");
const DATABASE_URL=process.env.DATABASE_URL||"";
const pool=DATABASE_URL?new Pool({connectionString:DATABASE_URL,ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:false,max:5}):null;
let state=null;
let persistChain=Promise.resolve();

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"2mb"}));
app.use(express.static(path.join(__dirname,"public")));

function readDB(){
 if(state)return state;
 return JSON.parse(fs.readFileSync(DB,"utf8"));
}
function writeDB(db){
 state=db;
 if(!pool){fs.writeFileSync(DB,JSON.stringify(db,null,2),"utf8");return Promise.resolve();}
 persistChain=persistChain.then(()=>pool.query(`INSERT INTO app_state(id,data,updated_at) VALUES(1,$1::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()`,[JSON.stringify(db)]));
 return persistChain;
}
async function initStore(){
 if(!pool){state=JSON.parse(fs.readFileSync(DB,"utf8"));return;}
 await pool.query(`CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 const r=await pool.query(`SELECT data FROM app_state WHERE id=1`);
 if(r.rows.length){state=r.rows[0].data;}else{state=JSON.parse(fs.readFileSync(DB,"utf8"));await pool.query(`INSERT INTO app_state(id,data) VALUES(1,$1::jsonb)`,[JSON.stringify(state)]);}
}
function uid(prefix){return prefix+"_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,7)}
function sign(user){return jwt.sign({id:user.id,role:user.role},JWT_SECRET,{expiresIn:"7d"})}

async function migrate(){
 if(!state && !pool){state=JSON.parse(fs.readFileSync(DB,"utf8"));}
 if(!state)return;
 let changed=false;
 for(const u of state.users){
   if(!u.passwordHash || u.passwordHash.length===64){
     u.passwordHash=await bcrypt.hash(u.role==="admin"?"Admin@12345":"Teacher@12345",12); changed=true;
   }
 }
 if(changed)await writeDB(state);
}
function auth(req,res,next){
 const h=req.headers.authorization||"";
 if(!h.startsWith("Bearer ")) return res.status(401).json({message:"يجب تسجيل الدخول"});
 try{req.user=jwt.verify(h.slice(7),JWT_SECRET);next()}
 catch(e){return res.status(401).json({message:"جلسة الدخول غير صالحة"})}
}
function role(...roles){return (req,res,next)=>{
 if(!roles.includes(req.user.role)) return res.status(403).json({message:"ليس لديك صلاحية"});
 next()
}}
function validate(s){return typeof s==="string"&&s.trim().length>0}
function publicUser(u){return {id:u.id,name:u.name,email:u.email,role:u.role,gradeId:u.gradeId,progress:u.progress||{},attempts:u.attempts||[]}}

const YOUTUBE_CHANNEL_URL=process.env.YOUTUBE_CHANNEL_URL||"https://youtube.com/@mohamed.alfeki";
const YOUTUBE_API_KEY=process.env.YOUTUBE_API_KEY||"";
const YOUTUBE_HANDLE=process.env.YOUTUBE_HANDLE||"@mohamed.alfeki";
app.get("/api/health",(req,res)=>res.json({ok:true,app:"Mostakshef",version:"8.0",database:!!pool?"postgres":"local",youtubeApiConfigured:!!YOUTUBE_API_KEY}));
app.get("/api/site-config",(req,res)=>res.json({youtubeChannel:YOUTUBE_CHANNEL_URL,youtubeHandle:YOUTUBE_HANDLE,youtubeApiConfigured:!!YOUTUBE_API_KEY}));

function extractYouTubeId(value){
 const v=String(value||"").trim();
 if(!v)return "";
 if(/^[A-Za-z0-9_-]{11}$/.test(v))return v;
 try{
   const u=new URL(v);
   if(u.hostname.includes("youtu.be")) return u.pathname.slice(1).split(/[?&#/]/)[0];
   if(u.searchParams.get("v")) return u.searchParams.get("v");
   const m=u.pathname.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/); if(m)return m[1];
 }catch(e){}
 return "";
}

app.get("/api/youtube/videos",auth,role("admin","teacher"),async(req,res)=>{
 if(!YOUTUBE_API_KEY) return res.status(503).json({message:"لم يتم ضبط YOUTUBE_API_KEY بعد. يمكنك استخدام إدخال رابط الفيديو يدويًا.",configured:false,videos:[]});
 try{
   const max=Math.min(Math.max(Number(req.query.max)||25,1),50);
   const cUrl=`https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&forHandle=${encodeURIComponent(YOUTUBE_HANDLE)}&key=${encodeURIComponent(YOUTUBE_API_KEY)}`;
   const cr=await fetch(cUrl); const cd=await cr.json();
   if(!cr.ok || !cd.items?.length) return res.status(502).json({message:"تعذر الوصول إلى قناة يوتيوب بهذا الـHandle. راجع YOUTUBE_HANDLE.",details:cd.error?.message||"Channel not found"});
   const channel=cd.items[0]; const uploads=channel.contentDetails?.relatedPlaylists?.uploads;
   if(!uploads)return res.status(404).json({message:"لم يتم العثور على قائمة فيديوهات القناة"});
   const pUrl=`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(uploads)}&maxResults=${max}&key=${encodeURIComponent(YOUTUBE_API_KEY)}`;
   const pr=await fetch(pUrl); const pd=await pr.json();
   if(!pr.ok)return res.status(502).json({message:"تعذر جلب فيديوهات القناة",details:pd.error?.message||"YouTube API error"});
   const videos=(pd.items||[]).filter(x=>x.contentDetails?.videoId).map(x=>({
     videoId:x.contentDetails.videoId,title:x.snippet?.title||"بدون عنوان",description:x.snippet?.description||"",publishedAt:x.contentDetails?.videoPublishedAt||x.snippet?.publishedAt||null,
     thumbnail:x.snippet?.thumbnails?.medium?.url||x.snippet?.thumbnails?.default?.url||`https://i.ytimg.com/vi/${x.contentDetails.videoId}/mqdefault.jpg`,url:`https://www.youtube.com/watch?v=${x.contentDetails.videoId}`
   }));
   res.json({configured:true,channel:{id:channel.id,title:channel.snippet?.title||"",thumbnail:channel.snippet?.thumbnails?.default?.url||null},videos});
 }catch(e){res.status(500).json({message:"حدث خطأ أثناء الاتصال بيوتيوب",details:e.message})}
});

app.post("/api/login",async(req,res)=>{
 const {email,password}=req.body||{}; const db=readDB();
 const u=db.users.find(x=>x.email.toLowerCase()===String(email||"").toLowerCase());
 if(!u || !(await bcrypt.compare(String(password||""),u.passwordHash))) return res.status(401).json({message:"البريد الإلكتروني أو كلمة المرور غير صحيحة"});
 res.json({token:sign(u),user:publicUser(u)});
});
app.get("/api/me",auth,(req,res)=>{
 const u=readDB().users.find(x=>x.id===req.user.id);
 if(!u)return res.status(404).json({message:"المستخدم غير موجود"});
 res.json(publicUser(u));
});
app.get("/api/grades",(req,res)=>res.json(readDB().grades));
app.get("/api/lessons",(req,res)=>{
 const db=readDB(); let a=db.lessons;
 if(req.query.grade)a=a.filter(x=>x.gradeId===req.query.grade);
 res.json(a);
});
app.get("/api/units",(req,res)=>{
 const db=readDB(); let a=db.units;
 if(req.query.grade)a=a.filter(x=>x.gradeId===req.query.grade);
 res.json(a);
});
app.get("/api/question-bank",auth,role("admin","teacher"),(req,res)=>{
 const db=readDB(); let qs=[];
 for(const qz of db.quizzes) for(const q of qz.questions) qs.push({...q,quizId:qz.id,quizTitle:qz.title,gradeId:qz.gradeId});
 res.json(qs);
});
app.get("/api/quizzes",(req,res)=>{
 const db=readDB(); let a=db.quizzes;
 if(req.query.grade)a=a.filter(x=>x.gradeId===req.query.grade);
 res.json(a);
});
app.get("/api/quizzes/:id",(req,res)=>{
 const q=readDB().quizzes.find(x=>x.id===req.params.id);
 if(!q)return res.status(404).json({message:"الاختبار غير موجود"});
 res.json(q);
});

app.get("/api/leaderboard",(req,res)=>{
 const db=readDB();
 const rows=db.users.filter(u=>u.role==="student").map(u=>{const a=u.attempts||[];const points=a.reduce((n,x)=>n+(x.passed?100:Math.round((x.percent||0)*0.5)),0)+(Object.values(u.progress||{}).filter(Boolean).length*10);return {id:u.id,name:u.name,gradeId:u.gradeId,points,completed:Object.values(u.progress||{}).filter(Boolean).length,attempts:a.length};}).sort((a,b)=>b.points-a.points).slice(0,20);
 res.json(rows);
});

app.get("/api/admin/stats",auth,role("admin","teacher"),(req,res)=>{
 const db=readDB();
 const students=db.users.filter(u=>u.role==="student").length;
 const teachers=db.users.filter(u=>u.role==="teacher").length;
 const attempts=db.users.reduce((n,u)=>n+(u.attempts||[]).length,0);
 res.json({students,teachers,grades:db.grades.length,units:db.units.length,lessons:db.lessons.length,quizzes:db.quizzes.length,attempts});
});
app.get("/api/admin/users",auth,role("admin"),(req,res)=>{
 const db=readDB(); res.json(db.users.map(publicUser));
});

app.post("/api/admin/grades",auth,role("admin"),(req,res)=>{
 const {name,stage}=req.body||{}; if(!validate(name)||!["primary","preparatory"].includes(stage))return res.status(400).json({message:"بيانات الصف غير صحيحة"});
 const db=readDB(); if(db.grades.some(x=>x.name.trim().toLowerCase()===name.trim().toLowerCase() && x.stage===stage))return res.status(409).json({message:"هذا الصف موجود بالفعل"}); const g={id:uid("grade"),name:name.trim(),stage}; db.grades.push(g);writeDB(db);res.status(201).json(g);
});
app.put("/api/admin/grades/:id",auth,role("admin"),(req,res)=>{
 const db=readDB(),g=db.grades.find(x=>x.id===req.params.id); if(!g)return res.status(404).json({message:"الصف غير موجود"});
 if(validate(req.body.name))g.name=req.body.name.trim(); if(["primary","preparatory"].includes(req.body.stage))g.stage=req.body.stage;
 writeDB(db);res.json(g);
});
app.delete("/api/admin/grades/:id",auth,role("admin"),(req,res)=>{
 const db=readDB(),id=req.params.id;if(!db.grades.some(x=>x.id===id))return res.status(404).json({message:"غير موجود"});
 db.grades=db.grades.filter(x=>x.id!==id);db.units=db.units.filter(x=>x.gradeId!==id);db.lessons=db.lessons.filter(x=>x.gradeId!==id);db.quizzes=db.quizzes.filter(x=>x.gradeId!==id);writeDB(db);res.json({ok:true});
});

app.post("/api/admin/units",auth,role("admin","teacher"),(req,res)=>{
 const {gradeId,name,description=""}=req.body||{};const db=readDB();
 if(!db.grades.some(x=>x.id===gradeId)||!validate(name))return res.status(400).json({message:"بيانات الوحدة غير صحيحة"});
 const u={id:uid("unit"),gradeId,name:name.trim(),description:String(description).trim()};db.units.push(u);writeDB(db);res.status(201).json(u);
});
app.put("/api/admin/units/:id",auth,role("admin","teacher"),(req,res)=>{
 const db=readDB(),u=db.units.find(x=>x.id===req.params.id);if(!u)return res.status(404).json({message:"الوحدة غير موجودة"});
 if(validate(req.body.name))u.name=req.body.name.trim();if(typeof req.body.description==="string")u.description=req.body.description.trim();
 writeDB(db);res.json(u);
});
app.delete("/api/admin/units/:id",auth,role("admin","teacher"),(req,res)=>{
 const db=readDB(),id=req.params.id;if(!db.units.some(x=>x.id===id))return res.status(404).json({message:"غير موجود"});
 db.units=db.units.filter(x=>x.id!==id);db.lessons=db.lessons.filter(x=>x.unitId!==id);writeDB(db);res.json({ok:true});
});

app.post("/api/admin/lessons",auth,role("admin","teacher"),(req,res)=>{
 const {gradeId,unitId=null,title,summary="",content=""}=req.body||{},db=readDB();
 if(!db.grades.some(x=>x.id===gradeId)||!validate(title))return res.status(400).json({message:"بيانات الدرس غير صحيحة"});
 const l={id:uid("lesson"),gradeId,unitId, title:title.trim(),summary:String(summary).trim(),content:String(content).trim(),youtubeId:extractYouTubeId(req.body.youtubeId||""),youtubeTitle:String(req.body.youtubeTitle||"").trim()};
 db.lessons.push(l);writeDB(db);res.status(201).json(l);
});
app.put("/api/admin/lessons/:id",auth,role("admin","teacher"),(req,res)=>{
 const db=readDB(),l=db.lessons.find(x=>x.id===req.params.id);if(!l)return res.status(404).json({message:"الدرس غير موجود"});
 for(const k of ["gradeId","unitId"])if(k in req.body)l[k]=req.body[k]||null;
 for(const k of ["title","summary","content","youtubeTitle"])if(typeof req.body[k]==="string")l[k]=req.body[k].trim();
 if(typeof req.body.youtubeId==="string")l.youtubeId=extractYouTubeId(req.body.youtubeId);
 writeDB(db);res.json(l);
});
app.delete("/api/admin/lessons/:id",auth,role("admin","teacher"),(req,res)=>{
 const db=readDB(),id=req.params.id;if(!db.lessons.some(x=>x.id===id))return res.status(404).json({message:"غير موجود"});
 db.lessons=db.lessons.filter(x=>x.id!==id);db.quizzes=db.quizzes.map(q=>q.lessonId===id?{...q,lessonId:null}:q);writeDB(db);res.json({ok:true});
});

app.post("/api/admin/quizzes",auth,role("admin","teacher"),(req,res)=>{
 const {gradeId,lessonId=null,title,questions=[]}=req.body||{},db=readDB();
 if(!db.grades.some(x=>x.id===gradeId)||!validate(title)||!Array.isArray(questions))return res.status(400).json({message:"بيانات الاختبار غير صحيحة"});
 const q={id:uid("quiz"),gradeId,lessonId:lessonId||null,title:title.trim(),duration:Number(req.body.duration)||0,passingScore:Number(req.body.passingScore)||50,questions:questions.map(normalizeQuestion)};
 db.quizzes.push(q);writeDB(db);res.status(201).json(q);
});
app.put("/api/admin/quizzes/:id",auth,role("admin","teacher"),(req,res)=>{
 const db=readDB(),q=db.quizzes.find(x=>x.id===req.params.id);if(!q)return res.status(404).json({message:"الاختبار غير موجود"});
 if(validate(req.body.title))q.title=req.body.title.trim();if(req.body.lessonId!==undefined)q.lessonId=req.body.lessonId||null;
 if(req.body.duration!==undefined)q.duration=Math.max(0,Number(req.body.duration)||0);
 if(req.body.passingScore!==undefined)q.passingScore=Math.min(100,Math.max(0,Number(req.body.passingScore)||0));
 if(Array.isArray(req.body.questions))q.questions=req.body.questions.map(normalizeQuestion);
 writeDB(db);res.json(q);
});
function normalizeQuestion(x){return {id:x.id||uid("q"),text:String(x.text||"").trim(),options:Array.isArray(x.options)?x.options.map(v=>String(v)):[],answer:Number.isInteger(x.answer)?x.answer:0}}

app.delete("/api/admin/quizzes/:id",auth,role("admin","teacher"),(req,res)=>{
 const db=readDB(),id=req.params.id;if(!db.quizzes.some(x=>x.id===id))return res.status(404).json({message:"غير موجود"});
 db.quizzes=db.quizzes.filter(x=>x.id!==id);writeDB(db);res.json({ok:true});
});

app.post("/api/admin/teachers",auth,role("admin"),async(req,res)=>{
 const {name,email,password,gradeId=null}=req.body||{},db=readDB();
 if(!validate(name)||!validate(email)||String(password||"").length<8)return res.status(400).json({message:"الاسم والبريد وكلمة المرور (8 أحرف على الأقل) مطلوبة"});
 if(db.users.some(x=>x.email.toLowerCase()===email.toLowerCase()))return res.status(409).json({message:"البريد مستخدم بالفعل"});
 const u={id:uid("teacher"),name:name.trim(),email:email.trim().toLowerCase(),passwordHash:await bcrypt.hash(password,12),role:"teacher",gradeId,progress:{},attempts:[]};
 db.users.push(u);writeDB(db);res.status(201).json(publicUser(u));
});

app.post("/api/register",async(req,res)=>{
 const {name,email,password,gradeId}=req.body||{},db=readDB();
 if(!validate(name)||!validate(email)||String(password||"").length<8)return res.status(400).json({message:"أكمل البيانات وكلمة المرور يجب أن تكون 8 أحرف على الأقل"});
 if(db.users.some(x=>x.email.toLowerCase()===email.toLowerCase()))return res.status(409).json({message:"البريد مستخدم بالفعل"});
 const u={id:uid("student"),name:name.trim(),email:email.trim().toLowerCase(),passwordHash:await bcrypt.hash(password,12),role:"student",gradeId:gradeId||null,progress:{},attempts:[]};
 db.users.push(u);writeDB(db);res.status(201).json({token:sign(u),user:publicUser(u)});
});
app.post("/api/progress",auth,(req,res)=>{
 const {lessonId,completed}=req.body||{},db=readDB(),u=db.users.find(x=>x.id===req.user.id);
 if(!u||!db.lessons.some(x=>x.id===lessonId))return res.status(400).json({message:"بيانات غير صحيحة"});
 u.progress[lessonId]=!!completed;writeDB(db);res.json({progress:u.progress});
});
app.post("/api/quizzes/:id/submit",auth,(req,res)=>{
 const db=readDB(),q=db.quizzes.find(x=>x.id===req.params.id),u=db.users.find(x=>x.id===req.user.id);
 if(!q||!u)return res.status(404).json({message:"غير موجود"});
 const answers=Array.isArray(req.body.answers)?req.body.answers:[],startedAt=req.body.startedAt?new Date(req.body.startedAt).getTime():null;
 if(q.duration>0 && startedAt && (Date.now()-startedAt)>q.duration*60000+5000) return res.status(400).json({message:"انتهى وقت الاختبار"});
 const correct=q.questions.reduce((n,x,i)=>n+(answers[i]===x.answer?1:0),0);
 const attempt={id:uid("attempt"),quizId:q.id,score:correct,total:q.questions.length,percent:q.questions.length?Math.round(correct/q.questions.length*100):0,passed:q.questions.length?Math.round(correct/q.questions.length*100)>=(q.passingScore||50):false,at:new Date().toISOString()};
 u.attempts=u.attempts||[];u.attempts.push(attempt);writeDB(db);res.json(attempt);
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
migrate().then(async()=>{await initStore(); await migrate(); if(pool)await pool.query('SELECT 1'); app.listen(PORT,"0.0.0.0",()=>console.log(`Mostakshef running on ${PORT}`));}).catch(err=>{console.error(err);process.exit(1)});
