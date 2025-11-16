from flask import Flask, request, jsonify, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from werkzeug.security import generate_password_hash, check_password_hash
import os

app = Flask(__name__, static_folder="../frontend", static_url_path="/")
CORS(app)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///sky.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="gevent")

# ---------------- Models ----------------
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)

# ---------------- Socket mappings ----------------
connected_sockets = {}  # user_id -> sid
sid_to_user = {}        # sid -> user_id

# ---------------- API ----------------
@app.route("/", defaults={"path": "index.html"})

@app.route("/<path:path>")
def serve_frontend(path):
    return send_from_directory(app.static_folder, path)
    
@app.route('/api/register', methods=['POST'])
def register():
    data = request.json or {}
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
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
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
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

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

# ---------------- SocketIO ----------------
@socketio.on('registerSocket')
def register_socket(data):
    user_id = str(data.get('userId'))
    if user_id:
        connected_sockets[user_id] = request.sid
        sid_to_user[request.sid] = user_id
        print("Registered socket:", user_id, request.sid)

@socketio.on('disconnect')
def disconnect():
    sid = request.sid
    user = sid_to_user.pop(sid, None)
    if user:
        connected_sockets.pop(user, None)
    print("Disconnected:", sid)

@socketio.on('callUser')
def call_user(data):
    to_user = str(data.get('toUserId'))
    caller_sid = request.sid
    caller_user = sid_to_user.get(caller_sid)
    if not to_user or to_user not in connected_sockets:
        emit('callFailed', {"reason": "user offline"}, to=caller_sid)
        return
    target_sid = connected_sockets[to_user]
    emit('incomingCall', {
        "fromUserId": caller_user,
        "offerSDP": data.get('offerSDP'),
        "name": data.get('name', '')
    }, to=target_sid)

@socketio.on('acceptCall')
def accept_call(data):
    caller_user = str(data.get('callerUserId'))
    answer = data.get('answerSDP')
    if caller_user in connected_sockets:
        emit('callAccepted', {"answerSDP": answer}, to=connected_sockets[caller_user])

@socketio.on('iceCandidate')
def ice_candidate(data):
    to_user = str(data.get('toUserId'))
    candidate = data.get('candidate')
    if to_user in connected_sockets:
        emit('iceCandidate', {"candidate": candidate}, to=connected_sockets[to_user])

@socketio.on('endCall')
def end_call(data):
    to_user = str(data.get('toUserId'))
    if to_user in connected_sockets:
        emit('callEnded', {}, to=connected_sockets[to_user])

# ---------------- Run ----------------
if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port)


