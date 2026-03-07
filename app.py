import os
import json
import re
import smtplib
import requests
import secrets
from email.message import EmailMessage
from datetime import datetime, timedelta
from functools import wraps

from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    send_file,
    session,
    redirect,
    url_for,
)
from flask_sqlalchemy import SQLAlchemy
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash, check_password_hash

load_dotenv()

db = SQLAlchemy()

def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-key-mudar-em-prod")
    db_url = os.getenv("DATABASE_URL", "sqlite:///rainbow_safe.db")
    app.config["SQLALCHEMY_DATABASE_URI"] = db_url
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    os.makedirs(os.path.join(app.root_path, "instance"), exist_ok=True)

    db.init_app(app)
    return app

app = create_app()

# ---------------------------
# Helpers (admin + auth + privacy)
# ---------------------------
def is_admin() -> bool:
    return session.get("is_admin") is True

def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not is_admin():
            return redirect(url_for("admin_login"))
        return fn(*args, **kwargs)
    return wrapper

def is_logged_in() -> bool:
    return session.get("user_id") is not None

def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not is_logged_in():
            if request.path.startswith("/api/"):
                return jsonify({"error": "Acesso negado. Faça login."}), 401
            return redirect(url_for("login"))
        return fn(*args, **kwargs)
    return wrapper

def public_name(full_name: str) -> str:
    """Retorna 'Nome L.' (anonimizado) para a comunidade."""
    if not full_name:
        return "Pessoa"
    parts = [p for p in full_name.strip().split() if p]
    first = parts[0]
    last_initial = (parts[-1][0].upper() + ".") if len(parts) > 1 else ""
    return f"{first} {last_initial}".strip()

_ADDRESS_PATTERNS = [
    r"\bn[ºo]\s*\d{1,5}\b",
    r"\bcep\b\s*\d{5}-?\d{3}\b",
    r"\bavenida\b|\bav\.\b|\brua\b|\br\.\b",
]

def looks_like_address(text: str) -> bool:
    t = (text or "").lower()
    return any(re.search(p, t) for p in _ADDRESS_PATTERNS)

