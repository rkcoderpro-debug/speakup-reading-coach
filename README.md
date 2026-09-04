# SpeakUp Reading Coach v4

Web **reading English aloud only** — không mở rộng sang Grammar, Listening, Writing hay AI Conversation.

## Đã triển khai
- Google Login qua Supabase Auth
- PostgreSQL database + Row Level Security
- Reading Placement 4 bài lần đầu
- Reading Aloud Level được tính bằng công thức ổn định
- Gemini tạo roadmap 14 ngày
- Daily Reading: Warm-up / Main / Challenge
- Daily passage cache vào DB, refresh không generate lại
- Custom passage theo topic + độ dài
- Browser TTS nghe mẫu
- Microphone MediaRecorder
- Gemini chấm audio
- Overall / Pronunciation / Fluency / Completeness / Intonation / WPM
- Highlight trực tiếp từ tốt / cần chú ý / sai / bỏ sót trong paragraph
- Click từ để xem feedback
- Difficult Words + average/best/attempts/next review
- Generate passage chứa difficult word
- Reading history + thống kê 7 ngày
- Streak + total words
- Reading topic preferences + daily goal
- Không lưu raw audio

## Chạy
Đọc `SETUP_SUPABASE.md`, sau đó:

```bash
npm install
npm start
```

Mở `http://localhost:3000`.
