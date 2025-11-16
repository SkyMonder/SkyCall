// ======================
//  call.js — WebRTC + REST signalling via polling
// ======================

// Simple state
let localStream = null;
let pc = null;
let role = null; // "caller" | "callee"
let peerUserId = null;
let me = JSON.parse(localStorage.getItem('user') || 'null');

// -----------------------------
// Helpers
// -----------------------------
function ensureLoggedIn() {
  if (!me) {
    window.location.href = '/login.html';
  } else {
    document.getElementById('meName').innerText = me.username;
    document.getElementById('myName').value = me.username;
  }
}
ensureLoggedIn();

const api = (path, opts = {}) => {
  return fetch('/api/' + path, opts);
};

// -----------------------------
// Logout
// -----------------------------
document.getElementById('logoutBtn').onclick = () => {
  localStorage.removeItem('user');
  window.location.href = '/login.html';
};

// -----------------------------
// Search users
// -----------------------------
document.getElementById('searchInput').addEventListener('input', async (e) => {
  const q = e.target.value.trim();
  if (!q) {
    document.getElementById('searchResults').innerHTML = '';
    return;
  }

  const res = await fetch('/api/search_users?q=' + encodeURIComponent(q));
  const data = await res.json();
  const out = data.users.map(u =>
    `<div class="sr-item">
        ${u.username} (id:${u.id})
        <button class="callNow" data-id="${u.id}">Call</button>
     </div>`
  ).join('');

  document.getElementById('searchResults').innerHTML = out;

  document.querySelectorAll('.callNow').forEach(btn => {
    btn.onclick = () => {
      document.getElementById('callTarget').value = btn.dataset.id;
      startCall(btn.dataset.id);
    };
  });
});

// -----------------------------
// Polling for signalling events
// -----------------------------
async function pollLoop() {
  if (!me) return;

  try {
    const res = await fetch('/api/poll?userId=' + me.id);
    const data = await res.json();

    if (data.ok && Array.isArray(data.events)) {
      data.events.forEach(ev => handleEvent(ev));
    }
  } catch (e) {
    console.warn('poll error', e);
  }
}

setInterval(pollLoop, 1000);
pollLoop();

// -----------------------------
// Handle incoming events
// -----------------------------
async function handleEvent(ev) {
  const type = ev.type;
  const data = ev.data || {};

  if (type === 'incomingCall') {
    // show modal
    document.getElementById('incomingName').innerText =
      (data.name || 'User') + ' (id:' + data.fromUserId + ')';
    document.getElementById('incomingModal').classList.remove('hidden');

    document.getElementById('acceptBtn').onclick = () => {
      document.getElementById('incomingModal').classList.add('hidden');
      acceptIncomingCall(data.fromUserId, data.offerSDP);
    };

    document.getElementById('rejectBtn').onclick = () => {
      document.getElementById('incomingModal').classList.add('hidden');
    };
  }

  else if (type === 'callAccepted') {
    if (role === 'caller' && pc && data.answerSDP) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answerSDP));
    }
  }

  else if (type === 'iceCandidate') {
    if (pc && data.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.warn('ICE error', err);
      }
    }
  }

  else if (type === 'callEnded') {
    stopCall();
    alert('Call ended by remote user');
  }
}

// -----------------------------
// WebRTC setup
// -----------------------------
async function startLocalStream() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('localVideo').play();
  }
}

// -----------------------------
// Start outgoing call
// -----------------------------
async function startCall(targetId) {
  role = 'caller';
  peerUserId = String(targetId);

  await startLocalStream();

  pc = new RTCPeerConnection();
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = evt => {
    const remoteVideo = document.getElementById('remoteVideo');
    remoteVideo.srcObject = evt.streams[0];
    remoteVideo.play();
  };

  pc.onicecandidate = evt => {
    if (evt.candidate) {
      api('call/candidate', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          fromUserId: me.id,
          toUserId: peerUserId,
          candidate: evt.candidate
        })
      });
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await api('call/start', {
    method: 'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      fromUserId: me.id,
      toUserId: peerUserId,
      offerSDP: pc.localDescription,
      name: document.getElementById('myName').value || me.username
    })
  });

  document.getElementById('endCallBtn').disabled = false;
}

// -----------------------------
// Accept incoming call
// -----------------------------
async function acceptIncomingCall(callerId, offerSDP) {
  role = 'callee';
  peerUserId = String(callerId);

  await startLocalStream();

  pc = new RTCPeerConnection();
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = evt => {
    const remoteVideo = document.getElementById('remoteVideo');
    remoteVideo.srcObject = evt.streams[0];
    remoteVideo.play();
  };

  pc.onicecandidate = evt => {
    if (evt.candidate) {
      api('call/candidate', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          fromUserId: me.id,
          toUserId: peerUserId,
          candidate: evt.candidate
        })
      });
    }
  };

  // Receive offer
  await pc.setRemoteDescription(new RTCSessionDescription(offerSDP));

  // Create answer
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  await api('call/answer', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      fromUserId: me.id,
      toUserId: peerUserId,
      answerSDP: pc.localDescription
    })
  });

  document.getElementById('endCallBtn').disabled = false;
}

// -----------------------------
// End call
// -----------------------------
document.getElementById('endCallBtn').onclick = async () => {
  if (peerUserId) {
    await api('call/end', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        fromUserId: me.id,
        toUserId: peerUserId
      })
    });
  }
  stopCall();
};

function stopCall() {
  if (pc) {
    pc.close();
    pc = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  peerUserId = null;
  role = null;

  document.getElementById('endCallBtn').disabled = true;
}
