// Helper fetch error handling
async function fetchData(url) {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('Gagal memuat data');
    return await res.json();
  } catch (err) {
    console.error('Error fetchData:', err);
    throw err;
  }
}

// konversi array ke objek
function arrayToObjects(data) {
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  });
}

// Chart global
let workloadChart, avgDeptBarChart, kpiPersonalLineChart;
let currentUser = null; // simpan user login
const personalColors = {};

function getRandomColor() {
  const r = Math.floor(Math.random() * 200) + 30;
  const g = Math.floor(Math.random() * 200) + 30;
  const b = Math.floor(Math.random() * 200) + 30;
  return `rgb(${r},${g},${b})`;
}

// set ukuran chart
function setChartSize(canvasId, width = 600, height = 400) {
  const ctx = document.getElementById(canvasId);
  ctx.width = width;
  ctx.height = height;
  return ctx.getContext('2d');
}

// Load Dashboard utama
async function loadDashboard(department = 'ALL', month = 'ALL', employee = 'ALL') {
  try {
    await populateFilters();
    await loadKomentar();
    await Promise.all([ loadRankingDept(), loadRankingEmployee() ]);

    const [
      kpiPersonalDataRaw,
      workloadDataRaw,
      indikatorPersonalDataRaw,
      sasaranMutuDataRaw
    ] = await Promise.all([
      fetchData('/api/kpi_personal'),
      fetchData('/api/workload'),
      fetchData('/api/indikatorpersonal'),
      fetchData('/api/sasaranmutu')
    ]);

    // ===== Normalisasi (sama seperti sebelumnya) =====
    let kpiPersonalData = Array.isArray(kpiPersonalDataRaw[0]) ? arrayToObjects(kpiPersonalDataRaw) : kpiPersonalDataRaw;
    let indikatorPersonalDataLocal = Array.isArray(indikatorPersonalDataRaw[0]) ? arrayToObjects(indikatorPersonalDataRaw) : indikatorPersonalDataRaw;
    let workloadData = workloadDataRaw;
    let sasaranMutuData = Array.isArray(sasaranMutuDataRaw[0]) ? arrayToObjects(sasaranMutuDataRaw) : sasaranMutuDataRaw;

    // Normalisasi field Sasaran Mutu (tetap)
    sasaranMutuData = sasaranMutuData.map(d => ({
      ...d,
      Department: d.Department || d.Departemen || d.Departement || "",
      Bulan: d.Bulan || "",
      Indikator: d.Indikator || ""
    }));

    // Role login
    const role = (currentUser?.role || "").toLowerCase();
    const userDept = currentUser?.department || "";

    // 🔹 Staff hanya lihat dept nya
    if (role === "staff") {
      department = userDept;
      kpiPersonalData = kpiPersonalData.filter(d => d.Departemen === userDept);
      indikatorPersonalDataLocal = indikatorPersonalDataLocal.filter(d => d.Departemen === userDept);
      workloadData = workloadData.filter(d => d.Department === userDept);
      sasaranMutuData = sasaranMutuData.filter(d => d.Department === userDept);
    }

    // Filter awal berdasarkan argumen function (masih berfungsi)
    if (department !== 'ALL' && department !== '') {
      indikatorPersonalDataLocal = indikatorPersonalDataLocal.filter(d => d.Departemen === department);
    }
    if (month !== 'ALL' && month !== '') {
      indikatorPersonalDataLocal = indikatorPersonalDataLocal.filter(d => d.Bulan === month);
    }
    if (employee !== 'ALL' && employee !== '') {
      indikatorPersonalDataLocal = indikatorPersonalDataLocal.filter(d => d.Personal === employee);
    }

    // Filter Workload
    if (department !== 'ALL' && department !== '') {
      workloadData = workloadData.filter(d => d.Department === department);
    }

    // Filter Sasaran Mutu
    if (department !== 'ALL' && department !== '') {
      sasaranMutuData = sasaranMutuData.filter(d => d.Department === department);
    }
    if (month !== 'ALL' && month !== '') {
      sasaranMutuData = sasaranMutuData.filter(d => d.Bulan === month);
    } else {
      const urutanBulan = [
        "Januari","Februari","Maret","April","Mei","Juni",
        "Juli","Agustus","September","Oktober","November","Desember"
      ];
      const bulanUnik = [...new Set(sasaranMutuData.map(d => d.Bulan))];
      const bulanTerakhir = bulanUnik.sort(
        (a, b) => urutanBulan.indexOf(a) - urutanBulan.indexOf(b)
      ).pop();
      sasaranMutuData = sasaranMutuData.filter(d => d.Bulan === bulanTerakhir);
    }

    // Simpan data master untuk referensi filter (global)
    indikatorPersonalData = indikatorPersonalDataLocal; // <-- IMPORTANT: set global
    sasaranMutuDataMaster = [...sasaranMutuData];

    // ===========================
    // Workload chart preparation
    // ===========================
    const monthSelected = (month !== 'ALL' && month !== '') ? month.toUpperCase() : 'AGUSTUS';
    const workloadChartData = workloadData.map(d => ({
      name: d.Name,
      workload: parseFloat(String(d[monthSelected]).replace(',', '.')) || 0
    }));

    const deptMap = {};
    workloadData.forEach(d => {
      const dept = d.Department || 'Unknown';
      const val = parseFloat(String(d[monthSelected]).replace(',', '.')) || 0;
      if (!deptMap[dept]) deptMap[dept] = { total: 0, count: 0 };
      deptMap[dept].total += val;
      deptMap[dept].count += 1;
    });

    // ===========================
    // Render semua tabel & chart
    // ===========================
    updateEmployeeFilterOptions(department);
    updateKpiSummary(kpiPersonalData, currentUser, department, month);

    // Ranking Dept (sama seperti semula)
    let rankingDeptData = [...kpiPersonalData];
    if (!(role.includes("admin") || role.includes("head"))) {
      if (department !== 'ALL' && department !== '') {
        rankingDeptData = rankingDeptData.filter(d => d.Departemen === department);
      }
    }

    // Isi dropdown filter indikator berdasarkan data yang sudah dinormalisasi
    populateIndikatorFilters(indikatorPersonalData);

    // Render indikator personal dari data yang sudah dinormalisasi (bukan lastDataRendered)
    renderIndikatorPersonalTable(indikatorPersonalData, role);

    // Pasang listener tombol filter (jika belum terpasang)
    const btn = document.getElementById("btnFilter");
    if (btn && !btn.dataset.listenerAttached) {
      btn.addEventListener("click", () => {
        const filtered = filterIndikatorPersonal(indikatorPersonalData);
        renderIndikatorPersonalTable(filtered, role);
      });
      btn.dataset.listenerAttached = "1";
    }

    // Render workload & charts
    renderWorkloadChart(workloadChartData);
    renderAvgDeptBarChart(
      Object.keys(deptMap),
      Object.keys(deptMap).map(dept => deptMap[dept].total / deptMap[dept].count)
    );
    renderKpiPersonalLineChart(kpiPersonalData);

    // Ranking Employee (sama seperti semula)
    let rankingEmployeeData = [...kpiPersonalData];
    if (!(role.includes("admin") || role.includes("head"))) {
      if (department !== 'ALL' && department !== '') {
        rankingEmployeeData = rankingEmployeeData.filter(d => d.Departemen === department);
      }
      if (employee !== 'ALL' && employee !== '') {
        rankingEmployeeData = rankingEmployeeData.filter(d => d.Personal === employee);
      }
    }

    // Isi dropdown departemen Sasaran Mutu & render
    populateDeptSarmutFilter();
    renderSasaranMutuTable(sasaranMutuData);

    // Debug
    console.log("=== DEBUG DATA LOADED ===");
    console.log("KPI Personal Data (5 pertama):", kpiPersonalData.slice(0, 5));
    console.log("Indikator Personal Data (5 pertama):", indikatorPersonalData.slice(0, 5));
    console.log("Workload Data (5 pertama):", workloadData.slice(0, 5));
    console.log("Sasaran Mutu Data (5 pertama):", sasaranMutuData.slice(0, 5));
    console.log("===========================");
  } catch (err) {
    alert('Gagal memuat data KPI: ' + err.message);
    console.error(err);
  }
}
    function logout() {
      alert('Logout clicked!');
    }

