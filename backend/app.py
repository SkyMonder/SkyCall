from flask import Flask, request, jsonify, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import os
import threading
import time

# Static folder points to frontend directory (relative to backend/)
# If you moved frontend into backend/static, change to static_folder="static"
app = Flask(__name__, static_folder="../frontend", static_url_path="/")
CORS(app)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///sky.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# ---------------- Models ----------------
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)

# ---------------- In-memory signalling queues ----------------
# message_queues: user_id -> [event, ...]
# Each event is a dict: { "type": "...", "data": {...} }
message_queues = {}
queues_lock = threading.Lock()

def push_event(user_id, event):
    if user_id is None:
        return
    uid = str(user_id)
    with queues_lock:
        if uid not in message_queues:
            message_queues[uid] = []
        message_queues[uid].append(event)

def pop_events(user_id):
    uid = str(user_id)
    with queues_lock:
        events = message_queues.get(uid, []).copy()
        message_queues[uid] = []
    return events

# ---------------- Routes ----------------
@app.route("/", defaults={"path": "index.html"})
@app.route("/<path:path>")
def serve_frontend(path):
    # serve static frontend files
    return send_from_directory(app.static_folder, path)

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json or {}
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    if not username or not password:
        return jsonify({"ok": False, "error": "username and password required"}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({"ok": False, "error": "username exists"}), 400
    user = User(username=username, password_hash=generate_password_hash(password))
    db.session.add(user)
    db.session.commit()
    return jsonify({"ok": True, "user": {"id": user.id, "username": user.username}})

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json or {}
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    user = User.query.filter_by(username=username).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({"ok": False, "error": "invalid credentials"}), 401
    return jsonify({"ok": True, "user": {"id": user.id, "username": user.username}})

@app.route('/api/search_users')
def search_users():
    q = (request.args.get('q') or '').strip()
    if not q:
        return jsonify({"ok": True, "users": []})
    users = User.query.filter(User.username.ilike(f"{q}%")).limit(20).all()
    return jsonify({"ok": True, "users": [{"id": u.id, "username": u.username} for u in users]})

# ---------------- Signalling REST endpoints ----------------
# Caller posts offer to start a call
# body: { fromUserId, toUserId, offerSDP, name }
@app.route('/api/call/start', methods=['POST'])
def api_call_start():
    data = request.json or {}
    from_id = data.get('fromUserId')
    to_id = data.get('toUserId')
    offer = data.get('offerSDP')
    name = data.get('name', '')
    if not from_id or not to_id or not offer:
        return jsonify({"ok": False, "error": "missing fields"}), 400
    # push incomingCall event to callee
    push_event(to_id, {"type": "incomingCall", "data": {"fromUserId": str(from_id), "offerSDP": offer, "name": name}})
    return jsonify({"ok": True})

# Callee posts answer
# body: { fromUserId (callee), toUserId (caller), answerSDP }
@app.route('/api/call/answer', methods=['POST'])
def api_call_answer():
    data = request.json or {}
    from_id = data.get('fromUserId')
    to_id = data.get('toUserId')
    answer = data.get('answerSDP')
    if not from_id or not to_id or not answer:
        return jsonify({"ok": False, "error": "missing fields"}), 400
    push_event(to_id, {"type": "callAccepted", "data": {"fromUserId": str(from_id), "answerSDP": answer}})
    return jsonify({"ok": True})

# ICE candidate relay
# body: { fromUserId, toUserId, candidate }
@app.route('/api/call/candidate', methods=['POST'])
def api_call_candidate():
    data = request.json or {}
    from_id = data.get('fromUserId')
    to_id = data.get('toUserId')
    candidate = data.get('candidate')
    if not from_id or not to_id or not candidate:
        return jsonify({"ok": False, "error": "missing fields"}), 400
    push_event(to_id, {"type": "iceCandidate", "data": {"fromUserId": str(from_id), "candidate": candidate}})
    return jsonify({"ok": True})

# End call
# body: { fromUserId, toUserId }
@app.route('/api/call/end', methods=['POST'])
def api_call_end():
    data = request.json or {}
    from_id = data.get('fromUserId')
    to_id = data.get('toUserId')
    if not from_id or not to_id:
        return jsonify({"ok": False, "error": "missing fields"}), 400
    push_event(to_id, {"type": "callEnded", "data": {"fromUserId": str(from_id)}})
    return jsonify({"ok": True})

# Polling endpoint
# GET /api/poll?userId=123
@app.route('/api/poll')
def api_poll():
    user_id = request.args.get('userId')
    if not user_id:
        return jsonify({"ok": False, "error": "userId required"}), 400
    events = pop_events(user_id)
    return jsonify({"ok": True, "events": events})

# ---------------- Run / DB init ----------------
if __name__ == '__main__':
    # Ensure DB and tables exist when app launches
    with app.app_context():
        db.create_all()
    port = int(os.environ.get('PORT', 5000))
    # Use Flask built-in server with threaded=True for simple runs (Render uses gunicorn)
    app.run(host='0.0.0.0', port=port, threaded=True)
