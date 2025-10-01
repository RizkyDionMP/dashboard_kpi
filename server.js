const express = require('express');
const session = require('express-session');
const path = require('path');
const { google } = require('googleapis');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = 3001;

// ========================
// Google Sheets Setup
// ========================
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const auth = new google.auth.JWT(
  credentials.client_email,
  null,
  credentials.private_key.replace(/\\n/g, '\n'),
  SCOPES
);

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = '1BzcBIofxJn5ktlZDVDnmhEwBwqmZvjAXEjPdK5jMqa0';

// ========================
// Middleware Setup
// ========================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: 'mazta_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
  })
);

// ========================
// Logger
// ========================
app.use((req, res, next) =>  {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ========================
// Authentication Endpoints
// ========================
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const users = await getUsers();
    const user = users.find(u => u.email === email && u.password === password);

    if (user) {
      req.session.isLoggedIn = true;
      req.session.email = user.email;
      req.session.department = user.department;
      req.session.role = user.role;
      req.session.personal = user.personal;
      req.session.user = user;

      res.json({ 
        success: true, 
        email: user.email,
        department: user.department, 
        role: user.role,
        personal: user.personal
      });
    } else {
      res.status(401).json({ success: false, message: 'Email atau password salah' });
    }
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


app.get('/check-login', (req, res) => {
  res.json({ loggedIn: !!req.session.isLoggedIn });
});

app.get('/user-info', (req, res) => {
  if (req.session.isLoggedIn) {
    res.json({ 
      email: req.session.email, 
      department: req.session.department || 'ALL',
      role: req.session.role || 'staff',
      personal: req.session.personal || null
    });
  } else {
    res.status(401).json({ message: 'Unauthorized' });
  }
});


app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// ========================
// Serve index.html
// ========================
app.get('/index.html', (req, res) => {
  if (req.session.isLoggedIn) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.redirect('/login.html');
  }
});

// ========================
// Middleware Require Login
// ========================
function requireLogin(req, res, next) {
  if (!req.session.isLoggedIn) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function getValue(obj, keys, fallback = '') {
  for (let key of keys) {
    if (obj[key]) return obj[key];
  }
  return fallback;
}

// ========================
// Helper Function: Get Sheet Data
// ========================
async function getSheetData(sheetName) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: "1BzcBIofxJn5ktlZDVDnmhEwBwqmZvjAXEjPdK5jMqa0",
    range: sheetName
  });

  const rows = response.data.values || [];
  if (!rows.length) return [];

  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] || '';
    });
    return obj;
  });
}

// function getUsers() {
async function getUsers() {
  const rows = await getSheetData('Users');
  return rows.map(row => ({
    email: row.Email,
    password: row.Password,
    department: row.Department,
    role: row.Role,
    personal: row.Personal || null
  }));
}

// ========================
// API: Current User Info
// ========================
app.get('/api/me', requireLogin, (req, res) => {
  res.json({
    email: req.session.email,
    department: req.session.department || 'ALL',
    role: req.session.role || 'staff',
    personal: req.session.personal || null
  });
});

// Workload
app.get('/api/workload', requireLogin, async (req, res) => {
  try {
    let data = await getSheetData('Workload');
    if (req.session.department !== 'ALL') {
      data = data.filter(item => 
      getValue(item, ['Departemen','Department']).toLowerCase().trim() === 
      req.session.department.toLowerCase().trim()
      );
    }
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Gagal mengambil data Workload' });
  }
});

// KPI Personal
app.get('/api/kpi_personal', requireLogin, async (req, res) => {
  try {
    let data = await getSheetData('Kpi_personal');

    const deptQuery = (req.query.dept || "").toLowerCase().trim();
    const sessionDept = (req.session.department || "").toLowerCase().trim();
    const role = (req.session.role || "").toLowerCase();

    // 1️⃣ Kalau role staff → hanya KPI miliknya
    if (role === 'staff' && req.session.personal) {
      const personal = (req.session.personal || "").toLowerCase().trim();
      data = data.filter(
        item => (item.Personal || item.Personil || "").toLowerCase().trim() === personal
      );
    } else {
      // 2️⃣ Kalau ada dept di query → pakai itu
      if (deptQuery) {
        data = data.filter(
          item =>
            (item.Departemen || item.Department || "").toLowerCase().trim() === deptQuery
        );
      }
      // 3️⃣ Kalau tidak ada query dan session dept ≠ ALL → pakai session
      else if (sessionDept && sessionDept !== "all") {
        data = data.filter(
          item =>
            (item.Departemen || item.Department || "").toLowerCase().trim() === sessionDept
        );
      }
    }

    res.json(data);
  } catch (err) {
    console.error("Error KPI Personal:", err);
    res.status(500).json({ error: "Gagal mengambil data Kpi_personal" });
  }
});

