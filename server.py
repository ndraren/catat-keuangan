import os
import sqlite3
import hashlib
import uuid
import json
from datetime import datetime, date, timedelta
from functools import wraps

from flask import (
    Flask, request, jsonify, g, send_from_directory,
    make_response, send_file
)
import jwt
import bcrypt
try:
    import pymysql
    import pymysql.cursors
    HAS_PYMYSQL = True
except ImportError:
    HAS_PYMYSQL = False

# ---------------------------------------------------------------------------
# App configuration
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(BASE_DIR, "database.db")
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
PUBLIC_FOLDER = os.path.join(BASE_DIR, "public")
JWT_SECRET = os.environ.get("JWT_SECRET", "catat-keuangan-super-secure-jwt-secret-key-32bytes-long-2024-xyz!")
JWT_ALGORITHM = "HS256"
JWT_EXP_HOURS = 72

# MySQL Configuration for phpMyAdmin (Laragon / XAMPP)
MYSQL_CONFIG = {
    "host": os.environ.get("MYSQL_HOST", "localhost"),
    "port": int(os.environ.get("MYSQL_PORT", 3306)),
    "user": os.environ.get("MYSQL_USER", "root"),
    "password": os.environ.get("MYSQL_PASSWORD", ""),
    "database": os.environ.get("MYSQL_DB", "db_catat_keuangan"),
    "charset": "utf8mb4",
    "autocommit": True
}

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # 5 MB

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(PUBLIC_FOLDER, exist_ok=True)

# ---------------------------------------------------------------------------
# Database helpers (MySQL phpMyAdmin with SQLite fallback)
# ---------------------------------------------------------------------------

class MySQLWrapper:
    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params=None):
        converted_sql = sql.replace("?", "%s")
        cur = self.conn.cursor(pymysql.cursors.DictCursor)
        if params:
            cur.execute(converted_sql, params)
        else:
            cur.execute(converted_sql)
        return cur

    def commit(self):
        try:
            self.conn.commit()
        except Exception:
            pass

    def close(self):
        try:
            self.conn.close()
        except Exception:
            pass


