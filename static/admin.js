// ==========================================
// UTILITÁRIOS BASE (API, Toast, Formatação)
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
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

function fmtMMSS(totalSec) {
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(Math.floor(totalSec % 60)).padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatWhatsAppLink(phone) {
  if (!phone) return "#";
  // Remove tudo que não for número
  let cleanPhone = phone.replace(/\D/g, "");
  
  // Se tiver 10 ou 11 dígitos, adiciona o '55' do Brasil
  if (cleanPhone.length === 10 || cleanPhone.length === 11) {
    cleanPhone = "55" + cleanPhone;
  }
  
  return `https://wa.me/${cleanPhone}`;
}

// ==========================================
// 📞 CONTATOS DE CONFIANÇA
// ==========================================

async function refreshContacts() {
  const list = document.getElementById("contactsList");
  if (!list) return;

  list.innerHTML = "";
  try {
    const contacts = await api("/api/contacts");

    if (contacts.length === 0) {
      list.innerHTML = `<li class="list-group-item text-secondary border-0 text-center py-3">Nenhum contato cadastrado ainda.</li>`;
      return;
    }

    for (const c of contacts) {
      const li = document.createElement("li");
      li.className = "list-group-item d-flex justify-content-between align-items-center";
      
      let phoneHtml = "";
      if (c.phone) {
        const waLink = formatWhatsAppLink(c.phone);
        phoneHtml = `
          <a href="${waLink}" target="_blank" class="text-decoration-none text-success small fw-semibold d-inline-block mt-1">
            <i class="bi bi-whatsapp"></i> ${escapeHtml(c.phone)}
          </a>
        `;
      }

      li.innerHTML = `
        <div>
          <div class="fw-semibold text-dark">${escapeHtml(c.name)}</div>
          <div class="small text-secondary">${escapeHtml(c.email || "")}</div>
          ${phoneHtml}
        </div>
        <button class="btn btn-sm btn-outline-danger rounded-pill px-3"><i class="bi bi-trash"></i></button>
      `;
      li.querySelector("button").addEventListener("click", async () => {
        if(confirm("Deseja realmente excluir este contato?")) {
          await api(`/api/contacts/${c.id}`, { method: "DELETE" });
          toast("Contato removido.", "warning");
          refreshContacts();
        }
      });
      list.appendChild(li);
    }
  } catch (e) {
    console.error(e);
  }
}

document.getElementById("contactForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const fd = new FormData(e.target);
    const payload = {
      name: fd.get("name"),
      email: fd.get("email"),
      phone: fd.get("phone")
    };
    await api("/api/contacts", { method: "POST", body: JSON.stringify(payload) });
    e.target.reset();
    toast("Contato adicionado com sucesso.", "success");
    refreshContacts();
  } catch (e2) {
    console.error(e2);
    toast("Erro ao adicionar contato.", "danger");
  }
});

// ==========================================
// 🚨 BOTÕES DE EMERGÊNCIA (SOS)
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
    toast("Alerta enviado com sucesso para a rede de proteção. ✅", "danger");
  } else if (out.email && out.email.sent) {
    toast("Alerta enviado por email.", "success");
  } else {
    toast("Alerta registrado no sistema.", "warning");
  }

  return out;
}

document.getElementById("btnSOS")?.addEventListener("click", async () => {
  try {
    const msg = prompt("Mensagem opcional (ex.: 'Estou na saída do bloco 3Q, preciso de ajuda')") || "";

    if (!navigator.geolocation) {
      await sendAlert("SOS", msg, null);
      return;
    }

    toast("Obtendo localização exata via satélite...", "info");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await sendAlert("SOS", msg, pos.coords);
        } catch (e) {
          toast("Erro ao processar SOS.", "danger");
        }
      },
      async (err) => {
        try {
          await sendAlert("SOS", msg, null);
        } catch (e) {
          toast("Erro ao enviar SOS.", "danger");
        }
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 2000 }
    );
  } catch (e) {
    toast("Erro interno no aplicativo.", "danger");
  }
});