// Sasaran Mutu
app.get('/api/sasaranmutu', requireLogin, async (req, res) => {
  try {
    let data = await getSheetData('SasaranMutu');
    if (req.session.department !== 'ALL') {
      data = data.filter(item => 
    getValue(item, ['Departemen','Department']).toLowerCase().trim() === 
    req.session.department.toLowerCase().trim()
    );
    }
    res.json(data);
  } catch (err) {
    console.error("Error SasaranMutu:", err);
    res.status(500).json({ error: 'Gagal mengambil data SasaranMutu' });
  }
});

// Indikator Personal
app.get('/api/indikatorpersonal', requireLogin, async (req, res) => {
  try {
    let data = await getSheetData('indikatorpersonal');
    if (req.session.department !== 'ALL') {
      data = data.filter(item => 
    getValue(item, ['Departemen','Department']).toLowerCase().trim() === 
    req.session.department.toLowerCase().trim()
    );
    }
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Gagal mengambil data indikatorpersonal' });
  }
});

app.get('/api/ranking_dept', requireLogin, async (req, res) => {
  try {
    let data = await getSheetData('Kpi_personal');

    // 🚀 Staff → hanya departemen dia
    if (req.session.role && req.session.role.toLowerCase() === 'staff') {
      data = data.filter(item => 
        (getValue(item, ['Departemen','Department']) || "")
          .toString().toLowerCase().trim() === 
        (req.session.department || "").toString().toLowerCase().trim()
      );
    }

    // 📊 Group by department dan hitung rata-rata dari SEMUA entry (semua bulan)
    const deptMap = {};
    
    data.forEach(item => {
      const dept = item.Departemen || item.Department || 'Unknown';
      const rawScore = item['Nilai KPI'] ? String(item['Nilai KPI']).replace(",", ".") : "0";
      const score = parseFloat(rawScore) || 0;

      if (!deptMap[dept]) {
        deptMap[dept] = { 
          totalScore: 0, 
          count: 0 
        };
      }
      
      deptMap[dept].totalScore += score;
      deptMap[dept].count += 1;
    });

    // Hitung rata-rata per departemen
    const ranking = Object.entries(deptMap)
      .map(([dept, { totalScore, count }]) => ({
        department: dept,
        avgKpi: count > 0 ? (totalScore / count) : 0,
        totalEntries: count  // bonus: total data (karyawan x bulan)
      }))
      .sort((a, b) => b.avgKpi - a.avgKpi)
      .map((item, index) => ({ rank: index + 1, ...item }));

    // ✅ Kirim data user ke frontend
    res.json({
      rankings: ranking,
      currentUser: {
        role: req.session.role || 'staff',
        department: req.session.department || '',
        name: req.session.name || ''
      }
    });
  } catch (err) {
    console.error("Error Ranking Dept:", err);
    res.status(500).json({ error: 'Gagal memuat data ranking departemen' });
  }
});

function getKpiGrade(nilaiKpi) {
  if (nilaiKpi >= 4.5) {
    return { 
      grade: 'A', 
      label: 'Sangat Baik',
      percentage: 100,
      percentageRange: '91% - 100%',
      color: '#10b981', // green
      bgColor: '#d1fae5'
    };
  } else if (nilaiKpi >= 3.5) {
    return { 
      grade: 'B', 
      label: 'Baik',
      percentage: 90,
      percentageRange: '81% - 90%',
      color: '#3b82f6', // blue
      bgColor: '#dbeafe'
    };
  } else if (nilaiKpi >= 2.5) {
    return { 
      grade: 'C', 
      label: 'Cukup',
      percentage: 80,
      percentageRange: '71% - 80%',
      color: '#f59e0b', // orange
      bgColor: '#fef3c7'
    };
  } else if (nilaiKpi >= 1.5) {
    return { 
      grade: 'D', 
      label: 'Kurang',
      percentage: 70,
      percentageRange: '61% - 70%',
      color: '#ef4444', // red
      bgColor: '#fee2e2'
    };
  } else {
    return { 
      grade: 'E', 
      label: 'Sangat Kurang',
      percentage: 60,
      percentageRange: '<60%',
      color: '#991b1b', // dark red
      bgColor: '#fecaca'
    };
  }
}

