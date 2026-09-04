# SpeakUp Reading Coach v4 — Setup Windows

## 1. Gemini
Giữ API key Gemini bạn đang dùng ở v3.x.

```env
GEMINI_API_KEY=YOUR_GEMINI_KEY
GEMINI_PRIMARY_MODEL=gemini-3.6-flash
GEMINI_FALLBACK_MODELS=gemini-3.5-flash-lite
```

## 2. Tạo Supabase project miễn phí
1. Vào https://supabase.com/
2. Đăng nhập → **New project**.
3. Đặt tên ví dụ `speakup-reading` và tạo project.

## 3. Tạo database
Trong Supabase Dashboard:

```text
SQL Editor → New query
```

Mở file:

```text
supabase/schema.sql
```

Copy toàn bộ → paste vào SQL Editor → **Run**.

Database sẽ có:

```text
profiles
reading_passages
reading_attempts
word_progress
daily_lessons
reading_plans
```

RLS đã được bật: mỗi user chỉ truy cập dữ liệu của chính họ.

## 4. Cấu hình Google Login
### Google Cloud
Vào https://console.cloud.google.com/ và mở **Google Auth Platform**.
Tạo OAuth Client:

```text
Clients → Create Client → Web application
```

Authorized JavaScript origins:

```text
http://localhost:3000
```

### Redirect URI
Trong Supabase:

```text
Authentication → Sign In / Providers → Google
```

Copy callback URL Supabase hiển thị. Thường là:

```text
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

Thêm URL đó vào Google Cloud → OAuth Client → **Authorized redirect URIs**.

Google sẽ cho `Client ID` và `Client Secret`.

## 5. Bật Google Provider trong Supabase
Trong:

```text
Authentication → Sign In / Providers → Google
```

Enable → paste Client ID + Client Secret → Save.

## 6. URL Configuration
Trong Supabase:

```text
Authentication → URL Configuration
```

Site URL:

```text
http://localhost:3000
```

Redirect URL:

```text
http://localhost:3000/**
```

## 7. Lấy Project URL và Publishable Key
Trong Supabase Dashboard tìm API/Connect settings.
Copy:

```text
Project URL
Publishable key (sb_publishable_...)
```

Nếu project cũ chỉ có `anon` key thì vẫn dùng được.

## 8. Tạo `.env`
Copy `.env.example` → đổi tên thành `.env`:

```env
GEMINI_API_KEY=AIza...YOUR_KEY...
GEMINI_PRIMARY_MODEL=gemini-3.6-flash
GEMINI_FALLBACK_MODELS=gemini-3.5-flash-lite

SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

PORT=3000
```

Nếu dùng anon key cũ:

```env
SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Không dùng `service_role` key trong browser.

## 9. Chạy
Cần Node.js 20+.

```bat
npm install
npm start
```

Hoặc double-click:

```text
START_WINDOWS.bat
```

Mở:

```text
http://localhost:3000
```

## 10. Flow lần đầu

```text
Google Login
→ 4 Reading Placement passages
→ Gemini chấm 4 bài
→ app tính Reading Aloud Level
→ Gemini tạo roadmap 14 ngày
→ Daily Reading
```

Placement chỉ đánh giá reading aloud, không đánh giá Grammar / Listening / Writing / Conversation.

## 11. Dữ liệu lưu
Supabase lưu:
- Google-auth user
- Reading Profile
- Reading Level
- scores + WPM
- generated passages
- reading history
- transcript + Gemini feedback
- Difficult Words
- streak
- daily lessons
- roadmap 14 ngày

**Raw microphone audio không được lưu**, chỉ gửi tạm thời cho Gemini để chấm rồi bỏ.

## 12. Tối ưu Free Tier
- Daily lesson chỉ generate một lần/ngày rồi cache vào Supabase.
- Refresh chỉ đọc database.
- Roadmap generate một lần sau Placement.
- Gemini chủ yếu được gọi khi bạn thực sự chấm audio hoặc chủ động generate passage.

## Lỗi `redirect_uri_mismatch`
Authorized redirect URI ở Google Cloud phải là **Supabase callback URL**, ví dụ:

```text
https://PROJECT_REF.supabase.co/auth/v1/callback
```

`http://localhost:3000` là JavaScript origin và Supabase redirect allow-list, không thay thế callback URL của Supabase.
