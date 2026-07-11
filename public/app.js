// public/app.js

let allVideos = [];
let filteredVideos = [];
let currentComments = [];
let sortField = "publishedAt";
let sortDir = "desc";
let commentSortField = "likeCount";
let commentSortDir = "desc";
let allChannelIds = [];
let selectedChannelIds = new Set(); // empty set = all channels selected

const els = {
  tbody: document.getElementById("videoTableBody"),
  search: document.getElementById("searchInput"),
  sortField: document.getElementById("sortField"),
  sortDir: document.getElementById("sortDir"),
  channelFilterWrap: document.getElementById("channelFilterWrap"),
  channelFilterBtn: document.getElementById("channelFilterBtn"),
  channelFilterPanel: document.getElementById("channelFilterPanel"),
  channelFilterList: document.getElementById("channelFilterList"),
  channelFilterLabel: document.getElementById("channelFilterLabel"),
  selectAllChannels: document.getElementById("selectAllChannels"),
  clearAllChannels: document.getElementById("clearAllChannels"),
  metaChannels: document.getElementById("metaChannels"),
  metaVideos: document.getElementById("metaVideos"),
  metaUpdated: document.getElementById("metaUpdated"),
  modalOverlay: document.getElementById("modalOverlay"),
  modalClose: document.getElementById("modalClose"),
  modalThumb: document.getElementById("modalThumb"),
  modalTitle: document.getElementById("modalTitle"),
  modalChannel: document.getElementById("modalChannel"),
  modalStats: document.getElementById("modalStats"),
  commentsList: document.getElementById("commentsList"),
  commentSortField: document.getElementById("commentSortField"),
  commentSortDir: document.getElementById("commentSortDir"),
};

function fmtNumber(n) {
  if (n === null || n === undefined) return "–";
  return new Intl.NumberFormat("vi-VN").format(n);
}