// Modifikasi endpoint /api/dept-summary
app.get('/api/dept-summary', requireLogin, async (req, res) => {
  try {
    const deptName = req.query.dept;
    if (!deptName) {
      return res.status(400).json({ error: 'Parameter dept wajib diisi' });
    }

    // 🔒 Validasi: Head hanya bisa akses dept sendiri
    if (req.session.role?.toLowerCase() === 'head') {
      if (deptName.toLowerCase().trim() !== (req.session.department || '').toLowerCase().trim()) {
        return res.status(403).json({ 
          error: 'Anda hanya dapat melihat data departemen sendiri' 
        });
      }
    }

    let data = await getSheetData('kpihead');
    
    if (req.session.role?.toLowerCase() === 'staff') {
      data = data.filter(r =>
        (r.Divisi || '').toLowerCase().trim() ===
        (req.session.department || '').toLowerCase().trim()
      );
    }

    const rows = data.filter(r =>
      (r.Divisi || '').toLowerCase().trim() === deptName.toLowerCase().trim()
    );

    if (!rows.length) {
      return res.json({
        avgKpi: 0,
        achSasaranMutu: 0,
        achProject: 0,
        nilaiPimpinan: 0,
        kehadiran: 0,
        nilaiKpiHead: 0,
        grade: getKpiGrade(0)
      });
    }

    const getNum = (row, key) => {
      const raw = row[key];
      if (!raw) return 0;
      const cleaned = String(raw)
        .replace(/%/g, '')
        .replace(',', '.')
        .trim();
      return parseFloat(cleaned) || 0;
    };

    let totalKpi = 0,
      totalSasaran = 0,
      totalProject = 0,
      totalPimpinan = 0,
      totalKehadiran = 0;

    rows.forEach(r => {
      totalKpi       += getNum(r, 'Kpi team');
      totalSasaran   += getNum(r, 'Ach Sasaran Mutu');
      totalProject   += getNum(r, 'Ach Project');
      totalPimpinan  += getNum(r, 'Nilai Pimpinan');
      totalKehadiran += getNum(r, 'Kehadiran / Kedisiplinan');
    });

    const count = rows.length;

    const avgKpi         = totalKpi / count;
    const achSasaranMutu = totalSasaran / count;
    const achProject     = totalProject / count;
    const nilaiPimpinan  = totalPimpinan / count;
    const kehadiran      = totalKehadiran / count;

    const persentase = (avgKpi + achSasaranMutu + achProject + nilaiPimpinan + kehadiran) / 5;

    let nilaiKpiHead;
    if (persentase >= 100) {
      nilaiKpiHead = 5;
    } else {
      nilaiKpiHead = (persentase / 100) * 4;
    }

    // ✅ Tambahkan grade info
    const gradeInfo = getKpiGrade(nilaiKpiHead);

    res.json({
      avgKpi,
      achSasaranMutu,
      achProject,
      nilaiPimpinan,
      kehadiran,
      nilaiKpiHead,
      persentase: persentase.toFixed(2),
      grade: gradeInfo
    });
  } catch (err) {
    console.error('❌ Error dept-summary:', err);
    res.status(500).json({ error: 'Gagal memuat summary departemen' });
  }
});

// ==========================
// Ranking Employee
// ==========================
app.get('/api/ranking_employee', requireLogin, async (req, res) => {
  try {
    const deptFilter = req.query.dept;
    let data = await getSheetData('Kpi_personal');

    // 🚀 Staff → hanya departemen dia
    if (req.session.role?.toLowerCase() === 'staff') {
      data = data.filter(item => 
        (getValue(item, ['Departemen','Department']) || "")
          .toString().toLowerCase().trim() === 
        (req.session.department || "").toString().toLowerCase().trim()
      );
    }

    // Filter by dept jika ada parameter
    if (deptFilter) {
      data = data.filter(item => {
        const dept = getValue(item, ['Departemen', 'Department']) || '';
        return dept.toString().toLowerCase().trim() === deptFilter.toLowerCase().trim();
      });
    }

    // 📊 Group by employee dan hitung rata-rata dari semua bulan
    const employeeMap = {};
    
    data.forEach(item => {
      const name = item.Personal || item.Nama || 'Unknown';
      const dept = item.Departemen || item.Department || '-';
      const rawScore = item['Nilai KPI'] ? String(item['Nilai KPI']).replace(",", ".") : "0";
      const score = parseFloat(rawScore) || 0;

      // Buat key unik per employee
      const key = `${name}_${dept}`;
      
      if (!employeeMap[key]) {
        employeeMap[key] = {
          personal: name,
          dept: dept,
          totalScore: 0,
          count: 0
        };
      }
      
      employeeMap[key].totalScore += score;
      employeeMap[key].count += 1;
    });

    // Hitung rata-rata per employee
    const employees = Object.values(employeeMap).map(emp => ({
      personal: emp.personal,
      dept: emp.dept,
      avgKpi: emp.count > 0 ? (emp.totalScore / emp.count) : 0,
      totalMonths: emp.count  // bonus: tampilkan jumlah bulan
    }));

    // Sort dan beri ranking
    const ranking = employees
      .sort((a, b) => b.avgKpi - a.avgKpi)
      .map((item, index) => ({ 
        rank: index + 1, 
        ...item 
      }));

    res.json(ranking);
  } catch (err) {
    console.error("Error Ranking Employee:", err);
    res.status(500).json({ error: 'Gagal memuat data ranking employee' });
  }
});