async function loadRankingDept() {
  const tbody = document.getElementById("rankingDeptTableBody");
  tbody.innerHTML =
    `<tr><td colspan="3" class="text-center py-4 text-gray-500">Loading...</td></tr>`;

  try {
    const res = await fetch("/api/ranking_dept", { credentials: "include" });
    if (!res.ok) throw new Error("Gagal fetch ranking dept");
    const response = await res.json();
    
    // ✅ Ambil data dari response yang baru
    const data = response.rankings || response; // backward compatible
    const currentUser = response.currentUser || {};
    
    const isHead = currentUser.role?.toLowerCase() === "head";
    const userDept = currentUser.department || "";

    tbody.innerHTML = "";

    if (!data || data.length === 0) {
      tbody.innerHTML =
        `<tr><td colspan="3" class="text-center py-4 text-gray-500">Tidak ada data KPI</td></tr>`;
      return;
    }

    data.forEach((r) => {
      const tr = document.createElement("tr");

      // 🎨 Warna baris berdasarkan ranking
      let rankClass = "";
      if (r.rank === 1) rankClass = "bg-yellow-100 font-bold text-yellow-800";
      else if (r.rank === 2) rankClass = "bg-gray-200 font-bold text-gray-800";
      else if (r.rank === 3) rankClass = "bg-orange-100 font-bold text-orange-800";
      else rankClass = r.rank % 2 === 0 ? "bg-white" : "bg-gray-50";

      // 🔒 Cek apakah dept ini bisa diklik
      const isClickable = !isHead || r.department.toLowerCase().trim() === userDept.toLowerCase().trim();
      const cursorClass = isClickable 
        ? "cursor-pointer hover:bg-gray-100" 
        : "cursor-not-allowed opacity-50";

      tr.className = `${rankClass} ${cursorClass} text-center text-base transition-opacity`;

      const avg = r.avgKpi && !isNaN(r.avgKpi)
        ? Number(r.avgKpi).toFixed(2)
        : "-";

      tr.innerHTML = `
        <td class="px-4 py-2">${r.department}</td>
        <td class="px-4 py-2">${avg}</td>
        <td class="px-4 py-2">
          ${r.rank}
          ${r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : ""}
        </td>
      `;

      // ➡️ Klik baris departemen → tampilkan Summary (dengan validasi)
      tr.addEventListener("click", () => {
        if (isHead && r.department.toLowerCase().trim() !== userDept.toLowerCase().trim()) {
          // 🚫 Head tidak bisa klik dept lain
          alert(`Anda hanya dapat melihat data departemen ${userDept}`);
          return;
        }
        showDeptSummary(r.department);
      });

      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error loadRankingDept:", err);
    tbody.innerHTML =
      `<tr><td colspan="3" class="text-center py-4 text-red-500">Error load ranking dept</td></tr>`;
  }
}

async function showDeptSummary(deptName) {
  document.getElementById("rankingSection").classList.add("hidden");
  document.getElementById("deptSummarySection").classList.remove("hidden");
  document.getElementById("deptTitle").textContent =
    `Summary Departemen: ${deptName}`;

  const container = document.getElementById("summaryContainer");
  container.innerHTML = '<p class="text-gray-400">Memuat...</p>';

  try {
    const res = await fetch(`/api/dept-summary?dept=${encodeURIComponent(deptName)}`);
    
    if (!res.ok) {
      if (res.status === 403) {
        throw new Error("Anda tidak memiliki akses ke departemen ini");
      }
      throw new Error("Gagal mengambil data summary");
    }
    
    const data = await res.json();

    // ✅ Tampilkan Nilai KPI Head dengan Grade
    const nilaiKpiHead = data.nilaiKpiHead != null ? Number(data.nilaiKpiHead).toFixed(2) : '0.00';
    const grade = data.grade || {};
    
    document.getElementById("nilaiKpiHead").textContent = nilaiKpiHead;
    
    // ✅ Tambahkan Grade Display
    const gradeDisplay = document.getElementById("gradeDisplay");
    if (gradeDisplay) {
      gradeDisplay.innerHTML = `
        <div class="flex items-center justify-center gap-4 flex-wrap">
          <!-- Grade Badge -->
          <div class="inline-flex items-center gap-3 px-6 py-4 rounded-2xl shadow-lg" 
               style="background-color: ${grade.bgColor}; border: 3px solid ${grade.color};">
            <div class="text-center">
              <div class="text-5xl font-black" style="color: ${grade.color};">${grade.grade}</div>
              <div class="text-sm font-semibold mt-1" style="color: ${grade.color};">${grade.label}</div>
            </div>
          </div>
          
          <!-- Persentase -->
          <div class="inline-flex items-center gap-3 px-6 py-4 bg-white dark:bg-gray-700 rounded-2xl shadow-lg">
            <i class="fas fa-chart-line text-3xl" style="color: ${grade.color};"></i>
            <div>
              <div class="text-sm text-gray-600 dark:text-gray-400">Persentase</div>
              <div class="text-3xl font-bold" style="color: ${grade.color};">${data.persentase}%</div>
              <div class="text-xs text-gray-500">(${grade.percentageRange})</div>
            </div>
          </div>
        </div>
      `;
    }

    // Cards untuk komponen KPI
    const cards = [
      { label: "KPI Team / Average", value: data.avgKpi },
      { label: "Ach Sasaran Mutu", value: data.achSasaranMutu },
      { label: "Ach Project", value: data.achProject },
      { label: "Nilai Pimpinan", value: data.nilaiPimpinan },
      { label: "Kehadiran / Kedisiplinan", value: data.kehadiran }
    ];

    container.innerHTML = "";
    cards.forEach((c) => {
      const div = document.createElement("div");
      div.className =
        "bg-white dark:bg-gray-800 rounded-2xl shadow p-6 text-center";
      div.innerHTML = `
        <h3 class="text-lg font-semibold mb-2">${c.label}</h3>
        <p class="text-3xl font-bold text-blue-600">
          ${c.value != null ? Number(c.value).toFixed(2) : '-'}
        </p>
      `;
      container.appendChild(div);
    });

    await loadRankingEmployee(deptName);
    await loadKpiLineChartByDept(deptName);

  } catch (err) {
    console.error("Error showDeptSummary:", err);
    container.innerHTML =
      `<p class="text-red-500">${err.message || 'Terjadi kesalahan saat memuat data summary.'}</p>`;
    
    if (err.message.includes("tidak memiliki akses")) {
      setTimeout(() => {
        document.getElementById("deptSummarySection").classList.add("hidden");
        document.getElementById("rankingSection").classList.remove("hidden");
      }, 2000);
    }
  }
}

// tombol kembali
document.getElementById("backToRanking").addEventListener("click", () => {
  document.getElementById("deptSummarySection").classList.add("hidden");
  document.getElementById("rankingSection").classList.remove("hidden");
});

async function loadRankingEmployee(deptName = null) {
  const tbody = document.getElementById("rankingEmployeeTableBody");
  tbody.innerHTML =
    `<tr><td colspan="4" class="text-center py-4 text-gray-500">Loading...</td></tr>`;

  try {
    // ✅ Selalu load SEMUA karyawan (tanpa filter dept)
    const url = `/api/ranking_employee`;
    const res = await fetch(url, { credentials: "include" });

    if (!res.ok) throw new Error("Gagal fetch ranking employee");

    let data = await res.json();
    
    // ✅ Filter di frontend jika deptName ada (untuk summary dept)
    if (deptName) {
      data = data.filter(r => 
        r.dept.toLowerCase().trim() === deptName.toLowerCase().trim()
      );
    }
    
    tbody.innerHTML = "";

    if (!data || data.length === 0) {
      tbody.innerHTML =
        `<tr><td colspan="4" class="text-center py-4 text-gray-500">Tidak ada data KPI</td></tr>`;
      return;
    }

    data.forEach((r) => {
      const tr = document.createElement("tr");
      let rankClass = "";
      if (r.rank === 1) rankClass = "bg-yellow-100 font-bold text-yellow-800";
      else if (r.rank === 2) rankClass = "bg-gray-200 font-bold text-gray-800";
      else if (r.rank === 3) rankClass = "bg-orange-100 font-bold text-orange-800";
      else rankClass = r.rank % 2 === 0 ? "bg-white" : "bg-gray-50";

      tr.className = `${rankClass} hover:bg-gray-100 text-center text-base`;
      const avg =
        r.avgKpi && !isNaN(r.avgKpi) ? Number(r.avgKpi).toFixed(2) : "-";

      tr.innerHTML = `
        <td class="px-4 py-2 font-bold">
          ${r.rank}
          ${r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : ""}
        </td>
        <td class="px-4 py-2 font-bold">${r.personal}</td>
        <td class="px-4 py-2">${r.dept || "-"}</td>
        <td class="px-4 py-2 font-bold">${avg}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error loadRankingEmployee:", err);
    tbody.innerHTML =
      `<tr><td colspan="4" class="text-center py-4 text-red-500">Error load ranking employee</td></tr>`;
  }
}

let komentarStore = {};  
let currentRowId = null;  
let lastDataRendered = []; 
let currentUserRole = window.userRole || "admin"; // role dikirim dari backend ke FE

// =======================
// 📌 Status KPI berdasarkan nilai
// =======================
function getStatusKPI(nilai) {
  const n = parseFloat(nilai);
  if (isNaN(n)) return "-";
  if (n <= 80) return "Under";
  if (n <= 90) return "Within";
  return "Upper";
}

let indikatorPersonalData = [];

// =======================
// 📌 Render tabel indikator personal
// =======================
function renderIndikatorPersonalTable(data, role = "head") {
  const tbody = document.getElementById("indikatorPersonalTableBody");
  tbody.innerHTML = "";

  if (!data || data.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="16" class="text-center py-4 text-gray-500 text-lg">Tidak ada data indikator personal</td></tr>';
    return;
  }

  // Kelompokkan berdasarkan Personil + Dept + Bulan
  const grouped = {};
  data.forEach((item) => {
    const key = `${item.Personil}_${item.Departement || item.Departemen}_${item.Bulan}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  });

  Object.keys(grouped).forEach((key) => {
    const rows = grouped[key];
    const rowspan = rows.length;

    rows.forEach((item, idx) => {
      const tr = document.createElement("tr");
      tr.className = `${idx % 2 === 0 ? "bg-white" : "bg-gray-100"} hover:bg-gray-200 border-b`;

      // Helper <td>
      const td = (text, extra = "", opt = {}) => {
        const el = document.createElement("td");
        el.className = `px-2 py-1 border text-sm ${extra}`;
        if (opt.rowspan) el.rowSpan = rowspan;
        el.textContent = text || "-";
        return el;
      };

      if (idx === 0) tr.appendChild(td(item.Personil, "text-center font-bold", { rowspan }));
      tr.appendChild(td(item.Indikator));
      if (idx === 0) tr.appendChild(td(item.Departement || item.Departemen, "text-center", { rowspan }));
      if (idx === 0) tr.appendChild(td(item.Bulan, "text-center", { rowspan }));

      tr.appendChild(td(item.Bobot));
      tr.appendChild(td(item["Total Task WL"]));

      // Status KPI untuk Project / Administrasi / Umum
      const makeCell = (val) => {
        const tdEl = document.createElement("td");
        tdEl.className = "px-2 py-1 border text-center";
        const status = getStatusKPI(val);
        if (status === "Under") tdEl.classList.add("text-red-600", "font-bold");
        else if (status === "Within") tdEl.classList.add("text-blue-600");
        else if (status === "Upper") tdEl.classList.add("text-green-600", "font-semibold");
        tdEl.textContent = val ?? "-";
        return tdEl;
      };

      tr.appendChild(makeCell(item.Project));
      tr.appendChild(makeCell(item.Administrasi));
      tr.appendChild(makeCell(item.Umum));

      tr.appendChild(td(item.Target));
      tr.appendChild(td(item["% ACH"] || item["% Ach"]));
      tr.appendChild(td(item.NilaiIndikator));

      if (idx === 0) tr.appendChild(td(item["Nilai KPI"], "text-center font-bold", { rowspan }));

      // Kolom aksi komentar (hanya untuk head & admin)
      if (idx === 0 && (role === "head" || role === "admin")) {
        const tdBtn = document.createElement("td");
        tdBtn.rowSpan = rowspan;
        tdBtn.className = "px-2 py-1 border text-center";

        const btn = document.createElement("button");
        btn.textContent = "💬 Komentar";
        btn.className = "px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600";
        btn.onclick = () => openKomentarModal(key, item.Departement || item.Departemen, item.Bulan, item.Personil);

        tdBtn.appendChild(btn);
        tr.appendChild(tdBtn);
      }

      tbody.appendChild(tr);
    });
  });
}

// =======================
// 📌 Isi opsi filter
// =======================
function populateIndikatorFilters(data) {
  const deptSel = document.getElementById("filterDept");
  const monthSel = document.getElementById("filterMonth");

  const reset = (el, label) => {
    el.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "ALL";
    opt.textContent = label;
    el.appendChild(opt);
  };

  reset(deptSel, "Semua Departemen");
  reset(monthSel, "Semua Bulan");

  const depts = [...new Set(data.map((d) => d.Departement || d.Departemen).filter(Boolean))];
  const months = [...new Set(data.map((d) => d.Bulan).filter(Boolean))];

  depts.forEach((v) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    deptSel.appendChild(o);
  });
  months.forEach((v) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    monthSel.appendChild(o);
  });
}

// =======================
// 📌 Filtering
// =======================
function filterIndikatorPersonal(data) {
  const dept = document.getElementById("filterDept").value;
  const month = document.getElementById("filterMonth").value;
  const status = document.getElementById("filterStatus").value;

  return data.filter((d) => {
    const deptMatch = dept === "ALL" || d.Departement === dept || d.Departemen === dept;
    const monthMatch = month === "ALL" || d.Bulan === month;
    const nilai = d["Nilai KPI"] || d.NilaiKPI;
    const stat = getStatusKPI(nilai);
    const statusMatch = status === "ALL" || stat === status;
    return deptMatch && monthMatch && statusMatch;
  });
}

// =======================
// 📌 KOMENTAR MODAL
// =======================
function renderKomentarTable(rowId) {
  const body = document.getElementById("komentarTableBody");
  if (!body) return;

  const list = komentarStore[rowId] || [];
  body.innerHTML = "";

  if (list.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="3" class="p-4 text-center text-gray-500 dark:text-gray-400 italic">
          <i class="fas fa-comments-slash mr-2"></i>No comments yet
        </td>
      </tr>
    `;
    return;
  }

  list.forEach((k, index) => {
    const tr = document.createElement("tr");
    tr.className = index % 2 === 0 ? 'bg-gray-50 dark:bg-gray-700' : 'bg-white dark:bg-gray-800';
    tr.innerHTML = `
      <td class="px-4 py-3 border-r border-gray-200 dark:border-gray-600 font-medium text-gray-800 dark:text-gray-200">${k.oleh}</td>
      <td class="px-4 py-3 border-r border-gray-200 dark:border-gray-600 text-center text-sm text-gray-600 dark:text-gray-400">${k.tanggal}</td>
      <td class="px-4 py-3 text-gray-700 dark:text-gray-300">${k.isi}</td>
    `;
    body.appendChild(tr);
  });
}

function openKomentarModal(rowId, department, bulan, personal) {
  const modal = document.getElementById("komentarModal");
  if (!modal) return;

  modal.dataset.rowId = rowId;
  modal.dataset.department = department;
  modal.dataset.bulan = bulan;
  modal.dataset.personal = personal;

  document.getElementById("komentarInput").value = "";
  renderKomentarTable(rowId);
  modal.classList.remove("hidden");
  modal.classList.add("flex", "items-center", "justify-center");

  setTimeout(() => {
    document.getElementById("komentarInput").focus();
  }, 100);
}

function closeKomentarModal() {
  const modal = document.getElementById("komentarModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex", "items-center", "justify-center");
    modal.dataset.rowId = "";
    modal.dataset.department = "";
    modal.dataset.bulan = "";
    modal.dataset.personal = "";
    document.getElementById("komentarInput").value = "";
  }
}

async function saveKomentar() {
  const komentar = document.getElementById("komentarInput").value.trim();
  if (!komentar) {
    showNotification('Invalid Input', 'Comment cannot be empty!', 'warning');
    return;
  }

  const modal = document.getElementById("komentarModal");
  if (!modal) return;

  const rowId = modal.dataset.rowId;
  const department = modal.dataset.department;
  const bulan = modal.dataset.bulan;
  const personal = modal.dataset.personal;

  try {
    const saveBtn = document.querySelector('#komentarModal button[onclick="saveKomentar()"]');
    const originalText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
    saveBtn.disabled = true;

    const res = await fetch("/api/komentar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ rowId, department, bulan, komentar, personal }),
    });

    const result = await res.json();

    saveBtn.innerHTML = originalText;
    saveBtn.disabled = false;

    if (result.success) {
      if (!komentarStore[rowId]) komentarStore[rowId] = [];
      const newKomen = {
        isi: komentar,
        oleh: result.user || "Admin",
        tanggal: result.tanggal || new Date().toLocaleDateString('id-ID'),
      };
      komentarStore[rowId].push(newKomen);

      document.getElementById("komentarInput").value = "";
      renderKomentarTable(rowId);

      showNotification('Success', 'Comment added successfully', 'success');
    } else {
      showNotification('Error', result.error || 'Failed to save comment', 'error');
    }
  } catch (err) {
    console.error("Error save komentar:", err);
    showNotification('Error', 'Network error while saving comment', 'error');
  }
}

async function loadKomentar() {
  try {
    const res = await fetch("/api/komentar", { credentials: "include" });
    if (!res.ok) throw new Error('Failed to load comments');

    const data = await res.json();
    komentarStore = {};

    data.forEach((k) => {
      if (!komentarStore[k.rowId]) komentarStore[k.rowId] = [];
      komentarStore[k.rowId].push({
        isi: k.komentar,
        oleh: k.dibuatOleh,
        tanggal: new Date(k.tanggal).toLocaleDateString('id-ID'),
      });
    });

    console.log("Comments loaded:", Object.keys(komentarStore).length, "rows");
  } catch (err) {
    console.error("Failed to load comments:", err);
    showNotification('Warning', 'Failed to load existing comments', 'warning');
  }
}

// =======================
// 📌 NOTIFIKASI
// =======================
function showNotification(title, message, type = "info", timeout = 5000) {
  const notif = document.getElementById("komentarNotif");
  if (!notif) return;

  document.getElementById("notifTitle").textContent = title;
  document.getElementById("notifBody").textContent = message;

  notif.classList.remove("hidden", "border-blue-600", "border-green-600", "border-yellow-600", "border-red-600");
  if (type === "success") notif.classList.add("border-green-600");
  else if (type === "warning") notif.classList.add("border-yellow-600");
  else if (type === "error") notif.classList.add("border-red-600");
  else notif.classList.add("border-blue-600");

  notif.style.opacity = "1";
  notif.style.transform = "translateY(0)";
  setTimeout(() => closeNotification(), timeout);
}

function closeNotification() {
  const notif = document.getElementById("komentarNotif");
  if (!notif) return;
  notif.style.opacity = "0";
  notif.style.transform = "translateY(-20px)";
  setTimeout(() => notif.classList.add("hidden"), 300);
}

// =======================
// 📌 INIT
// =======================
document.addEventListener("DOMContentLoaded", async () => {
  await loadKomentar();

  if (indikatorPersonalData.length === 0) {
    try {
      const res = await fetch("/api/indikatorpersonal");
      indikatorPersonalData = await res.json();
    } catch (err) {
      console.error("Failed load indikator personal:", err);
    }
  }

  populateIndikatorFilters(indikatorPersonalData);
  renderIndikatorPersonalTable(indikatorPersonalData, currentUserRole);

  ["filterDept", "filterMonth", "filterStatus"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("change", () => {
        const filtered = filterIndikatorPersonal(indikatorPersonalData);
        renderIndikatorPersonalTable(filtered, currentUserRole);
      });
    }
  });
});

    async function loadKomentar() {
      try {
        const res = await fetch("/api/komentar", { credentials: "include" });
        if (!res.ok) throw new Error('Failed to load comments');
        
        const data = await res.json();
        komentarStore = {};

        data.forEach((k) => {
          if (!komentarStore[k.rowId]) komentarStore[k.rowId] = [];
          komentarStore[k.rowId].push({
            isi: k.komentar,
            oleh: k.dibuatOleh,
            tanggal: new Date(k.tanggal).toLocaleDateString('id-ID'),
          });
        });

        console.log("Comments loaded successfully:", Object.keys(komentarStore).length, "rows");
      } catch (err) {
        console.error("Failed to load comments:", err);
        showNotification('Warning', 'Failed to load existing comments', 'warning');
      }
    }

function setChartSize(canvasId) {
  return document.getElementById(canvasId).getContext('2d');
}

let selectedDept = null;   // simpan dept yang dipilih
let selectedPersonal = null; // simpan personal yang dipilih

  // Workload Chart
  function renderWorkloadChart(data) {
  if (workloadChart) workloadChart.destroy();

  const labels = data.map(d => d.name);
  const values = data.map(d => d.workload);

  const ctx = setChartSize('workloadChart');

  workloadChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Workload',
        data: values,
        backgroundColor: labels.map(name =>
          name === selectedPersonal ? 'rgba(234,179,8,0.8)' : 'rgba(34,197,94,0.7)'
        ),
        borderRadius: 5
      }]
    },
    options: {
      responsive: true,              // ✅ Ubah ke true
      maintainAspectRatio: true,     // ✅ Tambahkan ini
      aspectRatio: 2,                // ✅ Rasio 2:1 (lebar:tinggi)
      onClick: (evt, elements) => {
        if (elements.length > 0) {
          const idx = elements[0].index;
          const personal = labels[idx];

          if (selectedPersonal === personal) {
            selectedPersonal = null;
            loadDashboard('ALL', 'ALL', 'ALL');
          } else {
            selectedPersonal = personal;
            loadDashboard('ALL', 'ALL', personal);
          }

          renderWorkloadChart(data);
        }
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: 'end',
          align: 'end',
          color: '#000000',
          font: { weight: 'bold', size: 14 }, // ✅ Turunkan sedikit
          formatter: value => value.toFixed(2)
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { 
            color: 'black', 
            font: { weight: 'bold', size: 12 }
          },
          grid: { color: '#ffffffff' }
        },
        x: {
          ticks: { 
            color: 'black', 
            font: { weight: 'bold', size: 12 },
            maxRotation: 45,        // ✅ Rotasi label kalau terlalu panjang
            minRotation: 45
          },
          grid: { display: false }
        }
      }
    },
    plugins: [ChartDataLabels]
  });
}

// Update renderAvgDeptBarChart
function renderAvgDeptBarChart(labels, values) {
  if (avgDeptBarChart) avgDeptBarChart.destroy();
  const ctx = setChartSize('avgDeptBarChart');

  avgDeptBarChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Rata-rata Workload per Departemen',
        data: values,
        backgroundColor: labels.map(dept =>
          dept === selectedDept ? 'rgba(234,179,8,0.8)' : 'rgba(59,130,246,0.7)'
        )
      }]
    },
    options: {
      responsive: true,              // ✅ Ubah ke true
      maintainAspectRatio: true,     // ✅ Tambahkan ini
      aspectRatio: 2,                // ✅ Rasio 2:1
      onClick: (evt, elements) => {
        if (elements.length > 0) {
          const idx = elements[0].index;
          const dept = labels[idx];

          if (selectedDept === dept) {
            selectedDept = null;
            loadDashboard('ALL', 'ALL', 'ALL');
          } else {
            selectedDept = dept;
            loadDashboard(dept, 'ALL', 'ALL');
          }

          renderAvgDeptBarChart(labels, values);
        }
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: 'end',
          align: 'end',
          color: '#000000',
          font: { weight: 'bold', size: 14 },
          formatter: value => value.toFixed(2)
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { 
            color: 'black', 
            font: { weight: 'bold', size: 12 }
          },
          grid: { color: '#ffffffff' }
        },
        x: {
          ticks: { 
            color: 'black', 
            font: { weight: 'bold', size: 12 }
          },
          grid: { display: false }
        }
      }
    },
    plugins: [ChartDataLabels]
  });
}

// ==============================
// Fetch Sasaran Mutu
// ==============================
async function fetchSasaranMutu(filters = {}) {
  try {
    const res = await fetch("/api/sasaranmutu", { credentials: "include" });
    let data = await res.json();

    if (filters.department) {
      data = data.filter(row => row.Department === filters.department);
    }

    if (filters.bulan && filters.bulan !== "") {
      // Jika user pilih bulan tertentu
      data = data.filter(row => row.Bulan === filters.bulan);
    } else {
      // Jika user tidak pilih bulan → ambil bulan terakhir
      const bulanUnik = [...new Set(data.map(row => row.Bulan))].filter(Boolean);
      const monthOrder = [
        "Januari","Februari","Maret","April","Mei","Juni",
        "Juli","Agustus","September","Oktober","November","Desember"
      ];
      const bulanTerakhir = bulanUnik.sort(
        (a, b) => monthOrder.indexOf(a) - monthOrder.indexOf(b)
      ).pop();

      data = data.filter(row => row.Bulan === bulanTerakhir);
    }

    renderSasaranMutuTable(data);
  } catch (err) {
    console.error("Error fetchSasaranMutu:", err);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  await fetchSasaranMutuSummary(); 
  populateDeptSarmutFilter();      
  filterSasaranMutu();             
});



// ==============================
// Render Table Sasaran Mutu
// ==============================
function renderSasaranMutuTable(data) {
  const tbody = document.getElementById("sasaranMutuBody");
  tbody.innerHTML = "";

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-gray-400 text-lg">Tidak ada data</td></tr>`;
    return;
  }

  let no = 1;
  data.forEach((row, idx) => {
    let programKerjaFormatted = "-";
    if (row["Program Kerja"]) {
      const items = row["Program Kerja"]
        .split(/(?=\d+\.\s)/g)
        .map(item => item.trim())
        .filter(Boolean);
      programKerjaFormatted =
        `<ul class="list-disc pl-5 text-base font-semibold">` +
        items.map(i => `<li>${i}</li>`).join("") +
        `</ul>`;
    }

    const tr = document.createElement("tr");
    tr.className = "hover:bg-gray-100 transition-colors duration-200 text-base font-semibold";

    tr.innerHTML = `
      <td class="border border-gray-400 px-3 py-2 text-center">${no++}</td>
      <td class="border border-gray-400 px-3 py-2 font-bold text-lg">${row["Kriteria"] || "-"}</td>
      <td class="border border-gray-400 px-3 py-2 font-bold text-lg">${row["Sasaran Mutu"] || row["Indikator"] || "-"}</td>
      <td class="border border-gray-400 px-3 py-2 text-center font-bold text-lg">${row["Department"] || "-"}</td>
      <td class="border border-gray-400 px-3 py-2 font-bold text-lg">${row["Cara Perhitungan"] || "-"}</td>
      <td class="border border-gray-400 px-3 py-2 text-center font-bold text-lg">${row["Bulan"] || "-"}</td>
      <td class="border border-gray-400 px-3 py-2 font-bold text-lg">${programKerjaFormatted}</td>
      <td class="border border-gray-400 px-3 py-2 text-center font-bold text-lg">${row["Periode Evaluasi"] || "-"}</td>
      <td class="border border-gray-400 px-3 py-2 text-center font-bold text-lg ${row["Ach"] !== "100%" ? "bg-red-200 text-red-700 font-extrabold" : ""}">
        ${row["Ach"] || "-"}
      </td>
    `;

    tbody.appendChild(tr);
  });
}

function toggleTable(contentId, btn) {
  const el = document.getElementById(contentId);
  if (!el) return;
  el.classList.toggle("hidden");

  const icon = btn.querySelector("i");
  const text = btn.querySelector("span");

  if (el.classList.contains("hidden")) {
    icon.className = "fas fa-plus-square mr-1";
    text.textContent = "Show";
  } else {
    icon.className = "fas fa-minus-square mr-1";
    text.textContent = "Hide";
  }
}

// ============================== 
// SASARAN MUTU SUMMARY & FILTER
// ============================== 
let sasaranMutuSummaryDataMaster = [];
let sasaranMutuDataMaster = [];

async function fetchSasaranMutuSummary() { 
  try { 
    const res = await fetch("/api/sarmutindikator", { credentials: "include" }); 
    sasaranMutuSummaryDataMaster = await res.json(); 
    renderSasaranMutuSummaryTable(sasaranMutuSummaryDataMaster); 
  } catch (err) { 
    console.error("Error fetchSasaranMutuSummary:", err); 
  } 
}

function renderSasaranMutuSummaryTable(data) { 
  const tbody = document.getElementById("sasaranMutuSummaryBody"); 
  if (!tbody) return;
  
  tbody.innerHTML = ""; 
  
  if (!data || data.length === 0) { 
    tbody.innerHTML = `<tr><td colspan="17" class="text-center py-4 text-gray-400 text-lg">Tidak ada data summary</td></tr>`; 
    return; 
  } 
  
  const grouped = {}; 
  data.forEach(row => { 
    const key = row["SASARAN MUTU"]; 
    if (!grouped[key]) grouped[key] = []; 
    grouped[key].push(row); 
  }); 
  
  let no = 1; 
  Object.keys(grouped).forEach(sasaran => { 
    const rows = grouped[sasaran]; 
    const rowspan = rows.length; 
    
    rows.forEach((row, idx) => { 
      const tr = document.createElement("tr"); 
      tr.className = "hover:bg-gray-100 transition-colors duration-200 text-base font-semibold"; 
      tr.innerHTML = `
        ${idx === 0 ? `<td class="border border-gray-400 px-3 py-2 text-center align-middle" rowspan="${rowspan}">${no++}</td>` : ""} 
        ${idx === 0 ? `<td class="border border-gray-400 px-3 py-2 font-bold text-center align-middle" rowspan="${rowspan}">${sasaran}</td>` : ""} 
        ${idx === 0 ? `<td class="border border-gray-400 px-3 py-2 text-center align-middle" rowspan="${rowspan}">${row["DEPT"] || "-"}</td>` : ""} 
        ${idx === 0 ? `<td class="border border-gray-400 px-3 py-2 text-center align-middle" rowspan="${rowspan}">${row["PERIODE EVALUASI"] || "-"}</td>` : ""}
        <td class="border border-gray-400 px-3 py-2 text-center">${row["NAMA PRODUK"] || "-"}</td> 
        <td class="border border-gray-400 px-3 py-2 text-center">${row["KATEGORI"] || "-"}</td> 
        <td class="border border-gray-400 px-3 py-2 text-center">${row["JAN"] || "-"}</td> 
        <td class="border border-gray-400 px-3 py-2 text-center">${row["FEB"] || "-"}</td> 
        <td class="border border-gray-400 px-3 py-2 text-center">${row["MAR"] || "-"}</td> 
        <td class="border border-gray-400 px-3 py-2 text-center">${row["APR"] || "-"}</td> 
        <td class="border border-gray-400 px-3 py-2 text-center">${row["MAY"] || "-"}</td> 
        <td class="border border-gray-400 px-3 py-2 text-center">${row["JUN"] || "-"}</td> 
        <td class="border border-gray-400 px-3 py-2 text-center">${row["JUL"] || "-"}</td> 
        <td class="border border-gray-400 px-3 py-2 text-center">${row["AUG"] || "-"}</td> 
        <td class="border border-gray-400 px-3 py-2 text-center">${row["SEP"] || "-"}</td> 
        <td class="border border-gray-400 px-3 py-2 text-center">${row["OCT"] || "-"}</td> 
        <td class="border border-gray-400 px-3 py-2 text-center">${row["NOV"] || "-"}</td> 
        <td class="border border-gray-400 px-3 py-2 text-center">${row["DEC"] || "-"}</td>
      `; 
      tbody.appendChild(tr); 
    }); 
  }); 
}

// ⭐ EVENT LISTENER untuk Filter Dept - SYNC DENGAN CHART
document.addEventListener("DOMContentLoaded", () => {
  const filterSelect = document.getElementById("filterDeptSarmut");
  
  if (filterSelect) {
    filterSelect.addEventListener("change", (e) => { 
      const dept = e.target.value; 
      
      console.log("🔄 Filter dept changed to:", dept);
      
      // Filter summary table
      filterSasaranMutu(currentSarmutMode);
      
      // Filter indikator table
      if (typeof filterSarmutIndikator === "function") {
        filterSarmutIndikator(currentSarmutMode);
      }
      
      // ⭐ CRITICAL: Show/Hide Chart berdasarkan dept
      if (dept.toUpperCase() === "MKT") {
        fetchChartSarmut(dept);
      } else {
        hideChartSarmut();
      }
    }); 
  }
});

function toggleTable(contentId, btn) { 
  const el = document.getElementById(contentId); 
  if (!el) return; 
  
  el.classList.toggle("hidden"); 
  const icon = btn.querySelector("i"); 
  const text = btn.querySelector("span"); 
  
  if (el.classList.contains("hidden")) { 
    icon.className = "fas fa-plus-square mr-1"; 
    text.textContent = "Show"; 
  } else { 
    icon.className = "fas fa-minus-square mr-1"; 
    text.textContent = "Hide"; 
  } 
}

// ============================== 
// Filter Sasaran Mutu 
// ============================== 
let currentSarmutMode = "ALL"; 
let userRole = window.USER_ROLE || "staff";

function filterSasaranMutu(mode = currentSarmutMode) { 
  if (!sasaranMutuSummaryDataMaster.length) return; 
  
  currentSarmutMode = mode; 
  const dept = document.getElementById("filterDeptSarmut")?.value || "ALL"; 
  
  let filtered = sasaranMutuSummaryDataMaster.filter(row => { 
    const kategori = (row["KATEGORI"] || "").toUpperCase().trim(); 
    return ["% ACH", "ACH", "TARGET"].includes(kategori); 
  }); 
  
  if (dept && dept !== "ALL") { 
    filtered = filtered.filter(
      row => (row["DEPT"] || "").toLowerCase().trim() === dept.toLowerCase().trim() 
    ); 
  } 
  
  const parsePercent = (val) => { 
    if (!val) return 0; 
    const num = parseFloat(String(val).replace("%", "").replace(",", ".").trim()); 
    return isNaN(num) ? 0 : num; 
  }; 
  
  const achRows = filtered.filter(r => (r["KATEGORI"] || "").toUpperCase() === "% ACH"); 
  const achievedKeys = new Set(); 
  
  achRows.forEach(row => { 
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]; 
    const nilai = months.map(k => parsePercent(row[k])).filter(v => v > 0); 
    const isAchieved = nilai.length > 0 && nilai.every(v => v === 100); 
    if (isAchieved) achievedKeys.add(row["SASARAN MUTU"]); 
  }); 
  
  if (mode === "ACHIEVED") { 
    filtered = filtered.filter(r => achievedKeys.has(r["SASARAN MUTU"])); 
  } else if (mode === "NOT_ACHIEVED") { 
    filtered = filtered.filter(r => !achievedKeys.has(r["SASARAN MUTU"])); 
  } 
  
  const uniqueSasaranMutu = new Set(achRows.map(r => r["SASARAN MUTU"]));
  const total = uniqueSasaranMutu.size; 
  const achieved = [...achievedKeys].length; 
  const notAchieved = total - achieved; 
  
  const totalEl = document.getElementById("sarmutTotal");
  const achievedEl = document.getElementById("sarmutAchieved");
  const notAchievedEl = document.getElementById("sarmutNotAchieved");
  
  if (totalEl) totalEl.textContent = total; 
  if (achievedEl) achievedEl.textContent = achieved; 
  if (notAchievedEl) notAchievedEl.textContent = notAchieved; 
  
  renderSasaranMutuSummaryTable(filtered); 
}

