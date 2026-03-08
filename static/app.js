// ==========================================
// UTILITÁRIOS BASE
// ==========================================

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts
  });

  if (!res.ok) {
    let errMsg = "Erro HTTP " + res.status;
    try {
      const data = await res.json();
      errMsg = data.error || errMsg;
    } catch (e) {
      errMsg = await res.text() || errMsg;
    }
    throw new Error(errMsg);
  }

  return res.json();
}

function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `alert alert-${type} shadow-lg rounded-4`;
  el.style.position = "fixed";
  el.style.right = "16px";
  el.style.bottom = "16px";
  el.style.zIndex = "9999";
  el.style.maxWidth = "420px";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[m]);
}

function fmtMMSS(totalSec) {
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(Math.floor(totalSec % 60)).padStart(2, "0");
  return `${mm}:${ss}`;
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Sem suporte a GPS"));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    });
  });
}

function renderRideMeta(u) {
  const parts = [];
  if (u.ride_from) parts.push(`De: ${escapeHtml(u.ride_from)}`);
  if (u.ride_to) parts.push(`Para: ${escapeHtml(u.ride_to)}`);
  if (u.ride_time) parts.push(`Horário: ${escapeHtml(u.ride_time)}`);
  if (u.meeting_point) parts.push(`Encontro: ${escapeHtml(u.meeting_point)}`);
  return parts.join(" • ");
}


// ==========================================
// APOIO DA REDE / ALERTAS
// ==========================================