// Top & Under Performing Departemen
app.get('/api/top_under_performer', requireLogin, async (req, res) => {
  try {
    let data = await getSheetData('Kpi_personal');
    if (req.session.department !== 'ALL') {
      data = data.filter(item => 
    getValue(item, ['Departemen','Department']).toLowerCase().trim() === 
    req.session.department.toLowerCase().trim()
    );
    }

    const deptMap = {};
    data.forEach(item => {
      const dept = item.Departemen || 'Unknown';
      const score = Number(item['Nilai KPI'] || 0);
      if (!deptMap[dept]) deptMap[dept] = { totalScore: 0, count: 0 };
      deptMap[dept].totalScore += score;
      deptMap[dept].count += 1;
    });

    const deptAvg = Object.entries(deptMap)
      .map(([dept, { totalScore, count }]) => ({
        department: dept,
        avgKpi: count ? (totalScore / count).toFixed(2) : 0
      }))
      .sort((a, b) => b.avgKpi - a.avgKpi);

    const topDept = deptAvg.length ? deptAvg[0].department : '-';
    const underDept = deptAvg.length ? deptAvg[deptAvg.length - 1].department : '-';

    res.json({ topDepartment: topDept, underDepartment: underDept });
  } catch {
    res.status(500).json({ error: 'Gagal memuat data departemen performer' });
  }
});

// KPI Summary
app.get('/api/kpi_summary', requireLogin, async (req, res) => {
  try {
    let data = await getSheetData('Kpi_personal');
    if (req.session.department !== 'ALL') {
      data = data.filter(item => 
    getValue(item, ['Departemen','Department']).toLowerCase().trim() === 
    req.session.department.toLowerCase().trim()
    );
    }
    const totalEmployees = new Set(data.map(i => i.Personal)).size;
    const scores = data.map(i => Number(i['Nilai KPI'] || 0));
    const avgKpi = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const count90Up = scores.filter(s => s >= 90).length;
    const countUnder70 = scores.filter(s => s < 70).length;

    res.json({ totalEmployees, avgKpi: avgKpi.toFixed(2), count90Up, countUnder70 });
  } catch {
    res.status(500).json({ error: 'Gagal memuat summary KPI' });
  }
});

    // ================= KPI Personal untuk Head =================
app.get('/api/kpi_personal/head', requireLogin, async (req, res) => {
  try {
    let data = await getSheetData('Kpi_personal');
    if (req.session.department && req.session.department !== 'ALL') {
      data = data.filter(item => 
        (item.Departemen || item.Department || '').toLowerCase().trim() === 
        req.session.department.toLowerCase().trim()
      );
    }
    res.json(data);
  } catch (err) {
    console.error("Error KPI Head:", err);
    res.status(500).json({ error: 'Gagal ambil data Head' });
  }
});

// ================= KPI Personal untuk Staff =================
app.get('/api/kpi_personal/staff', requireLogin, async (req, res) => {
  try {
    let data = await getSheetData('Kpi_personal');
    if (req.session.role === 'staff' && req.session.personal) {
      data = data.filter(item => 
        (item.Personal || item.Personil || '').toLowerCase().trim() === 
        req.session.personal.toLowerCase().trim()
      );
    }
    res.json(data);
  } catch (err) {
    console.error("Error KPI Staff:", err);
    res.status(500).json({ error: 'Gagal ambil data Staff' });
  }
});

// ========================
// BACKEND: API Routes
// ========================

// Utility function untuk mendapatkan nilai dari object
function getValue(item, keys) {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) {
      return item[key];
    }
  }
  return '';
}

// ========================
// API: Project Kolaborasi Summary
// ========================
app.get('/api/project/kolaborasi', requireLogin, async (req, res) => {
  try {
    let data = await getSheetData('Projectkolaborasi');
    
    // Filter sesuai session department
    if (req.session.department && req.session.department !== 'ALL') {
      data = data.filter(item =>
        getValue(item, ['Department']).toLowerCase().trim() ===
        req.session.department.toLowerCase().trim()
      );
    }

    console.log('Project Kolaborasi data:', data); // Debug log
    res.json(data);
  } catch (err) {
    console.error("Error Project Kolaborasi:", err);
    res.status(500).json({ error: 'Gagal mengambil data Project Kolaborasi' });
  }
});

// ========================
// API: Project Mandiri Summary  
// ========================
app.get('/api/project/mandiri', requireLogin, async (req, res) => {
  try {
    let data = await getSheetData('Projectmandiri');

    // Filter sesuai session department
    if (req.session.department && req.session.department !== 'ALL') {
      data = data.filter(item =>
        getValue(item, ['Department']).toLowerCase().trim() ===
        req.session.department.toLowerCase().trim()
      );
    }

    console.log('Project Mandiri data:', data); // Debug log
    res.json(data);
  } catch (err) {
    console.error("Error Project Mandiri:", err);
    res.status(500).json({ error: 'Gagal mengambil data Project Mandiri' });
  }
});