document.getElementById("btnTest")?.addEventListener("click", async () => {
  try {
    await sendAlert("TEST", "Teste do botão SOS (sem localização)", null);
    toast("Teste de conexão realizado com sucesso ✅", "success");
  } catch (e) {
    toast("Falha de conexão com o servidor.", "danger");
  }
});

// ==========================================
// 🧭 MODO "VOLTAR PRA CASA" (ACOMPANHAMENTO)
// ==========================================

let walk = {
  active: false,
  code: null,
  interval: null,
  watchId: null,
  lastCoords: null,
  countdown: null,
  nextIn: 0
};

function getWalkIntervalMs() {
  const sel = document.getElementById("walkInterval");
  const seconds = sel ? parseInt(sel.value || "60", 10) : 30;
  return Math.max(10, seconds) * 1000;
}

function setWalkUI(lastPingText, nextInSeconds) {
  const lastEl = document.getElementById("walkLastPing");
  const nextEl = document.getElementById("walkNextPing");
  if (lastEl) lastEl.textContent = lastPingText;
  if (nextEl) nextEl.textContent = `Próximo em: ${fmtMMSS(nextInSeconds)}`;
}

function startCountdown(seconds) {
  walk.nextIn = seconds;
  if (walk.countdown) clearInterval(walk.countdown);

  setWalkUI("Último check-in: —", walk.nextIn);

  walk.countdown = setInterval(() => {
    if (!walk.active) return;
    walk.nextIn = Math.max(0, walk.nextIn - 1);
    const lastEl = document.getElementById("walkLastPing");
    const lastText = lastEl ? lastEl.textContent : "Último check-in: —";
    setWalkUI(lastText, walk.nextIn);
  }, 1000);
}

async function pingWalk() {
  const payload = { session_code: walk.code };
  if (walk.lastCoords) {
    payload.lat = walk.lastCoords.latitude;
    payload.lon = walk.lastCoords.longitude;
  }

  try {
    await api("/api/walk/ping", { method: "POST", body: JSON.stringify(payload) });
    const seconds = Math.round(getWalkIntervalMs() / 1000);
    setWalkUI("Último check-in: agora", seconds);
    walk.nextIn = seconds;
  } catch (e) {
    console.warn("Ping falhou", e);
  }
}

async function startWalk() {
  if (walk.active) {
    toast("Acompanhamento já está ativo.", "info");
    return;
  }

  try {
    const label = document.getElementById("walkLabel").value || "Voltando para casa";
    const out = await api("/api/walk/start", { method: "POST", body: JSON.stringify({ label }) });

    walk.active = true;
    walk.code = out.session_code;

    document.getElementById("walkCode").textContent = walk.code;
    document.getElementById("walkBox").classList.remove("d-none");
    document.getElementById("btnWalkStart").disabled = true;

    if (navigator.geolocation) {
      walk.watchId = navigator.geolocation.watchPosition(
        (pos) => { walk.lastCoords = pos.coords; },
        (err) => { console.warn(err); },
        { enableHighAccuracy: true, maximumAge: 2000 }
      );
    }

    const ms = getWalkIntervalMs();
    const seconds = Math.round(ms / 1000);

    await pingWalk();
    startCountdown(seconds);
    walk.interval = setInterval(pingWalk, ms);

    toast("Modo de acompanhamento ativado. Fique em segurança.", "primary");
  } catch (e) {
    toast("Erro ao iniciar a sessão.", "danger");
  }
}

function stopWalkLocal() {
  walk.active = false;

  if (walk.interval) clearInterval(walk.interval);
  walk.interval = null;

  if (walk.countdown) clearInterval(walk.countdown);
  walk.countdown = null;

  if (walk.watchId != null && navigator.geolocation) {
    navigator.geolocation.clearWatch(walk.watchId);
  }

  walk.watchId = null;
  walk.code = null;
  walk.lastCoords = null;

  document.getElementById("walkBox")?.classList.add("d-none");
  const btnStart = document.getElementById("btnWalkStart");
  if(btnStart) btnStart.disabled = false;
}

