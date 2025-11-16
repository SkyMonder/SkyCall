// call.js — handles login, socket registration, single + group calls (demo)
const socket = io();

// Simple state
let localStream = null;
let pc = null;
let currentCalleeId = null;
let me = JSON.parse(localStorage.getItem('user') || 'null');
let micEnabled = true;
let camEnabled = true;

// UI elements
const loginRedirectIfNot = () => {
  if (!me) {
    window.location.href = '/login.html';
  } else {
    document.getElementById('meName').innerText = me.username;
    document.getElementById('myName').value = me.username;
  }
};
loginRedirectIfNot();

document.getElementById('logoutBtn').onclick = () => {
  localStorage.removeItem('user');
  window.location.href = '/login.html';
};

const api = (path, opts) => fetch('/api/' + path + (opts && opts.query ? ('?'+opts.query) : ''), opts);

// Search
document.getElementById('searchInput').addEventListener('input', async (e) => {
  const q = e.target.value.trim();
  if (!q) {
    document.getElementById('searchResults').innerHTML = '';
    return;
  }
  const res = await api('search_users', { query: 'q=' + encodeURIComponent(q) });
  const data = await res.json();
  const out = data.users.map(u => `<div class="sr-item" data-id="${u.id}">${u.username} (id:${u.id}) <button class="callNow" data-id="${u.id}">Call</button></div>`).join('');
  document.getElementById('searchResults').innerHTML = out;
  Array.from(document.getElementsByClassName('callNow')).forEach(btn => {
    btn.onclick = () => {
      document.getElementById('callTarget').value = btn.dataset.id;
      startCall(btn.dataset.id);
    };
  });
});

// Online users list (demo placeholder)
async function refreshOnline() {}
refreshOnline();

// Register socket
socket.on('connect', () => {
  if (me) {
    socket.emit('registerSocket', { userId: me.id });
  }
});

// Incoming call handler
socket.on('incomingCall', async (data) => {
  const callerId = data.fromUserId;
  const offerSDP = data.offerSDP;
  const name = data.name || 'User';
  document.getElementById('incomingName').innerText = `${name} (id:${callerId})`;
  document.getElementById('incomingModal').classList.remove('hidden');

  document.getElementById('acceptBtn').onclick = async () => {
    document.getElementById('incomingModal').classList.add('hidden');
    await acceptIncomingCall(callerId, offerSDP);
  };
  document.getElementById('rejectBtn').onclick = () => {
    document.getElementById('incomingModal').classList.add('hidden');
  };
});

// Call accepted
socket.on('callAccepted', async (data) => {
  const answerSDP = data.answerSDP;
  if (pc && answerSDP) {
    await pc.setRemoteDescription(new RTCSessionDescription(answerSDP));
  }
});

// ICE candidate relay
socket.on('iceCandidate', async (data) => {
  const c = data.candidate;
  if (pc && c) {
    try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn(e); }
  }
});

// End call
socket.on('callEnded', () => stopCall());

// --- local media ---
async function startLocalStream() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const localVideo = document.getElementById('localVideo');
    localVideo.srcObject = localStream;
    localVideo.play();
    updateControlButtons();
  }
}

// Update mic/cam buttons state
function updateControlButtons() {
  document.getElementById('toggleMicBtn').disabled = !localStream;
  document.getElementById('toggleCamBtn').disabled = !localStream;
}

// Toggle mic
document.getElementById('toggleMicBtn').onclick = () => {
  if (!localStream) return;
  micEnabled = !micEnabled;
  localStream.getAudioTracks().forEach(track => track.enabled = micEnabled);
  document.getElementById('toggleMicBtn').innerText = micEnabled ? "Mute Mic" : "Unmute Mic";
};

// Toggle camera
document.getElementById('toggleCamBtn').onclick = () => {
  if (!localStream) return;
  camEnabled = !camEnabled;
  localStream.getVideoTracks().forEach(track => track.enabled = camEnabled);
  document.getElementById('toggleCamBtn').innerText = camEnabled ? "Turn Off Camera" : "Turn On Camera";
};

// --- call flows ---
async function startCall(targetUserId) {
  currentCalleeId = String(targetUserId);
  await startLocalStream();

  pc = new RTCPeerConnection();
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = (evt) => {
    const remoteVideo = document.getElementById('remoteVideo');
    remoteVideo.srcObject = evt.streams[0];
    remoteVideo.play();
  };

  pc.onicecandidate = (evt) => {
    if (evt.candidate) {
      socket.emit('iceCandidate', { toUserId: currentCalleeId, candidate: evt.candidate });
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit('callUser', {
    toUserId: currentCalleeId,
    offerSDP: pc.localDescription,
    name: document.getElementById('myName').value || me.username
  });

  document.getElementById('endCallBtn').disabled = false;
  updateControlButtons();
}

async function acceptIncomingCall(callerId, offerSDP) {
  await startLocalStream();

  pc = new RTCPeerConnection();
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = (evt) => {
    const remoteVideo = document.getElementById('remoteVideo');
    remoteVideo.srcObject = evt.streams[0];
    remoteVideo.play();
  };

  pc.onicecandidate = (evt) => {
    if (evt.candidate) {
      socket.emit('iceCandidate', { toUserId: callerId, candidate: evt.candidate });
    }
  };

  await pc.setRemoteDescription(new RTCSessionDescription(offerSDP));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit('acceptCall', { callerUserId: callerId, answerSDP: pc.localDescription });

  document.getElementById('endCallBtn').disabled = false;
  updateControlButtons();
}

function stopCall() {
  if (pc) pc.close();
  pc = null;
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  localStream = null;
  currentCalleeId = null;
  document.getElementById('endCallBtn').disabled = true;
  document.getElementById('toggleMicBtn').disabled = true;
  document.getElementById('toggleCamBtn').disabled = true;
}

// UI hooks
document.getElementById('callBtn').onclick = () => {
  const target = document.getElementById('callTarget').value.trim();
  if (target) startCall(target);
};
document.getElementById('endCallBtn').onclick = () => {
  if (currentCalleeId) socket.emit('endCall', { toUserId: currentCalleeId });
  stopCall();
};

// --- group call (demo) ---
document.getElementById('createGroupBtn').onclick = async () => {
  const names = prompt("Comma separated user IDs to call (e.g. 2,3,4):");
  if (!names) return;
  const ids = names.split(',').map(s => s.trim()).filter(Boolean);

  await startLocalStream();
  pc = new RTCPeerConnection();
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.onicecandidate = (evt) => {
    if (evt.candidate && ids.length) {
      socket.emit('iceCandidate', { toUserId: ids[0], candidate: evt.candidate });
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('createGroupCall', { roomName: 'GroupCall', userIds: ids, hostUserId: me.id, offerSDP: pc.localDescription, name: me.username });

  updateControlButtons();
};
