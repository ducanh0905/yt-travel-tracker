let videoData = [];
let channelMap = {};

// Khởi chạy ứng dụng khi DOM đã sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
});

async function initApp() {
  try {
    // Tải song song data để tối ưu thời gian chờ với các phương án đường dẫn dự phòng (fallback)
    const [metaRes, channelsRes, videosRes] = await Promise.all([
      fetch('/data/meta.json').then(r => {
        if (!r.ok) return fetch('data/meta.json').then(res => res.json());
        return r.json();
      }),
      fetch('/channels.json').then(r => {
        if (!r.ok) return fetch('channels.json').then(res => res.json());
        return r.json();
      }),
      fetch('/data/videos.json').then(r => {
        if (!r.ok) return fetch('data/videos.json').then(res => res.json());
        return r.json();
      })
    ]);

    // Đổ dữ liệu lên các thẻ thống kê ở Header
    document.getElementById('lastUpdated').innerText = formatDate(metaRes.lastUpdated);
    document.getElementById('countChannels').innerText = channelsRes.length;
    document.getElementById('countVideos').innerText = videosRes.length;

    // Chuyển mảng channel thành Map để tra cứu ID nhanh với độ phức tạp O(1)
    channelsRes.forEach(ch => {
      channelMap[ch.id] = ch;
    });

    // Bản đồ map thông tin kênh trực tiếp vào object video
    videoData = videosRes.map(video => {
      const channelInfo = channelMap[video.channelId] || {};
      return {
        ...video,
        channelTitle: channelInfo.title || 'Không rõ kênh',
        subscriberCount: parseInt(channelInfo.metrics?.subscriberCount || 0)
      };
    });

    // Thực hiện sắp xếp mặc định và hiển thị bảng dữ liệu
    handleSortAndRender();

  } catch (error) {
    console.error("Lỗi chi tiết khi tải file JSON:", error);
    document.getElementById('videoTableBody').innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: #ef4444; padding: 2rem 0; font-weight: 500;">
          Lỗi kết nối dữ liệu: Không thể đọc được các tệp tin cấu hình JSON. Hãy kiểm tra lại tiến trình build dữ liệu tự động.
        </td>
      </tr>`;
  }
}

function setupEventListeners() {
  document.getElementById('sortSelect').addEventListener('change', handleSortAndRender);
  
  // Đóng mở Sidebar chuyển động mượt mà qua class định sẵn
  document.getElementById('closeSidebarBtn').addEventListener('click', closeSidebar);
  document.getElementById('sidebarOverlay').addEventListener('click', (e) => {
    if(e.target.id === 'sidebarOverlay') closeSidebar();
  });
}

function handleSortAndRender() {
  const sortBy = document.getElementById('sortSelect').value;

  videoData.sort((a, b) => {
    if (sortBy === 'publishedAt') {
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    }
    return (b[sortBy] || 0) - (a[sortBy] || 0);
  });

  renderTable(videoData);
}

// Gom chuỗi HTML render một lần duy nhất để tối ưu hiệu năng hiển thị và tránh hiện tượng giật màn hình
function renderTable(data) {
  const tbody = document.getElementById('videoTableBody');
  let html = '';

  data.forEach(video => {
    html += `
      <tr class="clickable-row" onclick="openVideoDetail('${video.id}')">
        <td class="video-td">
          <div class="video-cell">
            <img src="${video.thumbnail}" alt="thumbnail" loading="lazy">
            <div class="video-title">${video.title}</div>
          </div>
        </td>
        <td data-label="Kênh"><span class="channel-badge">${video.channelTitle}</span></td>
        <td data-label="Ngày đăng">${formatDate(video.publishedAt)}</td>
        <td data-label="Lượt xem"><strong>${video.viewCount.toLocaleString('vi-VN')}</strong></td>
        <td data-label="Thích">${video.likeCount.toLocaleString('vi-VN')}</td>
        <td data-label="Bình luận">${video.commentCount.toLocaleString('vi-VN')}</td>
        <td data-label="Sub kênh">${video.subscriberCount ? video.subscriberCount.toLocaleString('vi-VN') : '–'}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

async function openVideoDetail(videoId) {
  const video = videoData.find(v => v.id === videoId);
  if (!video) return;

  const overlay = document.getElementById('sidebarOverlay');
  const badgeContainer = document.getElementById('sidebarChannelBadge');
  const contentContainer = document.getElementById('sidebarContent');

  badgeContainer.innerHTML = `<span class="channel-badge" style="background:var(--primary-light); color:var(--primary); font-weight:600;">${video.channelTitle}</span>`;
  
  // Hiển thị trạng thái Loading trước khi tải xong bình luận
  contentContainer.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:2rem 0;">Đang tải dữ liệu hội thoại...</div>`;
  overlay.classList.add('active');

  // Nạp cấu trúc khung thông tin chi tiết
  let detailHtml = `
    <div class="sidebar-video-meta">
      <img src="${video.thumbnail}" alt="cover">
      <h2>${video.title}</h2>
    </div>
    <div class="meta-grid-stats">
      <div>Lượt xem <strong>${video.viewCount.toLocaleString('vi-VN')}</strong></div>
      <div>Lượt thích <strong>${video.likeCount.toLocaleString('vi-VN')}</strong></div>
      <div>Bình luận <strong>${video.commentCount.toLocaleString('vi-VN')}</strong></div>
      <div>Ngày xuất bản <strong>${formatDate(video.publishedAt)}</strong></div>
    </div>
    <div class="comments-section">
      <h3>Bình luận nổi bật</h3>
      <div id="sidebarCommentsContainer">Đang trích xuất...</div>
    </div>
  `;
  contentContainer.innerHTML = detailHtml;

  // Gọi file JSON tĩnh chứa bình luận của riêng video đó
  try {
    const commentsRes = await fetch(`/data/comments/${videoId}.json`).then(r => {
      if (!r.ok) return fetch(`data/comments/${videoId}.json`).then(res => res.json());
      return r.json();
    });
    const commentsContainer = document.getElementById('sidebarCommentsContainer');
    
    if(!commentsRes || commentsRes.length === 0) {
      commentsContainer.innerHTML = `<div style="color:var(--text-muted); font-size:0.875rem;">Video này hiện tại chưa có dữ liệu bình luận được lưu trữ.</div>`;
      return;
    }

    let commentsHtml = '';
    commentsRes.forEach(c => {
      commentsHtml += `
        <div class="comment-card">
          <div class="comment-header">
            <span>Người dùng ẩn danh</span>
            <span>👍 ${c.likeCount || 0}</span>
          </div>
          <div class="comment-body">${c.textDisplay}</div>
        </div>
      `;
    });
    commentsContainer.innerHTML = commentsHtml;

  } catch (err) {
    document.getElementById('sidebarCommentsContainer').innerHTML = `<div style="color:var(--text-muted); font-size:0.875rem;">Không tìm thấy tệp hoặc dữ liệu bình luận của video này trống.</div>`;
  }
}

function closeSidebar() {
  document.getElementById('sidebarOverlay').classList.remove('active');
}

function formatDate(isoString) {
  if (!isoString) return '–';
  const d = new Date(isoString);
  return d.toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
