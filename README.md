# Bảng theo dõi kênh Du lịch YouTube

Web app tĩnh (deploy trên Netlify) để theo dõi thống kê của một danh sách kênh YouTube
mảng du lịch: lượt xem, tốc độ tăng view (view/giờ), lượt thích, lượt bình luận, sub
kênh, ngày đăng — kèm xem bình luận từng video (có sắp xếp + dịch nhanh sang tiếng Việt).

Dữ liệu được GitHub Actions gọi API YouTube **1 lần/ngày**, lưu thành file JSON tĩnh
trong repo. Frontend (Netlify) chỉ đọc file JSON này — **không cần API key ở phía
trình duyệt**, không lộ key, không tốn quota mỗi khi có người xem trang.

```
┌─────────────┐   cron 1 lần/ngày      ┌──────────────────┐
│ GitHub       │ ───────────────────▶  │ YouTube Data API │
│ Actions      │ ◀───────────────────  │ v3               │
└──────┬──────┘   video + comment data └──────────────────┘
       │ commit public/data/*.json
       ▼
┌─────────────┐   phục vụ file tĩnh   ┌──────────────────┐
│ GitHub repo  │ ───────────────────▶ │ Netlify (frontend)│
└─────────────┘                       └──────────────────┘
```

## 1. Cấu trúc project

```
channels.json                 # các danh sách kênh YouTube cần theo dõi (theo tab), vd { "TBN": [...], "4K": [...] }
scripts/fetch-data.mjs        # script gọi YouTube API cho từng danh sách, chạy bởi GitHub Actions
.github/workflows/fetch-data.yml  # lịch chạy cron
public/                       # toàn bộ frontend, đây là thư mục Netlify sẽ publish
  index.html
  style.css
  app.js
  data/
    videos-<TÊN LIST>.json   # vd videos-TBN.json, videos-4K.json (được ghi tự động)
    meta-<TÊN LIST>.json     # vd meta-TBN.json, meta-4K.json (được ghi tự động)
    comments/<videoId>.json  # bình luận từng video, dùng chung cho mọi danh sách (được ghi tự động)
```

## 2. Lấy YouTube Data API key