function filterSarmutIndikator(mode = currentSarmutMode) { 
  const dept = document.getElementById("filterDeptSarmut")?.value || "ALL"; 
  let dataFiltered = sasaranMutuDataMaster; 
  
  if (dept && dept !== "ALL") { 
    dataFiltered = dataFiltered.filter(row => { 
      const deptName = row["Dept"] || row["DEPT"] || row["Department"] || ""; 
      return deptName.toLowerCase().trim() === dept.toLowerCase().trim(); 
    }); 
  } 
  
  if (typeof renderSasaranMutuIndikatorTable === "function") {
    renderSasaranMutuIndikatorTable(dataFiltered); 
  }
}

function populateDeptSarmutFilter() { 
  const select = document.getElementById("filterDeptSarmut"); 
  if (!select) return; 
  
  const uniqueDepts = [...new Set( 
    sasaranMutuDataMaster.map(row => row["Department"]).filter(Boolean) 
  )]; 
  
  select.innerHTML = `
    <option value="ALL">Semua Departemen</option> 
    ${uniqueDepts.map(d => `<option value="${d}">${d}</option>`).join("")}
  `; 
}

// ============================== 
// Init - Load pertama kali
// ============================== 
window.addEventListener("DOMContentLoaded", async () => { 
  console.log("🚀 Initializing Sasaran Mutu...");
  
  await fetchSasaranMutuSummary(); 
  populateDeptSarmutFilter();
  
  // ⭐ Hide chart by default (hanya tampil jika MKT dipilih)
  const dept = document.getElementById("filterDeptSarmut")?.value || "ALL";
  if (dept.toUpperCase() === "MKT") {
    fetchChartSarmut(dept);
  } else {
    hideChartSarmut();
  }
});

