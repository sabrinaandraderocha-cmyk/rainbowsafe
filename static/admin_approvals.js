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
  el.innerHTML = msg; // Permite colocar ícones no toast
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function esc(s) {
  return (s || "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
}

// ==========================================
// RENDERIZAÇÃO DE LISTAS E CARDS
// ==========================================

function renderPendingCard(user) {
  const date = new Date(user.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  return `
    <div class="list-group-item p-3 mb-2 border rounded-3 shadow-sm bg-white">
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-3">
        <div>
          <div class="fw-bold text-dark"><i class="bi bi-person-fill text-primary me-1"></i> ${esc(user.full_name)}</div>
          <div class="small text-secondary mt-1">
            <i class="bi bi-envelope me-1"></i> ${esc(user.email)}
            ${user.phone ? `<br><i class="bi bi-telephone me-1"></i> ${esc(user.phone)}` : ""}
          </div>
          <div class="small text-muted mt-2" style="font-size: 0.75rem;">
            <i class="bi bi-clock me-1"></i> Solicitado em: ${date}
          </div>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-success rounded-pill px-3 shadow-sm" data-approve="${user.id}">
            <i class="bi bi-check-lg"></i> Aprovar
          </button>
          <button class="btn btn-outline-danger rounded-pill px-3" data-reject="${user.id}">
            <i class="bi bi-x-lg"></i> Reprovar
          </button>
        </div>
      </div>
    </div>
  `;
}

// ==========================================
// FUNÇÃO PRINCIPAL DE ATUALIZAÇÃO
// ==========================================

async function refresh() {
  const pendingBox = document.getElementById("pendingBox");
  const approvedBox = document.getElementById("approvedBox");
  const reportedBox = document.getElementById("reportedBox");

  const btnRefresh = document.getElementById("btnRefresh");
  if(btnRefresh) {
      btnRefresh.disabled = true;
      btnRefresh.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span> Atualizando...`;
  }

  // Loading States
  pendingBox.innerHTML = `<div class="text-center text-secondary py-4"><span class="spinner-border spinner-border-sm me-2"></span> Carregando pendentes...</div>`;
  approvedBox.innerHTML = `<div class="text-center text-secondary py-4"><span class="spinner-border spinner-border-sm me-2"></span> Carregando diretório...</div>`;
  reportedBox.innerHTML = `<div class="text-center text-secondary py-4"><span class="spinner-border spinner-border-sm me-2"></span> Checando denúncias...</div>`;

  try {
    // 1. CARREGAR PENDENTES
    const pending = await api("/api/users/pending");
    if (pending.length === 0) {
      pendingBox.innerHTML = `
        <div class="text-center text-muted p-4">
          <i class="bi bi-check2-circle fs-1 d-block mb-2 text-success"></i>
          Nenhum perfil pendente de aprovação.
        </div>`;
    } else {
      pendingBox.innerHTML = pending.map(renderPendingCard).join("");
    }

    // 2. CARREGAR APROVADOS
    const approved = await api("/api/users/approved-rides");
    if (approved.length === 0) {
      approvedBox.innerHTML = `
        <div class="text-center text-muted p-4">
          <i class="bi bi-inbox fs-1 d-block mb-2 opacity-50"></i>
          Nenhum ofertante ativo na rede no momento.
        </div>`;
    } else {
      approvedBox.innerHTML = `
        <div class="list-group list-group-flush">
          ${approved.map(u => `
            <div class="list-group-item d-flex justify-content-between align-items-center p-3 mb-2 border rounded-3 bg-white shadow-sm">
              <div class="fw-bold text-dark">
                <i class="bi bi-person-check-fill text-success me-2"></i>${esc(u.display_name)}
              </div>
              <span class="badge bg-success rounded-pill px-3 py-2"><i class="bi bi-check-circle me-1"></i> ATIVO</span>
            </div>
          `).join("")}
        </div>
      `;
    }

    // 3. CARREGAR DENÚNCIAS
    const reported = await api("/api/admin/reported-threads");
    if (reported.length === 0) {
      reportedBox.innerHTML = `
        <div class="text-center text-muted p-4">
          <i class="bi bi-emoji-smile fs-1 d-block mb-2 text-success"></i>
          Nenhuma denúncia ativa! O chat está seguro.
        </div>`;
    } else {
      reportedBox.innerHTML = reported.map(t => {
        const date = t.reported_at ? new Date(t.reported_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : "";
        return `
          <div class="list-group-item p-3 mb-2 border border-danger rounded-3 shadow-sm bg-white">
            <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap">
              <div style="flex: 1;">
                <div class="fw-bold text-danger">
                  <i class="bi bi-exclamation-triangle-fill me-1"></i> Chat Cód. #${t.id} — Referente ao Ofertante: ${esc(t.rider_display_name)}
                </div>
                <div class="small text-secondary mt-1"><i class="bi bi-clock me-1"></i> Denunciado em: ${date}</div>
                <div class="mt-2 bg-light p-2 rounded text-dark small border border-danger border-opacity-25">
                  <strong><i class="bi bi-chat-square-quote me-1"></i> Motivo relatado:</strong> ${esc(t.report_reason || "Não especificado")}
                </div>
              </div>
              <div class="d-flex flex-column gap-2 mt-2 mt-sm-0">
                ${t.is_blocked 
                  ? `<span class="badge bg-secondary rounded-pill px-4 py-2"><i class="bi bi-lock-fill me-1"></i> CHAT BLOQUEADO</span>` 
                  : `<button class="btn btn-danger rounded-pill px-4 shadow-sm" data-block="${t.id}">
                       <i class="bi bi-slash-circle me-1"></i> Bloquear Chat
                     </button>`
                }
              </div>
            </div>
          </div>
        `;
      }).join("");
    }

    // ==========================================
    // LISTENERS DE AÇÕES (ATRIBUÍDOS APÓS O RENDER)
    // ==========================================
    
    document.querySelectorAll("[data-approve]").forEach(btn => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const id = btn.getAttribute("data-approve");
        try {
          await api(`/api/users/${id}/approve`, { method: "POST", body: "{}" });
          toast("<i class='bi bi-check-circle-fill me-2'></i> Usuário aprovado com sucesso!", "success");
          refresh();
        } catch(e) { toast(e.message, "danger"); btn.disabled = false; }
      });
    });

    document.querySelectorAll("[data-reject]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-reject");
        const notes = prompt("Qual o motivo da reprovação? (Opcional, mas recomendado para histórico):") || "";
        if(notes !== null) { // Se não cancelou o prompt
          btn.disabled = true;
          try {
            await api(`/api/users/${id}/reject`, { method: "POST", body: JSON.stringify({ notes }) });
            toast("<i class='bi bi-x-circle-fill me-2'></i> Usuário reprovado.", "warning");
            refresh();
          } catch(e) { toast(e.message, "danger"); btn.disabled = false; }
        }
      });
    });

    document.querySelectorAll("[data-block]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if(confirm("Deseja bloquear definitivamente esta conversa por segurança? Ofertante e aluno perderão acesso ao chat.")) {
          btn.disabled = true;
          const id = btn.getAttribute("data-block");
          try {
            await api(`/api/admin/threads/${id}/block`, { method: "POST", body: "{}" });
            toast("<i class='bi bi-shield-lock-fill me-2'></i> Chat bloqueado por segurança.", "dark");
            refresh();
          } catch(e) { toast(e.message, "danger"); btn.disabled = false; }
        }
      });
    });

  } catch(e) {
    toast("Erro ao carregar os dados: " + e.message, "danger");
  } finally {
    if(btnRefresh) {
        btnRefresh.disabled = false;
        btnRefresh.innerHTML = `<i class="bi bi-arrow-clockwise me-2"></i> Atualizar Dados`;
    }
  }
}

// Inicializa a escuta no botão superior
document.getElementById("btnRefresh")?.addEventListener("click", refresh);

// Executa a primeira carga assim que entra na página
refresh();