async function sendAlert(kind, message, coords) {
  const payload = { kind, message };

  if (coords) {
    payload.lat = coords.latitude;
    payload.lon = coords.longitude;
    payload.accuracy = coords.accuracy;
  }

  const out = await api("/api/alerts", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  if (out.telegram && out.telegram.sent) {
    toast("Aviso enviado para sua rede de apoio. ✅", kind === "CHECKIN" ? "success" : "warning");
  } else {
    toast("Aviso registrado no sistema.", "warning");
  }

  if (out.guidance && out.guidance.immediate_risk_message) {
    console.info("Guidance:", out.guidance.immediate_risk_message);
  }

  return out;
}

const btnSOS = document.getElementById("btnSOS");
if (btnSOS) {
  btnSOS.addEventListener("click", async () => {
    btnSOS.disabled = true;
    const oldHtml = btnSOS.innerHTML;
    btnSOS.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Preparando apoio...`;

    try {
      const msg =
        prompt("Descreva brevemente a situação (ex.: 'Estou saindo do campus e gostaria de acompanhamento')") || "";

      let coords = null;
      try {
        const pos = await getPosition();
        coords = pos.coords;
      } catch (e) {
        toast("Não foi possível pegar o GPS. O apoio será enviado sem mapa.", "warning");
      }

      const out = await sendAlert("SUPPORT", msg, coords);

      if (out.guidance && out.guidance.immediate_risk_message) {
        toast(out.guidance.immediate_risk_message, "danger");
      }
    } catch (e) {
      toast("Erro ao pedir apoio da rede.", "danger");
    } finally {
      btnSOS.disabled = false;
      btnSOS.innerHTML = oldHtml;
    }
  });
}

const btnCheckin = document.getElementById("btnCheckin");
if (btnCheckin) {
  btnCheckin.addEventListener("click", async () => {
    btnCheckin.disabled = true;
    const oldHtml = btnCheckin.innerHTML;
    btnCheckin.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Registrando...`;

    try {
      let coords = null;
      try {
        const pos = await getPosition();
        coords = pos.coords;
      } catch (e) {
        console.warn("Check-in sem GPS");
      }

      await sendAlert("CHECKIN", "Check-in de segurança: cheguei bem a um ponto do meu trajeto.", coords);
      toast("Check-in de segurança registrado com sucesso!", "success");
    } catch (e) {
      toast("Falha ao registrar check-in.", "danger");
    } finally {
      btnCheckin.disabled = false;
      btnCheckin.innerHTML = oldHtml;
    }
  });
}

const btnTest = document.getElementById("btnTest");
if (btnTest) {
  btnTest.addEventListener("click", async () => {
    try {
      const out = await sendAlert("TEST", "Teste da rede de apoio (sem localização).", null);
      toast("Teste enviado com sucesso.", "success");

      if (out.guidance && out.guidance.human_rights_report_label) {
        console.info(out.guidance.human_rights_report_label, out.guidance.human_rights_report_url);
      }
    } catch (e) {
      toast(e.message, "danger");
    }
  });
}


// ==========================================
// ACOMPANHAMENTO DE TRAJETO
// ==========================================

let walkSessionCode = null;
let walkIntervalId = null;
let walkCountdownId = null;
let walkNextIn = 0;

const btnWalkStart = document.getElementById("btnWalkStart");
if (btnWalkStart) {
  btnWalkStart.addEventListener("click", async () => {
    const label = document.getElementById("walkLabel").value || "Caminhada";
    const freqMs = parseInt(document.getElementById("walkInterval").value, 10) * 1000;

    try {
      btnWalkStart.disabled = true;
      const res = await api("/api/walk/start", {
        method: "POST",
        body: JSON.stringify({ label })
      });

      walkSessionCode = res.session_code;
      document.getElementById("walkBox").classList.remove("d-none");
      document.getElementById("walkCode").textContent = walkSessionCode;

      await walkPing();
      walkIntervalId = setInterval(walkPing, freqMs);

      startWalkCountdown(Math.floor(freqMs / 1000));

      toast("Acompanhamento iniciado. Compartilhe o link com alguém de confiança.", "success");
    } catch (e) {
      toast(e.message, "danger");
      btnWalkStart.disabled = false;
    }
  });
}

function startWalkCountdown(seconds) {
  walkNextIn = seconds;
  updateWalkNextPing();

  if (walkCountdownId) clearInterval(walkCountdownId);

  walkCountdownId = setInterval(() => {
    walkNextIn = Math.max(0, walkNextIn - 1);
    updateWalkNextPing();
  }, 1000);
}

function updateWalkNextPing() {
  const el = document.getElementById("walkNextPing");
  if (el) el.textContent = "Próximo em: " + fmtMMSS(walkNextIn);
}

async function walkPing() {
  if (!walkSessionCode) return;

  let lat = null, lon = null;
  try {
    const pos = await getPosition();
    lat = pos.coords.latitude;
    lon = pos.coords.longitude;
  } catch (e) {}

  try {
    await api("/api/walk/ping", {
      method: "POST",
      body: JSON.stringify({
        session_code: walkSessionCode,
        lat,
        lon
      })
    });

    const now = new Date();
    const lastEl = document.getElementById("walkLastPing");
    if (lastEl) lastEl.textContent = "Último check-in: " + now.toLocaleTimeString();

    const freqMs = parseInt(document.getElementById("walkInterval").value, 10) * 1000;
    walkNextIn = Math.floor(freqMs / 1000);
    updateWalkNextPing();
  } catch (e) {
    console.error("Falha no check-in", e);
  }
}

document.getElementById("btnWalkFinish")?.addEventListener("click", async () => {
  if (!walkSessionCode) return;

  try {
    await api("/api/walk/finish", {
      method: "POST",
      body: JSON.stringify({ session_code: walkSessionCode })
    });

    clearInterval(walkIntervalId);
    clearInterval(walkCountdownId);
    walkSessionCode = null;
    walkIntervalId = null;
    walkCountdownId = null;

    document.getElementById("walkBox").classList.add("d-none");
    document.getElementById("btnWalkStart").disabled = false;

    toast("Acompanhamento encerrado. Que bom que chegou bem!", "success");
  } catch (e) {
    toast(e.message, "danger");
  }
});

document.getElementById("btnWalkUncomfortable")?.addEventListener("click", async () => {
  if (!walkSessionCode) return;

  try {
    let coords = null;
    try {
      const pos = await getPosition();
      coords = pos.coords;
    } catch (e) {}

    const out = await sendAlert(
      "CHECKIN",
      "Alerta discreto: estou desconfortável durante o trajeto e gostaria de acompanhamento.",
      coords
    );

    toast("Alerta discreto enviado.", "warning");

    if (out.guidance && out.guidance.immediate_risk_message) {
      console.info(out.guidance.immediate_risk_message);
    }
  } catch (e) {
    toast(e.message, "danger");
  }
});

document.getElementById("btnCopyLink")?.addEventListener("click", async () => {
  if (!walkSessionCode) return;

  const link = `${window.location.origin}/rastrear/${walkSessionCode}`;
  try {
    await navigator.clipboard.writeText(
      `🌈 Rainbow Safe: acompanhe meu trajeto em tempo real.\n📍 Link: ${link}`
    );
    toast("Link copiado! Compartilhe com alguém de confiança.", "info");
  } catch (e) {
    toast("Não foi possível copiar o link.", "danger");
  }
});


// ==========================================
// CONTATOS DE CONFIANÇA
// ==========================================

const contactForm = document.getElementById("contactForm");
const contactsList = document.getElementById("contactsList");

if (contactForm && contactsList) {
  async function loadContacts() {
    try {
      const data = await api("/api/contacts");
      contactsList.innerHTML = data.map(c => `
        <li class="list-group-item d-flex justify-content-between align-items-center py-2">
          <div>
            <strong class="d-block text-dark">${escapeHtml(c.name)}</strong>
            <small class="text-secondary">${escapeHtml(c.phone || c.email || '')}</small>
          </div>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteContact(${c.id})">
            <i class="bi bi-trash"></i>
          </button>
        </li>
      `).join("");
    } catch (e) {
      console.error(e);
    }
  }

  window.deleteContact = async (id) => {
    if (confirm("Excluir este contato?")) {
      try {
        await api(`/api/contacts/${id}`, { method: "DELETE" });
        loadContacts();
      } catch (e) {
        toast(e.message, "danger");
      }
    }
  };

  contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(contactForm);

    try {
      await api("/api/contacts", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(fd))
      });

      contactForm.reset();
      loadContacts();
      toast("Contato adicionado.", "success");
    } catch (e) {
      toast(e.message, "danger");
    }
  });

  loadContacts();
}