// ============================== 
// CHART SARMUT - Hanya untuk MKT
// ============================== 
let chartSarmutLine = null;
let chartSarmutPercent = null;
let sarmutData = [];

// 🔹 Utility: normalize key
function normalizeKey(str) {
  return (str || "").toString().trim().toLowerCase();
}

// 🔹 Utility: convert "Rp ..." → number
function parseNumber(val) {
  if (!val) return 0;
  let cleaned = val.toString()
    .replace(/[^0-9,-]/g, "") // buang Rp, spasi
    .replace(/\./g, "")       // hapus titik ribuan
    .replace(/,/g, "");       // hapus koma ribuan
  return cleaned ? parseFloat(cleaned) : 0;
}

// 🔹 Utility: format number → Rp.xxx.xxx
function formatRupiah(num) {
  if (isNaN(num)) return "Rp.0";
  return "Rp." + num.toLocaleString("id-ID");
}

// ⭐ FUNGSI UTAMA: Fetch & Render Chart (hanya untuk MKT)
async function fetchChartSarmut(department = "ALL") {
  try {
    // ⭐ CRITICAL: Jangan fetch jika bukan MKT
    if (department.toUpperCase() !== "MKT") {
      console.log("⚠️ Chart Sarmut hanya untuk dept MKT, current dept:", department);
      hideChartSarmut();
      return;
    }

    const res = await fetch("/api/chartsarmut", { credentials: "include" });
    sarmutData = await res.json();

    console.log("✅ chartsarmut data:", sarmutData);
    console.log("✅ chartsarmut data sample:", sarmutData[0]);

    const container = document.getElementById("sarmutCharts");
    if (!container) {
      console.error("❌ Element sarmutCharts tidak ditemukan di HTML!");
      return;
    }

    // Filter data hanya untuk MKT
    const mktData = sarmutData.filter(r => {
      const rDept = normalizeKey(r["DEPT"] || r["Dept"] || r["DEPARTMENT"] || r["Department"] || "");
      return rDept === "mkt";
    });

    if (mktData.length === 0) {
      console.log("⚠️ Tidak ada data untuk dept MKT");
      hideChartSarmut();
      return;
    }

    console.log("🔍 Available columns:", Object.keys(mktData[0] || {}));

    // 🔹 Ambil semua nama produk unik untuk MKT
    const produkList = [
      ...new Set(
        mktData.map(r => {
          const produk = r["Nama Produk"] || r["NAMA PRODUK"] || r["nama produk"] || r["Produk"] || r["PRODUCT"] || r["Product"] || "";
          return produk;
        }).filter(Boolean)
      )
    ];

    console.log("📦 Produk list (MKT):", produkList);

    if (produkList.length === 0) {
      console.warn("⚠️ Tidak ada produk ditemukan untuk MKT");
      hideChartSarmut();
      return;
    }

    // ⭐ Show container
    container.classList.remove("hidden");

    const select = document.getElementById("produkSelect");
    if (!select) {
      console.error("❌ Element produkSelect tidak ditemukan di HTML!");
      return;
    }

    select.innerHTML = produkList.map(p => `<option value="${p}">${p}</option>`).join("");

    // Default: render produk pertama
    renderChart(produkList[0], "MKT");

    // Event listener ganti produk
    select.removeEventListener("change", handleProdukChange); // Hapus listener lama
    select.addEventListener("change", handleProdukChange);

  } catch (err) {
    console.error("❌ Error fetchChartSarmut:", err);
    hideChartSarmut();
  }
}

// ⭐ Handler untuk perubahan produk
function handleProdukChange(e) {
  const dept = document.getElementById("filterDeptSarmut")?.value || "MKT";
  renderChart(e.target.value, dept);
}

// ⭐ HIDE CHART - dipanggil ketika bukan MKT
function hideChartSarmut() {
  const container = document.getElementById("sarmutCharts");
  if (container) {
    container.classList.add("hidden");
  }
  
  // Destroy charts untuk free memory
  if (chartSarmutLine) {
    chartSarmutLine.destroy();
    chartSarmutLine = null;
  }
  if (chartSarmutPercent) {
    chartSarmutPercent.destroy();
    chartSarmutPercent = null;
  }
}

// 🔹 formatter rupiah
const rupiahFmt = val => "Rp." + val.toLocaleString("id-ID");