function fmtDate(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function fmtDateTime(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function loadData() {
  try {
    const [videosRes, metaRes] = await Promise.all([
      fetch("data/videos.json", { cache: "no-store" }),
      fetch("data/meta.json", { cache: "no-store" }),
    ]);
    allVideos = videosRes.ok ? await videosRes.json() : [];
    const meta = metaRes.ok ? await metaRes.json() : null;

    populateChannelFilter();
    if (meta) {
      els.metaChannels.textContent = meta.channelCount ?? "–";
      els.metaVideos.textContent = meta.videoCount ?? allVideos.length;
      els.metaUpdated.textContent = meta.lastUpdated ? fmtDateTime(meta.lastUpdated) : "–";
    } else {
      els.metaVideos.textContent = allVideos.length;
    }
    applyFilters();
  } catch (err) {
    els.tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Không tải được dữ liệu. Hãy chắc chắn GitHub Action đã chạy ít nhất 1 lần và public/data/videos.json tồn tại.</td></tr>`;
    console.error(err);
  }
}

function populateChannelFilter() {
  const channels = new Map();
  for (const v of allVideos) {
    if (!channels.has(v.channelId)) channels.set(v.channelId, v.channelTitle);
  }
  const sorted = [...channels.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  allChannelIds = sorted.map(([id]) => id);
  // Empty selection means "all channels" - start with nothing checked = show everything.
  selectedChannelIds = new Set();

  els.channelFilterList.innerHTML = sorted
    .map(
      ([id, title]) => `
    <label class="channel-filter__item">
      <input type="checkbox" value="${id}" />
      <span>${escapeHtml(title)}</span>
    </label>`
    )
    .join("");

  els.channelFilterList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) selectedChannelIds.add(cb.value);
      else selectedChannelIds.delete(cb.value);
      updateChannelFilterLabel();
      applyFilters();
    });
  });

  updateChannelFilterLabel();
}

function updateChannelFilterLabel() {
  if (selectedChannelIds.size === 0 || selectedChannelIds.size === allChannelIds.length) {
    els.channelFilterLabel.textContent = "Tất cả kênh";
  } else if (selectedChannelIds.size === 1) {
    const id = [...selectedChannelIds][0];
    const cb = els.channelFilterList.querySelector(`input[value="${id}"]`);
    els.channelFilterLabel.textContent = cb ? cb.nextElementSibling.textContent : "1 kênh";
  } else {
    els.channelFilterLabel.textContent = `${selectedChannelIds.size} kênh đã chọn`;
  }
}

function toggleChannelPanel(forceOpen) {
  const isOpen = els.channelFilterWrap.classList.contains("open");
  const shouldOpen = forceOpen !== undefined ? forceOpen : !isOpen;
  els.channelFilterWrap.classList.toggle("open", shouldOpen);
}

els.channelFilterBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleChannelPanel();
});

document.addEventListener("click", (e) => {
  if (!els.channelFilterWrap.contains(e.target)) toggleChannelPanel(false);
});

els.selectAllChannels.addEventListener("click", () => {
  selectedChannelIds = new Set(allChannelIds);
  els.channelFilterList.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = true));
  updateChannelFilterLabel();
  applyFilters();
});

els.clearAllChannels.addEventListener("click", () => {
  selectedChannelIds = new Set();
  els.channelFilterList.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = false));
  updateChannelFilterLabel();
  applyFilters();
});

function applyFilters() {
  const q = els.search.value.trim().toLowerCase();
  const filterActive = selectedChannelIds.size > 0 && selectedChannelIds.size < allChannelIds.length;

  filteredVideos = allVideos.filter((v) => {
    if (filterActive && !selectedChannelIds.has(v.channelId)) return false;
    if (!q) return true;
    return (
      v.title.toLowerCase().includes(q) ||
      v.channelTitle.toLowerCase().includes(q)
    );
  });

  sortVideos();
  renderTable();
}

function sortVideos() {
  const dir = sortDir === "asc" ? 1 : -1;
  filteredVideos.sort((a, b) => {
    let av = a[sortField];
    let bv = b[sortField];
    if (sortField === "publishedAt") {
      av = new Date(av).getTime();
      bv = new Date(bv).getTime();
    } else {
      av = av ?? -1;
      bv = bv ?? -1;
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

function renderTable() {
  document.querySelectorAll(".board-table thead th[data-field]").forEach((th) => {
    th.classList.toggle("active-sort", th.dataset.field === sortField);
  });

  if (!filteredVideos.length) {
    els.tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Không có video phù hợp.</td></tr>`;
    return;
  }

  els.tbody.innerHTML = filteredVideos
    .map(
      (v) => `
    <tr data-video-id="${v.videoId}">
      <td>
        <div class="video-cell">
          <img src="${v.thumbnail}" alt="" loading="lazy" />
          <div class="video-cell__title">${escapeHtml(v.title)}</div>
        </div>
      </td>
      <td class="channel-cell">${escapeHtml(v.channelTitle)}</td>
      <td class="col-num">${fmtDate(v.publishedAt)}</td>
      <td class="col-num">${fmtNumber(v.viewCount)}</td>
      <td class="col-num">${fmtNumber(v.likeCount)}</td>
      <td class="col-num">${fmtNumber(v.commentCount)}</td>
      <td class="col-num">${fmtNumber(v.subscriberCount)}</td>
    </tr>`
    )
    .join("");

  els.tbody.querySelectorAll("tr[data-video-id]").forEach((row) => {
    row.addEventListener("click", () => openModal(row.dataset.videoId));
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Modal & comments ----------

async function openModal(videoId) {
  const video = allVideos.find((v) => v.videoId === videoId);
  if (!video) return;

  els.modalOverlay.classList.add("open");
  els.modalThumb.src = video.thumbnail;
  els.modalTitle.textContent = video.title;
  els.modalChannel.textContent = video.channelTitle;
  els.modalStats.innerHTML = `
    <span>${fmtNumber(video.viewCount)} lượt xem</span>
    <span>${fmtNumber(video.likeCount)} thích</span>
    <span>${fmtNumber(video.commentCount)} bình luận</span>
    <span>${fmtDate(video.publishedAt)}</span>
  `;
  els.commentsList.innerHTML = `<div class="empty-state">Đang tải bình luận...</div>`;

  try {
    const res = await fetch(`data/comments/${videoId}.json`, { cache: "no-store" });
    if (!res.ok) throw new Error("no comments file");
    const data = await res.json();
    if (data.disabled) {
      currentComments = [];
      els.commentsList.innerHTML = `<div class="empty-state">Video này đã tắt bình luận.</div>`;
      return;
    }
    currentComments = data.comments || [];
    renderComments();
  } catch (err) {
    currentComments = [];
    els.commentsList.innerHTML = `<div class="empty-state">Chưa có dữ liệu bình luận cho video này.</div>`;
  }
}

function renderComments() {
  if (!currentComments.length) {
    els.commentsList.innerHTML = `<div class="empty-state">Không có bình luận.</div>`;
    return;
  }

  const dir = commentSortDir === "asc" ? 1 : -1;
  const sorted = [...currentComments].sort((a, b) => {
    let av = a[commentSortField];
    let bv = b[commentSortField];
    if (commentSortField === "publishedAt") {
      av = new Date(av).getTime();
      bv = new Date(bv).getTime();
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  els.commentsList.innerHTML = sorted
    .map(
      (c, i) => `
    <div class="comment" data-idx="${i}">
      <div class="comment__head">
        <img class="comment__avatar" src="${c.authorImage}" alt="" loading="lazy" />
        <span class="comment__author">${escapeHtml(c.author)}</span>
        <span class="comment__date">${fmtDate(c.publishedAt)}</span>
      </div>
      <div class="comment__text">${escapeHtml(c.text)}</div>
      <div class="comment__footer">
        <span class="comment__likes">♥ ${fmtNumber(c.likeCount)} lượt thích</span>
        <button class="translate-btn" data-idx="${i}">Dịch sang Tiếng Việt</button>
      </div>
      <div class="comment__translation" id="translation-${i}"></div>
    </div>`
    )
    .join("");

  els.commentsList.querySelectorAll(".translate-btn").forEach((btn) => {
    btn.addEventListener("click", () => translateComment(sorted, btn.dataset.idx));
  });
}

async function translateComment(sortedList, idx) {
  const comment = sortedList[idx];
  const box = document.getElementById(`translation-${idx}`);
  box.classList.add("visible");
  box.textContent = "Đang dịch...";

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${encodeURIComponent(
      comment.text
    )}`;
    const res = await fetch(url);
    const json = await res.json();
    const translated = json[0].map((chunk) => chunk[0]).join("");
    box.textContent = translated;
  } catch (err) {
    box.innerHTML = `Không dịch được tự động. <a href="https://translate.google.com/?sl=auto&tl=vi&text=${encodeURIComponent(
      comment.text
    )}&op=translate" target="_blank" rel="noopener">Mở Google Dịch</a>`;
  }
}

function closeModal() {
  els.modalOverlay.classList.remove("open");
}

// ---------- Events ----------

els.search.addEventListener("input", applyFilters);

els.sortField.addEventListener("change", () => {
  sortField = els.sortField.value;
  applyFilters();
});

els.sortDir.addEventListener("click", () => {
  sortDir = sortDir === "asc" ? "desc" : "asc";
  els.sortDir.dataset.dir = sortDir;
  els.sortDir.querySelector(".dir-btn__arrow").textContent = sortDir === "asc" ? "↑" : "↓";
  els.sortDir.lastChild.textContent = sortDir === "asc" ? " Tăng dần" : " Giảm dần";
  applyFilters();
});

document.querySelectorAll(".board-table thead th[data-field]").forEach((th) => {
  th.addEventListener("click", () => {
    const field = th.dataset.field;
    els.sortField.value = field;
    sortField = field;
    applyFilters();
  });
});

els.commentSortField.addEventListener("change", () => {
  commentSortField = els.commentSortField.value;
  renderComments();
});

els.commentSortDir.addEventListener("click", () => {
  commentSortDir = commentSortDir === "asc" ? "desc" : "asc";
  els.commentSortDir.dataset.dir = commentSortDir;
  els.commentSortDir.querySelector(".dir-btn__arrow").textContent = commentSortDir === "asc" ? "↑" : "↓";
  renderComments();
});

els.modalClose.addEventListener("click", closeModal);
els.modalOverlay.addEventListener("click", (e) => {
  if (e.target === els.modalOverlay) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

loadData();