1. Vào [Google Cloud Console](https://console.cloud.google.com/) → tạo project mới (hoặc dùng project cũ).
2. Bật **YouTube Data API v3** (APIs & Services → Library → tìm "YouTube Data API v3" → Enable).
3. Vào **APIs & Services → Credentials** → Create credentials → API key.
4. (Khuyến khích) Giới hạn API key chỉ dùng cho "YouTube Data API v3" để an toàn hơn.

Quota mặc định: 10,000 unit/ngày. Script này tốn khoảng:
- 1 unit/kênh để lấy thông tin kênh
- ~1 unit/50 video để lấy playlist
- ~1 unit/50 video để lấy thống kê
- **1 unit/video để lấy bình luận** (phần tốn quota nhất)

Với 15 kênh × 50 video/kênh = 750 video, lần chạy đầu tiên tốn khoảng 750–800 unit
(dư sức trong 10,000 unit/ngày). Từ lần chạy thứ 2 trở đi, script chỉ tải lại bình
luận của video nào có `commentCount` thay đổi so với lần trước → tiết kiệm quota rất
nhiều cho các video cũ.

Nếu bạn có nhiều kênh hơn hoặc muốn lấy nhiều video/bình luận hơn, có thể chỉnh 2 biến
môi trường `MAX_VIDEOS_PER_CHANNEL` và `MAX_COMMENTS_PER_VIDEO` trong file
`.github/workflows/fetch-data.yml`.

## 3. Đưa project lên GitHub

```bash
cd yt-travel-tracker
git init
git add .
git commit -m "init: youtube travel tracker"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

## 4. Thêm API key vào GitHub Secrets

Repo trên GitHub → **Settings → Secrets and variables → Actions → New repository secret**

- Name: `YOUTUBE_API_KEY`
- Value: API key vừa tạo ở bước 2

## 5. Sửa danh sách kênh cần theo dõi

Mở `channels.json`. File này chứa nhiều danh sách có tên — mỗi tên tương ứng 1 tab
trên giao diện (hiện có `TBN` và `4K`). Mỗi kênh hỗ trợ cả 3 dạng nhập:

```json
{
  "TBN": [
    "@tenkenh1",
    "https://www.youtube.com/@tenkenh2",
    "UCxxxxxxxxxxxxxxxxxxxxxx"
  ],
  "4K": [
    "@tenkenh3"
  ]
}
```

Muốn thêm tab mới, thêm 1 key mới vào file này (vd `"3D": [...]`) rồi thêm nút tab
tương ứng trong `public/index.html` (`<div id="marketTabs">`) — `data-list` phải khớp
đúng tên key trong `channels.json`.

Commit + push lên GitHub, workflow sẽ tự chạy lại (vì có trigger `push: paths: channels.json`).

## 6. Chạy thử workflow lần đầu

Vào tab **Actions** trên GitHub → chọn workflow "Fetch YouTube Data" → **Run workflow**
(nút bên phải) để chạy thủ công lần đầu, không cần đợi tới giờ cron.

Sau khi chạy xong (thường 1–3 phút tùy số kênh), workflow sẽ tự commit các file trong
`public/data/` về repo.

## 7. Deploy lên Netlify

1. Vào [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**.
2. Chọn repo GitHub vừa tạo.
3. Build settings:
   - Base directory: (để trống)
   - Build command: (để trống, hoặc giữ nguyên `echo 'No build step needed...'`)
   - Publish directory: `public`
4. Deploy. Xong — mỗi khi GitHub Actions commit dữ liệu mới, Netlify sẽ tự động deploy lại.

## 8. Lịch chạy cron

Mặc định workflow chạy **1 lần/ngày**: 23:00 UTC (~06:00 sáng giờ VN). Muốn đổi lịch,
sửa phần `cron` trong `.github/workflows/fetch-data.yml` (cú pháp cron chuẩn UTC).

Bạn cũng luôn có thể bấm **Run workflow** thủ công bất cứ lúc nào cần cập nhật ngay.

## 9. Các tính năng trên frontend

- Tìm kiếm theo tiêu đề video / tên kênh.
- Lọc theo từng kênh riêng lẻ.
- Sắp xếp theo: ngày đăng, lượt xem, view/giờ, lượt thích, lượt bình luận, sub kênh — tăng dần/giảm dần (bấm được cả vào tiêu đề cột).
- Bấm vào 1 video → mở bảng bình luận của video đó, sắp xếp theo lượt thích hoặc mới nhất.
- Mỗi bình luận có nút "Dịch sang Tiếng Việt" (dùng endpoint dịch công khai của Google,
  không cần API key riêng — nếu bị chặn do mạng, sẽ có link mở Google Dịch thay thế).

## 10. Giới hạn cần biết

- Endpoint dịch dùng trong app (`translate.googleapis.com`) là endpoint công khai không
  chính thức mà Google dùng cho tiện ích dịch nhanh trên web — miễn phí và không cần
  key, nhưng không có SLA chính thức, có thể bị giới hạn nếu gọi quá nhiều trong thời
  gian ngắn. Nếu cần ổn định lâu dài, có thể thay bằng Cloud Translation API chính thức
  (cần thêm key + billing).
- `likeCount` của video có thể là `null` nếu kênh ẩn số liệu này.
- `subscriberCount` có thể là `null` nếu kênh chọn ẩn số người đăng ký.
- Nếu 1 kênh nhập sai / không tồn tại, script sẽ ghi lỗi vào `meta-<LIST>.json` (mục
  `errors`) và tiếp tục xử lý các kênh còn lại, không dừng toàn bộ.
- **`viewsPerHour`**: vì workflow chỉ chạy 1 lần/ngày, số liệu này được tính bằng
  `(view hôm nay - view lần fetch trước) / số giờ giữa 2 lần fetch` — phản ánh tốc độ
  tăng view trong ~24h qua, không phải theo giờ thực. Video mới thấy lần đầu (chưa có
  dữ liệu lần trước để so sánh) sẽ tạm hiển thị trung bình cả đời video (`viewCount /
  số giờ kể từ khi đăng`), có đánh dấu `~` nhỏ bên cạnh số để phân biệt.