function renderChart(produk, department = "MKT") {
  console.log("🎯 Rendering chart for produk:", produk, "dept:", department);
  
  // ⭐ SAFETY CHECK: Jangan render jika bukan MKT
  if (department.toUpperCase() !== "MKT") {
    console.log("⚠️ Tidak render chart karena bukan dept MKT");
    hideChartSarmut();
    return;
  }

  // Filter data sesuai dept MKT
  let dataFiltered = sarmutData.filter(r => {
    const rDept = normalizeKey(r["DEPT"] || r["Dept"] || r["DEPARTMENT"] || r["Department"] || "");
    return rDept === "mkt";
  });

  console.log("🔍 Data filtered length:", dataFiltered.length);

  // Cari data ACH dan TARGET untuk produk tertentu
  const achData = dataFiltered.filter(r => {
    const rProduk = normalizeKey(r["NAMA PRODUK"] || r["Nama Produk"] || r["nama produk"] || r["Produk"] || "");
    const rKategori = normalizeKey(r["KATEGORI"] || r["Kategori"] || "");
    return rProduk === normalizeKey(produk) && rKategori === "ach";
  });

  const targetData = dataFiltered.filter(r => {
    const rProduk = normalizeKey(r["NAMA PRODUK"] || r["Nama Produk"] || r["nama produk"] || r["Produk"] || "");
    const rKategori = normalizeKey(r["KATEGORI"] || r["Kategori"] || "");
    return rProduk === normalizeKey(produk) && rKategori === "target";
  });

  console.log("🔍 ACH Data found:", achData.length);
  console.log("🔍 TARGET Data found:", targetData.length);

  if (achData.length === 0 || targetData.length === 0) {
    console.warn("❌ Data ACH atau TARGET tidak ditemukan untuk produk:", produk);
    return;
  }

  const rowAch = achData[0];
  const rowTarget = targetData[0];

  console.log("📋 Row ACH:", rowAch);
  console.log("📋 Row Target:", rowTarget);

  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

  const ach = months.map(m => {
    const val = parseNumber(rowAch?.[m]);
    return val;
  });
  
  const target = months.map(m => {
    const val = parseNumber(rowTarget?.[m]);
    return val;
  });
  
  const percent = months.map((m, i) => {
    const t = target[i] || 0;
    const a = ach[i] || 0;
    return t > 0 ? Math.min((a / t * 100), 100).toFixed(2) : 0;
  });

  console.log("📊 Final - Target:", target, "Ach:", ach, "Percent:", percent);

  // 🔹 Line Chart (Target vs Realisasi)
  const ctx1 = document.getElementById("chartSarmutLine");
  if (!ctx1) {
    console.error("❌ Canvas chartSarmutLine tidak ditemukan!");
    return;
  }

  if (chartSarmutLine) chartSarmutLine.destroy();
  chartSarmutLine = new Chart(ctx1, {
    type: "line",
    data: {
      labels: months,
      datasets: [
        {
          label: "Target",
          data: target,
          borderColor: "rgba(59,130,246,1)",
          backgroundColor: "rgba(59,130,246,0.3)",
          fill: false,
          tension: 0.3,
          pointBackgroundColor: "rgba(59,130,246,1)",
          pointBorderColor: "#000000ff",
          pointRadius: 4
        },
        {
          label: "Realisasi",
          data: ach,
          borderColor: "rgba(16,185,129,1)",
          backgroundColor: "rgba(16,185,129,0.3)",
          fill: false,
          tension: 0.3,
          pointBackgroundColor: "rgba(16,185,129,1)",
          pointBorderColor: "#000000ff",
          pointRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.5,
      interaction: {
        mode: 'point',
        intersect: false
      },
      plugins: {
        legend: { 
          labels: { color: "#000000ff", font: { size: 14 } }
        },
        tooltip: {
          enabled: true,
          mode: 'point',
          bodyFont: { size: 14 },
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${rupiahFmt(ctx.parsed.y)}`
          }
        },
        datalabels: {
          display: false
        }
      },
      scales: {
        x: { ticks: { color: "#000000ff", font: { size: 12 } } },
        y: {
          ticks: {
            color: "#000000ff",
            font: { size: 12 },
            callback: val => rupiahFmt(val)
          },
          beginAtZero: true
        }
      }
    }
  });

  // 🔹 Bar Chart (% Ach)
  const ctx2 = document.getElementById("chartSarmutPercent");
  if (!ctx2) {
    console.error("❌ Canvas chartSarmutPercent tidak ditemukan!");
    return;
  }

  if (chartSarmutPercent) chartSarmutPercent.destroy();
  chartSarmutPercent = new Chart(ctx2, {
    type: "bar",
    data: {
      labels: months,
      datasets: [
        {
          label: "% Ach",
          data: percent,
          backgroundColor: "rgba(234,179,8,0.7)",
          borderColor: "rgba(234,179,8,1)",
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: "#000000ff", font: { size: 14 } } },
        tooltip: {
          bodyFont: { size: 14 },
          callbacks: {
            label: ctx => `% Ach: ${ctx.parsed.y}%`
          }
        },
        datalabels: {
          color: "#000000ff",
          anchor: "end",
          align: "top",
          font: { size: 16, weight: "bold" },
          formatter: function(value) {
            return value > 0 ? value + "%" : '';
          },
          display: function(context) {
            return context.dataset.data[context.dataIndex] > 0;
          }
        }
      },
      scales: {
        x: { ticks: { color: "#000000ff", font: { size: 12 } } },
        y: { 
          ticks: { 
            color: "#000000ff", 
            font: { size: 12 },
            callback: val => val + "%"
          }, 
          beginAtZero: true, 
          max: 100
        }
      }
    }
  });
}

let sarmutIndikatorData = [];
let chartIndikatorLine = null;
let chartIndikatorPercent = null;

// Utility functions
function normalizeKey(str) {
  return (str || "").toString().trim().toLowerCase();
}

function parseNumber(val) {
  if (!val) return 0;
  
  const strVal = val.toString().trim();
  
  // Jika sudah dalam format persen (ada %), ambil angka saja
  if (strVal.includes('%')) {
    let cleaned = strVal.replace(/%/g, '').replace(/[^0-9.,-]/g, '').replace(/,/g, '.');
    return cleaned ? parseFloat(cleaned) : 0;
  }
  
  // Jika dalam format rupiah
  if (strVal.includes('Rp')) {
    let cleaned = strVal.replace(/Rp\s*/g, '').replace(/\./g, '').replace(/,/g, '');
    return cleaned ? parseFloat(cleaned) : 0;
  }
  
  // Untuk angka biasa
  let cleaned = strVal.replace(/[^0-9.,-]/g, '').replace(/\./g, '').replace(/,/g, '.');
  return cleaned ? parseFloat(cleaned) : 0;
}

async function fetchSarmutIndikator() {
  try {
    const res = await fetch("/api/sarmutindikator", { credentials: "include" });
    sarmutIndikatorData = await res.json();
    console.log("✅ sarmutindikator data:", sarmutIndikatorData);

    if (!sarmutIndikatorData.length) return;

    const deptSelect = document.getElementById("filterDeptSarmut");

    function updateSasaranDropdown() {
      const currentDept = deptSelect?.value || "ALL";

      // Jika department adalah ALL, hide grafik
      if (currentDept === "ALL") {
        document.getElementById("sarmutIndikatorCharts").classList.add("hidden");
        return;
      }

      // Filter data berdasarkan department
      let filteredData = sarmutIndikatorData.filter(r =>
        normalizeKey(r["DEPT"] || r["Dept"] || r["DEPARTMENT"] || r["Department"] || r["Departemen"]) === normalizeKey(currentDept)
      );

      // Ambil Sasaran Mutu unik
      const sasaranList = [...new Set(filteredData.map(r => r["SASARAN MUTU"]).filter(Boolean))];

      const select = document.getElementById("indikatorSelect");
      select.innerHTML = sasaranList.map(s => `<option value="${s}">${s}</option>`).join("");

      // Show grafik dan render chart default jika ada
      if (sasaranList.length > 0) {
        document.getElementById("sarmutIndikatorCharts").classList.remove("hidden");
        renderIndikatorChart(sasaranList[0], currentDept);
      }
    }

    // Inisialisasi dropdown - grafik tersembunyi di awal
    document.getElementById("sarmutIndikatorCharts").classList.add("hidden");
    updateSasaranDropdown();

    // Event listener ganti department
    if (deptSelect) {
      deptSelect.addEventListener("change", updateSasaranDropdown);
    }

    // Event listener ganti indikator
    const select = document.getElementById("indikatorSelect");
    select.addEventListener("change", e => {
      const dept = deptSelect?.value || "ALL";
      if (dept !== "ALL") {
        renderIndikatorChart(e.target.value, dept);
      }
    });

    // Jangan tampilkan grafik di awal karena default adalah ALL

  } catch (err) {
    console.error("❌ Error fetchSarmutIndikator:", err);
  }
}

function renderIndikatorChart(sasaran, department = "ALL") {
  let dataFiltered = [...sarmutIndikatorData];
  if (department !== "ALL") {
    dataFiltered = dataFiltered.filter(r =>
      normalizeKey(r["DEPT"] || r["Dept"] || r["DEPARTMENT"] || r["Department"] || r["Departemen"]) === normalizeKey(department)
    );
  }

  // 🔹 Cari baris ACH dan TARGET berdasarkan sasaran
  const rowAch = dataFiltered.find(r => normalizeKey(r["SASARAN MUTU"]) === normalizeKey(sasaran) && normalizeKey(r["KATEGORI"]) === "ach");
  const rowTarget = dataFiltered.find(r => normalizeKey(r["SASARAN MUTU"]) === normalizeKey(sasaran) && normalizeKey(r["KATEGORI"]) === "target");

  if (!rowAch || !rowTarget) {
    console.warn("Sasaran ACH/Target tidak ditemukan:", sasaran, "Dept:", department);
    return;
  }

  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const ach = months.map(m => parseNumber(rowAch[m]));
  const target = months.map(m => parseNumber(rowTarget[m]));
  const percent = months.map((m,i) => target[i] ? ((ach[i]/target[i])*100).toFixed(2) : 0);

  // Deteksi tipe data berdasarkan sasaran dan data asli
  const isPercentageData = rowAch["JAN"] && rowAch["JAN"].toString().includes('%');
  const isRupiahData = rowAch["JAN"] && rowAch["JAN"].toString().includes('Rp');

  // 🔹 Line Chart dengan nilai putih
  const ctxLine = document.getElementById("chartIndikatorLine").getContext("2d");
  if (chartIndikatorLine) chartIndikatorLine.destroy();
  chartIndikatorLine = new Chart(ctxLine, {
    type: "line",
    data: {
      labels: months,
      datasets: [
        { 
          label: "Target", 
          data: target, 
          borderColor: "rgba(59,130,246,1)", 
          backgroundColor: "rgba(59,130,246,0.3)", 
          fill: false, 
          tension: 0.3,
          // Tampilkan nilai di titik data
          pointBackgroundColor: "rgba(59,130,246,1)",
          pointBorderColor: "#000000ff",
          pointBorderWidth: 2,
          pointRadius: 5,
        },
        { 
          label: "Realisasi", 
          data: ach, 
          borderColor: "rgba(16,185,129,1)", 
          backgroundColor: "rgba(16,185,129,0.3)", 
          fill: false, 
          tension: 0.3,
          // Tampilkan nilai di titik data
          pointBackgroundColor: "rgba(16,185,129,1)",
          pointBorderColor: "#000000ff",
          pointBorderWidth: 2,
          pointRadius: 5,
        }
      ]
    },
    options: { 
      responsive: true,
      plugins: { 
        legend: { labels: { color: "#000000ff" } },
        // Plugin untuk menampilkan nilai di atas titik data
        datalabels: {
          color: '#000000ff',
          display: function(context) {
            return context.dataset.data[context.dataIndex] !== 0; // Hanya tampilkan jika nilai bukan 0
          },
          font: {
            size: 16,
            weight: 'bold'
          },
          anchor: 'end',
          align: 'top',
          formatter: function(value, context) {
            // Gunakan deteksi berdasarkan data asli
            if (isPercentageData) {
              // Data sudah dalam format persen
              return value + '%';
            } else if (isRupiahData) {
              // Data dalam format rupiah
              return 'Rp ' + new Intl.NumberFormat('id-ID').format(value);
            } else {
              // Nilai biasa (angka bulat)
              return Math.round(value).toString();
            }
          }
        }
      }, 
      scales: { 
        x: { ticks: { color: "#000000ff" } }, 
        y: { ticks: { color: "#000000ff" }, beginAtZero: true } 
      },
      // Menampilkan nilai di tooltip dengan warna putih
      interaction: {
        intersect: false,
        mode: 'index',
      },
      onHover: (event, activeElements) => {
        if (activeElements.length > 0) {
          event.native.target.style.cursor = 'pointer';
        } else {
          event.native.target.style.cursor = 'default';
        }
      }
    }
  });

  // 🔹 Bar Chart (% Ach) dengan nilai putih dan batas maksimal 100%
  const ctxBar = document.getElementById("chartIndikatorPercent").getContext("2d");
  if (chartIndikatorPercent) chartIndikatorPercent.destroy();
  
  // Batasi nilai bar chart maksimal 100%
  const percentCapped = percent.map(p => Math.min(parseFloat(p), 100));
  
  chartIndikatorPercent = new Chart(ctxBar, {
    type: "bar",
    data: { 
      labels: months, 
      datasets: [{ 
        label: "% Ach", 
        data: percentCapped, 
        backgroundColor: "rgba(234,179,8,0.7)",
        borderColor: "rgba(234,179,8,1)",
        borderWidth: 1
      }] 
    },
    options: { 
      responsive: true,
      plugins: { 
        legend: { labels: { color: "#000000ff" } },
        // Plugin untuk menampilkan nilai di atas bar
        datalabels: {
          color: '#000000ff',
          display: function(context) {
            return context.dataset.data[context.dataIndex] !== 0; // Hanya tampilkan jika nilai bukan 0
          },
          font: {
            size: 16,
            weight: 'bold'
          },
          anchor: 'end',
          align: 'top',
          formatter: function(value, context) {
            // Tampilkan nilai asli tapi dibatasi maksimal 100%
            const originalValue = percent[context.dataIndex];
            const displayValue = Math.min(parseFloat(originalValue), 100);
            return displayValue + '%';
          }
        }
      }, 
      scales: { 
        x: { ticks: { color: "#000000ff" } }, 
        y: { ticks: { color: "#000000ff" }, beginAtZero: true, max: 100 } 
      }
    }
  });
}

// Start fetch
fetchSarmutIndikator();

async function loadKpiLineChartByDept(deptName) {
  try {
    const res = await fetch(`/api/kpi_personal?dept=${encodeURIComponent(deptName)}`);
    if (!res.ok) throw new Error("Gagal fetch KPI Personal");
    const data = await res.json();
    renderKpiPersonalLineChart(data); // fungsi chart yang sudah kamu punya
  } catch (err) {
    console.error("Error loadKpiLineChartByDept:", err);
  }
}

// ==========================
// KPI Personal Line Chart
// ==========================

function renderKpiPersonalLineChart(kpiPersonalData) {
  if (!Array.isArray(kpiPersonalData) || kpiPersonalData.length === 0) {
    console.warn("Tidak ada data KPI personal untuk chart");
    return;
  }

  const urutanBulan = [
    "Januari","Februari","Maret","April","Mei","Juni",
    "Juli","Agustus","September","Oktober","November","Desember"
  ];

  const months = [...new Set(kpiPersonalData.map(d => d.Bulan))];
  const monthsSorted = months.sort(
    (a, b) => urutanBulan.indexOf(a) - urutanBulan.indexOf(b)
  );
  const lastMonth = monthsSorted[monthsSorted.length - 1];

  const filteredData = kpiPersonalData.filter(d => d.Bulan === lastMonth);
  const labels = filteredData.map(d => d.Personal || "-");
  const data = filteredData.map(d => {
    let val = d['Nilai KPI'];
    if (typeof val === "string") val = val.replace(",", ".").trim();
    return parseFloat(val) || 0;
  });

  const ctxElem = document.getElementById("kpiPersonalLineChart");
  if (!ctxElem) {
    console.error("Elemen canvas #kpiPersonalLineChart tidak ditemukan");
    return;
  }

  const ctx = ctxElem.getContext("2d");
  if (kpiPersonalLineChart) kpiPersonalLineChart.destroy();

  kpiPersonalLineChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: `Nilai KPI (${lastMonth})`,
        data,
        borderColor: "#00c0ff",
        backgroundColor: "rgba(0,192,255,0.2)",
        fill: true,
        tension: 0.3,
        pointRadius: 5,
        pointBackgroundColor: "#fff",
        pointBorderColor: "#00c0ff"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: "#fff", font: { weight: "bold", size: 14 } }
        },
        tooltip: {
          titleColor: "#fff",
          bodyColor: "#fff",
          callbacks: {
            label: (context) => `${context.dataset.label}: ${context.formattedValue}%`
          }
        },
        datalabels: {
          anchor: "top",
          align: "top",
          color: "#fff",
          font: { weight: "bold", size: 14 },
          formatter: (value) => value.toFixed(2)
        }
      },
      scales: {
        x: {
          ticks: { color: "#fff", font: { weight: "bold", size: 12 } },
          grid: { color: "rgba(255,255,255,0.2)" }
        },
        y: {
          beginAtZero: true,
          ticks: { color: "#fff", font: { weight: "bold", size: 12 } },
          grid: { color: "rgba(255,255,255,0.2)" }
        }
      }
    },
    plugins: [
      ChartDataLabels,
      {
        id: "customCanvasBackgroundColor",
        beforeDraw: (chart) => {
          const ctx = chart.ctx;
          ctx.save();
          ctx.globalCompositeOperation = "destination-over";
          ctx.fillStyle = "#1e293b";
          ctx.fillRect(0, 0, chart.width, chart.height);
          ctx.restore();
        }
      }
    ]
  });
}

  // KPI Summary
  function updateKpiSummary(kpiPersonalData, currentUser, department = 'ALL', month = 'ALL') {
    // Handle data kosong
    if (!kpiPersonalData || kpiPersonalData.length === 0) {
      document.getElementById("topPerformer").textContent = "-";
      document.getElementById("underPerformer").textContent = "-";
      document.getElementById("totalKaryawan").textContent = "0";
      document.getElementById("rataRataKpi").textContent = "0";
      document.getElementById("jumlah90Up").textContent = "0";
      document.getElementById("jumlahUnderTarget").textContent = "0";
      return;
    }

    // Filter bulan
    let filteredData = kpiPersonalData.filter(d => d.Personal && d['Nilai KPI']);
    if (month !== 'ALL' && month !== '') {
      filteredData = filteredData.filter(d => d.Bulan === month);
    }

    if (filteredData.length === 0) return;

    // Statistik umum
    const uniqueKaryawan = new Set(filteredData.map(d => d.Personal));
    document.getElementById("totalKaryawan").textContent = uniqueKaryawan.size;

    const nilaiKpiNums = filteredData.map(d => parseFloat(d['Nilai KPI']) || 0);
    const overallAvgKpi = nilaiKpiNums.reduce((a,b)=>a+b,0) / nilaiKpiNums.length;
    document.getElementById("rataRataKpi").textContent = overallAvgKpi.toFixed(2);

    document.getElementById("jumlah90Up").textContent = filteredData.filter(d => parseFloat(d['Nilai KPI']) >= 90).length;
    document.getElementById("jumlahUnderTarget").textContent = filteredData.filter(d => parseFloat(d['Nilai KPI']) < 70).length;

    // Top & under performer
    if (currentUser && (currentUser.role === "head_dept" || currentUser.role === "head")) {
      const deptName = currentUser.department;
      const deptKaryawan = filteredData.filter(d => d.Departemen === deptName);

      if (deptKaryawan.length > 0) {
        const employeeMap = {};
        deptKaryawan.forEach(d => {
          const nama = d.Personal;
          const nilai = parseFloat(d["Nilai KPI"]) || 0;
          if (!employeeMap[nama]) employeeMap[nama] = [];
          employeeMap[nama].push(nilai);
        });

        const employeeAvg = Object.entries(employeeMap).map(([nama, arr]) => ({
          nama,
          avgKpi: arr.reduce((a,b)=>a+b,0)/arr.length
        }));

        employeeAvg.sort((a,b) => b.avgKpi - a.avgKpi);

        document.getElementById("topPerformer").textContent =
          `${employeeAvg[0].nama}: ${employeeAvg[0].avgKpi.toFixed(2)}`;
        document.getElementById("underPerformer").textContent =
          `${employeeAvg[employeeAvg.length-1].nama}: ${employeeAvg[employeeAvg.length-1].avgKpi.toFixed(2)}`;
      }
    } else {
      // Admin/global → per dept
      const deptMap = {};
      filteredData.forEach(d => {
        const dept = d.Departemen || "Unknown";
        if (!deptMap[dept]) deptMap[dept] = [];
        deptMap[dept].push(parseFloat(d["Nilai KPI"]) || 0);
      });

      const deptAvgKpi = Object.entries(deptMap).map(([dept, arr]) => ({
        dept,
        avgKpi: arr.reduce((a,b)=>a+b,0)/arr.length
      }));

      deptAvgKpi.sort((a,b) => b.avgKpi - a.avgKpi);

      document.getElementById("topPerformer").textContent =
        `${deptAvgKpi[0].dept}: ${deptAvgKpi[0].avgKpi.toFixed(2)}`;
      document.getElementById("underPerformer").textContent =
        `${deptAvgKpi[deptAvgKpi.length-1].dept}: ${deptAvgKpi[deptAvgKpi.length-1].avgKpi.toFixed(2)}`;
    }
  }

  // ==============================
  // Helper fetch JSON dengan error handling
  // ==============================
  async function fetchJSON(url) {
    try {
      const res = await fetch(url, {
        credentials: "include", // penting kalau ada session/cookie
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error("Gagal fetch:", url, err);
      return [];
    }
  }

// ==============================
// Enhanced Project Module with Status Filtering
// ==============================

// Global cache variables
let cachedKolaborasiDetail = [];
let cachedMandiriDetail = [];
let cachedKolaborasiSummary = [];
let cachedMandiriSummary = [];

// Current filter states
let currentKolaborasiStatusFilter = 'ALL';
let currentMandiriStatusFilter = 'ALL';
let currentKolaborasiDeptFilter = 'ALL';
let currentMandiriDeptFilter = 'ALL';

// ==============================
// Utility Functions
// ==============================
function safeText(val) {
  if (!val) return "-";
  return val.toString().trim();
}

function toggleTable(contentId, btn) {
  const content = document.getElementById(contentId);
  if (!content) {
    console.error('Element not found:', contentId);
    return;
  }
  if (content.classList.contains("hidden")) {
    content.classList.remove("hidden");
    const span = btn.querySelector("span");
    const icon = btn.querySelector("i");
    if (span) span.textContent = "Hide";
    if (icon) icon.classList.replace("fa-chevron-down", "fa-chevron-up");
  } else {
    content.classList.add("hidden");
    const span = btn.querySelector("span");
    const icon = btn.querySelector("i");
    if (span) span.textContent = "Show";
    if (icon) icon.classList.replace("fa-chevron-up", "fa-chevron-down");
  }
}

// ==============================
// Status Normalization
// ==============================
function normalizeStatus(status) {
  if (!status) return 'unknown';
  
  const statusLower = status.toLowerCase().trim();
  
  if (statusLower.includes('done') || statusLower.includes('selesai') || statusLower.includes('complete')) {
    return 'done';
  }
  if (statusLower.includes('progress') || statusLower.includes('berjalan') || statusLower.includes('ongoing')) {
    return 'on progress';
  }
  if (statusLower.includes('overdue') || statusLower.includes('telat') || statusLower.includes('terlambat') || statusLower.includes('over due')) {
    return 'overdue';
  }
  
  return statusLower;
}

// ==============================
// Summary Calculation Functions
// ==============================
function calculateKolaborasiSummary() {
  if (!cachedKolaborasiDetail || cachedKolaborasiDetail.length === 0) return { total: 0, done: 0, progress: 0, overdue: 0 };
  
  const summary = {
    total: cachedKolaborasiDetail.length,
    done: 0,
    progress: 0,
    overdue: 0
  };
  
  cachedKolaborasiDetail.forEach(project => {
    const status = normalizeStatus(project.Status);
    switch(status) {
      case 'done':
        summary.done++;
        break;
      case 'on progress':
        summary.progress++;
        break;
      case 'overdue':
        summary.overdue++;
        break;
    }
  });
  
  return summary;
}

function calculateMandiriSummary() {
  if (!cachedMandiriDetail || cachedMandiriDetail.length === 0) return { total: 0, done: 0, progress: 0, overdue: 0 };
  
  const summary = {
    total: cachedMandiriDetail.length,
    done: 0,
    progress: 0,
    overdue: 0
  };
  
  cachedMandiriDetail.forEach(project => {
    const status = normalizeStatus(project.Status);
    switch(status) {
      case 'done':
        summary.done++;
        break;
      case 'on progress':
        summary.progress++;
        break;
      case 'overdue':
        summary.overdue++;
        break;
    }
  });
  
  return summary;
}

// ==============================
// Update Summary Cards
// ==============================
function updateKolaborasiSummaryCards() {
  const summary = calculateKolaborasiSummary();
  
  const totalEl = document.getElementById("kolaborasiTotalProject");
  const doneEl = document.getElementById("kolaborasiDoneProject");
  const progressEl = document.getElementById("kolaborasiProgressProject");
  const overdueEl = document.getElementById("kolaborasiOverdueProject");
  
  if (totalEl) totalEl.textContent = summary.total || 0;
  if (doneEl) doneEl.textContent = summary.done || 0;
  if (progressEl) progressEl.textContent = summary.progress || 0;
  if (overdueEl) overdueEl.textContent = summary.overdue || 0;
  
  console.log('Kolaborasi summary cards updated:', summary);
}

function updateMandiriSummaryCards() {
  const summary = calculateMandiriSummary();
  
  const totalEl = document.getElementById("mandiriTotalProject");
  const doneEl = document.getElementById("mandiriDoneProject");
  const progressEl = document.getElementById("mandiriProgressProject");
  const overdueEl = document.getElementById("mandiriOverdueProject");
  
  if (totalEl) totalEl.textContent = summary.total || 0;
  if (doneEl) doneEl.textContent = summary.done || 0;
  if (progressEl) progressEl.textContent = summary.progress || 0;
  if (overdueEl) overdueEl.textContent = summary.overdue || 0;
  
  console.log('Mandiri summary cards updated:', summary);
}

// ==============================
// Filter Functions
// ==============================
function filterKolaborasiByStatus(status) {
  console.log('Filtering Kolaborasi by status:', status);
  
  currentKolaborasiStatusFilter = status;
  updateKolaborasiFilterUI();
  
  let filteredData = cachedKolaborasiDetail;
  
  // Apply status filter
  if (status !== 'ALL') {
    filteredData = filteredData.filter(project => {
      const projectStatus = normalizeStatus(project.Status);
      return projectStatus === status;
    });
  }
  
  // Apply department filter if active
  if (currentKolaborasiDeptFilter !== 'ALL') {
    filteredData = filteredData.filter(project => {
      const dept = safeText(project.Department).toLowerCase();
      return dept === currentKolaborasiDeptFilter.toLowerCase();
    });
  }
  
  renderKolaborasiDetail(filteredData);
  updateFilterInfo('kolaborasi', status, filteredData.length);
}

function filterMandiriByStatus(status) {
  console.log('Filtering Mandiri by status:', status);
  
  currentMandiriStatusFilter = status;
  updateMandiriFilterUI();
  
  let filteredData = cachedMandiriDetail;
  
  // Apply status filter
  if (status !== 'ALL') {
    filteredData = filteredData.filter(project => {
      const projectStatus = normalizeStatus(project.Status);
      return projectStatus === status;
    });
  }
  
  // Apply department filter if active
  if (currentMandiriDeptFilter !== 'ALL') {
    filteredData = filteredData.filter(project => {
      const dept = safeText(project.Department).toLowerCase();
      return dept === currentMandiriDeptFilter.toLowerCase();
    });
  }
  
  renderMandiriDetail(filteredData);
  updateFilterInfo('mandiri', status, filteredData.length);
}

function filterKolaborasiByDepartment(department) {
  console.log('Filtering Kolaborasi by department:', department);
  
  currentKolaborasiDeptFilter = department;
  
  let filteredData = cachedKolaborasiDetail;
  
  // Apply department filter
  if (department !== 'ALL') {
    filteredData = filteredData.filter(project => {
      const dept = safeText(project.Department).toLowerCase();
      return dept === department.toLowerCase();
    });
  }
  
  // Apply status filter if active
  if (currentKolaborasiStatusFilter !== 'ALL') {
    filteredData = filteredData.filter(project => {
      const projectStatus = normalizeStatus(project.Status);
      return projectStatus === currentKolaborasiStatusFilter;
    });
  }
  
  renderKolaborasiDetail(filteredData);
  updateFilterInfo('kolaborasi', currentKolaborasiStatusFilter, filteredData.length);
}

function filterMandiriByDepartment(department) {
  console.log('Filtering Mandiri by department:', department);
  
  currentMandiriDeptFilter = department;
  
  let filteredData = cachedMandiriDetail;
  
  // Apply department filter
  if (department !== 'ALL') {
    filteredData = filteredData.filter(project => {
      const dept = safeText(project.Department).toLowerCase();
      return dept === department.toLowerCase();
    });
  }
  
  // Apply status filter if active
  if (currentMandiriStatusFilter !== 'ALL') {
    filteredData = filteredData.filter(project => {
      const projectStatus = normalizeStatus(project.Status);
      return projectStatus === currentMandiriStatusFilter;
    });
  }
  
  renderMandiriDetail(filteredData);
  updateFilterInfo('mandiri', currentMandiriStatusFilter, filteredData.length);
}

// ==============================
// UI Update Functions
// ==============================
function updateKolaborasiFilterUI() {
  // Remove active class from all cards
  const cards = ['kolaborasiAllCard', 'kolaborasiDoneCard', 'kolaborasiProgressCard', 'kolaborasiOverdueCard'];
  cards.forEach(cardId => {
    const card = document.getElementById(cardId);
    if (card) card.classList.remove('active');
  });
  
  // Hide all filter indicators
  const indicators = ['kolaborasiAllFilter', 'kolaborasiDoneFilter', 'kolaborasiProgressFilter', 'kolaborasiOverdueFilter'];
  indicators.forEach(indicatorId => {
    const indicator = document.getElementById(indicatorId);
    if (indicator) indicator.classList.add('hidden');
  });
  
  // Show active card and indicator
  let activeCardId, activeIndicatorId;
  
  switch(currentKolaborasiStatusFilter) {
    case 'ALL':
      activeCardId = 'kolaborasiAllCard';
      activeIndicatorId = 'kolaborasiAllFilter';
      break;
    case 'done':
      activeCardId = 'kolaborasiDoneCard';
      activeIndicatorId = 'kolaborasiDoneFilter';
      break;
    case 'on progress':
      activeCardId = 'kolaborasiProgressCard';
      activeIndicatorId = 'kolaborasiProgressFilter';
      break;
    case 'overdue':
      activeCardId = 'kolaborasiOverdueCard';
      activeIndicatorId = 'kolaborasiOverdueFilter';
      break;
  }
  
  if (activeCardId && currentKolaborasiStatusFilter !== 'ALL') {
    const activeCard = document.getElementById(activeCardId);
    const activeIndicator = document.getElementById(activeIndicatorId);
    if (activeCard) activeCard.classList.add('active');
    if (activeIndicator) activeIndicator.classList.remove('hidden');
  }
}

function updateMandiriFilterUI() {
  // Remove active class from all cards
  const cards = ['mandiriAllCard', 'mandiriDoneCard', 'mandiriProgressCard', 'mandiriOverdueCard'];
  cards.forEach(cardId => {
    const card = document.getElementById(cardId);
    if (card) card.classList.remove('active');
  });
  
  // Hide all filter indicators
  const indicators = ['mandiriAllFilter', 'mandiriDoneFilter', 'mandiriProgressFilter', 'mandiriOverdueFilter'];
  indicators.forEach(indicatorId => {
    const indicator = document.getElementById(indicatorId);
    if (indicator) indicator.classList.add('hidden');
  });
  
  // Show active card and indicator
  let activeCardId, activeIndicatorId;
  
  switch(currentMandiriStatusFilter) {
    case 'ALL':
      activeCardId = 'mandiriAllCard';
      activeIndicatorId = 'mandiriAllFilter';
      break;
    case 'done':
      activeCardId = 'mandiriDoneCard';
      activeIndicatorId = 'mandiriDoneFilter';
      break;
    case 'on progress':
      activeCardId = 'mandiriProgressCard';
      activeIndicatorId = 'mandiriProgressFilter';
      break;
    case 'overdue':
      activeCardId = 'mandiriOverdueCard';
      activeIndicatorId = 'mandiriOverdueFilter';
      break;
  }
  
  if (activeCardId && currentMandiriStatusFilter !== 'ALL') {
    const activeCard = document.getElementById(activeCardId);
    const activeIndicator = document.getElementById(activeIndicatorId);
    if (activeCard) activeCard.classList.add('active');
    if (activeIndicator) activeIndicator.classList.remove('hidden');
  }
}

function updateFilterInfo(type, status, count) {
  const infoElementId = type === 'kolaborasi' ? 'kolaborasiFilterInfo' : 'mandiriFilterInfo';
  const infoElement = document.getElementById(infoElementId);
  
  if (infoElement) {
    if (status === 'ALL') {
      infoElement.classList.add('hidden');
    } else {
      let statusText = '';
      switch(status) {
        case 'done': statusText = 'Done'; break;
        case 'on progress': statusText = 'On Progress'; break;
        case 'overdue': statusText = 'Overdue'; break;
      }
      infoElement.textContent = `${statusText}: ${count} projects`;
      infoElement.classList.remove('hidden');
    }
  }
}

// ==============================
// Render Functions
// ==============================
function renderKolaborasiSummary(data) {
  const tbody = document.getElementById("projectKolaborasiTableBody");
  if (!tbody) {
    console.error('Element projectKolaborasiTableBody not found');
    return;
  }
  
  tbody.innerHTML = "";

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-gray-500">Tidak ada data</td></tr>`;
    return;
  }

  data.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="border px-3 py-2">${i + 1}</td>
      <td class="border px-3 py-2">${safeText(row["Department"])}</td>
      <td class="border px-3 py-2">${safeText(row["Done"])}</td>
      <td class="border px-3 py-2">${safeText(row["On Progress"])}</td>
      <td class="border px-3 py-2">${safeText(row["Over Due"])}</td>
      <td class="border px-3 py-2">${safeText(row["Achievement"])}</td>
    `;
    tbody.appendChild(tr);
  });
  
  console.log('Kolaborasi summary rendered:', data.length, 'rows');
}

function renderKolaborasiDetail(data) {
  const tbody = document.getElementById("projectKolaborasiBodyTable");
  if (!tbody) {
    console.error('Element projectKolaborasiBodyTable not found');
    return;
  }
  
  tbody.innerHTML = "";

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-gray-500">Tidak ada data untuk filter yang dipilih</td></tr>`;
    return;
  }

  data.forEach((row, i) => {
    const status = normalizeStatus(row.Status);
    let statusClass = '';
    let statusIcon = '';
    
    switch(status) {
      case 'done':
        statusClass = 'text-green-600 font-semibold';
        statusIcon = '<i class="fas fa-check-circle mr-1"></i>';
        break;
      case 'on progress':
        statusClass = 'text-blue-600 font-semibold';
        statusIcon = '<i class="fas fa-clock mr-1"></i>';
        break;
      case 'overdue':
        statusClass = 'text-red-600 font-semibold';
        statusIcon = '<i class="fas fa-exclamation-triangle mr-1"></i>';
        break;
      default:
        statusClass = 'text-gray-600';
    }
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="border px-3 py-2">${i + 1}</td>
      <td class="border px-3 py-2 text-left">${safeText(row["Project Name"] || row["Nama Project"])}</td>
      <td class="border px-3 py-2">${safeText(row["Start Date"] || row["Tanggal Start"])}</td>
      <td class="border px-3 py-2 text-left">${safeText(row["Detail Task"] || row["Task"])}</td>
      <td class="border px-3 py-2">${safeText(row["Department"])}</td>
      <td class="border px-3 py-2 ${statusClass}">${statusIcon}${safeText(row["Status"])}</td>
    `;
    tbody.appendChild(tr);
  });
  
  console.log('Kolaborasi detail rendered:', data.length, 'rows');
}

function renderMandiriSummary(data) {
  const tbody = document.getElementById("projectMandiriTableBody");
  if (!tbody) {
    console.error('Element projectMandiriTableBody not found');
    return;
  }
  
  tbody.innerHTML = "";

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-gray-500">Tidak ada data</td></tr>`;
    return;
  }

  data.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="border px-3 py-2">${i + 1}</td>
      <td class="border px-3 py-2">${safeText(row["Department"])}</td>
      <td class="border px-3 py-2">${safeText(row["Done"])}</td>
      <td class="border px-3 py-2">${safeText(row["On Progress"])}</td>
      <td class="border px-3 py-2">${safeText(row["Over Due"])}</td>
      <td class="border px-3 py-2">${safeText(row["Achievement"])}</td>
    `;
    tbody.appendChild(tr);
  });
  
  console.log('Mandiri summary rendered:', data.length, 'rows');
}

function renderMandiriDetail(data) {
  const tbody = document.getElementById("projectMandiriBodyTable");
  if (!tbody) {
    console.error('Element projectMandiriBodyTable not found');
    return;
  }
  
  tbody.innerHTML = "";

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-gray-500">Tidak ada data untuk filter yang dipilih</td></tr>`;
    return;
  }

  data.forEach((row, i) => {
    const status = normalizeStatus(row.Status);
    let statusClass = '';
    let statusIcon = '';
    
    switch(status) {
      case 'done':
        statusClass = 'text-green-600 font-semibold';
        statusIcon = '<i class="fas fa-check-circle mr-1"></i>';
        break;
      case 'on progress':
        statusClass = 'text-blue-600 font-semibold';
        statusIcon = '<i class="fas fa-clock mr-1"></i>';
        break;
      case 'overdue':
        statusClass = 'text-red-600 font-semibold';
        statusIcon = '<i class="fas fa-exclamation-triangle mr-1"></i>';
        break;
      default:
        statusClass = 'text-gray-600';
    }
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="border px-3 py-2">${i + 1}</td>
      <td class="border px-3 py-2 text-left">${safeText(row["Project Name"] || row["Nama Project"])}</td>
      <td class="border px-3 py-2">${safeText(row["Start Date"] || row["Tanggal Start"])}</td>
      <td class="border px-3 py-2 text-left">${safeText(row["Detail Task"] || row["Task"])}</td>
      <td class="border px-3 py-2">${safeText(row["Department"])}</td>
      <td class="border px-3 py-2 ${statusClass}">${statusIcon}${safeText(row["Status"])}</td>
    `;
    tbody.appendChild(tr);
  });
  
  console.log('Mandiri detail rendered:', data.length, 'rows');
}

// ==============================
// Data Fetching Functions
// ==============================
async function fetchProjectKolaborasi() {
  try {
    console.log('Fetching Kolaborasi data...');
    
    // Show loading state
    const summaryTbody = document.getElementById("projectKolaborasiTableBody");
    const detailTbody = document.getElementById("projectKolaborasiBodyTable");
    
    if (summaryTbody) {
      summaryTbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Loading data...</td></tr>`;
    }
    if (detailTbody) {
      detailTbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Loading data...</td></tr>`;
    }
    
    // Fetch summary data
    const summaryRes = await fetch("/api/project/kolaborasi", { credentials: "include" });
    if (!summaryRes.ok) {
      throw new Error(`Summary API Error: ${summaryRes.status} ${summaryRes.statusText}`);
    }
    const summaryData = await summaryRes.json();
    cachedKolaborasiSummary = summaryData || [];
    renderKolaborasiSummary(summaryData);

    // Fetch detail data
    const detailRes = await fetch("/api/project/detailkolaborasi", { credentials: "include" });
    if (!detailRes.ok) {
      throw new Error(`Detail API Error: ${detailRes.status} ${detailRes.statusText}`);
    }
    const detailData = await detailRes.json();
    cachedKolaborasiDetail = detailData || [];
    
    // Update summary cards based on detail data
    updateKolaborasiSummaryCards();
    
    // Reset filters and render data
    currentKolaborasiStatusFilter = 'ALL';
    currentKolaborasiDeptFilter = 'ALL';
    updateKolaborasiFilterUI();
    renderKolaborasiDetail(detailData);
    
    // Populate department filter
    populateKolaborasiDeptFilter();
    
    console.log('Kolaborasi data loaded successfully');
    
  } catch (err) {
    console.error("Error fetch kolaborasi:", err);
    
    // Show error in tables
    const summaryTbody = document.getElementById("projectKolaborasiTableBody");
    const detailTbody = document.getElementById("projectKolaborasiBodyTable");
    
    const errorMsg = `<tr><td colspan="6" class="py-8 text-center text-red-500">Error: ${err.message}</td></tr>`;
    
    if (summaryTbody) summaryTbody.innerHTML = errorMsg;
    if (detailTbody) detailTbody.innerHTML = errorMsg;
  }
}

async function fetchProjectMandiri() {
  try {
    console.log('Fetching Mandiri data...');
    
    // Show loading state
    const summaryTbody = document.getElementById("projectMandiriTableBody");
    const detailTbody = document.getElementById("projectMandiriBodyTable");
    
    if (summaryTbody) {
      summaryTbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Loading data...</td></tr>`;
    }
    if (detailTbody) {
      detailTbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Loading data...</td></tr>`;
    }
    
    // Fetch summary data
    const summaryRes = await fetch("/api/project/mandiri", { 
      credentials: "include",
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!summaryRes.ok) {
      throw new Error(`Summary API Error: ${summaryRes.status} ${summaryRes.statusText}`);
    }
    
    const summaryData = await summaryRes.json();
    cachedMandiriSummary = summaryData || [];
    renderMandiriSummary(summaryData);

    // Fetch detail data
    const detailRes = await fetch("/api/project/detailmandiri", { 
      credentials: "include",
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!detailRes.ok) {
      throw new Error(`Detail API Error: ${detailRes.status} ${detailRes.statusText}`);
    }
    
    const detailData = await detailRes.json();
    cachedMandiriDetail = detailData || [];
    
    // Update summary cards based on detail data
    updateMandiriSummaryCards();
    
    // Reset filters and render data
    currentMandiriStatusFilter = 'ALL';
    currentMandiriDeptFilter = 'ALL';
    updateMandiriFilterUI();
    renderMandiriDetail(detailData);
    
    // Populate department filter
    populateMandiriDeptFilter();
    
    console.log('Mandiri data loaded successfully');
    
  } catch (err) {
    console.error("Error fetch mandiri:", err);
    
    // Show error in tables
    const summaryTbody = document.getElementById("projectMandiriTableBody");
    const detailTbody = document.getElementById("projectMandiriBodyTable");
    
    const errorMsg = `<tr><td colspan="6" class="py-8 text-center text-red-500">Error: ${err.message}</td></tr>`;
    
    if (summaryTbody) summaryTbody.innerHTML = errorMsg;
    if (detailTbody) detailTbody.innerHTML = errorMsg;
  }
}

// ==============================
// Department Filter Population
// ==============================
function populateKolaborasiDeptFilter() {
  const uniqueDepts = [...new Set(
    cachedKolaborasiDetail
      .map(row => row["Department"])
      .filter(dep => dep && dep.trim() !== "")
      .map(dep => dep.trim())
  )].sort();

  const select = document.getElementById("filterDeptKolaborasi");
  if (!select) return;

  // Remove existing options except "ALL"
  const existingOptions = select.querySelectorAll("option:not([value='ALL'])");
  existingOptions.forEach(opt => opt.remove());

  // Add department options
  uniqueDepts.forEach(dep => {
    const opt = document.createElement("option");
    opt.value = dep;
    opt.textContent = dep;
    select.appendChild(opt);
  });

  console.log('Kolaborasi department filter populated with:', uniqueDepts.length, 'departments');
}

function populateMandiriDeptFilter() {
  const uniqueDepts = [...new Set(
    cachedMandiriDetail
      .map(row => row["Department"])
      .filter(dep => dep && dep.trim() !== "")
      .map(dep => dep.trim())
  )].sort();

  const select = document.getElementById("filterDeptMandiri");
  if (!select) return;

  // Remove existing options except "ALL"
  const existingOptions = select.querySelectorAll("option:not([value='ALL'])");
  existingOptions.forEach(opt => opt.remove());

  // Add department options
  uniqueDepts.forEach(dep => {
    const opt = document.createElement("option");
    opt.value = dep;
    opt.textContent = dep;
    select.appendChild(opt);
  });

  console.log('Mandiri department filter populated with:', uniqueDepts.length, 'departments');
}

// ==============================
// Export Function
// ==============================
function exportProjectData() {
  console.log('Exporting project data...');
  
  const tableIds = [
    "projectKolaborasiTableBody",
    "projectKolaborasiBodyTable", 
    "projectMandiriTableBody",
    "projectMandiriBodyTable"
  ];
  
  let csvData = [];
  let hasData = false;

  tableIds.forEach(id => {
    const tbody = document.getElementById(id);
    if (!tbody) return;

    const rows = tbody.querySelectorAll("tr");
    rows.forEach((tr) => {
      const cells = tr.querySelectorAll("td");
      if (cells.length > 0) {
        const firstCellText = cells[0].innerText.trim();
        if (!firstCellText.includes('Loading') && 
            !firstCellText.includes('Error') && 
            !firstCellText.includes('Tidak ada data')) {
          
          const rowData = Array.from(cells).map(td => `"${td.innerText.replace(/"/g, '""')}"`);
          csvData.push(rowData.join(","));
          hasData = true;
        }
      }
    });
  });

  if (!hasData) {
    alert('Tidak ada data untuk diekspor');
    return;
  }

  const csv = csvData.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.download = `projects_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  URL.revokeObjectURL(url);
  console.log('Export completed');
}

// ==============================
// Section Management
// ==============================
function showSection(sectionId) {
  console.log('Showing section:', sectionId);
  
  // Hide all sections
  const allSections = document.querySelectorAll('section');
  allSections.forEach(section => {
    section.classList.add('hidden');
  });
  
  // Show target section
  const targetSection = document.getElementById(sectionId);
  if (targetSection) {
    targetSection.classList.remove('hidden');
    console.log('Successfully showed:', sectionId);
  }
}

// ==============================
// Navigation Functions (Updated)
// ==============================
function showProject(type) {
  console.log('Showing project type:', type);
  
  if (type === "kolaborasi") {
    showSection("projectKolaborasiSection");
    setTimeout(() => {
      fetchProjectKolaborasi();
    }, 100);
  } else if (type === "mandiri") {
    showSection("projectMandiriSection");
    setTimeout(() => {
      fetchProjectMandiri();
    }, 100);
  }
}

// ==============================
// Initialization
// ==============================
document.addEventListener("DOMContentLoaded", function() {
  console.log('Enhanced Project module initialization...');
  console.log('Enhanced Project module loaded successfully');
});

// ==============================
// Global Function Exports
// ==============================
window.showSection = showSection;
window.showProject = showProject;
window.toggleTable = toggleTable;
window.fetchProjectKolaborasi = fetchProjectKolaborasi;
window.fetchProjectMandiri = fetchProjectMandiri;
window.exportProjectData = exportProjectData;
window.filterKolaborasiByStatus = filterKolaborasiByStatus;
window.filterMandiriByStatus = filterMandiriByStatus;
window.filterKolaborasiByDepartment = filterKolaborasiByDepartment;
window.filterMandiriByDepartment = filterMandiriByDepartment;

  // Populate filter dropdown
  async function populateFilters() {
    try {
      const [workload, kpiPersonal] = await Promise.all([fetchData('/api/workload'), fetchData('/api/kpi_personal')]);
      const deptSet = new Set(workload.map(d => d.Department).filter(Boolean));
      const monthSet = new Set();
      if (workload.length) Object.keys(workload[0]).forEach(k => { 
        if (['JUNI','JULI','AGUSTUS','SEPTEMBER','OKTOBER','NOVEMBER','DESEMBER','JANUARI','FEBRUARI','MARET','APRIL','MEI'].includes(k.toUpperCase())) 
          monthSet.add(k.toUpperCase()); 
      });
      const empSet = new Set(kpiPersonal.map(d => d.Personal).filter(Boolean));

      const deptFilter = document.getElementById('departmentFilter');
      const currentDept = deptFilter.value;
      deptFilter.innerHTML = '<option value="ALL">All Departments</option>';
      Array.from(deptSet).sort().forEach(dept => deptFilter.innerHTML += `<option value="${dept}">${dept}</option>`);
      if (currentDept) deptFilter.value = currentDept;

      const monthFilter = document.getElementById('monthFilter');
      const currentMonth = monthFilter.value;
      monthFilter.innerHTML = '<option value="ALL">All Months</option>';
      Array.from(monthSet).sort().forEach(month => monthFilter.innerHTML += `<option value="${month}">${month}</option>`);
      if (currentMonth) monthFilter.value = currentMonth;

      updateEmployeeFilterOptions(deptFilter.value || 'ALL');
    } catch (err) {
      console.error('Gagal populate filter:', err);
    }
  }

  // Update employee filter
  async function updateEmployeeFilterOptions(department) {
    try {
      const kpiPersonal = await fetchData('/api/kpi_personal');
      let filteredEmployees = kpiPersonal.filter(d => d.Personal);
      if (department !== 'ALL' && department !== '') filteredEmployees = filteredEmployees.filter(d => d.Departemen === department);
      const empSet = new Set(filteredEmployees.map(d => d.Personal));
      const empFilter = document.getElementById('employeeFilter');
      const currentEmp = empFilter.value;
      empFilter.innerHTML = '<option value="ALL">All Employees</option>';
      Array.from(empSet).sort().forEach(emp => empFilter.innerHTML += `<option value="${emp}">${emp}</option>`);
      if (currentEmp) empFilter.value = currentEmp;
    } catch (err) {
      console.error('Gagal update employee filter:', err);
    }
  }

  // dokumen section
  let allDocuments = [];
  let currentPreviewDocId = null;

    // File input change
    document.getElementById('fileInput')?.addEventListener('change', function(e) {
      const fileName = e.target.files[0]?.name || 'Belum ada file dipilih';
      document.getElementById('fileName').textContent = fileName;
    });

    // Check user role
    async function checkUserRole() {
      try {
        const res = await fetch('/api/current-session', { credentials: 'include' });
        const user = await res.json();
        
        // Hanya admin yang bisa lihat upload section
        if (user.role === 'admin') {
          document.getElementById('uploadSection').classList.remove('hidden');
        }
      } catch (err) {
        console.error('Error checking user role:', err);
      }
    }

    // Upload document
    document.getElementById('uploadDocForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const submitBtn = e.target.querySelector('button[type="submit"]');
      
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Uploading...';
      
      try {
        const res = await fetch('/api/documents/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include'
        });
        
        const result = await res.json();
        
        if (res.ok) {
          alert('✅ Dokumen berhasil diupload!');
          e.target.reset();
          document.getElementById('fileName').textContent = 'Belum ada file dipilih';
          loadDocuments();
        } else {
          alert('❌ ' + (result.error || 'Gagal upload dokumen'));
        }
      } catch (err) {
        console.error('Upload error:', err);
        alert('❌ Terjadi kesalahan saat upload');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-upload mr-2"></i> Upload Dokumen';
      }
    });

    // Load documents
    async function loadDocuments() {
      const container = document.getElementById('documentsList');
      container.innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-3xl text-gray-400"></i></div>';
      
      try {
        const res = await fetch('/api/documents', { credentials: 'include' });
        allDocuments = await res.json();
        
        applyFiltersAndSort();
      } catch (err) {
        console.error('Error loading documents:', err);
        container.innerHTML = '<div class="text-center py-8 text-red-500">Gagal memuat dokumen</div>';
      }
    }

    // Apply filters and sort
    function applyFiltersAndSort() {
      const container = document.getElementById('documentsList');
      const category = document.getElementById('categoryFilter').value;
      const sortBy = document.getElementById('sortBy').value;
      
      let filtered = [...allDocuments];
      
      // Filter by category
      if (category) {
        filtered = filtered.filter(doc => doc.category === category);
      }
      
      // Sort
      filtered.sort((a, b) => {
        switch(sortBy) {
          case 'newest':
            return new Date(b.uploadDate) - new Date(a.uploadDate);
          case 'oldest':
            return new Date(a.uploadDate) - new Date(b.uploadDate);
          case 'title':
            return a.title.localeCompare(b.title);
          case 'title-desc':
            return b.title.localeCompare(a.title);
          default:
            return 0;
        }
      });
      
      displayDocuments(filtered);
    }

    // Display documents
    function displayDocuments(docs) {
      const container = document.getElementById('documentsList');
      
      if (!docs || docs.length === 0) {
        container.innerHTML = `
          <div class="text-center py-12 text-gray-500">
            <i class="fas fa-inbox text-5xl mb-4"></i>
            <p class="text-lg">Belum ada dokumen</p>
          </div>
        `;
        return;
      }
      
      container.innerHTML = docs.map(doc => {
        const isPdf = doc.originalName.toLowerCase().endsWith('.pdf');
        return `
          <div class="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-xl hover:shadow-md transition-all">
            <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center text-white text-xl">
              <i class="fas fa-file-${getFileIcon(doc.filename)}"></i>
            </div>
            
            <div class="flex-1">
              <h4 class="font-bold text-gray-900 dark:text-white">${doc.title}</h4>
              <p class="text-sm text-gray-600 dark:text-gray-400">${doc.description || 'Tidak ada deskripsi'}</p>
              <div class="flex gap-3 mt-2 text-xs text-gray-500">
                <span><i class="fas fa-tag"></i> ${doc.category}</span>
                <span><i class="fas fa-calendar"></i> ${formatDate(doc.uploadDate)}</span>
                <span><i class="fas fa-user"></i> ${doc.uploadedBy}</span>
              </div>
            </div>
            
            <div class="flex gap-2">
              ${isPdf ? `
                <button onclick="previewDocument('${doc.id}', '${doc.title}')"
                  class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors flex items-center gap-2"
                  title="Preview PDF">
                  <i class="fas fa-eye"></i>
                  <span class="hidden sm:inline">Preview</span>
                </button>
              ` : ''}
              <a href="/api/documents/download/${doc.id}" target="_blank"
                class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
                title="Download">
                <i class="fas fa-download"></i>
                <span class="hidden sm:inline">Download</span>
              </a>
              ${doc.canDelete ? `
                <button onclick="deleteDocument('${doc.id}')"
                  class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                  title="Hapus">
                  <i class="fas fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');
    }

    // Preview document - UPDATED
      function previewDocument(docId, title) {
        currentPreviewDocId = docId;
        const modal = document.getElementById('previewModal');
        const iframe = document.getElementById('pdfFrame');
        const titleEl = document.getElementById('previewTitle');
        
        titleEl.innerHTML = `<i class="fas fa-file-pdf text-red-600"></i> ${title}`;
        iframe.src = `/api/documents/preview/${docId}`;
        modal.style.display = 'flex'; // ✅ Ubah dari classList.add('active')
        
        // Prevent body scroll
        document.body.style.overflow = 'hidden';
      }

      // Close preview - UPDATED
      function closePreview(event) {
        if (event && event.target !== event.currentTarget) return;
        
        const modal = document.getElementById('previewModal');
        const iframe = document.getElementById('pdfFrame');
        
        modal.style.display = 'none'; // ✅ Ubah dari classList.remove('active')
        iframe.src = '';
        currentPreviewDocId = null;
        
        // Restore body scroll
        document.body.style.overflow = '';
      }

    // Download from preview
    function downloadFromPreview() {
      if (currentPreviewDocId) {
        window.open(`/api/documents/download/${currentPreviewDocId}`, '_blank');
      }
    }

    // Filter documents
    function filterDocuments() {
      applyFiltersAndSort();
    }

    // Sort documents
    function sortDocuments() {
      applyFiltersAndSort();
    }

    // Delete document
    async function deleteDocument(docId) {
      if (!confirm('Yakin ingin menghapus dokumen ini?')) return;
      
      try {
        const res = await fetch(`/api/documents/delete/${docId}`, {
          method: 'DELETE',
          credentials: 'include'
        });
        
        if (res.ok) {
          alert('✅ Dokumen berhasil dihapus');
          loadDocuments();
        } else {
          alert('❌ Gagal menghapus dokumen');
        }
      } catch (err) {
        console.error('Delete error:', err);
        alert('❌ Terjadi kesalahan');
      }
    }

    // Helper: Get file icon
    function getFileIcon(filename) {
      const ext = filename.split('.').pop().toLowerCase();
      if (ext === 'pdf') return 'pdf';
      if (['doc', 'docx'].includes(ext)) return 'word';
      if (['xls', 'xlsx'].includes(ext)) return 'excel';
      return 'alt';
    }

    // Helper: Format date
    function formatDate(dateString) {
      const date = new Date(dateString);
      return date.toLocaleDateString('id-ID', { 
        day: 'numeric', 
        month: 'short', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closePreview();
      }
    });

    // Initialize
    checkUserRole();
    loadDocuments();

  // ========================
  // Cek User & Load Dashboard
  // ========================

  async function checkUserAccess() {
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      if (!res.ok) throw new Error("Unauthorized");

      currentUser = await res.json();

      // Kalau tidak ada data user, redirect ke login
      if (!currentUser || !currentUser.email) {
        console.warn("User belum login, redirect ke login.html");
        window.location.href = "login.html";
        return;
      }

      console.log("Login sebagai:", currentUser);

      // Load dashboard sesuai role
      if (currentUser.role === "admin") {
        loadDashboard("ALL", "ALL", "ALL"); 
      } else if (currentUser.role === "head") {
        loadDashboard(currentUser.department, "ALL", "ALL");
      } else if (currentUser.role === "staff") {
        loadDashboard(currentUser.department, "ALL", currentUser.personal);
      }
    } catch (err) {
      console.error("Gagal checkUserAccess:", err);
      window.location.href = "login.html"; // fallback redirect
    }
  }

  // Jalankan saat halaman selesai load
  document.addEventListener("DOMContentLoaded", () => {
    checkUserAccess();
  });
  // Event listener filter
  document.getElementById('departmentFilter').addEventListener('change', e => { 
    const dept = e.target.value || 'ALL'; 
    document.getElementById('employeeFilter').value='ALL'; 
    loadDashboard(dept, document.getElementById('monthFilter').value||'ALL','ALL'); 
  });
  document.getElementById('monthFilter').addEventListener('change', e => 
    loadDashboard(document.getElementById('departmentFilter').value||'ALL', e.target.value||'ALL', document.getElementById('employeeFilter').value||'ALL')
  );
  document.getElementById('employeeFilter').addEventListener('change', e => 
    loadDashboard(document.getElementById('departmentFilter').value||'ALL', document.getElementById('monthFilter').value||'ALL', e.target.value||'ALL')
  );

  // Initialize
  populateFilters();
  fetchProjectKolaborasi();
  fetchProjectMandiri();
  window.loadDashboard = loadDashboard;
  document.addEventListener('DOMContentLoaded', loadDashboard);