// ==========================================
// CARONA COM CUIDADO
// ==========================================

const rideApplyForm = document.getElementById("rideApplyForm");
if (rideApplyForm) {
  rideApplyForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fd = new FormData(rideApplyForm);
    const data = Object.fromEntries(fd);
    data.offers_ride = true;

    try {
      const out = await api("/api/users/apply", {
        method: "POST",
        body: JSON.stringify(data)
      });

      document.getElementById("rideApplyStatus").innerHTML =
        `<span class="text-success"><i class="bi bi-check-circle"></i> Perfil enviado para aprovação do admin.</span>`;

      rideApplyForm.reset();

      if (out.guidance && out.guidance.message) {
        toast(out.guidance.message, "warning");
      }
    } catch (e) {
      document.getElementById("rideApplyStatus").innerHTML =
        `<span class="text-danger">${escapeHtml(e.message)}</span>`;
    }
  });
}

const rideApprovedList = document.getElementById("rideApprovedList");
if (rideApprovedList) {
  async function loadApprovedRides() {
    try {
      const data = await api("/api/users/approved-rides");

      if (data.length === 0) {
        rideApprovedList.innerHTML =
          `<li class="list-group-item text-secondary text-center py-3">Ainda não há ofertantes aprovados.</li>`;
        return;
      }

      rideApprovedList.innerHTML = data.map(u => `
        <li class="list-group-item py-3">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div>
              <span class="fw-bold text-dark d-block">
                <i class="bi bi-car-front-fill text-primary me-2"></i>${escapeHtml(u.display_name)}
              </span>
              <small class="text-secondary d-block mt-1">${renderRideMeta(u) || "Trajeto não informado."}</small>
            </div>
            <button class="btn btn-sm btn-primary rounded-pill px-3 shadow-sm"
              onclick="openChat(${u.id}, '${escapeHtml(u.display_name)}')">
              <i class="bi bi-chat-dots"></i> Conversar
            </button>
          </div>
        </li>
      `).join("");
    } catch (e) {
      console.error(e);
    }
  }

  loadApprovedRides();
}


