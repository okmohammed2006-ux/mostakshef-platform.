# منصة محمد الفقي التعليمية — Production V8

منصة دراسات اجتماعية عربية مبنية بـ Node.js + Express، مع PostgreSQL على Render، لوحة Admin/Teacher تفاعلية، نظام طلاب واختبارات وتقدم وشهادات وربط YouTube.

## تشغيل محلي
1. `npm install`
2. `npm start`
3. افتح `http://localhost:3000`

إذا لم تضع `DATABASE_URL` سيستخدم المشروع `data/db.json` للتجربة المحلية. عند النشر يجب استخدام PostgreSQL.

## النشر على Render
أسهل طريقة: ارفع المشروع إلى GitHub ثم في Render اختر **New → Blueprint** واربط المستودع. ملف `render.yaml` ينشئ Web Service وقاعدة PostgreSQL ويربط `DATABASE_URL` تلقائيًا.

أضف `YOUTUBE_API_KEY` من إعدادات الخدمة لتفعيل اختيار فيديوهات قناة محمد الفقي تلقائيًا. لا تضع المفتاح داخل ملفات JavaScript الخاصة بالمتصفح.

### متغيرات البيئة
- `DATABASE_URL` — ينشئها Render تلقائيًا من قاعدة البيانات.
- `JWT_SECRET` — Render يولده تلقائيًا عبر `generateValue` في Blueprint.
- `YOUTUBE_API_KEY` — مفتاح YouTube Data API.
- `YOUTUBE_HANDLE=@mohamed.alfeki`
- `YOUTUBE_CHANNEL_URL=https://youtube.com/@mohamed.alfeki`

## الحسابات التجريبية
- Admin: `admin@mostakshef.local` / `Admin@12345`
- Teacher: `teacher@mostakshef.local` / `Teacher@12345`

غيّر الحسابات وكلمات المرور قبل الاستخدام العام.

## ملاحظة قاعدة البيانات
نسخة الإنتاج تستخدم جدول PostgreSQL واحدًا باسم `app_state` لتخزين حالة المنصة كـJSONB، مع الحفاظ على نفس نموذج البيانات الحالي لتسهيل الانتقال من النسخة التجريبية. البيانات الأولية في `data/db.json` تُستخدم فقط عند إنشاء قاعدة جديدة لأول مرة.

Render يوضح أن نظام الملفات الافتراضي للخدمات مؤقت، لذلك لا تعتمد نسخة الإنتاج على `db.json` لتخزين بيانات الطلاب. PostgreSQL هو مخزن البيانات الدائم.
