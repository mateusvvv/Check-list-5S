import { categoryNames, checklistDataByViatura, damageTypeNames, ensureChecklistForViatura, formatTwoDigits, getChecklistItemsForPessoa, getEpiPessoaOptions, getItemName, normalizeEmployeeEpiItem, normalizeChecklistItem, viaturaResponsaveis, vehicleViewNames } from "./config.js";
import { addDoc, auth, collection, db, deleteDoc, firestoreDoc, getDocs, onAuthStateChanged, orderBy, query, serverTimestamp, signInWithEmailAndPassword, signOut, updateDoc } from "./firebase.js";
import { getDamageMarkerLabel } from "./damages.js";
import { gerarPDF, gerarRelatorioComEscolha } from "./pdf.js";
import { carregarConfiguracoes, salvarConfiguracoes } from "./settings.js";
import { ensureViaturaState, getActiveViaturas, setSelectedViatura, state } from "./state.js";

let authReadyCallback = async () => {};
const splashDelayMs = 3000;
let splashTimer = null;

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function escapeJsString(value) {
    return String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "");
}

function formatDateBR(date = new Date()) {
    return date.toLocaleDateString("pt-BR");
}

function formatDateTimeBR(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Data indisponível" : date.toLocaleString("pt-BR");
}

const vistoriadorPorEmail = {
    "alisson.tavares@digitalonline.com.br": "Alisson",
    "marcos@digitalonline.com.br": "Marcos",
    "italo@digitalonline.com.br": "Italo",
    "matheus@digitalonline.com.br": "Matheus"
};

function getVistoriadorResponsavel() {
    const email = String(auth.currentUser?.email || "").trim().toLowerCase();
    return document.getElementById("vistoriador-atual")?.value
        || vistoriadorPorEmail[email]
        || auth.currentUser?.email
        || "Não identificado";
}

function registrarHistoricoConfig(tipo, descricao) {
    state.configHistory.unshift({
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tipo,
        descricao,
        vistoriador: getVistoriadorResponsavel(),
        email: auth.currentUser?.email || "",
        data: new Date().toISOString()
    });
    state.configHistory = state.configHistory.slice(0, 200);
}

