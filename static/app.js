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
  el.className = `alert alert-${type} shadow-lg rounded-4 font-monospace`;
  el.style.position = "fixed";
  el.style.right = "16px";
  el.style.bottom = "16px";
  el.style.zIndex = "9999";
  el.style.maxWidth = "420px";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[m]);
}

function fmtMMSS(totalSec) {
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(Math.floor(totalSec % 60)).padStart(2, "0");
  return `${mm}:${ss}`;
}

// Pega geolocalização do navegador
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Sem suporte a GPS"));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true, timeout: 10000, maximumAge: 0
    });
  });
}

// ==========================================
// 🚨 BOTÕES DE EMERGÊNCIA (SOS e Check-in)
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
    toast(`[${kind}] Alerta enviado para a rede de proteção. ✅`, "danger");
  } else if (out.email && out.email.sent) {
    toast(`[${kind}] Alerta enviado por email.`, "success");
  } else {
    toast(`[${kind}] Registrado no sistema.`, "warning");
  }

  return out;
}

const btnSOS = document.getElementById("btnSOS");
if (btnSOS) {
  btnSOS.addEventListener("click", async () => {
    btnSOS.disabled = true;
    const oldHtml = btnSOS.innerHTML;
    btnSOS.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Buscando satélites...`;
    
    try {
      const msg = prompt("Mensagem opcional (ex.: 'Estou na saída do bloco 3Q, preciso de ajuda')") || "";
      let coords = null;
      
      try {
        const pos = await getPosition();
        coords = pos.coords;
      } catch (e) {
        toast("Não foi possível pegar GPS exato. Enviando SOS sem mapa.", "warning");
      }

      await sendAlert("SOS", msg, coords);
    } catch (e) {
      toast("Erro ao enviar SOS.", "danger");
    } finally {
      btnSOS.disabled = false;
      btnSOS.innerHTML = oldHtml;
    }
  });
}

// Botão de Check-in Rápido
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
      
      await sendAlert("CHECKIN", "Cheguei em segurança a um local do meu trajeto.", coords);
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
      await sendAlert("TEST", "Teste do botão SOS (sem localização)", null);
      toast("Teste de conexão enviado com sucesso.", "success");
    } catch (e) {
      toast(e.message, "danger");
    }
  });
}

// ==========================================
// 🧭 MODO "VOLTAR PRA CASA" (ACOMPANHAMENTO)
// ==========================================

let walkSessionCode = null;
let walkIntervalId = null;

const btnWalkStart = document.getElementById("btnWalkStart");
if (btnWalkStart) {
  btnWalkStart.addEventListener("click", async () => {
    const label = document.getElementById("walkLabel").value || "Caminhada";
    const freqMs = parseInt(document.getElementById("walkInterval").value) * 1000;
    
    try {
      btnWalkStart.disabled = true;
      const res = await api("/api/walk/start", { method: "POST", body: JSON.stringify({ label }) });
      walkSessionCode = res.session_code;
      
      document.getElementById("walkBox").classList.remove("d-none");
      document.getElementById("walkCode").textContent = walkSessionCode;
      
      await walkPing(); 
      walkIntervalId = setInterval(walkPing, freqMs);
      
      toast("Modo ativado. Compartilhe o link do painel.", "success");
    } catch (e) {
      toast(e.message, "danger");
      btnWalkStart.disabled = false;
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
  } catch(e) {}

  try {
    await api("/api/walk/ping", {
      method: "POST",
      body: JSON.stringify({ session_code: walkSessionCode, lat, lon })
    });
    const now = new Date();
    document.getElementById("walkLastPing").textContent = "Último check-in: " + now.toLocaleTimeString();
  } catch (e) {
    console.error("Falha no check-in", e);
  }
}

document.getElementById("btnWalkFinish")?.addEventListener("click", async () => {
  if (!walkSessionCode) return;
  try {
    await api("/api/walk/finish", { method: "POST", body: JSON.stringify({ session_code: walkSessionCode }) });
    clearInterval(walkIntervalId);
    walkSessionCode = null;
    document.getElementById("walkBox").classList.add("d-none");
    document.getElementById("btnWalkStart").disabled = false;
    toast("Modo encerrado. Que bom que chegou bem!", "success");
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
    } catch(e) {}
    
    await sendAlert("SOS", "ALERTA DISCRETO: Voltar Pra Casa - Estou desconfortável", coords);
    toast("Aviso silencioso enviado à equipe.", "warning");
  } catch (e) {
    toast(e.message, "danger");
  }
});

// AQUI ESTÁ A CORREÇÃO DO LINK DA MAMYS!
document.getElementById("btnCopyLink")?.addEventListener("click", async () => {
  if (!walkSessionCode) return;
  const link = `${window.location.origin}/rastrear/${walkSessionCode}`;
  try {
    await navigator.clipboard.writeText(`🌈 Rainbow Safe: Acompanhe minha rota ao vivo!\n📍 Clique no link para ver no mapa: ${link}`);
    toast("Link copiado! Cole no WhatsApp da Mamys/Migos.", "info");
  } catch (e) {
    toast("Não foi possível copiar o link.", "danger");
  }
});

// ==========================================
// 📞 CONTATOS DE CONFIANÇA
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
          <button class="btn btn-sm btn-outline-danger" onclick="deleteContact(${c.id})"><i class="bi bi-trash"></i></button>
        </li>
      `).join("");
    } catch(e) { console.error(e); }
  }

  window.deleteContact = async (id) => {
    if(confirm("Excluir este contato?")) {
      try { await api(`/api/contacts/${id}`, { method: "DELETE" }); loadContacts(); }
      catch(e) { toast(e.message, "danger"); }
    }
  };

  contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(contactForm);
    try {
      await api("/api/contacts", { method: "POST", body: JSON.stringify(Object.fromEntries(fd)) });
      contactForm.reset();
      loadContacts();
      toast("Contato adicionado.", "success");
    } catch(e) { toast(e.message, "danger"); }
  });

  loadContacts();
}