async function finishWalk() {
  if (!walk.active) return;

  try {
    await api("/api/walk/finish", { method: "POST", body: JSON.stringify({ session_code: walk.code }) });

    const coords = walk.lastCoords ? {
      latitude: walk.lastCoords.latitude,
      longitude: walk.lastCoords.longitude,
      accuracy: walk.lastCoords.accuracy
    } : null;

    stopWalkLocal();
    toast("Sessão finalizada. Que bom que chegou em segurança!", "success");
    await sendAlert("CHECKIN", "Cheguei ao destino (Modo Voltar pra Casa encerrado).", coords);
  } catch (e) {
    toast("Erro ao encerrar a sessão.", "danger");
  }
}

document.getElementById("btnWalkStart")?.addEventListener("click", startWalk);
document.getElementById("btnWalkFinish")?.addEventListener("click", finishWalk);

document.getElementById("btnCopyLink")?.addEventListener("click", async () => {
  try {
    const link = `${location.origin}/admin`;
    await navigator.clipboard.writeText(`Acompanhe minha rota no Rainbow Safe. Link: ${link} | Código da Sessão: ${document.getElementById("walkCode").textContent}`);
    toast("Link copiado! Envie no WhatsApp ou Telegram.", "info");
  } catch (e) {
    toast("Não foi possível copiar o link.", "danger");
  }
});

document.getElementById("btnWalkUncomfortable")?.addEventListener("click", async () => {
  const btn = document.getElementById("btnWalkUncomfortable");
  if (!btn) return;

  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "Avisando rede...";

  try {
    const coords = walk.lastCoords ? {
      latitude: walk.lastCoords.latitude,
      longitude: walk.lastCoords.longitude,
      accuracy: walk.lastCoords.accuracy
    } : null;

    await sendAlert("CHECKIN", "ALERTA DISCRETO: Estou desconfortável durante a rota. Possível ameaça.", coords);
    toast("Aviso silencioso enviado aos administradores.", "warning");
  } catch (e) {
    toast("Erro. Se for grave, use o botão SOS principal.", "danger");
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
});

// ==========================================
// 🚗 CARONAS & CHAT SEGURO (MESSENGER UI)
// ==========================================

async function refreshApprovedRides() {
  const ul = document.getElementById("rideApprovedList");
  if (!ul) return;

  ul.innerHTML = "";
  try {
    const arr = await api("/api/users/approved-rides");

    if (arr.length === 0) {
      ul.innerHTML = `<li class="list-group-item text-secondary text-center py-3 border-0">Nenhuma carona disponível na rede neste momento.</li>`;
      return;
    }

    for (const u of arr) {
      const li = document.createElement("li");
      li.className = "list-group-item d-flex justify-content-between align-items-center py-3";
      li.innerHTML = `
        <div>
          <div class="fw-bold text-dark"><i class="bi bi-person-check-fill text-success me-2"></i>${escapeHtml(u.display_name)}</div>
          <div class="small text-secondary mt-1">Status: Ativo na rede</div>
        </div>
        <button class="btn btn-sm btn-primary rounded-pill px-3 shadow-sm">Chat Seguro</button>
      `;
      li.querySelector("button").addEventListener("click", async () => {
        try {
          const out = await api("/api/chat/start", {
            method: "POST",
            body: JSON.stringify({ rider_id: u.id })
          });
          openChatModal(out.thread_id, out.rider_display_name);
        } catch(e) { toast("Erro ao iniciar conversa: " + e.message, "danger"); }
      });
      ul.appendChild(li);
    }
  } catch(e) { console.error(e); }
}

const rideForm = document.getElementById("rideApplyForm");
if (rideForm) {
  rideForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData(rideForm);
      const payload = {
        full_name: fd.get("full_name"),
        email: fd.get("email"),
        phone: fd.get("phone"),
        offers_ride: true
      };

      const out = await api("/api/users/apply", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      const st = document.getElementById("rideApplyStatus");
      if (st) st.innerHTML = `<span class="text-success fw-bold"><i class="bi bi-check2-circle"></i> Solicitação enviada! Status: ${out.status}</span>`;

      rideForm.reset();
      await refreshApprovedRides();
    } catch (e2) {
      // Correção de segurança: Proteção contra XSS
      document.getElementById("rideApplyStatus").innerHTML = `<span class="text-danger fw-bold">${escapeHtml(e2.message)}</span>`;
    }
  });

  refreshApprovedRides();
}