// ==========================================
// CHAT SEGURO
// ==========================================

let currentThreadId = null;
let chatInterval = null;
let chatModalObj = null;

window.openChat = async (riderId, riderName) => {
  try {
    const res = await api("/api/chat/start", {
      method: "POST",
      body: JSON.stringify({ rider_id: riderId })
    });

    currentThreadId = res.thread_id;
    document.getElementById("chatWith").textContent = res.rider_display_name;
    document.getElementById("chatStatus").textContent = "";

    if (!chatModalObj) {
      chatModalObj = new bootstrap.Modal(document.getElementById("chatModal"));
    }

    chatModalObj.show();
    await pollChat();

    if (chatInterval) clearInterval(chatInterval);
    chatInterval = setInterval(pollChat, 3000);
  } catch (e) {
    toast(e.message, "danger");
  }
};

document.getElementById("chatModal")?.addEventListener("hidden.bs.modal", () => {
  clearInterval(chatInterval);
  currentThreadId = null;
});

async function pollChat() {
  if (!currentThreadId) return;

  try {
    const msgs = await api(`/api/chat/${currentThreadId}/messages`);
    const box = document.getElementById("chatMsgs");
    if (!box) return;

    const isScrolledToBottom = box.scrollHeight - box.clientHeight <= box.scrollTop + 10;

    if (msgs.length === 0) {
      box.innerHTML = `<div class="text-center text-muted small mt-5">As mensagens são monitoradas por segurança.</div>`;
      return;
    }

    box.innerHTML = msgs.map(m => {
      const isRider = m.sender === "rider";
      const bubbleClass = isRider ? "rider" : "anonymous";
      const avatarIcon = isRider
        ? '<i class="bi bi-car-front-fill chat-avatar"></i>'
        : '<i class="bi bi-person-fill chat-avatar"></i>';
      const timeStr = new Date(m.created_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

      return `
        <div class="chat-bubble ${bubbleClass}">
          ${avatarIcon}
          <div class="chat-bubble-content">
            ${escapeHtml(m.text)}
            <span class="chat-bubble-time">${timeStr}</span>
          </div>
        </div>
      `;
    }).join("");

    if (isScrolledToBottom) {
      box.scrollTop = box.scrollHeight;
    }
  } catch (e) {
    console.error("Erro ao carregar chat", e);
  }
}

document.getElementById("chatSend")?.addEventListener("click", async () => {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();

  if (!text || !currentThreadId) return;

  try {
    await api(`/api/chat/${currentThreadId}/send`, {
      method: "POST",
      body: JSON.stringify({
        text,
        sender: "anonymous"
      })
    });

    input.value = "";
    await pollChat();

    const box = document.getElementById("chatMsgs");
    if (box) box.scrollTop = box.scrollHeight;
  } catch (e) {
    const statusEl = document.getElementById("chatStatus");
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-danger fw-bold"><i class="bi bi-shield-x"></i> ${escapeHtml(e.message)}</span>`;
      setTimeout(() => {
        statusEl.innerHTML = "";
      }, 4000);
    }
  }
});

document.getElementById("chatInput")?.addEventListener("keypress", function (e) {
  if (e.key === "Enter") {
    document.getElementById("chatSend").click();
  }
});

document.getElementById("chatReport")?.addEventListener("click", async () => {
  if (!currentThreadId) return;

  if (confirm("Deseja denunciar esta conversa por comportamento inadequado ou quebra das regras de segurança?")) {
    try {
      await api(`/api/chat/${currentThreadId}/report`, {
        method: "POST",
        body: JSON.stringify({
          reason: "Comportamento abusivo / quebra das regras de segurança"
        })
      });

      toast("Denúncia registrada. A conversa foi sinalizada.", "danger");

      const statusEl = document.getElementById("chatStatus");
      if (statusEl) {
        statusEl.innerHTML = `<span class="text-danger fw-bold">Conversa denunciada</span>`;
      }
    } catch (e) {
      toast("Erro ao denunciar.", "danger");
    }
  }
});
