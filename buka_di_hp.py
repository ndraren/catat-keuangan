import os
import sys
import time
import re
import socket
import subprocess

# Pastikan UTF-8 encoding di Windows cmd agar tidak crash charmap
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"

def is_server_running(port=3000):
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1.0)
        res = sock.connect_ex(("127.0.0.1", port))
        sock.close()
        return res == 0
    except Exception:
        return False

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    cloudflared_path = os.path.join(base_dir, "cloudflared.exe")

    print("=" * 64)
    print(" [*] MEMPERSIAPKAN AKSES APLIKASI CATAT KEUANGAN UNTUK HP...")
    print("=" * 64)

    # 1. Jalankan Flask Server jika belum jalan
    server_proc = None
    if not is_server_running(3000):
        print(">> Menjalankan server backend (server.py)...")
        server_py = os.path.join(base_dir, "server.py")
        server_proc = subprocess.Popen([sys.executable, server_py], cwd=base_dir)
        
        # Tunggu sampai server up
        for _ in range(15):
            time.sleep(1)
            if is_server_running(3000):
                print("[OK] Server backend berhasil aktif di port 3000!")
                break
        else:
            print("[!] Server backend mungkin butuh waktu beberapa detik...")
    else:
        print("[OK] Server backend sudah aktif di port 3000.")

    # 2. Periksa cloudflared.exe
    if not os.path.exists(cloudflared_path):
        print("[X] File cloudflared.exe tidak ditemukan di folder proyek!")
        return

    # 3. Jalankan Cloudflare Tunnel
    print(">> Menghubungkan ke Cloudflare Tunnel (Internet Publik)...")
    cf_proc = subprocess.Popen(
        [cloudflared_path, "tunnel", "--url", "http://localhost:3000"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1
    )

    tunnel_url = None
    pattern = re.compile(r"https://([a-zA-Z0-9-]+)\.trycloudflare\.com")

    # Baca output cloudflared untuk menemukan link URL
    start_time = time.time()
    try:
        for line in cf_proc.stdout:
            match = pattern.search(line)
            if match:
                subdomain = match.group(1).lower()
                if subdomain != "api":
                    tunnel_url = match.group(0)
                    break
            if time.time() - start_time > 30:
                break
    except Exception as e:
        print(f"[!] Error membaca tunnel: {e}")

    local_ip = get_local_ip()

    print("\n" + "=" * 64)
    print("  SUKSES! WEB APLIKASI ANDA SUDAH BISA DIAKSES DARI HP")
    print("=" * 64)

    if tunnel_url:
        print("\n [1] LINK INTERNET (Bisa dibuka dari HP via Kuota / Wi-Fi mana saja):")
        print(f"     LINK : {tunnel_url}")
    else:
        print("\n [1] LINK INTERNET:")
        print("     (Menghubungkan... jika belum muncul, pastikan laptop konek internet)")

    print(f"\n [2] LINK WI-FI LOKAL (Jika HP & Laptop terhubung ke Wi-Fi yang sama):")
    print(f"     LINK : http://{local_ip}:3000")

    print("\n" + "-" * 64)
    print(" CARA MEMBUKA DI HP:")
    print(" 1. Buka browser di HP Anda (Google Chrome / Safari / Samsung Internet).")
    print(" 2. Ketik / buka link di atas (Paling mudah gunakan Link [1]).")
    print(" 3. Login dengan akun Anda atau klik 'Daftar Sekarang'.")
    print(" 4. Tips: Di browser HP, klik menu titik tiga -> 'Tambahkan ke Layar Utama'")
    print("    agar web ini terpasang seperti aplikasi mobile asli di HP!")
    print("-" * 64)
    print(" PERHATIAN: Jendela ini harus tetap terbuka selama Anda pakai di HP.")
    print(" Tekan [CTRL + C] di jendela ini jika ingin mematikan aplikasi.")
    print("=" * 64 + "\n")

    try:
        # Loop tunggu sampai user menekan Ctrl+C
        while True:
            time.sleep(1)
            if cf_proc.poll() is not None:
                print("\n[!] Cloudflare Tunnel terhenti.")
                break
    except KeyboardInterrupt:
        print("\n\nMematikan server dan tunnel...")
    finally:
        try:
            cf_proc.terminate()
            cf_proc.wait(timeout=2)
        except Exception:
            pass

        if server_proc:
            try:
                server_proc.terminate()
                server_proc.wait(timeout=2)
            except Exception:
                pass
        print("[OK] Selesai. Aplikasi dinonaktifkan.")

if __name__ == "__main__":
    main()
