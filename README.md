# CatatKeuangan - Personal Expense Tracker

Aplikasi Pencatatan dan Pengelolaan Keuangan Pribadi modern, minimalis, profesional, dan responsif. Dirancang untuk memudahkan pengguna dalam mencatat pemasukan, pengeluaran, memantau kondisi keuangan sehari-hari, mengatur anggaran, dan mencapai target tabungan.

---

## 🚀 Fitur Utama

1. **Dashboard Modern**
   - Kartu Informasi Real-Time: Total Saldo, Total Pemasukan, Total Pengeluaran, Pengeluaran Hari Ini, dan Sisa Anggaran Bulanan.
   - Ringkasan Pengeluaran: Minggu ini dan bulan ini.
   - Grafik Interaktif: Perbandingan Pemasukan vs Pengeluaran (Bar Chart) dan Distribusi Pengeluaran per Kategori (Doughnut Chart) menggunakan Chart.js.
   - Tabel 10 transaksi terbaru.

2. **Pencatatan Transaksi Cepat & Fleksibel**
   - Tab switch mudah antara **Pemasukan** dan **Pengeluaran**.
   - Input: Nama transaksi, jumlah nominal (format Rupiah), kategori, tanggal transaksi, metode pembayaran (Tunai, Transfer Bank, E-Wallet, Kartu Debit, Kartu Kredit, QRIS), dan catatan tambahan.
   - Kategori bawaan lengkap + kebebasan menambah kategori baru.
   - Validasi ketat (nominal harus > 0).

3. **Riwayat Transaksi & Filter Lengkap**
   - Urutan otomatis dari yang terbaru.
   - Pencarian berdasarkan nama/keterangan transaksi.
   - Filter lengkap: Jenis transaksi (Pemasukan/Pengeluaran), Kategori, Tanggal (dari & sampai), serta Bulan tertentu.
   - Ringkasan total pemasukan & pengeluaran yang menyesuaikan hasil filter secara dinamis.
   - Fitur **Edit** dan **Hapus** transaksi dengan penyesuaian saldo seketika.
   - Paginasi rapi.

4. **Pengaturan Anggaran (Budgeting)**
   - Batas pengeluaran bulanan keseluruhan dan batas pengeluaran per kategori.
   - Progress bar dinamis dengan indikator warna:
     - 🟢 **Hijau (< 75%)**: Aman
     - 🟡 **Kuning (75% - 90%)**: Mendekati batas
     - 🔴 **Merah (> 90%)**: Peringatan batas terlampaui
   - Notifikasi otomatis saat pengeluaran mendekati atau melebihi anggaran.

5. **Laporan Keuangan & Ekspor**
   - Pilihan periode: **Harian**, **Mingguan**, **Bulanan**, dan **Tahunan**.
   - Grafik tren pemasukan/pengeluaran (Line Chart) dan diagram kategori (Pie Chart).
   - Daftar Kategori Pengeluaran Terbesar (Top Categories Ranking).
   - Rata-rata pengeluaran harian.
   - Ekspor laporan ke **PDF** (menggunakan jsPDF + AutoTable) dan **Excel** (menggunakan SheetJS/XLSX).

6. **Target Menabung (Savings Goals)**
   - Buat target tabungan dengan nama impian, target nominal, tanggal batas (deadline), dan ikon emoji.
   - Fitur "Tambah Tabungan" untuk menyetor uang ke tabungan kapan saja.
   - Progress bar persentase pencapaian dan sisa nominal yang harus dikumpulkan.
   - Kartu ucapan selamat otomatis saat target tabungan 100% tercapai.

7. **Pengaturan Akun & Personalisasi**
   - Ubah Nama Pengguna / Display Name.
   - Unggah Foto Profil (avatar) dengan penyimpanan lokal di server.
   - Atur Mata Uang (IDR - Rupiah) dan Tanggal Awal Bulan Anggaran (1 - 31).
   - Mode Tema: **Terang (Light Mode)** dan **Gelap (Dark Mode)**.
   - Pengelolaan Kategori Kustom (tambah & hapus).

8. **Sistem Keamanan & Multi-User**
   - Autentikasi Register & Login dengan enkripsi password **bcrypt**.
   - Sesi terenkripsi **JWT (JSON Web Token)** via HTTP-only cookie.
   - Isolasi data penuh: Setiap pengguna hanya dapat melihat dan mengelola data keuangannya sendiri.
   - Database SQLite persisten: Data tidak akan hilang saat reload.

---

## 💻 Cara Menjalankan Aplikasi

### Opsi 1: Menjalankan via File Batch (Paling Praktis)
Cukup klik dua kali file:
```
run.bat
```

### Opsi 2: Menjalankan via Terminal / PowerShell
Buka terminal di folder project ini:
```powershell
python server.py
```
atau gunakan full path Python:
```powershell
"C:\Users\ASUS\AppData\Local\Programs\Python\Python311\python.exe" server.py
```

### Membuka di Browser
Setelah server berjalan, buka browser dan akses:
👉 **http://localhost:3000**

---

## 📁 Struktur Direktori
```
catat keuangan/
├── server.py               # Backend API Flask + SQLite Database + Auth
├── database.db             # Database SQLite lokal (dibuat otomatis)
├── run.bat                 # Script batch untuk menjalankan server sekali klik
├── README.md               # Dokumentasi lengkap aplikasi
├── uploads/                # Direktori penyimpanan foto profil pengguna
└── public/
    ├── index.html          # Halaman autentikasi (Login & Registrasi)
    ├── app.html            # Single Page Application (Dashboard & seluruh modul)
    ├── css/
    │   └── style.css       # Desain modern, responsive, & tema dark/light
    └── js/
        └── app.js          # Logika frontend, API calls, navigasi, & Chart.js
```