// ========================
// API: Detail Project Kolaborasi
// ========================
app.get('/api/project/detailkolaborasi', requireLogin, async (req, res) => {
  try {
    let data = await getSheetData('detailkolaborasi');

    // Filter sesuai session department
    if (req.session.department && req.session.department !== 'ALL') {
      data = data.filter(item =>
        getValue(item, ['Department']).toLowerCase().trim() ===
        req.session.department.toLowerCase().trim()
      );
    }

    console.log('Detail Kolaborasi data:', data); // Debug log
    res.json(data);
  } catch (err) {
    console.error("Error Detail Project Kolaborasi:", err);
    res.status(500).json({ error: 'Gagal mengambil data Detail Project Kolaborasi' });
  }
});

// ========================
// API: Detail Project Mandiri
// ========================
app.get('/api/project/detailmandiri', requireLogin, async (req, res) => {
  try {
    let data = await getSheetData('detailmandiri');

    // Filter sesuai session department  
    if (req.session.department && req.session.department !== 'ALL') {
      data = data.filter(item =>
        getValue(item, ['Department']).toLowerCase().trim() ===
        req.session.department.toLowerCase().trim()
      );
    }

    console.log('Detail Mandiri data:', data); // Debug log
    res.json(data);
  } catch (err) {
    console.error("Error Detail Project Mandiri:", err);
    res.status(500).json({ error: 'Gagal mengambil data Detail Project Mandiri' });
  }
});

// ========================
// API: ALL PROJECTS (untuk filter department) - MISSING ENDPOINT INI!
// ========================
app.get('/api/project/all', requireLogin, async (req, res) => {
  try {
    // Get data dari semua sheets
    const kolaborasiData = await getSheetData('Projectkolaborasi');
    const mandiriData = await getSheetData('Projectmandiri');
    const detailKolaborasiData = await getSheetData('detailkolaborasi');
    const detailMandiriData = await getSheetData('detailmandiri');

    // Gabungkan semua data untuk mendapatkan list departments
    const allData = [
      ...kolaborasiData,
      ...mandiriData,
      ...detailKolaborasiData,
      ...detailMandiriData
    ];

    console.log('All Projects data for filter:', allData.length, 'records'); // Debug log
    res.json(allData);
  } catch (err) {
    console.error("Error All Projects:", err);
    res.status(500).json({ error: 'Gagal mengambil data semua projects' });
  }
});

// ========================
// API: Project Summary Statistics
// ========================
app.get('/api/project/summary', requireLogin, async (req, res) => {
  try {
    // Get both kolaborasi and mandiri data
    let kolaborasiData = await getSheetData('Projectkolaborasi');
    let mandiriData = await getSheetData('Projectmandiri');
    
    // Filter by department if needed
    if (req.session.department && req.session.department !== 'ALL') {
      const dept = req.session.department.toLowerCase().trim();
      kolaborasiData = kolaborasiData.filter(item =>
        getValue(item, ['Department']).toLowerCase().trim() === dept
      );
      mandiriData = mandiriData.filter(item =>
        getValue(item, ['Department']).toLowerCase().trim() === dept
      );
    }

    // Calculate totals
    const calculateTotals = (data) => {
      return data.reduce((acc, item) => {
        acc.done += parseInt(getValue(item, ['Done'])) || 0;
        acc.progress += parseInt(getValue(item, ['On Progress'])) || 0;
        acc.overdue += parseInt(getValue(item, ['Over Due'])) || 0;
        return acc;
      }, { done: 0, progress: 0, overdue: 0 });
    };

    const kolaborasiTotals = calculateTotals(kolaborasiData);
    const mandiriTotals = calculateTotals(mandiriData);

    const summary = {
      total: kolaborasiTotals.done + kolaborasiTotals.progress + kolaborasiTotals.overdue +
             mandiriTotals.done + mandiriTotals.progress + mandiriTotals.overdue,
      done: kolaborasiTotals.done + mandiriTotals.done,
      overdue: kolaborasiTotals.overdue + mandiriTotals.overdue
    };

    console.log('Project Summary:', summary); // Debug log
    res.json(summary);
  } catch (err) {
    console.error("Error Project Summary:", err);
    res.status(500).json({ error: 'Gagal mengambil summary project' });
  }
});

// ========================
// GET Semua Komentar (untuk frontend)
// ========================
console.log("✅ Route /api/komentar REGISTERED");

app.get('/api/komentar', requireLogin, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: '1BzcBIofxJn5ktlZDVDnmhEwBwqmZvjAXEjPdK5jMqa0',
      range: "Komentar!A:F",
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      return res.json([]); // kosong kalau cuma header
    }

    const data = rows.slice(1).map(r => ({
      rowId: r[0],        // RowID
      department: r[1],   // Department
      bulan: r[2],        // Bulan
      komentar: r[3],     // Komentar
      dibuatOleh: r[4],   // DibuatOleh
      tanggal: r[5],      // Tanggal
    }));

    res.json(data);
  } catch (err) {
    console.error("❌ ERROR GET KOMENTAR:", err.message, err.errors || err);
    res.status(500).json({ error: "Gagal load komentar", detail: err.message });
  }
});

