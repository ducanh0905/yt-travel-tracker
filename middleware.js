// Chặn TOÀN BỘ web bằng 1 mật khẩu chung, đặt trong biến môi trường
// SITE_PASSWORD trên Vercel (Project Settings → Environment Variables).
//
// Sau khi nhập đúng mật khẩu 1 lần, trình duyệt được nhớ 90 ngày qua cookie
// (không cần đăng nhập lại mỗi lần vào, kể cả khi đóng trình duyệt) - trừ khi
// bạn xoá cookie, đổi trình duyệt/máy khác, hoặc đổi SITE_PASSWORD.
//
// Không cần sửa gì trong index.html/app.js/api - middleware này chạy trước
// mọi request, kể cả file tĩnh (index.html, app.js, data/*.json) và API.

export const config = {
  // Chặn tất cả, trừ favicon (không cần bảo vệ file icon nhỏ này).
  matcher: ["/((?!favicon.ico).*)"],
};

const COOKIE_NAME = "site_auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 ngày

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function loginPage({ error } = {}) {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Đăng nhập</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at 20% 20%, #201a3a 0%, #0a0c1a 60%);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #e7e6f5;
  }
  form {
    width: 100%;
    max-width: 340px;
    padding: 32px 28px;
    background: rgba(20, 18, 40, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  }
  h1 { font-size: 18px; margin: 0 0 18px; font-weight: 600; text-align: center; }
  input {
    width: 100%;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    font-size: 14px;
    outline: none;
  }
  input:focus { border-color: #ff7a59; }
  button {
    width: 100%;
    margin-top: 14px;
    padding: 12px 14px;
    border: none;
    border-radius: 10px;
    background: #ff7a59;
    color: #1a1330;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
  }
  button:hover { opacity: 0.92; }
  .error { color: #ff9d8a; font-size: 13px; margin: -6px 0 14px; text-align: center; }
</style>
</head>
<body>
  <form method="POST" action="/__login">
    <h1>Nhập mật khẩu để vào trang</h1>
    ${error ? '<p class="error">Sai mật khẩu, thử lại nhé.</p>' : ""}
    <input type="password" name="password" placeholder="Mật khẩu" autofocus required />
    <button type="submit">Vào trang</button>
  </form>
</body>
</html>`;
}

export default async function middleware(request) {
  const password = process.env.SITE_PASSWORD;

  // Chưa cấu hình mật khẩu trên Vercel -> không chặn gì cả, để tránh tự khoá
  // luôn cả app nếu ai đó quên set biến môi trường này.
  if (!password) return;

  const url = new URL(request.url);
  const expectedCookie = await sha256Hex(`v1:${password}`);

  // Đăng xuất thủ công (xoá cookie), phòng khi dùng máy chung/máy lạ.
  if (url.pathname === "/__logout") {
    const res = new Response(loginPage(), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    res.headers.append("Set-Cookie", `${COOKIE_NAME}=; Max-Age=0; Path=/`);
    return res;
  }

  // Xử lý submit form đăng nhập.
  if (url.pathname === "/__login" && request.method === "POST") {
    const form = await request.formData();
    const input = String(form.get("password") || "");

    if (input === password) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: new URL("/", request.url).toString(),
          "Set-Cookie": `${COOKIE_NAME}=${expectedCookie}; Max-Age=${COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }

    return new Response(loginPage({ error: true }), {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Đã có cookie hợp lệ (đăng nhập trước đó, trong vòng 90 ngày) -> cho qua.
  const cookieHeader = request.headers.get("cookie") || "";
  const isAuthed = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .includes(`${COOKIE_NAME}=${expectedCookie}`);

  if (isAuthed) return;

  // Chưa đăng nhập -> chặn lại, hiện trang nhập mật khẩu.
  return new Response(loginPage(), {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