def get_db():
    """Return a database connection (prioritizes MySQL / phpMyAdmin)."""
    if "db" not in g:
        # 1. Try MySQL phpMyAdmin first
        if HAS_PYMYSQL:
            try:
                conn = pymysql.connect(**MYSQL_CONFIG)
                g.db = MySQLWrapper(conn)
                g.db_type = "mysql"
                return g.db
            except Exception:
                pass

        # 2. Fallback to SQLite
        conn = sqlite3.connect(DATABASE)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        g.db = conn
        g.db_type = "sqlite"
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables in MySQL (phpMyAdmin) and SQLite."""
    # 1. Initialize MySQL database in phpMyAdmin if available
    if HAS_PYMYSQL:
        try:
            mysql_root = pymysql.connect(
                host=MYSQL_CONFIG["host"],
                user=MYSQL_CONFIG["user"],
                password=MYSQL_CONFIG["password"],
                port=MYSQL_CONFIG["port"],
                autocommit=True
            )
            with mysql_root.cursor() as cur:
                cur.execute(f"CREATE DATABASE IF NOT EXISTS `{MYSQL_CONFIG['database']}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;")
            mysql_root.close()

            m_conn = pymysql.connect(**MYSQL_CONFIG)
            with m_conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS users (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        username VARCHAR(100) NOT NULL UNIQUE,
                        email VARCHAR(150) NOT NULL UNIQUE,
                        password VARCHAR(255) NOT NULL,
                        display_name VARCHAR(150),
                        profile_picture VARCHAR(255) DEFAULT '',
                        currency VARCHAR(10) DEFAULT 'IDR',
                        budget_start_day INT DEFAULT 1,
                        theme VARCHAR(20) DEFAULT 'light',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS categories (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        user_id INT NOT NULL,
                        name VARCHAR(100) NOT NULL,
                        type ENUM('income', 'expense') NOT NULL,
                        icon VARCHAR(20) DEFAULT '📁',
                        is_default TINYINT(1) DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS transactions (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        user_id INT NOT NULL,
                        type ENUM('income', 'expense') NOT NULL,
                        name VARCHAR(200) NOT NULL,
                        amount DOUBLE NOT NULL,
                        category_id INT,
                        date DATE NOT NULL,
                        payment_method VARCHAR(50) DEFAULT '',
                        notes TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS budgets (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        user_id INT NOT NULL,
                        category_id INT,
                        amount DOUBLE NOT NULL,
                        month VARCHAR(7) NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS savings_goals (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        user_id INT NOT NULL,
                        name VARCHAR(150) NOT NULL,
                        target_amount DOUBLE NOT NULL,
                        current_amount DOUBLE DEFAULT 0,
                        deadline DATE,
                        icon VARCHAR(20) DEFAULT '🎯',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                """)
            m_conn.close()
            print("[Database] Terhubung ke MySQL phpMyAdmin: db_catat_keuangan")
        except Exception as e:
            print("[Database] MySQL phpMyAdmin belum aktif, berjalan di SQLite:", e)

    conn = sqlite3.connect(DATABASE)
    conn.execute("PRAGMA foreign_keys=ON")
    cur = conn.cursor()

    cur.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            display_name TEXT,
            profile_picture TEXT DEFAULT '',
            currency TEXT DEFAULT 'IDR',
            budget_start_day INTEGER DEFAULT 1,
            theme TEXT DEFAULT 'light',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
            icon TEXT DEFAULT '📁',
            is_default INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
            name TEXT NOT NULL,
            amount REAL NOT NULL CHECK(amount > 0),
            category_id INTEGER,
            date TEXT NOT NULL,
            payment_method TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (category_id) REFERENCES categories(id)
        );

        CREATE TABLE IF NOT EXISTS budgets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            category_id INTEGER,
            amount REAL NOT NULL CHECK(amount > 0),
            month TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (category_id) REFERENCES categories(id)
        );

        CREATE TABLE IF NOT EXISTS savings_goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            target_amount REAL NOT NULL CHECK(target_amount > 0),
            current_amount REAL DEFAULT 0,
            deadline TEXT,
            icon TEXT DEFAULT '🎯',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    """)

    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Default categories helper
# ---------------------------------------------------------------------------

DEFAULT_INCOME_CATEGORIES = [
    ("Uang Saku", "💰"),
    ("Gaji", "💵"),
    ("Bonus", "🎁"),
    ("Hadiah", "🎀"),
    ("Lainnya", "📁"),
]

DEFAULT_EXPENSE_CATEGORIES = [
    ("Makanan dan Minuman", "🍔"),
    ("Transportasi", "🚗"),
    ("Pendidikan", "📚"),
    ("Belanja", "🛒"),
    ("Hiburan", "🎬"),
    ("Kesehatan", "💊"),
    ("Tagihan", "📄"),
    ("Kebutuhan Pribadi", "👤"),
    ("Lainnya", "📁"),
]


def insert_default_categories(user_id: int):
    db = get_db()
    for name, icon in DEFAULT_INCOME_CATEGORIES:
        db.execute(
            "INSERT INTO categories (user_id, name, type, icon, is_default) VALUES (?, ?, 'income', ?, 1)",
            (user_id, name, icon),
        )
    for name, icon in DEFAULT_EXPENSE_CATEGORIES:
        db.execute(
            "INSERT INTO categories (user_id, name, type, icon, is_default) VALUES (?, ?, 'expense', ?, 1)",
            (user_id, name, icon),
        )
    db.commit()


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def create_token(user_id: int) -> str:
    payload = {
        "user_id": user_id,
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXP_HOURS),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str):
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def set_token_cookie(response, token: str):
    response.set_cookie(
        "token",
        token,
        httponly=True,
        samesite="Lax",
        max_age=JWT_EXP_HOURS * 3600,
        path="/",
    )
    return response


# ---------------------------------------------------------------------------
# Auth decorator
# ---------------------------------------------------------------------------

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.cookies.get("token")
        if not token:
            return jsonify({"error": "Authentication required"}), 401
        payload = decode_token(token)
        if not payload:
            return jsonify({"error": "Invalid or expired token"}), 401
        g.user_id = payload["user_id"]
        return f(*args, **kwargs)
    return decorated


# ---------------------------------------------------------------------------
# Utility: row → dict
# ---------------------------------------------------------------------------

def serialize_db_value(val):
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    if hasattr(val, "as_tuple"):  # Decimal
        return float(val)
    return val


def row_to_dict(row):
    if row is None:
        return None
    return {k: serialize_db_value(v) for k, v in dict(row).items()}


def rows_to_list(rows):
    return [row_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Static file serving
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    token = request.cookies.get("token")
    if token:
        payload = decode_token(token)
        if payload:
            app_html = os.path.join(PUBLIC_FOLDER, "app.html")
            if os.path.isfile(app_html):
                return send_file(app_html)
    index_html = os.path.join(PUBLIC_FOLDER, "index.html")
    if os.path.isfile(index_html):
        return send_file(index_html)
    return "Public folder is empty", 404


@app.route("/public/<path:filename>")
def serve_public(filename):
    return send_from_directory(PUBLIC_FOLDER, filename)


@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)


@app.route("/css/<path:filename>")
def serve_css(filename):
    return send_from_directory(os.path.join(PUBLIC_FOLDER, "css"), filename)


@app.route("/js/<path:filename>")
def serve_js(filename):
    return send_from_directory(os.path.join(PUBLIC_FOLDER, "js"), filename)


@app.route("/img/<path:filename>")
def serve_img(filename):
    return send_from_directory(os.path.join(PUBLIC_FOLDER, "img"), filename)



# ===================================================================
#  AUTH ROUTES  /api/auth
# ===================================================================

@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    try:
        data = request.get_json(force=True)
        username = (data.get("username") or "").strip()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        display_name = (data.get("display_name") or username).strip()

        if not username or not email or not password:
            return jsonify({"error": "Username, email, and password are required"}), 400
        if len(password) < 6:
            return jsonify({"error": "Password must be at least 6 characters"}), 400

        hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

        db = get_db()
        try:
            cur = db.execute(
                "INSERT INTO users (username, email, password, display_name) VALUES (?, ?, ?, ?)",
                (username, email, hashed, display_name),
            )
            db.commit()
        except sqlite3.IntegrityError as ie:
            msg = str(ie).lower()
            if "email" in msg:
                return jsonify({"error": "Email already registered"}), 409
            if "username" in msg:
                return jsonify({"error": "Username already taken"}), 409
            return jsonify({"error": "Username or email already exists"}), 409

        user_id = cur.lastrowid
        insert_default_categories(user_id)

        token = create_token(user_id)
        resp = make_response(jsonify({
            "message": "Registration successful",
            "user": {
                "id": user_id,
                "username": username,
                "email": email,
                "display_name": display_name,
            },
        }), 201)
        return set_token_cookie(resp, token)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    try:
        data = request.get_json(force=True)
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""

        if not email or not password:
            return jsonify({"error": "Email and password are required"}), 400

        db = get_db()
        user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if not user:
            return jsonify({"error": "Invalid email or password"}), 401

        if not bcrypt.checkpw(password.encode("utf-8"), user["password"].encode("utf-8")):
            return jsonify({"error": "Invalid email or password"}), 401

        token = create_token(user["id"])
        resp = make_response(jsonify({
            "message": "Login successful",
            "user": {
                "id": user["id"],
                "username": user["username"],
                "email": user["email"],
                "display_name": user["display_name"],
                "profile_picture": user["profile_picture"],
                "currency": user["currency"],
                "theme": user["theme"],
            },
        }))
        return set_token_cookie(resp, token)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/auth/logout", methods=["GET", "POST"])
def auth_logout():
    resp = make_response(jsonify({"message": "Logged out successfully"}))
    resp.delete_cookie("token", path="/")
    resp.set_cookie("token", "", expires=0, max_age=0, path="/")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


@app.route("/api/auth/me", methods=["GET"])
@login_required
def auth_me():
    try:
        db = get_db()
        user = db.execute(
            "SELECT id, username, email, display_name, profile_picture, currency, budget_start_day, theme, created_at FROM users WHERE id = ?",
            (g.user_id,),
        ).fetchone()
        if not user:
            return jsonify({"error": "User not found"}), 404
        return jsonify({"user": row_to_dict(user)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ===================================================================
#  TRANSACTION ROUTES  /api/transactions
# ===================================================================

@app.route("/api/transactions/summary", methods=["GET"])
@login_required
def transactions_summary():
    try:
        db = get_db()
        ref_date_str = request.args.get("date")
        if ref_date_str:
            ref_date = datetime.strptime(ref_date_str, "%Y-%m-%d").date()
        else:
            ref_date = datetime.now().date()

        today_str = ref_date.isoformat()
        month_str = ref_date.strftime("%Y-%m")

        # Monday of this week
        weekday = ref_date.weekday()  # Monday=0
        week_start = (ref_date - timedelta(days=weekday)).isoformat()
        week_end = (ref_date - timedelta(days=weekday) + timedelta(days=6)).isoformat()

        month_start = f"{month_str}-01"
        # last day of month
        if ref_date.month == 12:
            month_end_date = ref_date.replace(year=ref_date.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            month_end_date = ref_date.replace(month=ref_date.month + 1, day=1) - timedelta(days=1)
        month_end = month_end_date.isoformat()

        # Total income / expense (all time)
        row = db.execute(
            "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS total_income, "
            "COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS total_expense "
            "FROM transactions WHERE user_id=?",
            (g.user_id,),
        ).fetchone()
        total_income = row["total_income"]
        total_expense = row["total_expense"]
        balance = total_income - total_expense

        # Today expense
        today_row = db.execute(
            "SELECT COALESCE(SUM(amount),0) AS v FROM transactions WHERE user_id=? AND type='expense' AND date=?",
            (g.user_id, today_str),
        ).fetchone()

        # This week expense
        week_row = db.execute(
            "SELECT COALESCE(SUM(amount),0) AS v FROM transactions WHERE user_id=? AND type='expense' AND date>=? AND date<=?",
            (g.user_id, week_start, week_end),
        ).fetchone()

        # This month expense
        month_expense_row = db.execute(
            "SELECT COALESCE(SUM(amount),0) AS v FROM transactions WHERE user_id=? AND type='expense' AND date>=? AND date<=?",
            (g.user_id, month_start, month_end),
        ).fetchone()

        # This month income
        month_income_row = db.execute(
            "SELECT COALESCE(SUM(amount),0) AS v FROM transactions WHERE user_id=? AND type='income' AND date>=? AND date<=?",
            (g.user_id, month_start, month_end),
        ).fetchone()

        return jsonify({
            "total_income": total_income,
            "total_expense": total_expense,
            "balance": balance,
            "today_expense": today_row["v"],
            "this_week_expense": week_row["v"],
            "this_month_expense": month_expense_row["v"],
            "this_month_income": month_income_row["v"],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/transactions/recent", methods=["GET"])
@login_required
def transactions_recent():
    try:
        db = get_db()
        rows = db.execute(
            "SELECT t.*, c.name AS category_name, c.icon AS category_icon "
            "FROM transactions t LEFT JOIN categories c ON t.category_id=c.id "
            "WHERE t.user_id=? ORDER BY t.date DESC, t.id DESC LIMIT 10",
            (g.user_id,),
        ).fetchall()
        return jsonify({"transactions": rows_to_list(rows)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/transactions/chart-data", methods=["GET"])
@login_required
def transactions_chart_data():
    try:
        db = get_db()
        year = request.args.get("year", str(datetime.now().year))

        rows = db.execute(
            "SELECT substr(date,6,2) AS m, "
            "COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS income, "
            "COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense "
            "FROM transactions WHERE user_id=? AND substr(date,1,4)=? "
            "GROUP BY m ORDER BY m",
            (g.user_id, year),
        ).fetchall()

        data_map = {r["m"]: {"income": r["income"], "expense": r["expense"]} for r in rows}
        result = []
        for i in range(1, 13):
            key = f"{i:02d}"
            entry = data_map.get(key, {"income": 0, "expense": 0})
            result.append({"month": f"{year}-{key}", "income": entry["income"], "expense": entry["expense"]})

        return jsonify({"chart_data": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/transactions/category-summary", methods=["GET"])
@login_required
def transactions_category_summary():
    try:
        db = get_db()
        month = request.args.get("month", datetime.now().strftime("%Y-%m"))

        rows = db.execute(
            "SELECT c.name AS category_name, c.icon, COALESCE(SUM(t.amount),0) AS total "
            "FROM transactions t JOIN categories c ON t.category_id=c.id "
            "WHERE t.user_id=? AND t.type='expense' AND substr(t.date,1,7)=? "
            "GROUP BY t.category_id ORDER BY total DESC",
            (g.user_id, month),
        ).fetchall()

        return jsonify({"category_summary": rows_to_list(rows)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/transactions", methods=["GET"])
@login_required
def transactions_list():
    try:
        db = get_db()
        conditions = ["t.user_id=?"]
        params: list = [g.user_id]

        type_filter = request.args.get("type")
        if type_filter in ("income", "expense"):
            conditions.append("t.type=?")
            params.append(type_filter)

        cat_id = request.args.get("category_id")
        if cat_id:
            conditions.append("t.category_id=?")
            params.append(int(cat_id))

        search = request.args.get("search")
        if search:
            conditions.append("(t.name LIKE ? OR t.notes LIKE ?)")
            like = f"%{search}%"
            params.extend([like, like])

        date_from = request.args.get("date_from")
        if date_from:
            conditions.append("t.date>=?")
            params.append(date_from)

        date_to = request.args.get("date_to")
        if date_to:
            conditions.append("t.date<=?")
            params.append(date_to)

        month = request.args.get("month")
        if month:
            conditions.append("substr(t.date,1,7)=?")
            params.append(month)

        where = " AND ".join(conditions)

        # Summary matching filters
        summary = db.execute(
            f"SELECT COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END),0) AS total_income, "
            f"COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END),0) AS total_expense "
            f"FROM transactions t WHERE {where}",
            params,
        ).fetchone()

        sort = request.args.get("sort", "date_desc")
        sort_map = {
            "date_desc": "t.date DESC, t.id DESC",
            "date_asc": "t.date ASC, t.id ASC",
            "amount_desc": "t.amount DESC",
            "amount_asc": "t.amount ASC",
        }
        order = sort_map.get(sort, "t.date DESC, t.id DESC")

        limit = request.args.get("limit")
        offset = request.args.get("offset")
        limit_clause = ""
        if limit:
            limit_clause = f" LIMIT {int(limit)}"
            if offset:
                limit_clause += f" OFFSET {int(offset)}"

        rows = db.execute(
            f"SELECT t.*, c.name AS category_name, c.icon AS category_icon "
            f"FROM transactions t LEFT JOIN categories c ON t.category_id=c.id "
            f"WHERE {where} ORDER BY {order}{limit_clause}",
            params,
        ).fetchall()

        # total count
        count_row = db.execute(
            f"SELECT COUNT(*) AS cnt FROM transactions t WHERE {where}",
            params,
        ).fetchone()

        return jsonify({
            "transactions": rows_to_list(rows),
            "total": count_row["cnt"],
            "summary": {
                "total_income": summary["total_income"],
                "total_expense": summary["total_expense"],
            },
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/transactions", methods=["POST"])
@login_required
def transactions_create():
    try:
        data = request.get_json(force=True)
        txn_type = data.get("type")
        name = (data.get("name") or "").strip()
        amount = data.get("amount")
        category_id = data.get("category_id")
        date = data.get("date")
        payment_method = data.get("payment_method", "")
        notes = data.get("notes", "")

        if txn_type not in ("income", "expense"):
            return jsonify({"error": "Type must be 'income' or 'expense'"}), 400
        if not name:
            return jsonify({"error": "Name is required"}), 400
        if amount is None or float(amount) <= 0:
            return jsonify({"error": "Amount must be greater than 0"}), 400
        if not date:
            return jsonify({"error": "Date is required"}), 400

        db = get_db()
        cur = db.execute(
            "INSERT INTO transactions (user_id, type, name, amount, category_id, date, payment_method, notes) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (g.user_id, txn_type, name, float(amount), category_id, date, payment_method, notes),
        )
        db.commit()

        txn = db.execute(
            "SELECT t.*, c.name AS category_name, c.icon AS category_icon "
            "FROM transactions t LEFT JOIN categories c ON t.category_id=c.id WHERE t.id=?",
            (cur.lastrowid,),
        ).fetchone()

        return jsonify({"message": "Transaction created", "transaction": row_to_dict(txn)}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/transactions/<int:txn_id>", methods=["PUT"])
@login_required
def transactions_update(txn_id):
    try:
        db = get_db()
        existing = db.execute(
            "SELECT * FROM transactions WHERE id=? AND user_id=?", (txn_id, g.user_id)
        ).fetchone()
        if not existing:
            return jsonify({"error": "Transaction not found"}), 404

        data = request.get_json(force=True)
        txn_type = data.get("type", existing["type"])
        name = (data.get("name") or existing["name"]).strip()
        amount = data.get("amount", existing["amount"])
        category_id = data.get("category_id", existing["category_id"])
        date = data.get("date", existing["date"])
        payment_method = data.get("payment_method", existing["payment_method"])
        notes = data.get("notes", existing["notes"])

        if txn_type not in ("income", "expense"):
            return jsonify({"error": "Type must be 'income' or 'expense'"}), 400
        if float(amount) <= 0:
            return jsonify({"error": "Amount must be greater than 0"}), 400

        db.execute(
            "UPDATE transactions SET type=?, name=?, amount=?, category_id=?, date=?, payment_method=?, notes=? WHERE id=?",
            (txn_type, name, float(amount), category_id, date, payment_method, notes, txn_id),
        )
        db.commit()

        txn = db.execute(
            "SELECT t.*, c.name AS category_name, c.icon AS category_icon "
            "FROM transactions t LEFT JOIN categories c ON t.category_id=c.id WHERE t.id=?",
            (txn_id,),
        ).fetchone()

        return jsonify({"message": "Transaction updated", "transaction": row_to_dict(txn)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/transactions/<int:txn_id>", methods=["DELETE"])
@login_required
def transactions_delete(txn_id):
    try:
        db = get_db()
        existing = db.execute(
            "SELECT * FROM transactions WHERE id=? AND user_id=?", (txn_id, g.user_id)
        ).fetchone()
        if not existing:
            return jsonify({"error": "Transaction not found"}), 404

        db.execute("DELETE FROM transactions WHERE id=?", (txn_id,))
        db.commit()
        return jsonify({"message": "Transaction deleted"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ===================================================================
#  BUDGET ROUTES  /api/budgets
# ===================================================================

@app.route("/api/budgets", methods=["GET"])
@login_required
def budgets_list():
    try:
        db = get_db()
        month = request.args.get("month", datetime.now().strftime("%Y-%m"))
        month_start = f"{month}-01"
        # end of month
        year_m = datetime.strptime(month, "%Y-%m")
        if year_m.month == 12:
            month_end_date = year_m.replace(year=year_m.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            month_end_date = year_m.replace(month=year_m.month + 1, day=1) - timedelta(days=1)
        month_end = month_end_date.strftime("%Y-%m-%d")

        budgets = db.execute(
            "SELECT b.*, c.name AS category_name, c.icon AS category_icon "
            "FROM budgets b LEFT JOIN categories c ON b.category_id=c.id "
            "WHERE b.user_id=? AND b.month=?",
            (g.user_id, month),
        ).fetchall()

        result = []
        overall_budget = 0
        overall_spent = 0

        for b in budgets:
            bd = dict(b)
            if bd["category_id"] is not None:
                spent_row = db.execute(
                    "SELECT COALESCE(SUM(amount),0) AS spent FROM transactions "
                    "WHERE user_id=? AND type='expense' AND category_id=? AND date>=? AND date<=?",
                    (g.user_id, bd["category_id"], month_start, month_end),
                ).fetchone()
            else:
                spent_row = db.execute(
                    "SELECT COALESCE(SUM(amount),0) AS spent FROM transactions "
                    "WHERE user_id=? AND type='expense' AND date>=? AND date<=?",
                    (g.user_id, month_start, month_end),
                ).fetchone()

            spent = spent_row["spent"]
            bd["spent"] = spent
            bd["remaining"] = bd["amount"] - spent
            result.append(bd)

            overall_budget += bd["amount"]
            overall_spent += spent

        return jsonify({
            "budgets": result,
            "overall": {
                "budget": overall_budget,
                "spent": overall_spent,
                "remaining": overall_budget - overall_spent,
            },
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/budgets", methods=["POST"])
@login_required
def budgets_create():
    try:
        data = request.get_json(force=True)
        category_id = data.get("category_id")  # None for overall
        amount = data.get("amount")
        month = data.get("month", datetime.now().strftime("%Y-%m"))

        if amount is None or float(amount) <= 0:
            return jsonify({"error": "Amount must be greater than 0"}), 400

        db = get_db()

        # Check if budget already exists for this category+month
        if category_id is not None:
            existing = db.execute(
                "SELECT id FROM budgets WHERE user_id=? AND category_id=? AND month=?",
                (g.user_id, category_id, month),
            ).fetchone()
        else:
            existing = db.execute(
                "SELECT id FROM budgets WHERE user_id=? AND category_id IS NULL AND month=?",
                (g.user_id, month),
            ).fetchone()

        if existing:
            # Update existing
            db.execute(
                "UPDATE budgets SET amount=? WHERE id=?",
                (float(amount), existing["id"]),
            )
            db.commit()
            budget = db.execute(
                "SELECT b.*, c.name AS category_name, c.icon AS category_icon "
                "FROM budgets b LEFT JOIN categories c ON b.category_id=c.id WHERE b.id=?",
                (existing["id"],),
            ).fetchone()
            return jsonify({"message": "Budget updated", "budget": row_to_dict(budget)})
        else:
            cur = db.execute(
                "INSERT INTO budgets (user_id, category_id, amount, month) VALUES (?, ?, ?, ?)",
                (g.user_id, category_id, float(amount), month),
            )
            db.commit()
            budget = db.execute(
                "SELECT b.*, c.name AS category_name, c.icon AS category_icon "
                "FROM budgets b LEFT JOIN categories c ON b.category_id=c.id WHERE b.id=?",
                (cur.lastrowid,),
            ).fetchone()
            return jsonify({"message": "Budget created", "budget": row_to_dict(budget)}), 201

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/budgets/<int:budget_id>", methods=["PUT"])
@login_required
def budgets_update(budget_id):
    try:
        db = get_db()
        existing = db.execute(
            "SELECT * FROM budgets WHERE id=? AND user_id=?", (budget_id, g.user_id)
        ).fetchone()
        if not existing:
            return jsonify({"error": "Budget not found"}), 404

        data = request.get_json(force=True)
        amount = data.get("amount", existing["amount"])

        if float(amount) <= 0:
            return jsonify({"error": "Amount must be greater than 0"}), 400

        db.execute("UPDATE budgets SET amount=? WHERE id=?", (float(amount), budget_id))
        db.commit()

        budget = db.execute(
            "SELECT b.*, c.name AS category_name, c.icon AS category_icon "
            "FROM budgets b LEFT JOIN categories c ON b.category_id=c.id WHERE b.id=?",
            (budget_id,),
        ).fetchone()
        return jsonify({"message": "Budget updated", "budget": row_to_dict(budget)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/budgets/<int:budget_id>", methods=["DELETE"])
@login_required
def budgets_delete(budget_id):
    try:
        db = get_db()
        existing = db.execute(
            "SELECT * FROM budgets WHERE id=? AND user_id=?", (budget_id, g.user_id)
        ).fetchone()
        if not existing:
            return jsonify({"error": "Budget not found"}), 404

        db.execute("DELETE FROM budgets WHERE id=?", (budget_id,))
        db.commit()
        return jsonify({"message": "Budget deleted"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ===================================================================
#  SAVINGS ROUTES  /api/savings
# ===================================================================

@app.route("/api/savings", methods=["GET"])
@login_required
def savings_list():
    try:
        db = get_db()
        rows = db.execute(
            "SELECT * FROM savings_goals WHERE user_id=? ORDER BY created_at DESC",
            (g.user_id,),
        ).fetchall()

        result = []
        for r in rows:
            d = dict(r)
            d["percentage"] = round((d["current_amount"] / d["target_amount"]) * 100, 2) if d["target_amount"] > 0 else 0
            result.append(d)

        return jsonify({"savings_goals": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/savings", methods=["POST"])
@login_required
def savings_create():
    try:
        data = request.get_json(force=True)
        name = (data.get("name") or "").strip()
        target_amount = data.get("target_amount")
        deadline = data.get("deadline")
        icon = data.get("icon", "🎯")

        if not name:
            return jsonify({"error": "Name is required"}), 400
        if target_amount is None or float(target_amount) <= 0:
            return jsonify({"error": "Target amount must be greater than 0"}), 400

        db = get_db()
        cur = db.execute(
            "INSERT INTO savings_goals (user_id, name, target_amount, deadline, icon) VALUES (?, ?, ?, ?, ?)",
            (g.user_id, name, float(target_amount), deadline, icon),
        )
        db.commit()

        goal = db.execute("SELECT * FROM savings_goals WHERE id=?", (cur.lastrowid,)).fetchone()
        d = dict(goal)
        d["percentage"] = 0
        return jsonify({"message": "Savings goal created", "savings_goal": d}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/savings/<int:goal_id>", methods=["PUT"])
@login_required
def savings_update(goal_id):
    try:
        db = get_db()
        existing = db.execute(
            "SELECT * FROM savings_goals WHERE id=? AND user_id=?", (goal_id, g.user_id)
        ).fetchone()
        if not existing:
            return jsonify({"error": "Savings goal not found"}), 404

        data = request.get_json(force=True)
        name = (data.get("name") or existing["name"]).strip()
        target_amount = data.get("target_amount", existing["target_amount"])
        current_amount = data.get("current_amount", existing["current_amount"])
        deadline = data.get("deadline", existing["deadline"])
        icon = data.get("icon", existing["icon"])

        if float(target_amount) <= 0:
            return jsonify({"error": "Target amount must be greater than 0"}), 400

        db.execute(
            "UPDATE savings_goals SET name=?, target_amount=?, current_amount=?, deadline=?, icon=? WHERE id=?",
            (name, float(target_amount), float(current_amount), deadline, icon, goal_id),
        )
        db.commit()

        goal = db.execute("SELECT * FROM savings_goals WHERE id=?", (goal_id,)).fetchone()
        d = dict(goal)
        d["percentage"] = round((d["current_amount"] / d["target_amount"]) * 100, 2) if d["target_amount"] > 0 else 0
        return jsonify({"message": "Savings goal updated", "savings_goal": d})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/savings/<int:goal_id>/add", methods=["PUT"])
@login_required
def savings_add(goal_id):
    try:
        db = get_db()
        existing = db.execute(
            "SELECT * FROM savings_goals WHERE id=? AND user_id=?", (goal_id, g.user_id)
        ).fetchone()
        if not existing:
            return jsonify({"error": "Savings goal not found"}), 404

        data = request.get_json(force=True)
        add_amount = data.get("amount")
        if add_amount is None or float(add_amount) <= 0:
            return jsonify({"error": "Amount must be greater than 0"}), 400

        new_amount = existing["current_amount"] + float(add_amount)
        db.execute(
            "UPDATE savings_goals SET current_amount=? WHERE id=?",
            (new_amount, goal_id),
        )
        db.commit()

        goal = db.execute("SELECT * FROM savings_goals WHERE id=?", (goal_id,)).fetchone()
        d = dict(goal)
        d["percentage"] = round((d["current_amount"] / d["target_amount"]) * 100, 2) if d["target_amount"] > 0 else 0
        return jsonify({"message": "Amount added", "savings_goal": d})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/savings/<int:goal_id>", methods=["DELETE"])
@login_required
def savings_delete(goal_id):
    try:
        db = get_db()
        existing = db.execute(
            "SELECT * FROM savings_goals WHERE id=? AND user_id=?", (goal_id, g.user_id)
        ).fetchone()
        if not existing:
            return jsonify({"error": "Savings goal not found"}), 404

        db.execute("DELETE FROM savings_goals WHERE id=?", (goal_id,))
        db.commit()
        return jsonify({"message": "Savings goal deleted"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ===================================================================
#  CATEGORY ROUTES  /api/categories
# ===================================================================

@app.route("/api/categories", methods=["GET"])
@login_required
def categories_list():
    try:
        db = get_db()
        type_filter = request.args.get("type")
        if type_filter in ("income", "expense"):
            rows = db.execute(
                "SELECT * FROM categories WHERE user_id=? AND type=? ORDER BY is_default DESC, name ASC",
                (g.user_id, type_filter),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM categories WHERE user_id=? ORDER BY type, is_default DESC, name ASC",
                (g.user_id,),
            ).fetchall()
        return jsonify({"categories": rows_to_list(rows)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/categories", methods=["POST"])
@login_required
def categories_create():
    try:
        data = request.get_json(force=True)
        name = (data.get("name") or "").strip()
        cat_type = data.get("type")
        icon = data.get("icon", "📁")

        if not name:
            return jsonify({"error": "Name is required"}), 400
        if cat_type not in ("income", "expense"):
            return jsonify({"error": "Type must be 'income' or 'expense'"}), 400

        db = get_db()
        cur = db.execute(
            "INSERT INTO categories (user_id, name, type, icon, is_default) VALUES (?, ?, ?, ?, 0)",
            (g.user_id, name, cat_type, icon),
        )
        db.commit()

        cat = db.execute("SELECT * FROM categories WHERE id=?", (cur.lastrowid,)).fetchone()
        return jsonify({"message": "Category created", "category": row_to_dict(cat)}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/categories/<int:cat_id>", methods=["PUT"])
@login_required
def categories_update(cat_id):
    try:
        db = get_db()
        existing = db.execute(
            "SELECT * FROM categories WHERE id=? AND user_id=?", (cat_id, g.user_id)
        ).fetchone()
        if not existing:
            return jsonify({"error": "Category not found"}), 404

        data = request.get_json(force=True)
        name = (data.get("name") or existing["name"]).strip()
        icon = data.get("icon", existing["icon"])

        db.execute(
            "UPDATE categories SET name=?, icon=? WHERE id=?",
            (name, icon, cat_id),
        )
        db.commit()

        cat = db.execute("SELECT * FROM categories WHERE id=?", (cat_id,)).fetchone()
        return jsonify({"message": "Category updated", "category": row_to_dict(cat)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/categories/<int:cat_id>", methods=["DELETE"])
@login_required
def categories_delete(cat_id):
    try:
        db = get_db()
        existing = db.execute(
            "SELECT * FROM categories WHERE id=? AND user_id=?", (cat_id, g.user_id)
        ).fetchone()
        if not existing:
            return jsonify({"error": "Category not found"}), 404

        if existing["is_default"]:
            return jsonify({"error": "Cannot delete default category"}), 400

        # Check if used in transactions
        usage = db.execute(
            "SELECT COUNT(*) AS cnt FROM transactions WHERE category_id=?", (cat_id,)
        ).fetchone()
        if usage["cnt"] > 0:
            return jsonify({"error": f"Cannot delete category: used in {usage['cnt']} transaction(s). Reassign them first."}), 400

        db.execute("DELETE FROM categories WHERE id=?", (cat_id,))
        db.commit()
        return jsonify({"message": "Category deleted"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ===================================================================
#  SETTINGS ROUTES  /api/settings
# ===================================================================

@app.route("/api/settings", methods=["GET"])
@login_required
def settings_get():
    try:
        db = get_db()
        user = db.execute(
            "SELECT display_name, currency, budget_start_day, theme, profile_picture FROM users WHERE id=?",
            (g.user_id,),
        ).fetchone()
        if not user:
            return jsonify({"error": "User not found"}), 404
        return jsonify({"settings": row_to_dict(user)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/settings", methods=["PUT"])
@login_required
def settings_update():
    try:
        data = request.get_json(force=True)
        db = get_db()

        user = db.execute("SELECT * FROM users WHERE id=?", (g.user_id,)).fetchone()
        if not user:
            return jsonify({"error": "User not found"}), 404

        display_name = (data.get("display_name") or user["display_name"]).strip()
        currency = data.get("currency", user["currency"])
        budget_start_day = data.get("budget_start_day", user["budget_start_day"])
        theme = data.get("theme", user["theme"])

        db.execute(
            "UPDATE users SET display_name=?, currency=?, budget_start_day=?, theme=? WHERE id=?",
            (display_name, currency, int(budget_start_day), theme, g.user_id),
        )
        db.commit()

        return jsonify({
            "message": "Settings updated",
            "settings": {
                "display_name": display_name,
                "currency": currency,
                "budget_start_day": int(budget_start_day),
                "theme": theme,
            },
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/settings/profile-picture", methods=["POST"])
@login_required
def settings_profile_picture():
    try:
        if "profile_picture" not in request.files:
            return jsonify({"error": "No file provided"}), 400

        file = request.files["profile_picture"]
        if file.filename == "":
            return jsonify({"error": "No file selected"}), 400

        allowed_exts = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in allowed_exts:
            return jsonify({"error": "File type not allowed. Use JPG, PNG, GIF, or WEBP"}), 400

        filename = f"profile_{g.user_id}_{uuid.uuid4().hex[:8]}{ext}"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        file.save(filepath)

        # Remove old profile picture file if exists
        db = get_db()
        old = db.execute("SELECT profile_picture FROM users WHERE id=?", (g.user_id,)).fetchone()
        if old and old["profile_picture"]:
            old_path = os.path.join(UPLOAD_FOLDER, old["profile_picture"])
            if os.path.isfile(old_path):
                try:
                    os.remove(old_path)
                except OSError:
                    pass

        db.execute("UPDATE users SET profile_picture=? WHERE id=?", (filename, g.user_id))
        db.commit()

        return jsonify({
            "message": "Profile picture updated",
            "profile_picture": filename,
            "url": f"/uploads/{filename}",
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ===================================================================
#  REPORT ROUTES  /api/reports
# ===================================================================

@app.route("/api/reports/daily", methods=["GET"])
@login_required
def reports_daily():
    try:
        db = get_db()
        date_single = request.args.get("date")
        date_from = request.args.get("date_from")
        date_to = request.args.get("date_to")

        if date_single:
            date_from = date_single
            date_to = date_single
        elif not date_from or not date_to:
            today = datetime.now().strftime("%Y-%m-%d")
            date_from = date_from or today
            date_to = date_to or today

        rows = db.execute(
            "SELECT t.*, c.name AS category_name, c.icon AS category_icon "
            "FROM transactions t LEFT JOIN categories c ON t.category_id=c.id "
            "WHERE t.user_id=? AND t.date>=? AND t.date<=? "
            "ORDER BY t.date DESC, t.id DESC",
            (g.user_id, date_from, date_to),
        ).fetchall()

        total_income = 0
        total_expense = 0
        transactions = []
        for r in rows:
            d = dict(r)
            transactions.append(d)
            if d["type"] == "income":
                total_income += d["amount"]
            else:
                total_expense += d["amount"]

        # Category breakdown (expenses only)
        cat_rows = db.execute(
            "SELECT c.name AS category_name, c.icon, COALESCE(SUM(t.amount),0) AS total "
            "FROM transactions t JOIN categories c ON t.category_id=c.id "
            "WHERE t.user_id=? AND t.type='expense' AND t.date>=? AND t.date<=? "
            "GROUP BY t.category_id ORDER BY total DESC",
            (g.user_id, date_from, date_to),
        ).fetchall()

        daily_breakdown = [{
            "date": date_from,
            "income": total_income,
            "expense": total_expense
        }]

        d_start = datetime.strptime(date_from, "%Y-%m-%d")
        d_end = datetime.strptime(date_to, "%Y-%m-%d")
        days_count = max(1, (d_end - d_start).days + 1)
        avg_daily = total_expense / float(days_count)

        return jsonify({
            "date": date_from,
            "total_income": total_income,
            "total_expense": total_expense,
            "avg_daily": avg_daily,
            "daily_breakdown": daily_breakdown,
            "category_breakdown": rows_to_list(cat_rows),
            "transactions": transactions,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/reports/weekly", methods=["GET"])
@login_required
def reports_weekly():
    try:
        db = get_db()
        date_str = request.args.get("date", datetime.now().strftime("%Y-%m-%d"))
        ref = datetime.strptime(date_str, "%Y-%m-%d").date()

        week_start = ref - timedelta(days=ref.weekday())
        week_end = week_start + timedelta(days=6)
        ws_str = week_start.isoformat()
        we_str = week_end.isoformat()

        rows = db.execute(
            "SELECT t.*, c.name AS category_name, c.icon AS category_icon "
            "FROM transactions t LEFT JOIN categories c ON t.category_id=c.id "
            "WHERE t.user_id=? AND t.date>=? AND t.date<=? "
            "ORDER BY t.date ASC, t.id ASC",
            (g.user_id, ws_str, we_str),
        ).fetchall()

        daily_map = {}
        for i in range(7):
            day = (week_start + timedelta(days=i)).isoformat()
            daily_map[day] = {"date": day, "income": 0, "expense": 0}

        total_income = 0
        total_expense = 0
        transactions = []
        for r in rows:
            d = dict(r)
            transactions.append(d)
            dt = d["date"]
            if dt in daily_map:
                if d["type"] == "income":
                    daily_map[dt]["income"] += d["amount"]
                    total_income += d["amount"]
                else:
                    daily_map[dt]["expense"] += d["amount"]
                    total_expense += d["amount"]

        cat_rows = db.execute(
            "SELECT c.name AS category_name, c.icon, COALESCE(SUM(t.amount),0) AS total "
            "FROM transactions t JOIN categories c ON t.category_id=c.id "
            "WHERE t.user_id=? AND t.type='expense' AND t.date>=? AND t.date<=? "
            "GROUP BY t.category_id ORDER BY total DESC",
            (g.user_id, ws_str, we_str),
        ).fetchall()

        avg_daily = total_expense / 7.0

        return jsonify({
            "week_start": ws_str,
            "week_end": we_str,
            "total_income": total_income,
            "total_expense": total_expense,
            "avg_daily": avg_daily,
            "daily_breakdown": list(daily_map.values()),
            "category_breakdown": rows_to_list(cat_rows),
            "transactions": transactions,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/reports/monthly", methods=["GET"])
@login_required
def reports_monthly():
    try:
        db = get_db()
        month = request.args.get("month", datetime.now().strftime("%Y-%m"))

        year_m = datetime.strptime(month, "%Y-%m")
        month_start = f"{month}-01"
        if year_m.month == 12:
            month_end_date = year_m.replace(year=year_m.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            month_end_date = year_m.replace(month=year_m.month + 1, day=1) - timedelta(days=1)
        month_end = month_end_date.strftime("%Y-%m-%d")
        total_days = month_end_date.day

        rows = db.execute(
            "SELECT t.*, c.name AS category_name, c.icon AS category_icon "
            "FROM transactions t LEFT JOIN categories c ON t.category_id=c.id "
            "WHERE t.user_id=? AND t.date>=? AND t.date<=? "
            "ORDER BY t.date DESC, t.id DESC",
            (g.user_id, month_start, month_end),
        ).fetchall()

        total_income = 0
        total_expense = 0
        daily_map = {}
        transactions = []
        for r in rows:
            d = dict(r)
            transactions.append(d)
            dt = d["date"]
            if dt not in daily_map:
                daily_map[dt] = {"date": dt, "income": 0, "expense": 0}
            if d["type"] == "income":
                daily_map[dt]["income"] += d["amount"]
                total_income += d["amount"]
            else:
                daily_map[dt]["expense"] += d["amount"]
                total_expense += d["amount"]

        daily_breakdown = sorted(daily_map.values(), key=lambda x: x["date"])

        cat_rows = db.execute(
            "SELECT c.name AS category_name, c.icon, COALESCE(SUM(t.amount),0) AS total "
            "FROM transactions t JOIN categories c ON t.category_id=c.id "
            "WHERE t.user_id=? AND t.type='expense' AND t.date>=? AND t.date<=? "
            "GROUP BY t.category_id ORDER BY total DESC",
            (g.user_id, month_start, month_end),
        ).fetchall()

        avg_daily = total_expense / float(total_days)

        return jsonify({
            "month": month,
            "total_income": total_income,
            "total_expense": total_expense,
            "avg_daily": avg_daily,
            "daily_breakdown": daily_breakdown,
            "category_breakdown": rows_to_list(cat_rows),
            "transactions": transactions,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/reports/yearly", methods=["GET"])
@login_required
def reports_yearly():
    try:
        db = get_db()
        year = request.args.get("year", str(datetime.now().year))

        rows = db.execute(
            "SELECT t.*, c.name AS category_name, c.icon AS category_icon "
            "FROM transactions t LEFT JOIN categories c ON t.category_id=c.id "
            "WHERE t.user_id=? AND substr(t.date,1,4)=? "
            "ORDER BY t.date DESC, t.id DESC",
            (g.user_id, year),
        ).fetchall()

        monthly_map = {f"{i:02d}": {"income": 0, "expense": 0} for i in range(1, 13)}
        total_income = 0
        total_expense = 0
        transactions = []

        for r in rows:
            d = dict(r)
            transactions.append(d)
            m_key = d["date"][5:7]
            if m_key in monthly_map:
                if d["type"] == "income":
                    monthly_map[m_key]["income"] += d["amount"]
                    total_income += d["amount"]
                else:
                    monthly_map[m_key]["expense"] += d["amount"]
                    total_expense += d["amount"]

        monthly_breakdown = [
            {"month": f"{year}-{k}", "income": v["income"], "expense": v["expense"]}
            for k, v in sorted(monthly_map.items())
        ]

        cat_rows = db.execute(
            "SELECT c.name AS category_name, c.icon, COALESCE(SUM(t.amount),0) AS total "
            "FROM transactions t JOIN categories c ON t.category_id=c.id "
            "WHERE t.user_id=? AND t.type='expense' AND substr(t.date,1,4)=? "
            "GROUP BY t.category_id ORDER BY total DESC",
            (g.user_id, year),
        ).fetchall()

        is_leap = (int(year) % 4 == 0 and int(year) % 100 != 0) or (int(year) % 400 == 0)
        days_in_year = 366 if is_leap else 365
        avg_daily = total_expense / float(days_in_year)

        return jsonify({
            "year": year,
            "total_income": total_income,
            "total_expense": total_expense,
            "avg_daily": avg_daily,
            "monthly_breakdown": monthly_breakdown,
            "category_breakdown": rows_to_list(cat_rows),
            "transactions": transactions,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/reports/comparison", methods=["GET"])
@login_required
def reports_comparison():
    try:
        db = get_db()
        months_param = request.args.get("months", "")
        if not months_param:
            return jsonify({"error": "months parameter is required (comma-separated YYYY-MM)"}), 400

        months = [m.strip() for m in months_param.split(",") if m.strip()]

        comparison = []
        for month in months:
            year_m = datetime.strptime(month, "%Y-%m")
            month_start = f"{month}-01"
            if year_m.month == 12:
                month_end_date = year_m.replace(year=year_m.year + 1, month=1, day=1) - timedelta(days=1)
            else:
                month_end_date = year_m.replace(month=year_m.month + 1, day=1) - timedelta(days=1)
            month_end = month_end_date.strftime("%Y-%m-%d")

            totals = db.execute(
                "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS total_income, "
                "COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS total_expense "
                "FROM transactions WHERE user_id=? AND date>=? AND date<=?",
                (g.user_id, month_start, month_end),
            ).fetchone()

            # Category breakdown for expense
            cat_rows = db.execute(
                "SELECT c.name AS category_name, c.icon, COALESCE(SUM(t.amount),0) AS total "
                "FROM transactions t JOIN categories c ON t.category_id=c.id "
                "WHERE t.user_id=? AND t.type='expense' AND t.date>=? AND t.date<=? "
                "GROUP BY t.category_id ORDER BY total DESC",
                (g.user_id, month_start, month_end),
            ).fetchall()

            comparison.append({
                "month": month,
                "total_income": totals["total_income"],
                "total_expense": totals["total_expense"],
                "balance": totals["total_income"] - totals["total_expense"],
                "categories": rows_to_list(cat_rows),
            })

        return jsonify({"comparison": comparison})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3000))
    app.run(host="0.0.0.0", port=port, debug=False)