// Ambil komentar dari sheet
app.get('/api/debug/komentar', requireLogin, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: '1BzcBIofxJn5ktlZDVDnmhEwBwqmZvjAXEjPdK5jMqa0',
      range: "Komentar!A:F",  // ambil 6 kolom
    });

    const rows = response.data.values || [];
    console.log("📄 DEBUG KOMENTAR SHEET:", rows);

    if (rows.length === 0) {
      return res.json({ message: "Sheet Komentar kosong" });
    }

    res.json({
      header: rows[0],
      sample: rows.slice(1, 6) // tampilkan 5 baris pertama setelah header
    });
  } catch (err) {
    console.error("❌ ERROR DEBUG KOMENTAR:", err.message, err.errors || err);
    res.status(500).json({ error: "Gagal baca sheet Komentar", detail: err.message });
  }
});

// Simpan Komentar ke Google Sheet
// ========================
app.post('/api/komentar', requireLogin, async (req, res) => {
  try {
    const { rowId, department, bulan, komentar } = req.body;

    if (!rowId || !department || !bulan || !komentar) {
      return res.status(400).json({ success: false, error: "Data tidak lengkap" });
    }

    const dibuatOleh = req.session.user?.name || req.session.email || "UNKNOWN";
    const tanggal = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    console.log("📥 KOMENTAR MASUK:", { rowId, department, bulan, komentar, dibuatOleh, tanggal });

    // langsung pakai Google Sheets API append (pastikan range A:F)
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Komentar!A:F",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      resource: {
        values: [[rowId, department, bulan, komentar, dibuatOleh, tanggal]]
      }
    });

    console.log("✅ BERHASIL SIMPAN KOMENTAR:", response.data.updates);
    res.json({ success: true, message: "Komentar berhasil disimpan" });

  } catch (err) {
    console.error("❌ Error simpan komentar:", err?.response?.data || err.stack || err.message || err);
    res.status(500).json({ success: false, error: "Gagal simpan komentar", detail: err?.message || String(err) });
  }
});

app.get('/api/chartsarmut', requireLogin, async (req, res) => {
  try {
    console.log("🔍 Fetch chartsarmut...");
    console.log("🔍 Session department:", req.session.department);
    console.log("🔍 Session user:", req.session.username);
    
    let data = await getSheetData('chartsarmut');
    console.log("✅ Raw data chartsarmut:", data.length);
    
    // Debug: lihat sample data
    if (data.length > 0) {
      console.log("✅ Sample data structure:", Object.keys(data[0]));
      console.log("✅ Sample data row:", data[0]);
    }

    // UNTUK HEAD/ADMIN (ALL) - tampilkan semua data MKT
    if (req.session.department === 'ALL') {
      // Coba berbagai nama kolom department
      const beforeFilter = data.length;
      data = data.filter(item => {
        const deptVariations = [
          item.DEPT, item.Dept, item.dept,
          item.DEPARTMENT, item.Department, item.department,
          item.Departemen, item.departemen,
          item.DEPT_NAME, item.Dept_Name
        ];
        
        const itemDept = deptVariations.find(d => d)?.toString().toLowerCase().trim();
        console.log("🔍 Checking dept:", itemDept, "against: mkt");
        
        return itemDept === 'mkt' || itemDept === 'marketing';
      });
      
      console.log(`✅ Filtered MKT data for head/admin: ${beforeFilter} -> ${data.length}`);
      return res.json(data);
    }

    // UNTUK USER DEPARTMENT MKT
    if (req.session.department === 'MKT') {
      data = data.filter(item => {
        const itemDept = (item.DEPT || item.Dept || item.Department || item.Departemen || "").toLowerCase().trim();
        return itemDept === 'mkt' || itemDept === 'marketing';
      });
      console.log("✅ Filtered MKT data for MKT user:", data.length);
      return res.json(data);
    }

    // UNTUK DEPARTMENT LAIN - tidak ada akses ke chart sarmut
    console.log("⚠️ Department tidak memiliki akses chart sarmut:", req.session.department);
    return res.json([]);

  } catch (err) {
    console.error("❌ Error chartsarmut:", err);
    res.status(500).json({ error: 'Gagal mengambil data chartsarmut', detail: err.message });
  }
});