function isValidDateBR(value) {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return false;
    const [day, month, year] = value.split("/").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function setAuthReadyCallback(callback) {
    authReadyCallback = callback;
}

export async function loginApp() {
    const email = document.getElementById("app-login-email")?.value || "";
    const pass = document.getElementById("app-login-password")?.value || "";
    const errorLabel = document.getElementById("app-login-error");
    if (errorLabel) errorLabel.innerText = "";

    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (error) {
        if (errorLabel) errorLabel.innerText = "E-mail ou senha inválidos.";
        else alert("Erro no login: " + error.message);
    }
}

export async function loginAdmin() {
    const email = document.getElementById("admin-email").value;
    const pass = document.getElementById("admin-password").value;
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (error) {
        alert("Erro no login: " + error.message);
    }
}

export async function logoutAdmin() {
    if (!confirm("Tem certeza que deseja sair?")) return;
    await signOut(auth);
}

function renderAdminConfig() {
    renderAdminViaturas();
    renderAdminViaturaOptions();
    renderAdminChecklist();
    renderAdminHistory();
}

export function showAdminConfigTab(tab) {
    const targetButton = document.getElementById(`admin-tab-${tab}`);
    const isAlreadyOpen = targetButton?.classList.contains("active");
    if (isAlreadyOpen) {
        ["viaturas", "itens", "historico"].forEach(item => {
            document.getElementById(`admin-tab-${item}`)?.classList.remove("active");
            document.getElementById(`admin-config-${item}`)?.classList.remove("active");
        });
        return;
    }

    ["viaturas", "itens", "historico"].forEach(item => {
        document.getElementById(`admin-tab-${item}`)?.classList.toggle("active", tab === item);
        document.getElementById(`admin-config-${item}`)?.classList.toggle("active", tab === item);
    });
}

function refreshAppAfterConfigChange() {
    window.refreshAppAfterConfigChange?.();
    renderAdminConfig();
}

export function renderAdminViaturas() {
    const container = document.getElementById("admin-viaturas-list");
    if (!container) return;

    container.innerHTML = state.viaturas.map((viatura) => {
        const responsaveis = viaturaResponsaveis[viatura.id] || {};
        return `
            <div class="admin-config-row admin-vehicle-row ${viatura.ativa === false ? "inactive" : ""}">
                <div class="admin-vehicle-main">
                    <input type="text" value="${escapeHtml(viatura.nome)}" onchange="editarNomeViatura('${viatura.id}', this.value)">
                    <span>ID ${formatTwoDigits(viatura.id)}</span>
                    <div class="admin-config-actions">
                        <button type="button" class="${viatura.ativa === false ? "" : "btn-muted"}" onclick="alternarViaturaAtiva('${viatura.id}')">${viatura.ativa === false ? "Ativar" : "Desativar"}</button>
                        <button type="button" class="btn-danger" onclick="removerViatura('${viatura.id}')">Remover</button>
                    </div>
                </div>
                <div class="admin-responsaveis-grid">
                    <label>
                        <span>Técnico</span>
                        <input type="text" value="${escapeHtml(responsaveis.tecnico || "")}" onchange="editarResponsavelViatura('${viatura.id}', 'tecnico', this.value)">
                    </label>
                    <label>
                        <span>CPF técnico</span>
                        <input type="text" value="${escapeHtml(responsaveis.tecnicoCpf || "")}" onchange="editarResponsavelViatura('${viatura.id}', 'tecnicoCpf', this.value)">
                    </label>
                    <label>
                        <span>Auxiliar</span>
                        <input type="text" value="${escapeHtml(responsaveis.auxiliar || "")}" onchange="editarResponsavelViatura('${viatura.id}', 'auxiliar', this.value)">
                    </label>
                    <label>
                        <span>CPF auxiliar</span>
                        <input type="text" value="${escapeHtml(responsaveis.auxiliarCpf || "")}" onchange="editarResponsavelViatura('${viatura.id}', 'auxiliarCpf', this.value)">
                    </label>
                </div>
            </div>
        `;
    }).join("");
}

export function renderAdminHistory() {
    const container = document.getElementById("admin-config-history-list");
    if (!container) return;

    if (!state.configHistory.length) {
        container.innerHTML = '<p class="admin-history-empty">Nenhuma alteração registrada.</p>';
        return;
    }

    container.innerHTML = state.configHistory.map(item => `
        <div class="admin-history-row">
            <div class="admin-history-meta">
                <span>${escapeHtml(item.vistoriador || "Não identificado")}</span>
                <small>${escapeHtml(formatDateTimeBR(item.data))}</small>
            </div>
            <div class="admin-history-change">
                <strong>${escapeHtml(item.tipo)}</strong>
                <p>${escapeHtml(item.descricao)}</p>
            </div>
        </div>
    `).join("");
}

export async function limparHistoricoConfig() {
    if (!state.configHistory.length) return;
    if (!confirm("Deseja limpar todo o histórico de alterações?")) return;

    state.configHistory = [];
    await salvarConfiguracoes();
    renderAdminHistory();
}

export async function adicionarViatura() {
    const proximoId = String(Math.max(0, ...state.viaturas.map(viatura => Number(viatura.id) || 0)) + 1);
    const nome = `Viatura ${formatTwoDigits(proximoId)}`;
    state.viaturas.push({ id: proximoId, nome, ativa: true });
    ensureViaturaState(proximoId);
    ensureChecklistForViatura(proximoId);
    setSelectedViatura(proximoId);
    registrarHistoricoConfig("Viatura adicionada", `${nome} foi adicionada.`);
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function editarNomeViatura(id, nome) {
    const viatura = state.viaturas.find(item => item.id === String(id));
    if (!viatura) return;
    viatura.nome = nome.trim() || `Viatura ${formatTwoDigits(id)}`;
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function editarResponsavelViatura(id, campo, valor) {
    const viaturaId = String(id);
    if (!viaturaResponsaveis[viaturaId]) {
        viaturaResponsaveis[viaturaId] = { tecnico: "", tecnicoCpf: "", auxiliar: "", auxiliarCpf: "" };
    }
    if (!["tecnico", "tecnicoCpf", "auxiliar", "auxiliarCpf"].includes(campo)) return;
    viaturaResponsaveis[viaturaId][campo] = valor.trim();
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function alternarViaturaAtiva(id) {
    const viatura = state.viaturas.find(item => item.id === String(id));
    if (!viatura) return;
    viatura.ativa = viatura.ativa === false;
    if (state.selectedViatura === String(id) && viatura.ativa === false) {
        setSelectedViatura(getActiveViaturas()[0]?.id || id);
    }
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function removerViatura(id) {
    const viaturaId = String(id);
    const viatura = state.viaturas.find(item => item.id === viaturaId);
    if (!viatura) return;

    if (!confirm(`Deseja remover ${viatura.nome}?`)) return;

    registrarHistoricoConfig("Viatura removida", `${viatura.nome} foi removida.`);
    state.viaturas = state.viaturas.filter(item => item.id !== viaturaId);
    delete state.surveyStatus[viaturaId];
    delete state.vehicleDamages[viaturaId];
    delete state.tabletDamages[viaturaId];
    delete state.vistoriaMode[viaturaId];
    delete state.vistoriasLocais[viaturaId];
    delete checklistDataByViatura[viaturaId];

    if (state.viaturas.length === 0) {
        await adicionarViatura();
        return;
    }

    if (state.selectedViatura === viaturaId) {
        setSelectedViatura(getActiveViaturas()[0]?.id || state.viaturas[0]?.id || "1");
    }

    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export function renderAdminChecklist() {
    const container = document.getElementById("admin-checklist-list");
    const select = document.getElementById("admin-item-category");
    const viaturaSelect = document.getElementById("admin-item-viatura");
    const pessoaSelect = document.getElementById("admin-item-pessoa");
    if (!container || !select || !viaturaSelect) return;

    const category = select.value || "ferramentas";
    const viaturaId = viaturaSelect.value || state.selectedViatura;
    if (pessoaSelect) {
        const pessoas = getEpiPessoaOptions(viaturaId);
        const valorAtual = pessoaSelect.value;
        pessoaSelect.style.display = category === "epis" ? "" : "none";
        pessoaSelect.innerHTML = pessoas.length
            ? pessoas.map(pessoa => `<option value="${escapeHtml(pessoa.key)}">${escapeHtml(pessoa.tipo)} - ${escapeHtml(pessoa.nome)}</option>`).join("")
            : `<option value="">Nenhum técnico ou auxiliar</option>`;
        pessoaSelect.value = pessoas.some(pessoa => pessoa.key === valorAtual) ? valorAtual : (pessoas[0]?.key || "");
    }
    const pessoaKey = category === "epis" ? (pessoaSelect?.value || "") : "";
    const items = getChecklistItemsForPessoa(category, viaturaId, pessoaKey);
    items.splice(0, items.length, ...items.map((item, index) => (
        category === "epis" ? normalizeEmployeeEpiItem(item, index) : normalizeChecklistItem(item, index)
    )));

    container.innerHTML = items.map((item, index) => {
        const ultimaSubstituicao = item.substituicoes?.at?.(-1);
        const nota = ultimaSubstituicao
            ? `<span class="substitution-note">Substituiu "${escapeHtml(ultimaSubstituicao.itemAnterior)}" em ${escapeHtml(ultimaSubstituicao.data)}</span>`
            : "";

        return `
            <div class="admin-config-row ${item.ativo === false ? "inactive" : ""}">
                <input type="text" value="${escapeHtml(getItemName(item))}" onchange="editarItemChecklist('${viaturaId}', '${category}', ${index}, this.value, '${escapeJsString(pessoaKey)}')">
                <div class="admin-config-actions">
                    <button type="button" onclick="substituirItemChecklist('${viaturaId}', '${category}', ${index}, '${escapeJsString(pessoaKey)}')">Substituir</button>
                    <button type="button" class="btn-muted" onclick="alternarItemChecklist('${viaturaId}', '${category}', ${index}, '${escapeJsString(pessoaKey)}')">${item.ativo === false ? "Ativar" : "Desativar"}</button>
                    <button type="button" class="btn-danger" onclick="removerItemChecklist('${viaturaId}', '${category}', ${index}, '${escapeJsString(pessoaKey)}')">Remover</button>
                </div>
                ${nota}
            </div>
        `;
    }).join("");
}

export function renderAdminViaturaOptions() {
    const select = document.getElementById("admin-item-viatura");
    if (!select) return;

    const valorAtual = select.value || state.selectedViatura;
    select.innerHTML = state.viaturas.map(viatura => `
        <option value="${viatura.id}">${escapeHtml(viatura.nome)}${viatura.ativa === false ? " (desativada)" : ""}</option>
    `).join("");
    select.value = state.viaturas.some(viatura => viatura.id === valorAtual) ? valorAtual : state.selectedViatura;
}

export async function adicionarItemChecklist() {
    const category = document.getElementById("admin-item-category")?.value || "ferramentas";
    const viaturaId = document.getElementById("admin-item-viatura")?.value || state.selectedViatura;
    const pessoaKey = category === "epis" ? (document.getElementById("admin-item-pessoa")?.value || "") : "";
    const input = document.getElementById("admin-item-name");
    const nome = input?.value.trim();
    if (!nome) {
        alert("Informe o nome do item.");
        return;
    }

    const normalizeItem = category === "epis" ? normalizeEmployeeEpiItem : normalizeChecklistItem;
    getChecklistItemsForPessoa(category, viaturaId, pessoaKey).push(normalizeItem({
        id: `item-${Date.now()}`,
        nome,
        ativo: true,
        quantidade: 1,
        valor: 0,
        substituicoes: []
    }));
    if (input) input.value = "";
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function editarItemChecklist(viaturaId, category, index, nome, pessoaKey = "") {
    const items = getChecklistItemsForPessoa(category, viaturaId, pessoaKey);
    items[index] = category === "epis" ? normalizeEmployeeEpiItem(items[index], index) : normalizeChecklistItem(items[index], index);
    items[index].nome = nome.trim() || items[index].nome;
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function alternarItemChecklist(viaturaId, category, index, pessoaKey = "") {
    const items = getChecklistItemsForPessoa(category, viaturaId, pessoaKey);
    items[index] = category === "epis" ? normalizeEmployeeEpiItem(items[index], index) : normalizeChecklistItem(items[index], index);
    items[index].ativo = items[index].ativo === false;
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function removerItemChecklist(viaturaId, category, index, pessoaKey = "") {
    if (!confirm("Deseja remover este item do checklist?")) return;
    getChecklistItemsForPessoa(category, viaturaId, pessoaKey).splice(index, 1);
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function substituirItemChecklist(viaturaId, category, index, pessoaKey = "") {
    const items = getChecklistItemsForPessoa(category, viaturaId, pessoaKey);
    items[index] = category === "epis" ? normalizeEmployeeEpiItem(items[index], index) : normalizeChecklistItem(items[index], index);
    const item = items[index];
    const novoNome = prompt("Informe o nome do novo item:", item.nome);
    if (!novoNome || !novoNome.trim()) return;

    const data = prompt("Informe a data da substituição (dd/mm/aaaa):", formatDateBR());
    if (!data || !data.trim()) return;
    if (!isValidDateBR(data.trim())) {
        alert("Informe a data no formato brasileiro: dd/mm/aaaa.");
        return;
    }

    const itemAnterior = item.nome;
    const itemNovo = novoNome.trim();
    item.substituicoes.push({
        itemAnterior,
        itemNovo,
        data: data.trim(),
        registradoEm: new Date().toISOString()
    });
    item.nome = itemNovo;
    item.ativo = true;
    const viatura = state.viaturas.find(item => item.id === String(viaturaId));
    registrarHistoricoConfig(
        "Item substituído",
        `${categoryNames[category] || category}: "${itemAnterior}" foi substituído por "${itemNovo}" em ${viatura?.nome || `Viatura ${formatTwoDigits(viaturaId)}`}.`
    );
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function carregarHistorico() {
    const tbody = document.getElementById("history-tbody");
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Carregando...</td></tr>';

    try {
        const q = query(collection(db, "vistorias"), orderBy("dataEnvio", "desc"));
        const querySnapshot = await getDocs(q);

        tbody.innerHTML = "";
        state.vistoriasCache = [];
        state.selectedVistorias.clear();
        atualizarContadorSelecionadas();

        const vistorias = [];
        const resolucoes = [];

        querySnapshot.forEach((doc) => {
            const data = { id: doc.id, ...doc.data() };
            if (data.tipoRegistro === "resolucaoPendencia") {
                resolucoes.push(data);
                return;
            }
            vistorias.push(data);
        });

        const resolucoesPorVistoria = {};
        resolucoes.forEach((resolucao) => {
            if (!resolucao.vistoriaOrigemId) return;
            const atual = resolucoesPorVistoria[resolucao.vistoriaOrigemId];
            const dataAtual = atual?.pendenciaResolvida?.dataResolucao?.toDate?.() || new Date(0);
            const dataResolucao = resolucao.pendenciaResolvida?.dataResolucao?.toDate?.() || new Date(0);
            if (!atual || dataResolucao >= dataAtual) {
                resolucoesPorVistoria[resolucao.vistoriaOrigemId] = resolucao;
            }
        });

        state.vistoriasCache = vistorias.map((vistoria) => {
            const resolucao = resolucoesPorVistoria[vistoria.id];
            if (!resolucao) return vistoria;
            return {
                ...vistoria,
                pendenciaResolvida: resolucao.pendenciaResolvida
            };
        });

        aplicarFiltros();
    } catch (error) {
        console.error("Erro ao buscar histórico:", error);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Erro ao carregar dados.</td></tr>';
    }
}

export function aplicarFiltros() {
    const vistoriador = document.getElementById("filter-vistoriador").value;
    const dataInicio = document.getElementById("filter-data-inicio").value;
    const dataFim = document.getElementById("filter-data-fim").value;
    const status = document.getElementById("filter-status")?.value || "";

    if (vistoriador) window.sincronizarVistoriadorLogado?.(vistoriador);

    let filtrados = state.vistoriasCache;

    if (vistoriador) filtrados = filtrados.filter(v => v.vistoriador === vistoriador);
    if (dataInicio) {
        const dInicio = new Date(dataInicio + "T00:00:00");
        filtrados = filtrados.filter(v => getDataReferenciaFiltro(v) >= dInicio);
    }
    if (dataFim) {
        const dFim = new Date(dataFim + "T23:59:59");
        filtrados = filtrados.filter(v => getDataReferenciaFiltro(v) <= dFim);
    }
    if (status) {
        filtrados = filtrados.filter(v => getStatusVistoria(v) === status);
    }

    atualizarCardsEstatisticas(filtrados);
    renderHistoricoTable(filtrados);
}

function getDataReferenciaFiltro(vistoria) {
    if (vistoria.pendenciaResolvida?.resolvida) {
        return vistoria.pendenciaResolvida.dataResolucao?.toDate?.()
            || vistoria.dataEnvio?.toDate?.()
            || new Date();
    }

    return vistoria.dataEnvio?.toDate?.() || new Date();
}

function getStatusVistoria(vistoria) {
    if (vistoria.pendenciaResolvida?.resolvida) return "resolvida";
    if (vistoriaTemPendencia(vistoria)) return "pendente";
    return "ok";
}

function vistoriaTemPendencia(vistoria) {
    if (vistoria.pendenciaResolvida?.resolvida) return false;

    const temItemPendente = vistoria.itens.some(i => i.status !== "ok");
    const temAvariaVisual = Array.isArray(vistoria.avarias) && vistoria.avarias.length > 0;
    const temAvariaTablet = Array.isArray(vistoria.avariasTablet) && vistoria.avariasTablet.length > 0;
    return temItemPendente || temAvariaVisual || temAvariaTablet;
}

function montarResolucaoPendencia(vistoria, observacao) {
    return {
        resolvida: true,
        observacao: observacao.trim(),
        resolvidoPor: auth.currentUser.email || "Admin",
        dataResolucao: serverTimestamp(),
        vistoriaOrigemId: vistoria.id
    };
}

async function salvarResolucaoPendencia(vistoria, observacao) {
    const pendenciaResolvida = montarResolucaoPendencia(vistoria, observacao);

    try {
        await updateDoc(firestoreDoc(db, "vistorias", vistoria.id), { pendenciaResolvida });
        return;
    } catch (error) {
        if (error?.code !== "permission-denied") throw error;

        await addDoc(collection(db, "vistorias"), {
            tipoRegistro: "resolucaoPendencia",
            vistoriaOrigemId: vistoria.id,
            viaturaId: vistoria.viaturaId || null,
            tabletId: vistoria.tabletId || null,
            vistoriador: vistoria.vistoriador || auth.currentUser.email || "Admin",
            categoria: vistoria.categoria || "resolucao",
            itens: [],
            dataEnvio: serverTimestamp(),
            pendenciaResolvida
        });
    }
}

function atualizarCardsEstatisticas(dados) {
    const total = dados.length;
    const pendentes = dados.filter(vistoriaTemPendencia).length;

    document.getElementById("stat-total").innerText = total;
    document.getElementById("stat-pending").innerText = pendentes;
    document.getElementById("stat-ok").innerText = total - pendentes;
}

function renderHistoricoTable(dados) {
    const tbody = document.getElementById("history-tbody");
    tbody.innerHTML = "";

    if (dados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nenhuma vistoria encontrada com os filtros aplicados.</td></tr>';
        return;
    }

    dados.forEach((data) => {
        const dateObj = getDataReferenciaFiltro(data);
        const status = getStatusVistoria(data);
        const statusHTML = status === "pendente"
            ? '<span class="status-pendente">Pendência</span>'
            : status === "resolvida"
                ? '<span class="status-resolvida">Resolvida</span>'
            : '<span class="status-ok">Tudo OK</span>';
        const equipamento = data.categoria === "tablets"
            ? `Tablet ${data.tabletId || data.viaturaId}`
            : `Viatura ${data.viaturaId}`;

        tbody.innerHTML += `
            <tr onclick="verDetalhes('${data.id}')">
                <td onclick="event.stopPropagation();">
                    <input type="checkbox" class="history-select" value="${data.id}" ${state.selectedVistorias.has(data.id) ? "checked" : ""} onchange="toggleSelecionarVistoria('${data.id}', this.checked)">
                </td>
                <td>${dateObj.toLocaleString("pt-BR")}</td>
                <td>${data.vistoriador}</td>
                <td>${equipamento}</td>
                <td>${categoryNames[data.categoria] || data.categoria}</td>
                <td>${statusHTML}</td>
            </tr>
        `;
    });
    atualizarContadorSelecionadas();
}

export function toggleSelecionarVistoria(id, checked) {
    if (checked) state.selectedVistorias.add(id);
    else state.selectedVistorias.delete(id);
    atualizarContadorSelecionadas();
}

export function toggleSelecionarTodasVistorias(checked) {
    document.querySelectorAll(".history-select").forEach(checkbox => {
        checkbox.checked = checked;
        toggleSelecionarVistoria(checkbox.value, checked);
    });
}

function atualizarContadorSelecionadas() {
    const count = state.selectedVistorias.size;
    const label = document.getElementById("selected-count");
    const selectAll = document.getElementById("select-all-vistorias");
    if (label) label.innerText = `${count} selecionada${count === 1 ? "" : "s"}`;
    if (selectAll) {
        const visibleCheckboxes = document.querySelectorAll(".history-select");
        selectAll.checked = visibleCheckboxes.length > 0 && [...visibleCheckboxes].every(checkbox => checkbox.checked);
    }
}

export async function excluirVistoriasSelecionadas() {
    const ids = [...state.selectedVistorias];
    if (ids.length === 0) {
        alert("Selecione pelo menos uma vistoria para excluir.");
        return;
    }

    if (!auth.currentUser) {
        alert("Faça login no Painel Admin antes de excluir vistorias.");
        return;
    }

    if (!confirm(`Deseja excluir ${ids.length} vistoria${ids.length === 1 ? "" : "s"} selecionada${ids.length === 1 ? "" : "s"}? Esta ação não pode ser desfeita.`)) {
        return;
    }

    const deleteButton = document.querySelector(".btn-delete-selected");
    try {
        if (deleteButton) deleteButton.disabled = true;
        for (const id of ids) {
            await deleteDoc(firestoreDoc(db, "vistorias", id));
        }
        state.selectedVistorias.clear();
        await carregarHistorico();
        alert("Vistorias excluídas com sucesso.");
    } catch (error) {
        console.error("Erro ao excluir vistorias:", error);
        const mensagem = error?.code === "permission-denied"
            ? "Permissão negada pelo Firebase. Verifique se as regras do Firestore permitem delete para o usuário admin logado."
            : `Erro ao excluir vistorias selecionadas: ${error?.message || error}`;
        alert(mensagem);
    } finally {
        if (deleteButton) deleteButton.disabled = false;
    }
}

export async function resolverPendenciasSelecionadas() {
    try {
        if (!auth.currentUser) {
            alert("Faça login no Painel Admin antes de marcar pendências como resolvidas.");
            return;
        }

        const ids = [...state.selectedVistorias];
        if (ids.length === 0) {
            alert("Selecione pelo menos uma vistoria com pendência.");
            return;
        }

        const selecionadas = ids
            .map(id => state.vistoriasCache.find(vistoria => vistoria.id === id))
            .filter(Boolean);
        const pendentes = selecionadas.filter(vistoriaTemPendencia);

        if (pendentes.length === 0) {
            alert("As vistorias selecionadas não possuem pendências abertas.");
            return;
        }

        const observacao = prompt(
            `Descreva como ${pendentes.length === 1 ? "a pendência foi resolvida" : "as pendências foram resolvidas"}:`,
            ""
        );

        if (!observacao || !observacao.trim()) {
            alert("Informe uma observação para registrar a resolução.");
            return;
        }

        const resolveButton = document.querySelector(".btn-resolve-selected");
        if (resolveButton) resolveButton.disabled = true;

        for (const vistoria of pendentes) {
            await salvarResolucaoPendencia(vistoria, observacao);
        }

        state.selectedVistorias.clear();
        await carregarHistorico();
        alert(`${pendentes.length} pendência${pendentes.length === 1 ? "" : "s"} marcada${pendentes.length === 1 ? "" : "s"} como resolvida${pendentes.length === 1 ? "" : "s"}.`);
    } catch (error) {
        console.error("Erro ao resolver pendências:", error);
        alert(`Erro ao resolver pendências: ${error?.message || error}`);
    } finally {
        const resolveButton = document.querySelector(".btn-resolve-selected");
        if (resolveButton) resolveButton.disabled = false;
    }
}

export async function exportarVistoriasSelecionadasPDF() {
    try {
        if (!auth.currentUser) {
            alert("Faça login no Painel Admin antes de baixar os PDFs selecionados.");
            return;
        }

        const ids = [...state.selectedVistorias];
        if (ids.length === 0) {
            alert("Selecione pelo menos uma vistoria para baixar em PDF.");
            return;
        }

        const selecionadas = ids
            .map(id => state.vistoriasCache.find(vistoria => vistoria.id === id))
            .filter(Boolean);

        if (selecionadas.length === 0) {
            alert("Nenhuma vistoria selecionada foi encontrada no histórico carregado.");
            return;
        }

        const exportButton = document.querySelector(".btn-export-selected");
        if (exportButton) exportButton.disabled = true;

        for (const vistoria of selecionadas) {
            const equipamento = vistoria.categoria === "tablets"
                ? `Tablet_${formatTwoDigits(vistoria.tabletId || vistoria.viaturaId)}_Viatura_${formatTwoDigits(vistoria.viaturaId)}`
                : `Viatura_${formatTwoDigits(vistoria.viaturaId)}`;
            const categoria = categoryNames[vistoria.categoria] || vistoria.categoria;
            const data = (vistoria.dataEnvio?.toDate?.() || new Date()).toISOString().slice(0, 10);

            await gerarPDF(`Relatorio_${equipamento}_${categoria}_${data}`, [vistoria], {
                reportName: `${equipamento.replace(/_/g, " ")} - ${categoria}`
            });
        }

        alert(`${selecionadas.length} PDF${selecionadas.length === 1 ? "" : "s"} baixado${selecionadas.length === 1 ? "" : "s"} com sucesso.`);
    } catch (error) {
        console.error("Erro ao baixar PDFs selecionados:", error);
        alert(`Erro ao baixar PDFs selecionados: ${error?.message || error}`);
    } finally {
        const exportButton = document.querySelector(".btn-export-selected");
        if (exportButton) exportButton.disabled = false;
    }
}

export function verDetalhes(docId) {
    const vistoria = state.vistoriasCache.find(v => v.id === docId);
    if (!vistoria) return;

    const modal = document.getElementById("details-modal");
    const body = document.getElementById("modal-body");
    const title = document.getElementById("modal-title");

    const equipamentoTitulo = vistoria.categoria === "tablets"
        ? `Tablet ${vistoria.tabletId || vistoria.viaturaId}`
        : `Viatura ${vistoria.viaturaId}`;
    title.innerText = `Detalhes: ${categoryNames[vistoria.categoria]} - ${equipamentoTitulo}`;

    const pendentes = vistoria.itens.filter(i => i.status !== "ok");
    let html = `<p><strong>Vistoriador:</strong> ${vistoria.vistoriador}</p>`;
    if (vistoria.dataVistoria) html += `<p><strong>Data da vistoria:</strong> ${String(vistoria.dataVistoria).split("-").reverse().join("/")}</p>`;
    if (vistoria.tecnicoNome) html += `<p><strong>Técnico:</strong> ${vistoria.tecnicoNome}</p>`;
    if (vistoria.tecnicoCpf) html += `<p><strong>CPF Técnico:</strong> ${vistoria.tecnicoCpf}</p>`;
    if (vistoria.auxiliarTecnico) html += `<p><strong>Auxiliar Técnico:</strong> ${vistoria.auxiliarTecnico}</p>`;
    if (vistoria.auxiliarCpf) html += `<p><strong>CPF Auxiliar:</strong> ${vistoria.auxiliarCpf}</p>`;
    if (vistoria.categoria === "epis" && vistoria.epiResponsavelNome) {
        html += `<p><strong>EPIs vistoriados:</strong> ${vistoria.epiResponsavelTipo || "Funcionário"} - ${vistoria.epiResponsavelNome}</p>`;
    }
    if (vistoria.km) html += `<p><strong>KM:</strong> ${vistoria.km}</p>`;
    if (vistoria.categoria === "tablets") {
        html += `<p><strong>Tablet:</strong> ${formatTwoDigits(vistoria.tabletId || vistoria.viaturaId)} vinculado à Viatura ${formatTwoDigits(vistoria.viaturaId)}</p>`;
        if (vistoria.observacoesTablet) html += `<p><strong>Observações:</strong> ${vistoria.observacoesTablet}</p>`;
    }
    if (vistoria.avarias && vistoria.avarias.length > 0) {
        html += '<h4>Avarias marcadas:</h4><ul class="pending-list">';
        vistoria.avarias.forEach((avaria) => {
            html += `<li><strong>${getDamageMarkerLabel(avaria.type)} - ${damageTypeNames[avaria.type] || avaria.type}:</strong> ${vehicleViewNames[avaria.view] || avaria.view}</li>`;
        });
        html += "</ul>";
    }
    if (vistoria.avariasTablet && vistoria.avariasTablet.length > 0) {
        html += '<h4>Avarias do tablet:</h4><ul class="pending-list">';
        vistoria.avariasTablet.forEach((avaria) => {
            html += `<li><strong>${getDamageMarkerLabel(avaria.type)} - ${damageTypeNames[avaria.type] || avaria.type}:</strong> ${avaria.view}</li>`;
        });
        html += "</ul>";
    }

    if (pendentes.length > 0) {
        html += '<h4>Itens Pendentes:</h4><ul class="pending-list">';
        pendentes.forEach(p => {
            const iconMap = { pendente: "⚠️", perdeu: "❌", quebrou: "🛠️" };
            const labelStatus = iconMap[p.status] || "❓";
            const quantidade = Number(p.quantidade || 0);
            const valor = Number(p.valorUnitario || 0);
            const total = Number(p.total || quantidade * valor);
            const epiMeta = `${p.ca ? ` - C.A.: ${escapeHtml(p.ca)}` : ""}${p.dataEntrega ? ` - Entrega: ${escapeHtml(p.dataEntrega)}` : ""}`;
            html += `<li><strong>${labelStatus} ${quantidade || "-"}x ${p.item} - R$ ${valor.toFixed(2)} - Total R$ ${total.toFixed(2)}${epiMeta}:</strong> ${p.observacao || "Sem observação"}</li>`;
        });
        html += "</ul>";
    } else {
        html += '<p class="status-ok details-ok">✅ Nenhum item pendente encontrado.</p>';
    }

    if (vistoria.pendenciaResolvida?.resolvida) {
        const dataResolucao = vistoria.pendenciaResolvida.dataResolucao?.toDate?.();
        html += '<div class="resolution-box">';
        html += '<h4>Pendência Resolvida</h4>';
        html += `<p><strong>Observação:</strong> ${vistoria.pendenciaResolvida.observacao || "Sem observação"}</p>`;
        html += `<p><strong>Resolvido por:</strong> ${vistoria.pendenciaResolvida.resolvidoPor || "Admin"}</p>`;
        if (dataResolucao) html += `<p><strong>Data:</strong> ${dataResolucao.toLocaleString("pt-BR")}</p>`;
        html += "</div>";
    }

    body.innerHTML = html;
    modal.style.display = "block";
}

export function closeModal() {
    document.getElementById("details-modal").style.display = "none";
}

export async function exportarHistoricoPDF() {
    try {
        if (!auth.currentUser) {
            alert("Faça login no Painel Admin antes de exportar o PDF.");
            return;
        }

        if (state.vistoriasCache.length === 0) await carregarHistorico();
        await gerarRelatorioComEscolha({ resetarStatus: false });
    } catch (error) {
        console.error("Erro ao exportar PDF:", error);
        alert(`Erro ao exportar PDF: ${error?.message || error}`);
    }
}

export function initAdminAuthListener() {
    onAuthStateChanged(auth, async (user) => {
        const loginScreen = document.getElementById("app-login-screen");
        const splashScreen = document.getElementById("app-splash-screen");
        const header = document.querySelector("header");
        const main = document.querySelector("main");
        const loginSec = document.getElementById("admin-login-section");
        const panelSec = document.getElementById("admin-panel-section");

        if (splashTimer) {
            clearTimeout(splashTimer);
            splashTimer = null;
        }

        if (loginScreen) loginScreen.style.display = user ? "none" : "grid";
        if (splashScreen) splashScreen.style.display = user ? "grid" : "none";
        if (header) header.style.display = "none";
        if (main) main.style.display = "none";
        if (loginSec) loginSec.style.display = user ? "none" : "block";
        if (panelSec) panelSec.style.display = user ? "block" : "none";
        if (!user) {
            const vistoriadorSelect = document.getElementById("vistoriador-atual");
            if (vistoriadorSelect) vistoriadorSelect.disabled = false;
        }
        if (user) {
            const splashWait = new Promise(resolve => {
                splashTimer = setTimeout(resolve, splashDelayMs);
            });
            await Promise.all([
                (async () => {
                    await carregarConfiguracoes();
                    await authReadyCallback();
                    renderAdminConfig();
                    carregarHistorico();
                })(),
                splashWait
            ]);
            if (auth.currentUser !== user) return;
            if (splashScreen) splashScreen.style.display = "none";
            if (header) header.style.display = "flex";
            if (main) main.style.display = "block";
            splashTimer = null;
        }
    });
}