# ---------------------------
# Models
# ---------------------------
class Account(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    email = db.Column(db.String(200), nullable=False, unique=True)
    phone = db.Column(db.String(50), nullable=False)
    course = db.Column(db.String(120), nullable=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Contact(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(200), nullable=True)
    phone = db.Column(db.String(50), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Alert(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    kind = db.Column(db.String(30), nullable=False, default="SOS")
    message = db.Column(db.Text, nullable=True)
    lat = db.Column(db.Float, nullable=True)
    lon = db.Column(db.Float, nullable=True)
    accuracy = db.Column(db.Float, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Place(db.Model):
    """Mapa Colaborativo Seguro"""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("account.id"), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    category = db.Column(db.String(30), nullable=False)
    notes = db.Column(db.Text, nullable=True)
    lat = db.Column(db.Float, nullable=False)
    lon = db.Column(db.Float, nullable=False)
    report_count = db.Column(db.Integer, default=0)
    is_hidden = db.Column(db.Boolean, default=False)
    expires_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class WalkSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    session_code = db.Column(db.String(32), unique=True, nullable=False)
    label = db.Column(db.String(200), nullable=True)
    started_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_ping_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_lat = db.Column(db.Float, nullable=True)
    last_lon = db.Column(db.Float, nullable=True)
    is_active = db.Column(db.Boolean, default=True)

class User(db.Model):
    """Ofertantes de caroninha."""
    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(160), nullable=False)
    email = db.Column(db.String(200), nullable=False, unique=True)
    phone = db.Column(db.String(50), nullable=False)
    offers_ride = db.Column(db.Boolean, default=False)
    status = db.Column(db.String(20), nullable=False, default="PENDING")
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    approved_at = db.Column(db.DateTime, nullable=True)

class ChatThread(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    rider_user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    is_blocked = db.Column(db.Boolean, default=False)
    report_reason = db.Column(db.Text, nullable=True)
    reported_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class ChatMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    thread_id = db.Column(db.Integer, db.ForeignKey("chat_thread.id"), nullable=False)
    sender = db.Column(db.String(20), nullable=False)
    text = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

def init_db():
    with app.app_context():
        db.create_all()

# ---------------------------
# Telegram Integration
# ---------------------------
def send_telegram_message(text: str):
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id: return {"sent": False}
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {"chat_id": chat_id, "text": text, "disable_web_page_preview": False}
        r = requests.post(url, json=payload, timeout=10)
        return {"sent": r.status_code < 400}
    except: return {"sent": False}

# ---------------------------
# Routes (HTML Pages)
# ---------------------------
@app.get("/")
def home():
    return render_template("index.html", logged_in=is_logged_in())

@app.get("/mapa")
def mapa_view():
    return render_template("map.html", logged_in=is_logged_in())

@app.get("/rastrear/<code>")
def public_tracker(code):
    ws = WalkSession.query.filter_by(session_code=code).first()
    if not ws: return "Sessão expirada ou não encontrada.", 404
    return render_template("tracker.html", session_code=ws.session_code, label=ws.label)

@app.get("/login")
def login(): return render_template("login.html")

@app.post("/login")
def login_post():
    email = request.form.get("email", "").strip().lower()
    password = request.form.get("password", "")
    acc = Account.query.filter_by(email=email).first()
    if not acc or not check_password_hash(acc.password_hash, password):
        return render_template("login.html", error="Email ou senha incorretos.")
    session.update({"user_id": acc.id, "user_name": acc.name})
    return redirect(url_for("home"))

@app.get("/register")
def register(): return render_template("register.html")

@app.post("/register")
def register_post():
    name, email = request.form.get("name"), request.form.get("email", "").lower()
    phone, pwd = request.form.get("phone"), request.form.get("password")
    
    if Account.query.filter_by(email=email).first():
        return render_template("register.html", error="Email já cadastrado.")
    
    acc = Account(name=name, email=email, phone=phone, 
                  course=request.form.get("course"),
                  password_hash=generate_password_hash(pwd))
    db.session.add(acc)
    db.session.commit()
    session.update({"user_id": acc.id, "user_name": acc.name})
    return redirect(url_for("home"))

@app.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("home"))

@app.get("/admin")
@admin_required
def admin(): return render_template("admin.html")

@app.get("/admin/login")
def admin_login(): return render_template("admin_login.html")

@app.post("/admin/login")
def admin_login_post():
    if request.form.get("password") == os.getenv("ADMIN_PASSWORD", "admin123"):
        session["is_admin"] = True
        return redirect(url_for("admin"))
    return render_template("admin_login.html", error="Senha inválida.")

@app.post("/admin/logout")
def admin_logout():
    session.pop("is_admin", None)
    return redirect(url_for("home"))

@app.get("/admin/approvals")
@admin_required
def admin_approvals(): return render_template("admin_approvals.html")

# ---------------------------
# API: Mapa Colaborativo
# ---------------------------
@app.get("/api/places")
def list_places():
    now = datetime.utcnow()
    places = Place.query.filter(Place.is_hidden == False, 
                                db.or_(Place.expires_at == None, Place.expires_at > now)).all()
    return jsonify([{"id": p.id, "name": p.name, "category": p.category, 
                     "notes": p.notes, "lat": p.lat, "lon": p.lon} for p in places])

@app.post("/api/places")
@login_required
def create_place():
    data = request.get_json()
    expires = datetime.utcnow() + timedelta(days=7) if data.get("is_temporary") else None
    p = Place(user_id=session["user_id"], name=data['name'], category=data['category'],
              notes=data.get('notes'), lat=data['lat'], lon=data['lon'], expires_at=expires)
    db.session.add(p)
    db.session.commit()
    return jsonify({"ok": True})

@app.post("/api/places/<int:place_id>/report")
@login_required
def report_place(place_id):
    p = Place.query.get_or_404(place_id)
    p.report_count += 1
    if p.report_count >= 3: p.is_hidden = True
    db.session.commit()
    return jsonify({"ok": True})

# ---------------------------
# API: SOS & Caminhada
# ---------------------------
@app.post("/api/alerts")
def create_alert():
    data = request.get_json()
    a = Alert(kind=data.get("kind", "SOS"), message=data.get("message"),
              lat=data.get("lat"), lon=data.get("lon"), accuracy=data.get("accuracy"))
    db.session.add(a)
    db.session.commit()
    
    if a.lat and a.lon:
        maps_link = f"https://maps.google.com/?q={a.lat},{a.lon}"
        msg = f"🚨 Rainbow Safe - {a.kind}\n📍 Mapa: {maps_link}\n💬 Msg: {a.message or 'Sem mensagem extra'}"
    else:
        msg = f"🚨 Rainbow Safe - {a.kind}\n📍 Localização: GPS Indisponível/Desativado\n💬 Msg: {a.message or 'Sem mensagem extra'}"
        
    send_telegram_message(msg)
    return jsonify({"ok": True, "telegram": {"sent": True}})

@app.post("/api/walk/start")
def walk_start():
    code = secrets.token_hex(8)
    ws = WalkSession(session_code=code, label=request.get_json().get("label"))
    db.session.add(ws)
    db.session.commit()
    return jsonify({"ok": True, "session_code": code})

@app.post("/api/walk/ping")
def walk_ping():
    data = request.get_json()
    ws = WalkSession.query.filter_by(session_code=data['session_code'], is_active=True).first()
    if not ws: return jsonify({"error": "Sessão inativa"}), 404
    ws.last_ping_at = datetime.utcnow()
    ws.last_lat, ws.last_lon = data.get('lat'), data.get('lon')
    db.session.commit()
    return jsonify({"ok": True})

@app.post("/api/walk/finish")
def walk_finish():
    ws = WalkSession.query.filter_by(session_code=request.get_json()['session_code']).first()
    if ws: ws.is_active = False
    db.session.commit()
    return jsonify({"ok": True})

@app.get("/api/walk/status/<code>")
def walk_status(code):
    ws = WalkSession.query.filter_by(session_code=code).first()
    if not ws: return jsonify({"error": "Inexistente"}), 404
    stale = ws.is_active and ws.last_ping_at < datetime.utcnow() - timedelta(minutes=3)
    return jsonify({"is_active": ws.is_active, "is_stale": stale, "last_lat": ws.last_lat, 
                    "last_lon": ws.last_lon, "last_ping_at": ws.last_ping_at.isoformat(),
                    "stale_minutes": 3})

# ---------------------------
# API: Contatos & Caronas
# ---------------------------
@app.get("/api/contacts")
def list_contacts():
    return jsonify([{"id": c.id, "name": c.name, "phone": c.phone} for c in Contact.query.all()])

@app.post("/api/contacts")
def add_contact():
    data = request.get_json()
    c = Contact(name=data['name'], email=data.get('email'), phone=data.get('phone'))
    db.session.add(c)
    db.session.commit()
    return jsonify({"ok": True})

@app.delete("/api/contacts/<int:cid>")
def del_contact(cid):
    db.session.delete(Contact.query.get_or_404(cid))
    db.session.commit()
    return jsonify({"ok": True})

@app.post("/api/users/apply")
def carpool_apply():
    data = request.get_json()
    u = User(full_name=data['full_name'], email=data['email'], phone=data['phone'], 
             offers_ride=True, status="PENDING")
    db.session.add(u)
    db.session.commit()
    return jsonify({"ok": True, "status": "PENDING"})

@app.get("/api/users/approved-rides")
def list_rides():
    users = User.query.filter_by(status="APPROVED").all()
    return jsonify([{"id": u.id, "display_name": public_name(u.full_name)} for u in users])

# ---------------------------
# API: Chat Seguro
# ---------------------------
@app.post("/api/chat/start")
def chat_start():
    th = ChatThread(rider_user_id=request.get_json()['rider_id'])
    db.session.add(th)
    db.session.commit()
    return jsonify({"thread_id": th.id, "rider_display_name": "Ofertante"})

@app.get("/api/chat/<int:tid>/messages")
def get_msgs(tid):
    th = ChatThread.query.get_or_404(tid)
    if th.is_blocked:
        return jsonify({"error": "Conversa bloqueada por segurança."}), 403
    msgs = ChatMessage.query.filter_by(thread_id=tid).order_by(ChatMessage.created_at.asc()).all()
    return jsonify([{"sender": m.sender, "text": m.text, "created_at": m.created_at.isoformat()} for m in msgs])

@app.post("/api/chat/<int:tid>/send")
def send_msg(tid):
    th = ChatThread.query.get_or_404(tid)
    if th.is_blocked:
        return jsonify({"error": "Conversa bloqueada por segurança."}), 403
        
    data = request.get_json()
    if looks_like_address(data['text']):
        return jsonify({"error": "Endereços exatos são bloqueados por segurança."}), 400
        
    m = ChatMessage(thread_id=tid, sender=data['sender'], text=data['text'])
    db.session.add(m)
    db.session.commit()
    return jsonify({"ok": True})

@app.post("/api/chat/<int:tid>/report")
def report_chat(tid):
    data = request.get_json() or {}
    th = ChatThread.query.get_or_404(tid)
    th.report_reason = data.get("reason", "Sem motivo especificado")
    th.reported_at = datetime.utcnow()
    th.is_blocked = True
    db.session.commit()
    return jsonify({"ok": True})

# ---------------------------
# API: ADMINISTRAÇÃO E PAINEL
# ---------------------------
@app.get("/api/export.json")
@admin_required
def export_data():
    """Rota usada pelo admin.js para carregar o mapa ao vivo."""
    alerts = Alert.query.order_by(Alert.created_at.desc()).limit(200).all()
    walks = WalkSession.query.order_by(WalkSession.created_at.desc()).limit(100).all()
    
    return jsonify({
        "alerts": [{
            "id": a.id, "kind": a.kind, "message": a.message,
            "lat": a.lat, "lon": a.lon, "created_at": a.created_at.isoformat()
        } for a in alerts],
        "walks": [{
            "id": w.id, "session_code": w.session_code, "label": w.label,
            "last_ping_at": w.last_ping_at.isoformat() if w.last_ping_at else None,
            "is_active": w.is_active
        } for w in walks]
    })

@app.get("/api/users/pending")
@admin_required
def get_pending_users():
    users = User.query.filter_by(status="PENDING").order_by(User.created_at.desc()).all()
    return jsonify([{"id": u.id, "full_name": u.full_name, "email": u.email, "phone": u.phone, "created_at": u.created_at.isoformat()} for u in users])

@app.post("/api/users/<int:uid>/approve")
@admin_required
def approve_user(uid):
    u = User.query.get_or_404(uid)
    u.status = "APPROVED"
    u.approved_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"ok": True})

@app.post("/api/users/<int:uid>/reject")
@admin_required
def reject_user(uid):
    u = User.query.get_or_404(uid)
    u.status = "REJECTED"
    u.notes = request.get_json().get("notes", "") if request.is_json else ""
    db.session.commit()
    return jsonify({"ok": True})

@app.get("/api/admin/reported-threads")
@admin_required
def get_reported_threads():
    threads = ChatThread.query.filter(ChatThread.reported_at != None).order_by(ChatThread.reported_at.desc()).all()
    out = []
    for t in threads:
        rider = User.query.get(t.rider_user_id)
        out.append({
            "id": t.id,
            "rider_display_name": public_name(rider.full_name) if rider else "Desconhecido",
            "report_reason": t.report_reason,
            "reported_at": t.reported_at.isoformat() if t.reported_at else None,
            "is_blocked": t.is_blocked
        })
    return jsonify(out)

@app.post("/api/admin/threads/<int:tid>/block")
@admin_required
def block_thread(tid):
    th = ChatThread.query.get_or_404(tid)
    th.is_blocked = True
    db.session.commit()
    return jsonify({"ok": True})


if __name__ == "__main__":
    init_db()
    app.run(debug=True)