// ========================
// API: Sarmut Indikator
// ========================
app.get('/api/sarmutindikator', requireLogin, async (req, res) => {
  try {
    console.log("🔍 Fetch sarmutindikator...");
    let data = await getSheetData('sarmutindikator');
    console.log("✅ Data sarmutindikator:", data.length);

    // filter departemen sesuai session login (kecuali admin ALL)
    if (req.session.department && req.session.department !== 'ALL') {
      data = data.filter(item =>
        (item.DEPT || item.Dept || "").toLowerCase().trim() ===
        req.session.department.toLowerCase().trim()
      );
    }

    res.json(data);
  } catch (err) {
    console.error("❌ Error sarmutindikator:", err);
    res.status(500).json({ 
      error: 'Gagal mengambil data sarmutindikator', 
      detail: err.message 
    });
  }
});

// Setup Multer untuk upload file
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = './uploads/documents';
    // Buat folder jika belum ada
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: function (req, file, cb) {
    const allowedTypes = /pdf|doc|docx|xls|xlsx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('File harus berformat PDF, DOC, DOCX, XLS, atau XLSX'));
    }
  }
});

// ==========================================
// API ENDPOINTS
// ==========================================

// 📤 Upload Document
app.post('/api/documents/upload', requireLogin, upload.single('document'), async (req, res) => {
  try {
    console.log('Upload attempt by:', req.session.name, 'Role:', req.session.role);
    
    // Hanya admin dan head yang bisa upload
    if (req.session.role !== 'admin' && req.session.role !== 'head') {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Anda tidak memiliki akses untuk upload dokumen' });
    }

    const { title, category, description } = req.body;
    const file = req.file;

    console.log('Upload data:', { title, category, hasFile: !!file });

    if (!file) {
      return res.status(400).json({ error: 'File dokumen wajib diupload' });
    }

    if (!title || !category) {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'Judul dan kategori wajib diisi' });
    }

    // Ambil data existing dari sheet documents
    let existingData = [];
    try {
      existingData = await getSheetData('documents');
    } catch (err) {
      console.log('Sheet documents belum ada atau kosong, akan dibuat baris baru');
    }

    const newRow = [
      Date.now().toString(),
      title,
      category,
      description || '',
      file.filename,
      file.originalname,
      file.size.toString(),
      req.session.name || req.session.username,
      new Date().toISOString(),
    ];

    console.log('Attempting to write to sheet documents:', newRow);

    const spreadsheetId = SPREADSHEET_ID;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'documents!A:I',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [newRow] }
    });

    console.log('Sheet append successful');

    res.json({
      success: true,
      message: 'Dokumen berhasil diupload',
      document: {
        id: newRow[0],
        title,
        category,
        filename: file.filename
      }
    });

  } catch (err) {
    console.error('Upload error DETAILS:', err.message);
    console.error('Full error:', err);
    
    // Hapus file jika ada error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: 'Gagal upload dokumen',
      details: err.message 
    });
  }
});

// 📋 Get All Documents
app.get('/api/documents', requireLogin, async (req, res) => {
  try {
    console.log("Fetch documents...");
    const category = req.query.category;
    let data = await getSheetData('documents');
    console.log("Data documents:", data.length);

    // Filter by category jika ada
    if (category) {
      data = data.filter(doc => doc.Category === category);
    }

    const documents = data.map(doc => ({
      id: doc.ID,
      title: doc.Title,
      category: doc.Category,
      description: doc.Description,
      filename: doc.Filename,
      originalName: doc.OriginalName,
      fileSize: doc.FileSize,
      uploadedBy: doc.UploadedBy,
      uploadDate: doc.UploadDate,
      canDelete: req.session.role === 'admin' || doc.UploadedBy === req.session.name
    }));

    res.json(documents);
  } catch (err) {
    console.error('Error loading documents:', err);
    res.status(500).json({ error: 'Gagal memuat dokumen', detail: err.message });
  }
});

// 📥 Download Document
app.get('/api/documents/download/:id', requireLogin, async (req, res) => {
  try {
    const docId = req.params.id;
    const data = await getSheetData('documents');
    const doc = data.find(d => d.ID === docId);

    if (!doc) {
      return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
    }

    const filePath = path.join(__dirname, 'uploads', 'documents', doc.Filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File tidak ditemukan di server' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${doc.OriginalName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Gagal download dokumen' });
  }
});