// Lógica de Renderização do Chat Modal
let chatState = { threadId: null, timer: null };

async function loadChatMessages() {
  if (!chatState.threadId) return;

  try {
    const msgs = await api(`/api/chat/${chatState.threadId}/messages`);
    const box = document.getElementById("chatMsgs");
    if (!box) return;

    const isScrolledToBottom = box.scrollHeight - box.clientHeight <= box.scrollTop + 10;

    box.innerHTML = "";
    
    if(msgs.length === 0) {
       box.innerHTML = `<div class="text-center text-muted small mt-5">Início da conversa criptografada de ponta a ponta (MVP).</div>`;
       return;
    }

    for (const m of msgs) {
      const isRider = m.sender === "rider";
      const bubbleClass = isRider ? "rider" : "anonymous";
      
      const msgDate = new Date(m.created_at);
      const timeStr = msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const row = document.createElement("div");
      row.className = `chat-bubble ${bubbleClass}`;
      row.innerHTML = `
        ${escapeHtml(m.text)}
        <span class="chat-bubble-time">${timeStr}</span>
      `;
      box.appendChild(row);
    }

    if (isScrolledToBottom) {
      box.scrollTop = box.scrollHeight;
    }
  } catch(e) { console.error("Erro no poll do chat", e); }
}

function openChatModal(threadId, withName) {
  // Correção de memória: limpa o timer anterior caso o modal seja reaberto rapidamente
  if (chatState.timer) clearInterval(chatState.timer);

  chatState.threadId = threadId;

  const withEl = document.getElementById("chatWith");
  const statusEl = document.getElementById("chatStatus");
  const inputEl = document.getElementById("chatInput");
  const modalEl = document.getElementById("chatModal");

  if (!modalEl) return;

  if (withEl) withEl.textContent = withName || "Ofertante";
  if (statusEl) statusEl.textContent = "";
  if (inputEl) inputEl.value = "";

  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  loadChatMessages();

  chatState.timer = setInterval(loadChatMessages, 2500);

  modalEl.addEventListener("hidden.bs.modal", () => {
    if (chatState.timer) clearInterval(chatState.timer);
    chatState.timer = null;
    chatState.threadId = null;
  }, { once: true });
}

document.getElementById("chatSend")?.addEventListener("click", async () => {
  if (!chatState.threadId) return;

  const input = document.getElementById("chatInput");
  const text = (input?.value || "").trim();
  if (!text) return;

  try {
    await api(`/api/chat/${chatState.threadId}/send`, {
      method: "POST",
      body: JSON.stringify({ sender: "anonymous", text })
    });

    input.value = "";
    await loadChatMessages();
    
    const box = document.getElementById("chatMsgs");
    if(box) box.scrollTop = box.scrollHeight;
    
  } catch (e) {
    const statusEl = document.getElementById("chatStatus");
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-danger fw-bold"><i class="bi bi-x-circle"></i> Bloqueio de Segurança: ${escapeHtml(e.message)}</span>`;
      setTimeout(() => statusEl.innerHTML = "", 4000);
    }
  }
});

document.getElementById("chatInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("chatSend")?.click();
  }
});

document.getElementById("chatReport")?.addEventListener("click", async () => {
  if (!chatState.threadId) return;

  try {
    const reason = prompt("Descreva o comportamento inadequado (ex: pedindo endereço, assédio, etc):") || "";
    if(!reason) return; 
    
    await api(`/api/chat/${chatState.threadId}/report`, {
      method: "POST",
      body: JSON.stringify({ reason })
    });

    const statusEl = document.getElementById("chatStatus");
    // Correção de sintaxe: aspas consertadas aqui
    if (statusEl) statusEl.innerHTML = `<span class="text-danger fw-bold"><i class="bi bi-shield-check"></i> Denúncia Registrada.</span>`;
    toast("A equipe de moderação foi acionada e o chat será bloqueado.", "danger");
  } catch (e) {
    toast("Falha ao registrar a denúncia.", "danger");
  }
});

// Inicialização
refreshContacts();
