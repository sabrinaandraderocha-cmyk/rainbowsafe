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

function toast(msg, type = "dark") {
  const el = document.createElement("div");
  el.className = `alert alert-${type} shadow-lg rounded-3 fw-semibold px-4`;
  el.style.position = "fixed";
  el.style.left = "50%";
  el.style.transform = "translateX(-50%)";
  el.style.bottom = "24px";
  el.style.zIndex = "9999";
  el.style.width = "90%";
  el.style.maxWidth = "400px";
  el.style.textAlign = "center";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
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
// APOIO DA REDE / ALERTAS (SOS / CHECK-IN)
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
    toast(`Alerta enviado para sua rede de apoio! ✅`, kind === "SOS" ? "danger" : "success");
  } else {
    toast("Alerta registrado no sistema.", "warning");
  }

  return out;
}

const btnSOS = document.getElementById("btnSOS");
if (btnSOS) {
  btnSOS.addEventListener("click", async () => {
    if (!confirm("🚨 Tem certeza? Isso enviará um alerta para a sua rede com a sua localização!")) return;

    btnSOS.disabled = true;
    const oldHtml = btnSOS.innerHTML;
    btnSOS.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Buscando GPS...`;

    try {
      let coords = null;
      try {
        const pos = await getPosition();
        coords = pos.coords;
      } catch (e) {
        toast("Não foi possível pegar o GPS. O apoio será enviado sem mapa.", "warning");
      }

      await sendAlert("SOS", "Alerta de Emergência", coords);
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

// ==========================================
// ACOMPANHAMENTO DE TRAJETO ("ME ACOMPANHA?")
// ==========================================

let walkSessionCode = null;
let walkIntervalId = null;

const btnWalkStart = document.getElementById("btnWalkStart");
if (btnWalkStart) {
  btnWalkStart.addEventListener("click", async () => {
    const labelInput = document.getElementById("walkLabel");
    const label = labelInput && labelInput.value.trim() !== "" ? labelInput.value.trim() : "Voltando pra casa";

    try {
      btnWalkStart.disabled = true;
      btnWalkStart.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Iniciando...';

      const res = await api("/api/walk/start", {
        method: "POST",
        body: JSON.stringify({ label })
      });

      walkSessionCode = res.session_code;
      document.getElementById("walkBox").classList.remove("d-none");
      document.getElementById("walkCode").textContent = walkSessionCode;

      await walkPing();
      walkIntervalId = setInterval(walkPing, 60000); // 60 segundos fixo

      toast("Rastreador ativado! Compartilhe o link.", "success");
    } catch (e) {
      toast(e.message, "danger");
    } finally {
      btnWalkStart.disabled = false;
      btnWalkStart.innerHTML = 'Começar Trajeto';
    }
  });
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
      body: JSON.stringify({ session_code: walkSessionCode, lat, lon })
    });

    const now = new Date();
    const timeStr = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
    
    const lastEl = document.getElementById("walkLastPing");
    if (lastEl) lastEl.textContent = `Última atualização: ${timeStr}`;
  } catch (e) {
    console.error("Falha no check-in do trajeto", e);
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
    walkSessionCode = null;
    walkIntervalId = null;

    document.getElementById("walkBox").classList.add("d-none");
    toast("Acompanhamento encerrado. Que bom que chegou bem!", "success");
    
    // Opcional: Avisar a rede que encerrou
    await sendAlert("CHECKIN", "Cheguei ao destino (Modo Acompanhamento encerrado).", null);
  } catch (e) {
    toast(e.message, "danger");
  }
});

document.getElementById("btnWalkUncomfortable")?.addEventListener("click", async () => {
  if (!walkSessionCode) return;
  const btn = document.getElementById("btnWalkUncomfortable");
  btn.disabled = true;

  try {
    let coords = null;
    try {
      const pos = await getPosition();
      coords = pos.coords;
    } catch (e) {}

    await sendAlert(
      "CHECKIN",
      "ALERTA DISCRETO: estou desconfortável durante o trajeto. Fiquem de olho no mapa.",
      coords
    );

    toast("Alerta discreto enviado para a rede.", "warning");
  } catch (e) {
    toast("Erro ao enviar o alerta.", "danger");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btnCopyLink")?.addEventListener("click", () => {
  if (!walkSessionCode) return;

  const link = `${window.location.origin}/rastrear/${walkSessionCode}`;
  try {
    const mensagem = encodeURIComponent(`📍 Acompanhe minha rota pelo Rainbow Safe. Se eu sumir, acione a rede!\n\nLink: ${link}`);
    window.open(`https://api.whatsapp.com/send?text=${mensagem}`, "_blank");
  } catch (e) {
    toast("Não foi possível gerar o link.", "danger");
  }
});