// 👁️ Preview Document (untuk PDF)
app.get('/api/documents/preview/:id', requireLogin, async (req, res) => {
  try {
    const docId = req.params.id;
    const data = await getSheetData('documents');
    const doc = data.find(d => d.ID === docId);

    if (!doc) {
      return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
    }

    const filePath = path.join(__dirname, 'uploads', 'documents', doc.Filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File tidak ditemukan di server' });
    }

    const isPdf = doc.OriginalName.toLowerCase().endsWith('.pdf');
    
    if (!isPdf) {
      return res.status(400).json({ error: 'Preview hanya tersedia untuk file PDF' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.OriginalName}"`);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

  } catch (err) {
    console.error('Preview error:', err);
    res.status(500).json({ error: 'Gagal preview dokumen' });
  }
});

// 🗑️ Delete Document
app.delete('/api/documents/delete/:id', requireLogin, async (req, res) => {
  try {
    const docId = req.params.id;
    const data = await getSheetData('documents');
    const docIndex = data.findIndex(d => d.ID === docId);

    if (docIndex === -1) {
      return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
    }

    const doc = data[docIndex];

    if (req.session.role !== 'admin' && doc.UploadedBy !== req.session.name) {
      return res.status(403).json({ error: 'Anda tidak memiliki akses untuk menghapus dokumen ini' });
    }

    // Hapus file dari server
    const filePath = path.join(__dirname, 'uploads', 'documents', doc.Filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const spreadsheetId = SPREADSHEET_ID;

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `documents!A${docIndex + 2}:I${docIndex + 2}`,
    });

    res.json({ success: true, message: 'Dokumen berhasil dihapus' });

  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Gagal menghapus dokumen' });
  }
});

// 📋 Get All Documents
app.get('/api/documents', requireLogin, async (req, res) => {
  try {
    const category = req.query.category;
    let data = await getSheetData('documents');

    // Filter by category jika ada
    if (category) {
      data = data.filter(doc => doc.Category === category);
    }

    const documents = data.map(doc => ({
      id: doc.ID,
      title: doc.Title,
      category: doc.Category,
      description: doc.Description,
      filename: doc.Filename,
      originalName: doc.OriginalName,
      fileSize: doc.FileSize,
      uploadedBy: doc.UploadedBy,
      uploadDate: doc.UploadDate,
      // User hanya bisa delete dokumen sendiri (atau admin bisa delete semua)
      canDelete: req.session.role === 'admin' || doc.UploadedBy === req.session.name
    }));

    res.json(documents);
  } catch (err) {
    console.error('Error loading documents:', err);
    res.status(500).json({ error: 'Gagal memuat dokumen' });
  }
});

// 📥 Download Document
app.get('/api/documents/download/:id', requireLogin, async (req, res) => {
  try {
    const docId = req.params.id;
    const data = await getSheetData('documents');
    const doc = data.find(d => d.ID === docId);

    if (!doc) {
      return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
    }

    const filePath = path.join(__dirname, 'uploads', 'documents', doc.Filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File tidak ditemukan di server' });
    }

    // Set headers untuk download
    res.setHeader('Content-Disposition', `attachment; filename="${doc.OriginalName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    // Stream file ke response
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Gagal download dokumen' });
  }
});

// 👁️ Preview Document (untuk PDF)
app.get('/api/documents/preview/:id', requireLogin, async (req, res) => {
  try {
    const docId = req.params.id;
    const data = await getSheetData('documents');
    const doc = data.find(d => d.ID === docId);

    if (!doc) {
      return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
    }

    const filePath = path.join(__dirname, 'uploads', 'documents', doc.Filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File tidak ditemukan di server' });
    }

    // Cek apakah file adalah PDF
    const isPdf = doc.OriginalName.toLowerCase().endsWith('.pdf');
    
    if (!isPdf) {
      return res.status(400).json({ error: 'Preview hanya tersedia untuk file PDF' });
    }

    // Set headers untuk preview inline (tidak download)
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.OriginalName}"`);

    // Stream file ke response
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

  } catch (err) {
    console.error('Preview error:', err);
    res.status(500).json({ error: 'Gagal preview dokumen' });
  }
});

// 🗑️ Delete Document
app.delete('/api/documents/delete/:id', requireLogin, async (req, res) => {
  try {
    const docId = req.params.id;
    const data = await getSheetData('documents');
    const docIndex = data.findIndex(d => d.ID === docId);

    if (docIndex === -1) {
      return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
    }

    const doc = data[docIndex];

    // Cek permission: admin bisa hapus semua, user hanya bisa hapus miliknya
    if (req.session.role !== 'admin' && doc.UploadedBy !== req.session.name) {
      return res.status(403).json({ error: 'Anda tidak memiliki akses untuk menghapus dokumen ini' });
    }

    // Hapus file dari server
    const filePath = path.join(__dirname, 'uploads', 'documents', doc.Filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Hapus row dari Google Sheets
    const sheets = await getGoogleSheetsClient();
    const spreadsheetId = process.env.SPREADSHEET_ID;

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `documents!A${docIndex + 2}:I${docIndex + 2}`, // +2 karena header + index mulai dari 0
    });

    res.json({ success: true, message: 'Dokumen berhasil dihapus' });

  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Gagal menghapus dokumen' });
  }
});

// ==========================================
// API untuk mendapatkan session user saat ini
// ==========================================
app.get('/api/current-session', requireLogin, (req, res) => {
  res.json({
    username: req.session.username,
    name: req.session.name,
    role: req.session.role,
    department: req.session.department
  });
});

// ========================
// Start Server (Local Only)
// ========================
if (process.env.VERCEL) {
  module.exports = app; // Untuk Vercel
} else {
  app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
  });
}