// ==========================================
// 🚗 CARONAS & CHAT (DESIGN MODERNO)
// ==========================================

const rideApplyForm = document.getElementById("rideApplyForm");
if (rideApplyForm) {
  rideApplyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(rideApplyForm);
    const data = Object.fromEntries(fd);
    data.offers_ride = true;
    try {
      await api("/api/users/apply", { method: "POST", body: JSON.stringify(data) });
      document.getElementById("rideApplyStatus").innerHTML = `<span class="text-success"><i class="bi bi-check-circle"></i> Enviado para aprovação do Admin!</span>`;
      rideApplyForm.reset();
    } catch (e) {
      document.getElementById("rideApplyStatus").innerHTML = `<span class="text-danger">${e.message}</span>`;
    }
  });
}

const rideApprovedList = document.getElementById("rideApprovedList");
if (rideApprovedList) {
  async function loadApprovedRides() {
    try {
      const data = await api("/api/users/approved-rides");
      if (data.length === 0) {
        rideApprovedList.innerHTML = `<li class="list-group-item text-secondary text-center py-3">Nenhum ofertante online.</li>`;
        return;
      }
      rideApprovedList.innerHTML = data.map(u => `
        <li class="list-group-item d-flex justify-content-between align-items-center py-3">
          <span class="fw-bold text-dark"><i class="bi bi-car-front-fill text-primary me-2"></i> ${escapeHtml(u.display_name)}</span>
          <button class="btn btn-sm btn-primary rounded-pill px-3 shadow-sm" onclick="openChat(${u.id}, '${escapeHtml(u.display_name)}')">
            <i class="bi bi-chat-dots"></i> Conversar
          </button>
        </li>
      `).join("");
    } catch(e) { console.error(e); }
  }
  loadApprovedRides();
}

// Lógica do Chat Seguro com Avatar e Balões
let currentThreadId = null;
let chatInterval = null;
let chatModalObj = null;

window.openChat = async (riderId, riderName) => {
  try {
    const res = await api("/api/chat/start", { method: "POST", body: JSON.stringify({ rider_id: riderId }) });
    currentThreadId = res.thread_id;
    document.getElementById("chatWith").textContent = res.rider_display_name;
    document.getElementById("chatStatus").textContent = "";
    
    if (!chatModalObj) chatModalObj = new bootstrap.Modal(document.getElementById("chatModal"));
    chatModalObj.show();
    
    pollChat();
    chatInterval = setInterval(pollChat, 3000);
  } catch (e) { toast(e.message, "danger"); }
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
      // Usa a estrutura exata do nosso app.css novo
      const isRider = m.sender === "rider";
      const bubbleClass = isRider ? "rider" : "anonymous";
      const avatarIcon = isRider ? '<i class="bi bi-car-front-fill chat-avatar"></i>' : '<i class="bi bi-person-fill chat-avatar"></i>';
      const timeStr = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
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
  } catch (e) { console.error("Erro ao carregar chat", e); }
}

document.getElementById("chatSend")?.addEventListener("click", async () => {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text || !currentThreadId) return;
  
  try {
    await api(`/api/chat/${currentThreadId}/send`, { method: "POST", body: JSON.stringify({ text, sender: "anonymous" }) });
    input.value = "";
    await pollChat();
    
    const box = document.getElementById("chatMsgs");
    if (box) box.scrollTop = box.scrollHeight;

  } catch (e) { 
      const statusEl = document.getElementById("chatStatus");
      if (statusEl) {
        statusEl.innerHTML = `<span class="text-danger fw-bold"><i class="bi bi-shield-x"></i> ${escapeHtml(e.message)}</span>`;
        setTimeout(() => statusEl.innerHTML = "", 4000);
      }
  }
});

document.getElementById("chatInput")?.addEventListener("keypress", function (e) {
  if (e.key === "Enter") document.getElementById("chatSend").click();
});

document.getElementById("chatReport")?.addEventListener("click", async () => {
  if (!currentThreadId) return;
  if (confirm("Você se sentiu ameaçado(a) ou houve pedido de endereço exato? Confirmar denúncia?")) {
    try {
      await api(`/api/chat/${currentThreadId}/report`, { method: "POST", body: JSON.stringify({ reason: "Comportamento abusivo/Quebra de regras" }) });
      toast("Denúncia registrada. A equipe bloqueará a conversa.", "danger");
      document.getElementById("chatStatus").innerHTML = `<span class="text-danger fw-bold">Conversa Denunciada</span>`;
    } catch (e) { toast("Erro ao denunciar.", "danger"); }
  }
});