// ==========================================
// CONTATOS DE CONFIANÇA ("MINHA REDE")
// ==========================================

const contactForm = document.getElementById("contactForm");
const contactsList = document.getElementById("contactsList");

if (contactForm && contactsList) {
  async function loadContacts() {
    try {
      const data = await api("/api/contacts");
      
      if (data.length === 0) {
        contactsList.innerHTML = `<li class="list-group-item text-secondary border-0 text-center py-3 bg-light rounded-3">Nenhum contato cadastrado ainda.</li>`;
        return;
      }

      contactsList.innerHTML = data.map(c => `
        <li class="list-group-item d-flex justify-content-between align-items-center py-3">
          <div>
            <div class="fw-semibold text-dark">${escapeHtml(c.name)}</div>
            <div class="small text-secondary">${escapeHtml(c.email || "")}${c.phone ? " • " + escapeHtml(c.phone) : ""}</div>
          </div>
          <button class="btn btn-sm btn-outline-danger rounded-3 px-3" onclick="deleteContact(${c.id})">
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
        toast("Contato removido.", "warning");
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
      toast("Contato adicionado com sucesso.", "success");
    } catch (e) {
      toast(e.message, "danger");
    }
  });

  loadContacts();
}

// ==========================================
// CARONA COM CUIDADO E CHAT
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
        `<span class="text-success fw-bold"><i class="bi bi-check-circle"></i> Perfil enviado para aprovação.</span>`;

      rideApplyForm.reset();
      if (typeof loadApprovedRides === "function") loadApprovedRides();
    } catch (e) {
      document.getElementById("rideApplyStatus").innerHTML =
        `<span class="text-danger fw-bold">${escapeHtml(e.message)}</span>`;
    }
  });
}

const rideApprovedList = document.getElementById("rideApprovedList");
if (rideApprovedList) {
  window.loadApprovedRides = async function() {
    try {
      const data = await api("/api/users/approved-rides");

      if (data.length === 0) {
        rideApprovedList.innerHTML =
          `<li class="list-group-item text-secondary text-center py-3 bg-light rounded-3 border-0 mt-2">Nenhuma carona disponível na rede neste momento.</li>`;
        return;
      }

      rideApprovedList.innerHTML = data.map(u => `
        <li class="list-group-item py-3">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div>
              <span class="fw-bold text-dark d-block">
                <i class="bi bi-car-front-fill text-success me-2"></i>${escapeHtml(u.display_name)}
              </span>
              <small class="text-secondary d-block mt-1">${renderRideMeta(u) || "Trajeto não informado."}</small>
            </div>
            <button class="btn btn-sm btn-dark rounded-3 px-3 shadow-sm"
              onclick="openChat(${u.id}, '${escapeHtml(u.display_name)}')">
               Chat Seguro
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


// CHAT MODAL LOGIC
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

    const modalEl = document.getElementById("chatModal");
    if (!chatModalObj && modalEl) {
      chatModalObj = new bootstrap.Modal(modalEl);
    }

    if (chatModalObj) chatModalObj.show();
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
      const timeStr = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      return `
        <div class="chat-bubble ${bubbleClass}">
          ${escapeHtml(m.text)}
          <span class="chat-bubble-time">${timeStr}</span>
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
      statusEl.innerHTML = `<span class="text-danger fw-bold"><i class="bi bi-shield-x"></i> Bloqueio: ${escapeHtml(e.message)}</span>`;
      setTimeout(() => statusEl.innerHTML = "", 4000);
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

  const reason = prompt("Descreva o comportamento inadequado:");
  if (!reason) return;

  try {
    await api(`/api/chat/${currentThreadId}/report`, {
      method: "POST",
      body: JSON.stringify({ reason })
    });

    toast("Denúncia registrada. A equipe foi acionada.", "danger");

    const statusEl = document.getElementById("chatStatus");
    if (statusEl) statusEl.innerHTML = `<span class="text-danger fw-bold">Conversa denunciada</span>`;
  } catch (e) {
    toast("Erro ao denunciar.", "danger");
  }
});
