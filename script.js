import { categoryNames, employeeEpisByPerson, formatTwoDigits, funcionariosExtras, getChecklistItemsForPessoa, getEpiPessoaByKey, getEpiPessoaOptions, getFuncionarioKeyFromFields, getFuncionariosData, getItemName, getVistoriadorByEmail, getVistoriadorPermissoes, normalizeEmployeeEpiItem, resolveChecklistItemData, viaturaResponsaveis, vistoriadorPermissionCategories, vistoriadorPodeVistoriar, vistoriadores, vistoriadoresTablet, vistoriadoresNotebook, vistoriadoresAcessoNotebook } from "./js/config.js";
import {
    addDoc,
    auth,
    collection,
    db,
    deleteDoc,
    firestoreDoc,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where
} from "./js/firebase.js";
import {
    limparAvariasTablet,
    limparAvariasViatura,
    limparAvariasNotebook,
    marcarAvaria,
    marcarAvariaTablet,
    marcarAvariaNotebook,
    removerAvaria,
    removerAvariaTablet,
    removerAvariaNotebook,
    renderDamageList,
    renderDamageMarkers,
    renderTabletDamageList,
    renderTabletDamageMarkers,
    renderNotebookDamageList,
    renderNotebookDamageMarkers,
    setDamageType,
    setTabletDamageType,
    setNotebookDamageType,
    updateTabletInfo,
    updateVehicleMapImage
} from "./js/damages.js?v=3";
import {
    aplicarFiltros,
    carregarHistorico,
    closeModal,
    excluirVistoriasSelecionadas,
    exportarVistoriasSelecionadasPDF,
    exportarHistoricoPDF,
    initAdminAuthListener,
    loginApp,
    loginAdmin,
    logoutAdmin,
    limparHistoricoConfig,
    toggleExibirTodosHistoricoConfig,
    toggleExibirTodosHistoricoVistorias,
    exibirMenosHistoricoVistorias,
    limparFiltrosHistoricoVistorias,
    adicionarItemChecklist,
    atualizarTotalItemChecklistAdmin,
    atualizarTotalNovoItemChecklist,
    importarPDFs,
    processarPDFsImportados,
    adicionarEpiFuncionarioExtra,
    adicionarFuncionarioExtra,
    finalizarCadastroFuncionarioExtra,
    adicionarViatura,
    alternarItemChecklist,
    alternarViaturaAtiva,
    adicionarResponsavelViatura,
    editarItemChecklist,
    editarEpiFuncionarioExtra,
    editarFuncionarioExtra,
    editarNomeViatura,
    editarResponsavelViatura,
    removerViatura,
    removerEpiFuncionarioExtra,
    removerFuncionarioExtra,
    removerVistoriador,
    removerItemChecklist,
    removerResponsavelViatura,
    renderAdminHistory,
    renderAdminVistoriadores,
    renderAdminChecklist,
    selecionarAuxiliarViatura,
    selecionarTecnicoViatura,
    setAuthReadyCallback,
    showAdminConfigTab,
    showAdminPeopleTab,
    toggleAdicionarResponsavelViatura,
    substituirItemChecklist,
    adicionarVistoriador,
    alterarPermissoesVistoriador,
    resolverPendenciasSelecionadas,
    toggleSelecionarTodasVistorias,
    toggleSelecionarVistoria,
    verDetalhes
} from "./js/admin.js?v=21";
import {
    encerrarVistoriaCompleta,
    gerarRelatorioViatura,
    setPdfUiCallbacks
} from "./js/pdf.js?v=10";
import {
    checklistReportCategories,
    getCategoriasVistoria,
    getActiveViaturas,
    getViaturaById,
    isVistoriaParcial,
    salvarVistoriaLocal,
    setSelectedViatura,
    setModoVistoria,
    state,
    todasEtapasConcluidas
} from "./js/state.js?v=2";
import { carregarConfiguracoes, salvarConfiguracoes } from "./js/settings.js?v=4";

window.__APP_MODULE_BOOTED__ = true;

let funcionarioItensEditandoKey = "";
let lastTapTime = 0;
let lastTapViaturaId = null;
let menuJustOpened = false; // Trava para o menu não fechar rápido demais
let isLongPressActive = false;
let signatureCanvasInitialized = false;
let signatureDrawing = false;
let statusViaturasUnsubscribe = null;
let analistasCadastradosUnsubscribe = null;
let signatureTarget = { type: "tecnico", index: 0 };
const DOUBLE_TAP_DELAY = 300; // Tempo máximo entre toques para considerar clique duplo
const vistoriaCategoriaLabels = {
    ferramentas: "Ferramentas",
    epis: "EPIs",
    viaturas: "Viatura",
    tablets: "Tablet"
};

function getVistoriadorAtivo() {
    return document.getElementById("vistoriador-atual")?.value || "";
}

function getVistoriadorPorEmail(email) {
    return getVistoriadorByEmail(email)?.nome || "";
}

function getVistoriadorAutenticado() {
    return getVistoriadorPorEmail(auth.currentUser?.email);
}

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
        .replace(/\r?\n/g, "\\n");
}

function renderSelectOptions(select, options, placeholder, currentValue = "") {
    if (!select) return;
    const selectedValue = currentValue || select.value || "";
    select.innerHTML = [
        `<option value="">${escapeHtml(placeholder)}</option>`,
        ...options.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    ].join("");
    select.value = options.some(option => option.value === selectedValue) ? selectedValue : "";
}

function renderVistoriadorOptions() {
    const vistoriadorOptions = vistoriadores.map(vistoriador => ({
        value: vistoriador.nome,
        label: vistoriador.nome
    }));
    renderSelectOptions(document.getElementById("vistoriador-atual"), vistoriadorOptions, "Selecione o Vistoriador");
    renderSelectOptions(document.getElementById("filter-vistoriador"), vistoriadorOptions, "Todos");
    renderSelectOptions(
        document.getElementById("tablet-vistoriador"),
        vistoriadores
            .filter(vistoriador => vistoriadorPodeVistoriar(vistoriador.nome, "tablets"))
            .map(vistoriador => ({ value: vistoriador.nome, label: vistoriador.nome })),
        "Selecione o Responsável"
    );
    renderSelectOptions(
        document.getElementById("notebook-vistoriador"),
        vistoriadores
            .filter(vistoriador => vistoriadoresAcessoNotebook.includes(vistoriador.nome))
            .map(vistoriador => ({ value: vistoriador.nome, label: vistoriador.nome })),
        "Selecione o Responsável"
    );
}

function isTabletOnlyUser(vistoriador = getVistoriadorAtivo()) {
    const permissoes = getVistoriadorPermissoes(vistoriador);
    return permissoes.length === 1 && permissoes[0] === "tablets";
}

function isAlissonVistoriador(vistoriador = getVistoriadorAtivo()) {
    return vistoriador === "Alisson";
}

function podeAcessarCategoria(category, vistoriador = getVistoriadorAtivo()) {
    if (!categoryNames[category]) return true;
    if (!vistoriadorPermissionCategories.includes(category)) return true;
    return vistoriadorPodeVistoriar(vistoriador, category);
}

function getAccessDeniedMessage(category, vistoriador) {
    if (category === "tablets") {
        return `A vistoria de tablets só pode ser acessada por: ${vistoriadoresTablet.join(", ")}.`;
    }
    if (category === "notebooks") {
        return `A vistoria de notebooks só pode ser acessada por: ${vistoriadoresAcessoNotebook.join(", ")}.`;
    }

    if (isTabletOnlyUser(vistoriador)) {
        return `${vistoriador} pode realizar apenas vistorias de tablets.`;
    }

    return "Selecione um vistoriador autorizado para acessar esta vistoria.";
}

function updateVistoriadorLogado() {
    const label = document.getElementById("vistoriador-logado");
    if (!label) return;

    label.innerText = "";
    label.classList.remove("active");
    label.hidden = true;
}

function syncSpecialVistoriadores() {
    const vistoriador = getVistoriadorAtivo();
    const tabletSelect = document.getElementById("tablet-vistoriador");
    const notebookSelect = document.getElementById("notebook-vistoriador");

    if (tabletSelect) {
        tabletSelect.value = (isTabletOnlyUser(vistoriador) || isAlissonVistoriador(vistoriador)) ? vistoriador : "";
    }
    if (notebookSelect) {
        notebookSelect.value = vistoriadoresAcessoNotebook.includes(vistoriador) ? vistoriador : "";
    }
    updateTabletInfo();
}

function updateAccessByVistoriador() {
    const vistoriador = getVistoriadorAtivo();
    Object.keys(categoryNames).forEach(category => {
        const link = document.getElementById(`menu-${category}`);
        if (!link) return;
        const shouldRestrict = !podeAcessarCategoria(category, vistoriador);
        link.classList.toggle("restricted", shouldRestrict);
    });

    // Restrição visual do Painel Admin: Somente Alisson tem acesso
    const adminLink = document.getElementById("menu-admin");
    if (adminLink) {
        adminLink.classList.toggle("restricted", vistoriador !== "Alisson");
    }
}

function selecionarVistoriadorAtivo(silent = false) {
    const vistoriadorSelect = document.getElementById("vistoriador-atual");
    const vistoriadorAutenticado = getVistoriadorAutenticado();
    if (vistoriadorAutenticado && vistoriadorSelect && vistoriadorSelect.value !== vistoriadorAutenticado) {
        vistoriadorSelect.value = vistoriadorAutenticado;
    }

    const vistoriador = getVistoriadorAtivo();
    localStorage.setItem("vistoriadorAtivo", vistoriador);
    updateVistoriadorLogado();
    syncSpecialVistoriadores();
    updateAccessByVistoriador();

    const activeTab = document.querySelector(".tab-content.active");
    if (activeTab && !podeAcessarCategoria(activeTab.id, vistoriador)) {
        if (!silent) alert(getAccessDeniedMessage(activeTab.id, vistoriador));
        showPage(isTabletOnlyUser(vistoriador) ? "tablets" : "ferramentas");
    }
}

function selecionarVistoriadorPorLogin() {
    const vistoriador = getVistoriadorAutenticado();
    const vistoriadorSelect = document.getElementById("vistoriador-atual");
    if (!vistoriador || !vistoriadorSelect) return;

    vistoriadorSelect.value = vistoriador;
    vistoriadorSelect.disabled = true;
    selecionarVistoriadorAtivo(true);
}

function sincronizarVistoriadorLogado(vistoriador) {
    const vistoriadorSelect = document.getElementById("vistoriador-atual");
    if (!vistoriadorSelect || vistoriadorSelect.value === vistoriador) return;

    vistoriadorSelect.value = vistoriador;
    selecionarVistoriadorAtivo(true);
}

function selecionarResponsavelTablet() {
    const tabletSelect = document.getElementById("tablet-vistoriador");
    const vistoriadorSelect = document.getElementById("vistoriador-atual");
    const responsavel = tabletSelect?.value || "";

    if (!vistoriadoresTablet.includes(responsavel)) {
        updateTabletInfo();
        return;
    }

    if (vistoriadorSelect && !isTabletOnlyUser() && !isAlissonVistoriador() && !getVistoriadorAutenticado()) {
        vistoriadorSelect.value = responsavel;
        selecionarVistoriadorAtivo(true);
    }
    updateTabletInfo();
}

function selecionarResponsavelNotebook() {
    const notebookSelect = document.getElementById("notebook-vistoriador");
    const vistoriadorSelect = document.getElementById("vistoriador-atual");
    const responsavel = notebookSelect?.value || "";

    if (!vistoriadoresAcessoNotebook.includes(responsavel)) {
        return;
    }

    if (vistoriadorSelect && !isTabletOnlyUser() && !isAlissonVistoriador() && !getVistoriadorAutenticado()) {
        vistoriadorSelect.value = responsavel;
        selecionarVistoriadorAtivo(true);
    }
}

function toggleNotebookInspectionInfo() {
    const button = document.querySelector(".notebook-info-title");
    const panel = document.getElementById("notebook-inspection-info");
    if (!button || !panel) return;

    setNotebookInspectionInfoOpen(panel.hidden);
}

function setNotebookInspectionInfoOpen(open = true) {
    const button = document.querySelector(".notebook-info-title");
    const panel = document.getElementById("notebook-inspection-info");
    const card = panel?.closest(".notebook-info-card");
    if (!button || !panel) return;

    panel.hidden = !open;
    if (card) card.hidden = !open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    const stateText = button.querySelector("small");
    if (stateText) stateText.textContent = open ? "Ocultar" : "Mostrar";
}

function preencherCamposNotebookCadastro(notebook, scope = "inspection") {
    const modeloInput = scope === "admin"
        ? document.getElementById("admin-notebook-modelo")
        : document.getElementById("notebook-modelo");
    const serialInput = scope === "admin"
        ? document.getElementById("admin-notebook-serial")
        : document.getElementById("notebook-serial");

    if (modeloInput) modeloInput.value = notebook?.modelo || "";
    if (serialInput) serialInput.value = notebook?.numeroSerie || "";
}

function normalizeNotebookLookup(value = "") {
    return String(value)
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ");
}

function getNotebookIdentityFromData(data = {}) {
    const serial = normalizeNotebookLookup(data.numeroSerie || data.notebookNumeroSerie);
    if (serial) return `serial:${serial}`;

    const modelo = normalizeNotebookLookup(data.modelo || data.notebookModelo);
    return modelo ? `modelo:${modelo}` : "";
}

function isNotebookReturnMovement(termType = "") {
    const normalized = String(termType)
        .trim()
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    return normalized === "RETORNO" || normalized === "DEVOLUCAO";
}

function getNotebookUsageStatus(notebook = {}) {
    const identity = getNotebookIdentityFromData(notebook);
    return identity ? state.notebookUsageStatus[identity] : null;
}

function formatNotebookUsageDays(days = 0) {
    const value = Math.max(0, Number(days || 0));
    return value === 1 ? "1 dia" : `${value} dias`;
}

function renderNotebookStatusBadge(notebook = {}) {
    const status = getNotebookUsageStatus(notebook);
    if (status?.emUso) {
        const analista = status.analistaNome || "Analista não informado";
        return `
            <span class="notebook-usage-status" title="Em uso por ${escapeHtml(analista)}">
                <span class="notebook-usage-label">Em uso <span class="notebook-usage-days">(${formatNotebookUsageDays(status.diasUso)})</span></span>
                <span class="notebook-usage-analyst">${escapeHtml(analista)}</span>
            </span>
        `;
    }
    return '<span class="notebook-picker-badge available">Disponível</span>';
}

function renderNotebookInspectionList() {
    const list = document.getElementById("notebook-device-list");
    if (!list) return;

    const busca = String(document.getElementById("notebook-device-search")?.value || "").trim().toLowerCase();
    const selectedSerial = String(document.getElementById("notebook-serial")?.value || "");
    const notebooksOrdenados = [...state.notebooksCadastrados].sort((a, b) => {
        const modeloA = String(a?.modelo || "").toLowerCase();
        const modeloB = String(b?.modelo || "").toLowerCase();
        return modeloA.localeCompare(modeloB);
    });
    const notebooksFiltrados = notebooksOrdenados.filter((notebook) => {
        const label = `${notebook?.modelo || ""} ${notebook?.numeroSerie || ""}`.toLowerCase();
        return !busca || label.includes(busca);
    });

    if (!notebooksFiltrados.length) {
        list.innerHTML = '<p class="placeholder">Nenhum notebook encontrado.</p>';
        return;
    }

    list.innerHTML = notebooksFiltrados.map((notebook) => {
        const modelo = String(notebook.modelo || "Notebook sem identificação").trim();
        const serial = String(notebook.numeroSerie || "Nº de série não informado").trim();
        const selected = selectedSerial && selectedSerial === String(notebook.numeroSerie || "");
        return `
            <button type="button" class="notebook-picker-item${selected ? " selected" : ""}" onclick="selecionarNotebookCadastrado('inspection', '${escapeJsString(notebook.id || "")}')">
                <span class="notebook-picker-icon" aria-hidden="true">💻</span>
                <span class="notebook-picker-info">
                    <strong>${escapeHtml(modelo)}</strong>
                    <small>${escapeHtml(serial)}</small>
                </span>
                ${renderNotebookStatusBadge(notebook)}
            </button>
        `;
    }).join("");
}

function renderNotebookSelectOptions(scope = "inspection") {
    const select = scope === "admin"
        ? document.getElementById("admin-notebook-select")
        : document.getElementById("notebook-select");
    if (!select && scope !== "inspection") return;

    const valorAnterior = select?.value || "";
    if (select) {
        select.innerHTML = '<option value="">Selecione um notebook cadastrado</option>';
    }

    const notebooksOrdenados = [...state.notebooksCadastrados].sort((a, b) => {
        const modeloA = String(a?.modelo || "").toLowerCase();
        const modeloB = String(b?.modelo || "").toLowerCase();
        return modeloA.localeCompare(modeloB);
    });

    if (select) {
        notebooksOrdenados.forEach((notebook) => {
            const option = document.createElement("option");
            option.value = notebook.id || "";
            const label = notebook.modelo
                ? notebook.modelo
                : (notebook.numeroSerie || "Notebook sem identificação");
            option.textContent = label;
            select.appendChild(option);
        });

        if (valorAnterior && Array.from(select.options).some(option => option.value === valorAnterior)) {
            select.value = valorAnterior;
        }
    }

    if (scope === "inspection") renderNotebookInspectionList();
}

function selecionarNotebookCadastrado(scope = "inspection", notebookIdSelecionado = null) {
    const select = scope === "admin"
        ? document.getElementById("admin-notebook-select")
        : document.getElementById("notebook-select");
    const notebookId = notebookIdSelecionado ?? select?.value;
    if (!notebookId) return;

    const notebookSelecionado = state.notebooksCadastrados.find(item => String(item.id) === String(notebookId));
    if (notebookSelecionado) {
        preencherCamposNotebookCadastro(notebookSelecionado, scope);
        if (scope === "inspection") {
            preencherDadosDevolucaoNotebookEmUso(notebookSelecionado);
        }
    }
    if (select) select.value = notebookId;
    if (scope === "inspection") renderNotebookInspectionList();
}

function preencherDadosDevolucaoNotebookEmUso(notebook = {}) {
    const status = getNotebookUsageStatus(notebook);
    if (!status?.emUso) return;

    const termTypeSelect = document.getElementById("notebook-term-type");
    const analistaNomeInput = document.getElementById("notebook-analista-nome");
    const analistaCpfInput = document.getElementById("notebook-analista-cpf");
    const modeloInput = document.getElementById("notebook-modelo");
    const serialInput = document.getElementById("notebook-serial");

    if (termTypeSelect) termTypeSelect.value = "DEVOLUCAO";
    if (analistaNomeInput) analistaNomeInput.value = status.analistaNome || "";
    if (analistaCpfInput) analistaCpfInput.value = status.analistaCpf || "";
    if (modeloInput) modeloInput.value = status.notebookModelo || notebook.modelo || "";
    if (serialInput) serialInput.value = status.notebookNumeroSerie || notebook.numeroSerie || "";

    renderAnalistasInspectionList();
}

async function removerNotebookCadastradoSelecionado(scope = "inspection") {
    const select = scope === "admin"
        ? document.getElementById("admin-notebook-select")
        : document.getElementById("notebook-select");
    const notebookId = select?.value;

    if (!notebookId) {
        alert("Selecione um notebook cadastrado antes de remover.");
        return;
    }

    const notebookSelecionado = state.notebooksCadastrados.find(item => String(item.id) === String(notebookId));
    const label = notebookSelecionado?.modelo || notebookSelecionado?.numeroSerie || "este notebook";

    if (!confirm(`Deseja remover do banco o notebook "${label}"?`)) {
        return;
    }

    try {
        await deleteDoc(firestoreDoc(db, "notebooksCadastrados", notebookId));
        await carregarNotebooksCadastrados();
        const modeloInput = scope === "admin"
            ? document.getElementById("admin-notebook-modelo")
            : document.getElementById("notebook-modelo");
        const serialInput = scope === "admin"
            ? document.getElementById("admin-notebook-serial")
            : document.getElementById("notebook-serial");
        if (modeloInput) modeloInput.value = "";
        if (serialInput) serialInput.value = "";
        alert("✅ Notebook removido do banco com sucesso.");
    } catch (error) {
        console.error("Erro ao remover notebook cadastrado:", error);
        alert("Erro ao remover o notebook do banco.");
    }
}

function normalizarCpfAnalista(valor) {
    return String(valor || "").replace(/\D/g, "");
}

function isAnalistaAtivo(analista) {
    return analista?.ativo !== false;
}

function renderAnalistasInspectionList() {
    const list = document.getElementById("notebook-analyst-list");
    if (!list) return;

    const busca = String(document.getElementById("notebook-analyst-search")?.value || "").trim().toLowerCase();
    const selectedCpf = String(document.getElementById("notebook-analista-cpf")?.value || "");
    const analistasOrdenados = [...state.analistasCadastrados].sort((a, b) => {
        const nomeA = String(a?.nome || "").toLowerCase();
        const nomeB = String(b?.nome || "").toLowerCase();
        return nomeA.localeCompare(nomeB);
    });
    const analistasFiltrados = analistasOrdenados.filter((analista) => {
        const label = `${analista?.nome || ""} ${analista?.cpf || ""}`.toLowerCase();
        return !busca || label.includes(busca);
    });

    if (!analistasFiltrados.length) {
        list.innerHTML = '<p class="placeholder">Nenhum analista encontrado.</p>';
        return;
    }

    list.innerHTML = analistasFiltrados.map((analista) => {
        const ativo = isAnalistaAtivo(analista);
        const nome = String(analista.nome || "Analista sem nome").trim();
        const cpf = String(analista.cpf || "").trim();
        const selected = selectedCpf && selectedCpf === cpf;
        return `
            <button type="button" class="notebook-picker-item${selected ? " selected" : ""}${ativo ? "" : " inactive"}" onclick="selecionarAnalistaCadastrado('inspection', '${escapeJsString(cpf)}')" ${ativo ? "" : "disabled"}>
                <span class="notebook-picker-icon" aria-hidden="true">👤</span>
                <span class="notebook-picker-info">
                    <strong>${escapeHtml(nome)}</strong>
                    <small>${escapeHtml(cpf || "CPF não informado")}</small>
                </span>
                <span class="notebook-picker-badge ${ativo ? "active" : "inactive"}">${ativo ? "Ativo" : "Inativo"}</span>
            </button>
        `;
    }).join("");
}

function renderAnalistasSelectOptions(scope = "inspection") {
    const select = scope === "admin"
        ? document.getElementById("admin-analista-select")
        : document.getElementById("analista-select");
    if (!select && scope !== "inspection") return;

    const valorAnterior = select?.value || "";
    if (select) {
        select.innerHTML = '<option value="">Selecione um analista cadastrado</option>';
    }

    if (select) {
        state.analistasCadastrados.forEach((analista) => {
            const option = document.createElement("option");
            option.value = analista.cpf || "";
            const nome = String(analista.nome || "").trim();
            const ativo = isAnalistaAtivo(analista);
            option.textContent = `${nome || (analista.cpf || "")}${ativo ? "" : " (Inativo)"}`;
            if (!ativo) {
                option.className = "analista-option-inactive";
                if (scope === "inspection") option.disabled = true;
            }
            select.appendChild(option);
        });

        if (valorAnterior && Array.from(select.options).some(option => option.value === valorAnterior && !option.disabled)) {
            select.value = valorAnterior;
        } else if (scope === "inspection") {
            select.value = "";
            const nomeInput = document.getElementById("notebook-analista-nome");
            const cpfInput = document.getElementById("notebook-analista-cpf");
            if (nomeInput) nomeInput.value = "";
            if (cpfInput) cpfInput.value = "";
        }
    }

    if (scope === "inspection") renderAnalistasInspectionList();
}

function renderAnalistasGerenciamento() {
    const modalList = document.getElementById("analistas-modal-list");

    if (!state.analistasCadastrados.length) {
        if (modalList) modalList.innerHTML = '<p class="placeholder">Nenhum analista cadastrado.</p>';
        return;
    }

    if (!modalList) return;

    modalList.innerHTML = state.analistasCadastrados.map((analista) => {
        const ativo = isAnalistaAtivo(analista);
        const nome = String(analista.nome || "Analista sem nome").trim();
        const cpf = String(analista.cpf || "").trim();
        return `
            <div class="analyst-manager-row${ativo ? "" : " inactive"}">
                <div class="admin-analyst-info">
                    <strong>${escapeHtml(nome)}</strong>
                    <span>${escapeHtml(cpf || "CPF não informado")}</span>
                </div>
                <div class="analyst-status-control">
                    <button type="button" class="analyst-toggle ${ativo ? "active" : ""}" onclick="alternarStatusAnalista('${escapeJsString(analista.id)}')" aria-pressed="${ativo ? "true" : "false"}">
                        <span></span>
                    </button>
                    <strong>${ativo ? "Ativo" : "Inativo"}</strong>
                </div>
            </div>
        `;
    }).join("");
}

function abrirGerenciadorAnalistas() {
    renderAnalistasGerenciamento();
    const modal = document.getElementById("analistas-modal");
    if (modal) modal.style.display = "block";
}

function fecharGerenciadorAnalistas() {
    const modal = document.getElementById("analistas-modal");
    if (modal) modal.style.display = "none";
}

function selecionarAnalistaCadastrado(scope = "inspection", cpfSelecionado = null) {
    const select = scope === "admin"
        ? document.getElementById("admin-analista-select")
        : document.getElementById("analista-select");
    const nomeInput = scope === "admin"
        ? document.getElementById("admin-notebook-analista-nome")
        : document.getElementById("notebook-analista-nome");
    const cpfInput = scope === "admin"
        ? document.getElementById("admin-notebook-analista-cpf")
        : document.getElementById("notebook-analista-cpf");

    const cpfSelecionadoFinal = cpfSelecionado ?? select?.value ?? "";
    if (!cpfInput) return;

    const analistaSelecionado = state.analistasCadastrados.find(item => String(item.cpf || "") === String(cpfSelecionadoFinal || ""));
    if (scope === "inspection" && analistaSelecionado && !isAnalistaAtivo(analistaSelecionado)) return;
    if (nomeInput) {
        nomeInput.value = analistaSelecionado?.nome || "";
    }
    cpfInput.value = analistaSelecionado?.cpf || cpfSelecionadoFinal || "";
    if (select) select.value = cpfInput.value;
    if (scope === "inspection") renderAnalistasInspectionList();
}

async function carregarAnalistasCadastrados() {
    if (analistasCadastradosUnsubscribe) return;

    return new Promise((resolve) => {
        const q = query(collection(db, "analistasCadastrados"), orderBy("cpf", "asc"));
        let resolved = false;

        analistasCadastradosUnsubscribe = onSnapshot(q, (snapshot) => {
            state.analistasCadastrados = snapshot.docs.map(docSnap => ({
                id: docSnap.id,
                ...docSnap.data(),
                ativo: docSnap.data().ativo !== false
            }));
            renderAnalistasSelectOptions("inspection");
            renderAnalistasSelectOptions("admin");
            renderAnalistasGerenciamento();
            if (!resolved) {
                resolved = true;
                resolve();
            }
        }, (error) => {
            analistasCadastradosUnsubscribe = null;
            console.error("Erro ao carregar CPFs de analistas:", error);
            if (!resolved) {
                resolved = true;
                resolve();
            }
        });
    });
}

async function salvarCpfAnalista(scope = "inspection") {
    const nomeInput = scope === "admin"
        ? document.getElementById("admin-notebook-analista-nome")
        : document.getElementById("notebook-analista-nome");
    const cpfInput = scope === "admin"
        ? document.getElementById("admin-notebook-analista-cpf")
        : document.getElementById("notebook-analista-cpf");
    const nome = String(nomeInput?.value || "").trim();
    const cpf = normalizarCpfAnalista(cpfInput?.value || "");

    if (!nome || !cpf) {
        alert("Informe o nome e o CPF do analista para salvar.");
        return;
    }

    try {
        const payload = {
            nome,
            cpf,
            cpfBusca: cpf,
            nomeBusca: nome.toLowerCase(),
            ativo: true,
            atualizadoEm: new Date().toISOString()
        };

        const snapshot = await getDocs(query(collection(db, "analistasCadastrados"), where("cpfBusca", "==", cpf)));
        if (!snapshot.empty) {
            payload.ativo = snapshot.docs[0].data().ativo !== false;
            await setDoc(snapshot.docs[0].ref, payload, { merge: true });
        } else {
            await addDoc(collection(db, "analistasCadastrados"), payload);
        }

        await carregarAnalistasCadastrados();
        const select = scope === "admin"
            ? document.getElementById("admin-analista-select")
            : document.getElementById("analista-select");
        if (select) select.value = cpf;
        if (scope === "admin") {
            const adminNomeInput = document.getElementById("admin-notebook-analista-nome");
            const adminCpfInput = document.getElementById("admin-notebook-analista-cpf");
            const adminAnalistaSelect = document.getElementById("admin-analista-select");
            if (adminNomeInput) adminNomeInput.value = "";
            if (adminCpfInput) adminCpfInput.value = "";
            if (adminAnalistaSelect) adminAnalistaSelect.value = "";
        }
        if (scope === "admin") renderAnalistasSelectOptions("inspection");
        alert("✅ Analista salvo no banco.");
    } catch (error) {
        console.error("Erro ao salvar analista:", error);
        alert("Erro ao salvar o analista no banco.");
    }
}

async function removerCpfAnalista(scope = "inspection") {
    const nomeInput = scope === "admin"
        ? document.getElementById("admin-notebook-analista-nome")
        : document.getElementById("notebook-analista-nome");
    const cpfInput = scope === "admin"
        ? document.getElementById("admin-notebook-analista-cpf")
        : document.getElementById("notebook-analista-cpf");
    const cpf = normalizarCpfAnalista(cpfInput?.value || "");

    if (!cpf) {
        alert("Informe o CPF do analista para remover.");
        return;
    }

    if (!confirm(`Deseja remover o analista de CPF ${cpf} do banco?`)) {
        return;
    }

    try {
        const snapshot = await getDocs(query(collection(db, "analistasCadastrados"), where("cpfBusca", "==", cpf)));
        if (snapshot.empty) {
            alert("Analista não encontrado no banco.");
            return;
        }

        const promises = snapshot.docs.map(docSnap => deleteDoc(docSnap.ref));
        await Promise.all(promises);
        await carregarAnalistasCadastrados();
        const select = scope === "admin"
            ? document.getElementById("admin-analista-select")
            : document.getElementById("analista-select");
        if (select) select.value = "";
        if (nomeInput) nomeInput.value = "";
        if (cpfInput) cpfInput.value = "";
        alert("✅ Analista removido do banco.");
    } catch (error) {
        console.error("Erro ao remover analista:", error);
        alert("Erro ao remover o analista do banco.");
    }
}

async function alternarStatusAnalista(analistaId) {
    const analista = state.analistasCadastrados.find(item => item.id === analistaId);
    if (!analista) {
        alert("Analista não encontrado.");
        return;
    }

    const novoStatus = !isAnalistaAtivo(analista);
    try {
        await updateDoc(firestoreDoc(db, "analistasCadastrados", analistaId), {
            ativo: novoStatus,
            atualizadoEm: new Date().toISOString()
        });
        await carregarAnalistasCadastrados();
    } catch (error) {
        console.error("Erro ao alterar status do analista:", error);
        alert("Erro ao alterar o status do analista.");
    }
}

async function carregarNotebooksCadastrados() {
    try {
        const snapshot = await getDocs(query(collection(db, "notebooksCadastrados"), orderBy("modelo", "asc")));
        state.notebooksCadastrados = snapshot.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
        }));
        renderNotebookSelectOptions("inspection");
        renderNotebookSelectOptions("admin");
    } catch (error) {
        console.error("Erro ao carregar notebooks cadastrados:", error);
    }
}

async function carregarNotebookUsageStatus() {
    try {
        const snapshot = await getDocs(query(collection(db, "vistorias"), orderBy("dataEnvio", "desc"), limit(300)));
        const statusPorNotebook = {};
        const hoje = new Date();
        const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.tipoRegistro === "resolucaoPendencia" || data.categoria !== "notebooks") return;

            const identity = getNotebookIdentityFromData(data);
            if (!identity || statusPorNotebook[identity]) return;

            const emUso = !isNotebookReturnMovement(data.notebookTermType);
            const dataRetirada = data.dataVistoria
                ? new Date(`${data.dataVistoria}T00:00:00`)
                : data.dataEnvio?.toDate?.();
            const inicioRetirada = dataRetirada && !Number.isNaN(dataRetirada.getTime())
                ? new Date(dataRetirada.getFullYear(), dataRetirada.getMonth(), dataRetirada.getDate())
                : inicioHoje;
            const diasUso = Math.max(0, Math.round((inicioHoje.getTime() - inicioRetirada.getTime()) / (24 * 60 * 60 * 1000)));
            statusPorNotebook[identity] = {
                emUso,
                analistaNome: emUso ? String(data.analistaNome || "").trim() : "",
                analistaCpf: emUso ? String(data.analistaCpf || "").trim() : "",
                notebookModelo: emUso ? String(data.notebookModelo || "").trim() : "",
                notebookNumeroSerie: emUso ? String(data.notebookNumeroSerie || "").trim() : "",
                diasUso: emUso ? diasUso : 0
            };
        });

        state.notebookUsageStatus = statusPorNotebook;
        renderNotebookSelectOptions("inspection");
    } catch (error) {
        console.error("Erro ao carregar status dos notebooks:", error);
    }
}

async function carregarCadastrosAposAutenticacao() {
    await Promise.all([
        carregarNotebooksCadastrados(),
        carregarAnalistasCadastrados(),
        carregarNotebookUsageStatus()
    ]);
}

async function salvarNotebookCadastro(silencioso = false, scope = "inspection") {
    const modeloInput = scope === "admin"
        ? document.getElementById("admin-notebook-modelo")
        : document.getElementById("notebook-modelo");
    const serialInput = scope === "admin"
        ? document.getElementById("admin-notebook-serial")
        : document.getElementById("notebook-serial");

    const modelo = modeloInput?.value?.trim() || "";
    const numeroSerie = serialInput?.value?.trim() || "";

    if (!modelo && !numeroSerie) {
        if (!silencioso) alert("Informe o modelo e/ou o número de série do notebook para salvar.");
        return null;
    }

    const numeroSerieBusca = numeroSerie.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const payload = {
        modelo,
        numeroSerie,
        numeroSerieBusca,
        atualizadoEm: new Date().toISOString()
    };

    try {
        const snapshot = await getDocs(query(collection(db, "notebooksCadastrados"), where("numeroSerieBusca", "==", numeroSerieBusca)));

        if (!snapshot.empty) {
            const docRef = snapshot.docs[0].ref;
            await setDoc(docRef, payload, { merge: true });
        } else {
            await addDoc(collection(db, "notebooksCadastrados"), payload);
        }

        await carregarNotebooksCadastrados();
        const select = scope === "admin"
            ? document.getElementById("admin-notebook-select")
            : document.getElementById("notebook-select");
        if (select) {
            select.value = state.notebooksCadastrados.find(item => item.numeroSerie === numeroSerie)?.id || "";
        }
        if (scope === "admin") {
            const adminModeloInput = document.getElementById("admin-notebook-modelo");
            const adminSerialInput = document.getElementById("admin-notebook-serial");
            const adminNotebookSelect = document.getElementById("admin-notebook-select");
            if (adminModeloInput) adminModeloInput.value = "";
            if (adminSerialInput) adminSerialInput.value = "";
            if (adminNotebookSelect) adminNotebookSelect.value = "";
        }
        if (scope === "admin") renderNotebookSelectOptions("inspection");
        if (!silencioso) {
            alert("✅ Notebook salvo para uso futuro.");
        }
        return payload;
    } catch (error) {
        console.error("Erro ao salvar notebook cadastrado:", error);
        if (!silencioso) alert("Erro ao salvar o notebook no banco.");
        return null;
    }
}

function solicitarVistoriadorTablet() {
    const vistoriadorAutenticado = getVistoriadorAutenticado();
    if (vistoriadorAutenticado && !vistoriadorPodeVistoriar(vistoriadorAutenticado, "tablets")) {
        alert(`A vistoria de tablets só pode ser acessada por: ${vistoriadoresTablet.join(", ")}.`);
        return false;
    }

    const atual = vistoriadorPodeVistoriar(getVistoriadorAtivo(), "tablets") ? getVistoriadorAtivo() : "";
    const resposta = prompt(
        `Para acessar a vistoria de tablets, informe um vistoriador autorizado: ${vistoriadoresTablet.join(" ou ").toUpperCase()}.`,
        atual
    );

    if (!resposta) return false;

    const normalizado = resposta.trim().toLowerCase();
    const vistoriador = vistoriadoresTablet.find(nome => nome.toLowerCase() === normalizado);

    if (!vistoriador) {
        alert(`A vistoria de tablets só pode ser acessada por: ${vistoriadoresTablet.join(", ")}.`);
        return false;
    }

    const vistoriadorSelect = document.getElementById("vistoriador-atual");
    if (vistoriadorSelect) vistoriadorSelect.value = vistoriador;
    selecionarVistoriadorAtivo(true);
    return true;
}

function toggleMenu() {
    document.getElementById("menu-list").classList.toggle("show");
}

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function showHome() {
    const categorias = getCategoriasVistoria(state.selectedViatura);
    const paginaPadrao = isTabletOnlyUser() ? "tablets" : (categorias[0] || "ferramentas");
    showPage(paginaPadrao, { activeMenuId: "inicio" });
}

function updateActiveMenuLink(pageId) {
    document.querySelectorAll(".nav-links li a.active").forEach(link => link.classList.remove("active"));
    document.getElementById(`menu-${pageId}`)?.classList.add("active");
}

function isChecklistReportCategory(pageId) {
    return checklistReportCategories.includes(pageId);
}

function isCategoriaNaVistoriaAtual(pageId) {
    if (!isChecklistReportCategory(pageId)) return true;
    if (!isVistoriaParcial(state.selectedViatura)) return true;
    return getCategoriasVistoria(state.selectedViatura).includes(pageId);
}

function showPage(pageId, options = {}) {
    let vistoriador = getVistoriadorAtivo();

    // Bloqueio de acesso ao Painel Admin
    if (pageId === "admin" && vistoriador !== "Alisson") {
        alert("Acesso negado. O Painel Admin é restrito ao administrador Alisson.");
        document.getElementById("menu-list").classList.remove("show");
        return;
    }

    if (pageId === "tablets" && !podeAcessarCategoria("tablets", vistoriador)) {
        if (!solicitarVistoriadorTablet()) {
            document.getElementById("menu-list").classList.remove("show");
            return;
        }
        vistoriador = getVistoriadorAtivo();
    }

    if (!podeAcessarCategoria(pageId, vistoriador)) {
        alert(getAccessDeniedMessage(pageId, vistoriador));
        document.getElementById("menu-list").classList.remove("show");
        return;
    }

    if (!isCategoriaNaVistoriaAtual(pageId)) {
        alert(`${categoryNames[pageId]} não faz parte da vistoria parcial selecionada para esta viatura.`);
        document.getElementById("menu-list").classList.remove("show");
        return;
    }

    const headerInfo = document.querySelector(".header-info");
    if (headerInfo) headerInfo.style.display = ["admin", "funcionarios", "notebooks"].includes(pageId) ? "none" : "block";
    document.body.classList.toggle("page-funcionarios", pageId === "funcionarios");
    document.body.classList.toggle("page-notebooks", pageId === "notebooks");

    document.querySelectorAll(".tab-content").forEach(content => content.classList.remove("active"));

    const activePage = document.getElementById(pageId);
    if (activePage) {
        activePage.classList.add("active");
        updateActiveMenuLink(options.activeMenuId || pageId);
        renderItems(pageId);
        if (pageId === "notebooks") setNotebookInspectionInfoOpen(true);
    }

    if (pageId === "funcionarios") renderFuncionariosPage();

    document.getElementById("menu-list").classList.remove("show");
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function normalizeSearch(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function getFuncionarioStatusClass(status) {
    const normalized = normalizeSearch(status);
    if (normalized.includes("ferias")) return "vacation";
    if (normalized.includes("atestado") || normalized.includes("falta")) return "danger";
    if (normalized.includes("folga")) return "dayoff";
    return "active";
}

function getFuncionarioKey(funcionario) {
    return funcionario.cpf || funcionario.nome;
}

function getFuncionarioEditKey(funcionario) {
    return getFuncionarioKeyFromFields(funcionario.nome, funcionario.cpf);
}

function getFuncionarioDisplayViaturaId(funcionario) {
    const viaturaId = String(funcionario?.viaturaId || "");
    return getActiveViaturas().some(viatura => String(viatura.id) === viaturaId) ? viaturaId : "";
}

function getFuncionarioStatusOverrides() {
    try {
        return JSON.parse(localStorage.getItem("funcionarioStatusOverrides") || "{}");
    } catch {
        return {};
    }
}

function getFuncionarioStatus(funcionario) {
    return getFuncionarioStatusOverrides()[getFuncionarioKey(funcionario)] || funcionario.status;
}

function getTecnicoOptions() {
    const porChave = new Map();
    const addOption = (funcionario) => {
        if (!funcionario?.nome || !funcionario?.cpf) return;
        const key = `${normalizeSearch(funcionario.nome)}|${funcionario.cpf}`;
        if (!porChave.has(key)) {
            porChave.set(key, {
                nome: funcionario.nome,
                cpf: funcionario.cpf,
                funcao: funcionario.funcao || ""
            });
        }
    };

    getFuncionariosData()
        .filter(funcionario => funcionario?.nome && funcionario?.cpf)
        .forEach(addOption);

    addOption({
        nome: "SIDNEY MANOEL DO NASCIMENTO",
        cpf: "099.077.164-48",
        funcao: "Técnico"
    });
    [
        { nome: "JOSE RANDSON SILVA", cpf: "125.442.764-36", funcao: "Técnico" },
        { nome: "LUCAS MATEUS BEZERRA CABRAL", cpf: "144.054.924-92", funcao: "Técnico" },
        { nome: "ISAEL FORTUNATO DE LIMA", cpf: "182.838.664-27", funcao: "Auxiliar técnico" },
        { nome: "JOSENILDO VINICIUS ALVES LOPES SILVA", cpf: "131.000.574-57", funcao: "Auxiliar técnico" },
        { nome: "MIKE RYAN LIMA CRUZ", cpf: "159.056.184-88", funcao: "Auxiliar técnico" }
    ].forEach(addOption);

    return [...porChave.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function findTecnicoByName(nome) {
    const termo = normalizeSearch(nome).trim();
    const cpfTermo = onlyDigits(nome);
    if (!termo) return null;
    const options = getTecnicoOptions();
    return options.find(tecnico => normalizeSearch(tecnico.nome).trim() === termo)
        || options.find(tecnico => cpfTermo && onlyDigits(tecnico.cpf) === cpfTermo)
        || options.find(tecnico => normalizeSearch(tecnico.nome).includes(termo))
        || options.find(tecnico => cpfTermo && onlyDigits(tecnico.cpf).includes(cpfTermo))
        || null;
}

function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
}

function findResponsavelEmOutraViatura(viaturaIdAtual, nome, cpf) {
    const nomeNormalizado = normalizeSearch(nome).trim();
    const cpfNormalizado = onlyDigits(cpf);
    if (!nomeNormalizado && !cpfNormalizado) return null;

    for (const [viaturaId, responsaveis] of Object.entries(viaturaResponsaveis)) {
        if (String(viaturaId) === String(viaturaIdAtual)) continue;

        const pessoas = [
            { tipo: "técnico", nome: responsaveis.tecnico, cpf: responsaveis.tecnicoCpf },
            { tipo: "auxiliar", nome: responsaveis.auxiliar, cpf: responsaveis.auxiliarCpf },
            ...(Array.isArray(responsaveis.auxiliares)
                ? responsaveis.auxiliares.map(auxiliar => ({ tipo: "auxiliar", nome: auxiliar.nome, cpf: auxiliar.cpf }))
                : [])
        ];

        const encontrada = pessoas.find(pessoa => {
            if (!pessoa.nome || pessoa.nome === "Veículo sem Técnico") return false;
            const mesmoCpf = cpfNormalizado && onlyDigits(pessoa.cpf) === cpfNormalizado;
            const mesmoNome = nomeNormalizado && normalizeSearch(pessoa.nome).trim() === nomeNormalizado;
            return mesmoCpf || mesmoNome;
        });

        if (encontrada) {
            const viatura = getViaturaById(viaturaId);
            return {
                ...encontrada,
                viaturaNome: viatura?.nome || `Viatura ${formatTwoDigits(viaturaId)}`
            };
        }
    }

    return null;
}

function confirmarResponsavelDuplicadoVistoria(nome, cpf) {
    const duplicado = findResponsavelEmOutraViatura(state.selectedViatura, nome, cpf);
    if (!duplicado) return true;

    return confirm(
        `Atenção: ${duplicado.nome} já está cadastrado como ${duplicado.tipo} em ${duplicado.viaturaNome}.\n\n` +
        "Motivo: a mesma pessoa ficará vinculada a mais de uma viatura.\n\n" +
        "Tem certeza que deseja cadastrar mesmo assim?"
    );
}

function renderTecnicoDatalist() {
    const tecnicoDatalist = document.getElementById("tecnicos-list");
    const auxiliarDatalist = document.getElementById("auxiliares-list");
    const tecnicoAuxiliarDatalist = document.getElementById("tecnicos-auxiliares-list");
    if (!tecnicoDatalist && !auxiliarDatalist && !tecnicoAuxiliarDatalist) return;

    const options = getTecnicoOptions()
        .map(tecnico => `<option value="${escapeHtml(tecnico.nome)}" label="${escapeHtml(tecnico.cpf)}"></option>`)
        .join("");

    if (tecnicoDatalist) tecnicoDatalist.innerHTML = options;
    if (auxiliarDatalist) auxiliarDatalist.innerHTML = options;
    if (tecnicoAuxiliarDatalist) tecnicoAuxiliarDatalist.innerHTML = options;
}

function getResponsavelPickerOptions(term = "") {
    const normalizedTerm = normalizeSearch(term).trim();
    const digitsTerm = onlyDigits(term);
    return getTecnicoOptions()
        .filter((pessoa) => {
            if (!normalizedTerm && !digitsTerm) return true;
            return normalizeSearch(pessoa.nome).includes(normalizedTerm)
                || onlyDigits(pessoa.cpf).includes(digitsTerm);
        })
        .sort((a, b) => {
            if (!normalizedTerm) return a.nome.localeCompare(b.nome, "pt-BR");
            const aStarts = normalizeSearch(a.nome).startsWith(normalizedTerm);
            const bStarts = normalizeSearch(b.nome).startsWith(normalizedTerm);
            if (aStarts !== bStarts) return aStarts ? -1 : 1;
            return a.nome.localeCompare(b.nome, "pt-BR");
        });
}

function ensureResponsavelPicker(input) {
    let picker = input.parentElement?.querySelector(".responsavel-picker-list");
    if (!picker) {
        picker = document.createElement("div");
        picker.className = "responsavel-picker-list";
        picker.setAttribute("role", "listbox");
        input.insertAdjacentElement("afterend", picker);
    }
    return picker;
}

function hideResponsavelPicker(input) {
    const picker = input?.parentElement?.querySelector(".responsavel-picker-list");
    if (picker) picker.hidden = true;
}

function hideOtherResponsavelPickers(activeInput) {
    ["tecnico-nome", "responsavel-pesquisa"].forEach((id) => {
        const input = document.getElementById(id);
        if (input && input !== activeInput) hideResponsavelPicker(input);
    });
}

function showResponsavelPicker(input, { showAll = false } = {}) {
    if (!input) return;
    renderTecnicoDatalist();
    hideOtherResponsavelPickers(input);
    const picker = ensureResponsavelPicker(input);
    const options = getResponsavelPickerOptions(showAll ? "" : input.value);

    picker.innerHTML = options.length
        ? options.map((pessoa) => `
            <button type="button" class="responsavel-picker-item" data-nome="${escapeHtml(pessoa.nome)}">
                <strong>${escapeHtml(pessoa.nome)}</strong>
                <span>${escapeHtml(pessoa.funcao || "Equipe")} • ${escapeHtml(pessoa.cpf)}</span>
            </button>
        `).join("")
        : '<div class="responsavel-picker-empty">Nenhum nome encontrado.</div>';

    picker.hidden = false;
    picker.querySelectorAll(".responsavel-picker-item").forEach((button) => {
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", async () => {
            const nome = button.dataset.nome || "";
            input.value = nome;
            updateInputFontSize(input);
            hideResponsavelPicker(input);
            if (input.id === "tecnico-nome") {
                await selecionarTecnicoVistoriaAtual(nome);
            } else if (input.id === "responsavel-pesquisa") {
                await adicionarAuxiliarExtra(nome);
            }
        });
    });
}

function setupResponsavelPickers() {
    ["tecnico-nome", "responsavel-pesquisa"].forEach((id) => {
        const input = document.getElementById(id);
        if (!input || input.dataset.responsavelPickerBound === "true") return;
        input.dataset.responsavelPickerBound = "true";
        input.setAttribute("readonly", "readonly");
        input.setAttribute("autocomplete", "off");
        input.addEventListener("focus", () => showResponsavelPicker(input, { showAll: true }));
        input.addEventListener("click", () => showResponsavelPicker(input, { showAll: true }));
        input.addEventListener("beforeinput", (event) => event.preventDefault());
        input.addEventListener("input", () => showResponsavelPicker(input, { showAll: true }));
        input.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                hideResponsavelPicker(input);
                return;
            }
            if (["Tab", "Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
                if (event.key !== "Tab") event.preventDefault();
                showResponsavelPicker(input, { showAll: true });
                return;
            }
            event.preventDefault();
        });
    });
}

async function selecionarTecnicoVistoriaAtual(nome) {
    const tecnico = findTecnicoByName(nome);
    const tecnicoNomeInput = document.getElementById("tecnico-nome");
    const tecnicoCpfInput = document.getElementById("tecnico-cpf");
    const tecnicoNome = tecnico?.nome || nome.trim();
    const tecnicoCpf = tecnico?.cpf || tecnicoCpfInput?.value || "";

    if (!confirmarResponsavelDuplicadoVistoria(tecnicoNome, tecnicoCpf)) {
        preencherResponsaveisViatura();
        return;
    }

    if (tecnicoNomeInput) tecnicoNomeInput.value = tecnicoNome;
    if (tecnico && tecnicoCpfInput) tecnicoCpfInput.value = tecnicoCpf;
    if (tecnicoNomeInput) updateInputFontSize(tecnicoNomeInput);

    if (viaturaResponsaveis[state.selectedViatura]) {
        const previous = cloneResponsaveisEquipe(viaturaResponsaveis[state.selectedViatura]);
        viaturaResponsaveis[state.selectedViatura].tecnico = tecnicoNome;
        viaturaResponsaveis[state.selectedViatura].tecnicoCpf = tecnicoCpf;
        refreshEquipeResponsavelUI();

        try {
            await salvarConfiguracoes();
            refreshEquipeResponsavelUI();
        } catch (error) {
            restoreResponsaveisEquipe(state.selectedViatura, previous);
            console.error("Erro ao salvar técnico na equipe responsável.", error);
            alert("Não foi possível salvar o técnico. Verifique sua conexão/permissão e tente novamente.");
        }
    }
}

async function salvarCpfTecnicoVistoriaAtual(cpf) {
    const cpfVal = String(cpf || "").trim();
    if (viaturaResponsaveis[state.selectedViatura]) {
        const previous = cloneResponsaveisEquipe(viaturaResponsaveis[state.selectedViatura]);
        viaturaResponsaveis[state.selectedViatura].tecnicoCpf = cpfVal;
        refreshEquipeResponsavelUI();

        try {
            await salvarConfiguracoes();
            refreshEquipeResponsavelUI();
        } catch (error) {
            restoreResponsaveisEquipe(state.selectedViatura, previous);
            console.error("Erro ao salvar CPF do técnico na equipe responsável.", error);
            alert("Não foi possível salvar o CPF do técnico. Verifique sua conexão/permissão e tente novamente.");
        }
    }
}

function selecionarAuxiliarVistoriaAtual(nome) {
    const auxiliar = findTecnicoByName(nome);
    const auxiliarNomeInput = document.getElementById("auxiliar-nome");
    const auxiliarCpfInput = document.getElementById("auxiliar-cpf");
    const auxiliarNome = auxiliar?.nome || nome.trim();
    const auxiliarCpf = auxiliar?.cpf || auxiliarCpfInput?.value || "";

    if (!confirmarResponsavelDuplicadoVistoria(auxiliarNome, auxiliarCpf)) {
        preencherResponsaveisViatura();
        return;
    }

    if (auxiliarNomeInput) auxiliarNomeInput.value = auxiliarNome;
    if (auxiliar && auxiliarCpfInput) auxiliarCpfInput.value = auxiliarCpf;
}

async function selecionarResponsavelPorPesquisa(nome) {
    const pessoa = findTecnicoByName(nome);
    const pesquisaInput = document.getElementById("responsavel-pesquisa");
    const pessoaNome = pessoa?.nome || nome.trim();
    const pessoaCpf = pessoa?.cpf || "";
    const isAuxiliar = normalizeSearch(pessoa?.funcao || "").includes("auxiliar");
    const campoNome = isAuxiliar ? "auxiliar" : "tecnico";
    const campoCpf = isAuxiliar ? "auxiliarCpf" : "tecnicoCpf";
    const nomeInput = document.getElementById(isAuxiliar ? "auxiliar-nome" : "tecnico-nome");
    const cpfInput = document.getElementById(isAuxiliar ? "auxiliar-cpf" : "tecnico-cpf");

    if (!confirmarResponsavelDuplicadoVistoria(pessoaNome, pessoaCpf)) {
        if (pesquisaInput) pesquisaInput.value = "";
        return;
    }

    if (nomeInput) nomeInput.value = pessoaNome;
    if (pessoa && cpfInput) cpfInput.value = pessoaCpf;
    if (viaturaResponsaveis[state.selectedViatura]) {
        const resp = ensureResponsaveisEquipe(state.selectedViatura);
        const previous = cloneResponsaveisEquipe(resp);
        let vinculoAnterior = null;
        let vinculoNovoAnterior = null;
        if (isAuxiliar) {
            const anterior = resp.auxiliares[0];
            vinculoAnterior = snapshotVinculoAuxiliarExtra(anterior?.nome, anterior?.cpf);
            vinculoNovoAnterior = snapshotVinculoAuxiliarExtra(pessoaNome, pessoaCpf);
            if (resp.auxiliares.length > 0) {
                resp.auxiliares[0] = { nome: pessoaNome, cpf: pessoaCpf };
            } else {
                resp.auxiliares.push({ nome: pessoaNome, cpf: pessoaCpf });
            }
            syncAuxiliarPrincipal(resp);
            limparVinculoAuxiliarExtra(anterior?.nome, anterior?.cpf, state.selectedViatura);
            atualizarVinculoAuxiliarExtra(pessoaNome, pessoaCpf, state.selectedViatura);
        }

        resp[campoNome] = pessoaNome;
        resp[campoCpf] = pessoaCpf;
        refreshEquipeResponsavelUI();

        try {
            await salvarConfiguracoes();
            refreshEquipeResponsavelUI();
        } catch (error) {
            restoreVinculoAuxiliarExtra(vinculoAnterior);
            restoreVinculoAuxiliarExtra(vinculoNovoAnterior);
            restoreResponsaveisEquipe(state.selectedViatura, previous);
            console.error("Erro ao salvar responsável pesquisado na equipe.", error);
            alert("Não foi possível salvar a equipe responsável. Verifique sua conexão/permissão e tente novamente.");
        }
    }
    if (pesquisaInput) pesquisaInput.value = "";
    refreshEquipeResponsavelUI();
}

function alterarStatusFuncionario(key, status) {
    if (getVistoriadorAtivo() !== "Alisson") {
        alert("Somente Alisson pode alterar o status do funcionário.");
        renderFuncionariosPage();
        return;
    }

    const overrides = getFuncionarioStatusOverrides();
    overrides[key] = status;
    localStorage.setItem("funcionarioStatusOverrides", JSON.stringify(overrides));
    renderFuncionariosPage();
}

function renderFuncionarioCard(funcionario) {
    const editKey = getFuncionarioEditKey(funcionario);
    const isEditingItems = funcionarioItensEditandoKey === editKey;
    const displayViaturaId = getFuncionarioDisplayViaturaId(funcionario);
    const deleteControl = getVistoriadorAtivo() === "Alisson"
        ? `<button type="button" class="employee-delete-btn" onclick="excluirFuncionario('${escapeJsString(editKey)}')">Excluir</button>`
        : "";
    const editControl = getVistoriadorAtivo() === "Alisson"
        ? `<button type="button" class="employee-edit-items-btn ${isEditingItems ? "editing" : ""}" onclick="abrirEditorItensFuncionario('${escapeJsString(editKey)}')">${isEditingItems ? "Concluir edição" : "Editar itens"}</button>`
        : "";
    const actionsHtml = deleteControl || editControl
        ? `<div class="employee-card-actions">${deleteControl}${editControl}</div>`
        : "";
    const episHtml = isEditingItems
        ? renderEditorItensFuncionarioInline(editKey)
        : funcionario.epis?.length
        ? `
            <div class="employee-epi-table-wrap">
                <table class="employee-epi-table">
                    <thead>
                        <tr>
                            <th>Qtd</th>
                            <th>Descrição do EPI</th>
                            <th>C.A.</th>
                            <th>Data de entrega</th>
                            <th>OBS</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${funcionario.epis.map(epi => `
                            <tr>
                                <td data-label="Qtd">${Number(epi.quantidade || 1)}</td>
                                <td data-label="Descrição">${escapeHtml(epi.nome)}</td>
                                <td data-label="C.A.">${escapeHtml(epi.ca || "-")}</td>
                                <td data-label="Entrega">${escapeHtml(epi.dataEntrega || "-")}</td>
                                <td data-label="OBS">${escapeHtml(epi.observacao || "")}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `
        : `<p class="employee-empty-epis">Nenhum EPI cadastrado para esta pessoa.</p>`;

    return `
        <article class="employee-card">
            <div class="employee-card-header">
                <div>
                    <h3>${escapeHtml(funcionario.nome)}</h3>
                    <p>${escapeHtml(funcionario.funcao)}${displayViaturaId ? ` - Viatura ${formatTwoDigits(displayViaturaId)}` : ""}</p>
                </div>
                ${actionsHtml}
            </div>
            <div class="employee-meta">
                <span>CPF: ${escapeHtml(funcionario.cpf || "-")}</span>
                <span>EPIs: ${funcionario.epis?.length || 0}</span>
            </div>
            ${episHtml}
        </article>
    `;
}

function getFuncionarioRoleOrder(funcao = "") {
    const normalized = normalizeSearch(funcao);
    if (normalized.includes("tecnico") && !normalized.includes("auxiliar")) return 0;
    if (normalized.includes("auxiliar")) return 1;
    return 2;
}

function findFuncionarioByEditKey(key) {
    return getFuncionariosData().find(funcionario => getFuncionarioEditKey(funcionario) === key) || null;
}

function getFuncionarioExtraByEditKey(key) {
    return funcionariosExtras.find(funcionario => getFuncionarioEditKey(funcionario) === key) || null;
}

function getFuncionarioVinculoViatura(key) {
    for (const [viaturaId, responsaveis] of Object.entries(viaturaResponsaveis)) {
        if (responsaveis.tecnico && getFuncionarioKeyFromFields(responsaveis.tecnico, responsaveis.tecnicoCpf) === key) {
            return { viaturaId, campoNome: "tecnico", campoCpf: "tecnicoCpf", funcao: "Técnico" };
        }

        if (responsaveis.auxiliar && getFuncionarioKeyFromFields(responsaveis.auxiliar, responsaveis.auxiliarCpf) === key) {
            return { viaturaId, campoNome: "auxiliar", campoCpf: "auxiliarCpf", funcao: "Auxiliar técnico" };
        }
    }

    return null;
}

function getFuncionarioResponsavelFields(funcionario) {
    const isAuxiliar = normalizeSearch(funcionario?.funcao || "").includes("auxiliar");
    return {
        campoNome: isAuxiliar ? "auxiliar" : "tecnico",
        campoCpf: isAuxiliar ? "auxiliarCpf" : "tecnicoCpf",
        funcao: isAuxiliar ? "Auxiliar técnico" : "Técnico"
    };
}

function removerVinculosFuncionario(keys) {
    const keySet = new Set(keys.filter(Boolean));
    if (!keySet.size) return;

    Object.values(viaturaResponsaveis).forEach(responsaveis => {
        if (responsaveis.tecnico && keySet.has(getFuncionarioKeyFromFields(responsaveis.tecnico, responsaveis.tecnicoCpf))) {
            responsaveis.tecnico = "";
            responsaveis.tecnicoCpf = "";
        }

        if (responsaveis.auxiliar && keySet.has(getFuncionarioKeyFromFields(responsaveis.auxiliar, responsaveis.auxiliarCpf))) {
            responsaveis.auxiliar = "";
            responsaveis.auxiliarCpf = "";
        }
    });
}

function sincronizarFuncionarioExtraComViatura(funcionario, oldKey = "") {
    const currentKey = getFuncionarioEditKey(funcionario);
    const viaturaId = String(funcionario.viaturaId || "").trim();
    const fields = getFuncionarioResponsavelFields(funcionario);

    if (!viaturaId || !getActiveViaturas().some(viatura => String(viatura.id) === viaturaId)) {
        funcionario.viaturaId = "";
        removerVinculosFuncionario([oldKey, currentKey]);
        return true;
    }

    if (!viaturaResponsaveis[viaturaId]) {
        viaturaResponsaveis[viaturaId] = { tecnico: "", tecnicoCpf: "", auxiliar: "", auxiliarCpf: "" };
    }

    const destino = viaturaResponsaveis[viaturaId];
    const destinoNome = destino[fields.campoNome];
    const destinoKey = getFuncionarioKeyFromFields(destinoNome, destino[fields.campoCpf]);
    const mesmoFuncionario = destinoKey === oldKey || destinoKey === currentKey;

    if (destinoNome && destinoNome !== "Veículo sem Técnico" && !mesmoFuncionario) {
        const confirmar = confirm(`A ${formatTwoDigits(viaturaId)} já possui ${fields.funcao.toLowerCase()}: ${destinoNome}. Deseja substituir?`);
        if (!confirmar) return false;
    }

    removerVinculosFuncionario([oldKey, currentKey]);
    destino[fields.campoNome] = funcionario.nome;
    destino[fields.campoCpf] = funcionario.cpf;
    funcionario.viaturaId = viaturaId;
    return true;
}

function moveFuncionarioStoredData(oldKey, newKey) {
    if (!oldKey || oldKey === newKey) return;

    if (employeeEpisByPerson[oldKey]) {
        employeeEpisByPerson[newKey] = employeeEpisByPerson[oldKey];
        delete employeeEpisByPerson[oldKey];
    }

    const overrides = getFuncionarioStatusOverrides();
    if (overrides[oldKey]) {
        overrides[newKey] = overrides[oldKey];
        delete overrides[oldKey];
        localStorage.setItem("funcionarioStatusOverrides", JSON.stringify(overrides));
    }
}

async function editarDadosFuncionario(key, campo, valor) {
    if (getVistoriadorAtivo() !== "Alisson") return;

    const funcionario = findFuncionarioByEditKey(key);
    if (!funcionario || !["nome", "cpf", "viaturaId"].includes(campo)) return;

    const extra = getFuncionarioExtraByEditKey(key);
    const vinculo = getFuncionarioVinculoViatura(key);
    const newValue = String(valor || "").trim();
    const oldKey = key;
    const previousExtra = extra
        ? { nome: extra.nome, cpf: extra.cpf, viaturaId: extra.viaturaId }
        : null;
    let nextNome = funcionario.nome;
    let nextCpf = funcionario.cpf;

    if (campo === "nome" && !newValue) {
        alert("Informe o nome do funcionário.");
        renderFuncionariosPage();
        return;
    }

    if (extra) {
        extra[campo] = newValue;
        nextNome = extra.nome;
        nextCpf = extra.cpf;
        if (!sincronizarFuncionarioExtraComViatura(extra, oldKey)) {
            Object.assign(extra, previousExtra);
            renderFuncionariosPage();
            return;
        }
        if (campo === "viaturaId" && extra.viaturaId) {
            setSelectedViatura(extra.viaturaId);
        }
    } else if (vinculo) {
        const responsaveisAtuais = viaturaResponsaveis[vinculo.viaturaId];

        if (campo === "nome") {
            responsaveisAtuais[vinculo.campoNome] = newValue;
            nextNome = newValue;
        } else if (campo === "cpf") {
            responsaveisAtuais[vinculo.campoCpf] = newValue;
            nextCpf = newValue;
        } else if (campo === "viaturaId" && !newValue) {
            responsaveisAtuais[vinculo.campoNome] = "";
            responsaveisAtuais[vinculo.campoCpf] = "";
        } else if (campo === "viaturaId" && newValue && newValue !== vinculo.viaturaId) {
            const destino = viaturaResponsaveis[newValue];
            if (!destino) {
                alert("Viatura não encontrada.");
                renderFuncionariosPage();
                return;
            }

            const destinoOcupado = destino[vinculo.campoNome];
            if (destinoOcupado && destinoOcupado !== "Veículo sem Técnico") {
                const confirmar = confirm(`A ${formatTwoDigits(newValue)} já possui ${vinculo.funcao.toLowerCase()}: ${destinoOcupado}. Deseja substituir?`);
                if (!confirmar) {
                    renderFuncionariosPage();
                    return;
                }
            }

            destino[vinculo.campoNome] = responsaveisAtuais[vinculo.campoNome];
            destino[vinculo.campoCpf] = responsaveisAtuais[vinculo.campoCpf];
            nextNome = destino[vinculo.campoNome];
            nextCpf = destino[vinculo.campoCpf];
            responsaveisAtuais[vinculo.campoNome] = "";
            responsaveisAtuais[vinculo.campoCpf] = "";
        }
    }

    const newKey = getFuncionarioKeyFromFields(nextNome, nextCpf);
    moveFuncionarioStoredData(oldKey, newKey);
    funcionarioItensEditandoKey = newKey;
    renderTecnicoDatalist();
    preencherResponsaveisViatura();
    renderAdminVistoriadores();
    renderViaturaDashboard();
    updateMenuStatus();
    renderFuncionariosPage();

    try {
        await salvarConfiguracoes();
    } catch (error) {
        console.warn("Não foi possível salvar o vínculo do funcionário no Firebase.", error);
        alert("O vínculo foi atualizado nesta tela, mas não consegui salvar no Firebase. Verifique sua conexão e tente novamente.");
    }
}

async function excluirFuncionario(key) {
    if (getVistoriadorAtivo() !== "Alisson") {
        alert("Somente Alisson pode excluir funcionários.");
        return;
    }

    const funcionario = findFuncionarioByEditKey(key);
    if (!funcionario) {
        alert("Funcionário não encontrado.");
        return;
    }

    if (!confirm(`Deseja realmente excluir ${funcionario.nome}?`)) return;

    const extraIndex = funcionariosExtras.findIndex(item => getFuncionarioEditKey(item) === key);
    if (extraIndex >= 0) {
        funcionariosExtras.splice(extraIndex, 1);
    } else {
        Object.values(viaturaResponsaveis).forEach(responsaveis => {
            if (responsaveis.tecnico && getFuncionarioKeyFromFields(responsaveis.tecnico, responsaveis.tecnicoCpf) === key) {
                responsaveis.tecnico = "";
                responsaveis.tecnicoCpf = "";
            }

            if (responsaveis.auxiliar && getFuncionarioKeyFromFields(responsaveis.auxiliar, responsaveis.auxiliarCpf) === key) {
                responsaveis.auxiliar = "";
                responsaveis.auxiliarCpf = "";
            }
        });
    }

    delete employeeEpisByPerson[key];
    if (funcionarioItensEditandoKey === key) funcionarioItensEditandoKey = "";
    await salvarConfiguracoes();
    renderTecnicoDatalist();
    preencherResponsaveisViatura();
    renderFuncionariosPage();
}

function getEditableFuncionarioEpis(key) {
    const funcionario = findFuncionarioByEditKey(key);
    if (!funcionario) return [];

    if (!employeeEpisByPerson[key]) {
        employeeEpisByPerson[key] = (funcionario.epis || []).map((epi, index) => normalizeEmployeeEpiItem(epi, index));
    }

    return employeeEpisByPerson[key];
}

function syncFuncionarioExtraFromEditableEpis(key) {
    const funcionarioExtra = getFuncionarioExtraByEditKey(key);
    if (!funcionarioExtra) return;
    funcionarioExtra.epis = (employeeEpisByPerson[key] || []).map((epi, index) => normalizeEmployeeEpiItem(epi, index));
}

function renderEditorItensFuncionario(key) {
    const funcionario = findFuncionarioByEditKey(key);
    const modal = document.getElementById("employee-items-modal");
    const title = document.getElementById("employee-items-title");
    const body = document.getElementById("employee-items-body");
    if (!modal || !title || !body || !funcionario) return;

    const items = getEditableFuncionarioEpis(key);
    title.textContent = `Editar itens - ${funcionario.nome}`;
    body.innerHTML = `
        <div class="employee-items-add-form">
            <input type="number" min="1" step="1" id="employee-item-new-qtd" value="1" aria-label="Quantidade">
            <input type="text" id="employee-item-new-nome" placeholder="Descrição do item" autocomplete="new-password">
            <input type="text" id="employee-item-new-ca" placeholder="C.A." autocomplete="new-password">
            <input type="text" id="employee-item-new-entrega" placeholder="Data de entrega" autocomplete="new-password">
            <input type="text" id="employee-item-new-obs" placeholder="OBS" autocomplete="new-password">
            <button type="button" onclick="adicionarItemFuncionarioEditado('${escapeJsString(key)}')">Adicionar</button>
        </div>
        <div class="employee-items-editor-list">
            ${items.length ? items.map((epi, index) => `
                <div class="employee-items-editor-row">
                    <input type="number" min="1" step="1" value="${Number(epi.quantidade || 1)}" placeholder="Qtd" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'quantidade', this.value)" aria-label="Quantidade">
                    <input type="text" value="${escapeHtml(epi.nome || "")}" placeholder="Descrição do item" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'nome', this.value)" aria-label="Descrição do item">
                    <input type="text" value="${escapeHtml(epi.ca || "")}" placeholder="C.A." onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'ca', this.value)" aria-label="C.A.">
                    <input type="text" value="${escapeHtml(epi.dataEntrega || "")}" placeholder="Data de entrega" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'dataEntrega', this.value)" aria-label="Data de entrega">
                    <input type="text" value="${escapeHtml(epi.observacao || "")}" placeholder="OBS" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'observacao', this.value)" aria-label="Observação">
                    <button type="button" class="employee-item-remove-btn" onclick="removerItemFuncionarioEditado('${escapeJsString(key)}', ${index})">Remover</button>
                </div>
            `).join("") : `<p class="employee-empty-epis">Nenhum item cadastrado para esta pessoa.</p>`}
        </div>
    `;
}

function abrirEditorItensFuncionario(key) {
    if (getVistoriadorAtivo() !== "Alisson") {
        alert("Somente Alisson pode editar os itens dos funcionários.");
        return;
    }

    const funcionario = findFuncionarioByEditKey(key);
    if (!funcionario) {
        alert("Funcionário não encontrado.");
        return;
    }

    funcionarioItensEditandoKey = funcionarioItensEditandoKey === key ? "" : key;
    renderFuncionariosPage();
}

function fecharEditorItensFuncionario() {
    funcionarioItensEditandoKey = "";
    const modal = document.getElementById("employee-items-modal");
    if (modal) {
        modal.style.display = "none";
        modal.dataset.funcionarioKey = "";
    }
    renderFuncionariosPage();
}

function renderEditorItensFuncionarioInline(key) {
    const funcionario = findFuncionarioByEditKey(key);
    const items = getEditableFuncionarioEpis(key);
    const displayViaturaId = getFuncionarioDisplayViaturaId(funcionario);
    const viaturasOptions = getActiveViaturas().map(viatura => `
        <option value="${escapeHtml(viatura.id)}" ${displayViaturaId === String(viatura.id) ? "selected" : ""}>${escapeHtml(viatura.nome || `Viatura ${formatTwoDigits(viatura.id)}`)}</option>
    `).join("");

    return `
        <div class="employee-inline-editor">
            <div class="employee-inline-person-form">
                <label>
                    <span>Nome</span>
                    <input type="text" value="${escapeHtml(funcionario?.nome || "")}" onchange="editarDadosFuncionario('${escapeJsString(key)}', 'nome', this.value)" autocomplete="new-password">
                </label>
                <label>
                    <span>CPF</span>
                    <input type="text" value="${escapeHtml(funcionario?.cpf || "")}" onchange="editarDadosFuncionario('${escapeJsString(key)}', 'cpf', this.value)" autocomplete="new-password">
                </label>
                <label>
                    <span>Viatura</span>
                    <select onchange="editarDadosFuncionario('${escapeJsString(key)}', 'viaturaId', this.value)">
                        <option value="">Sem viatura</option>
                        ${viaturasOptions}
                    </select>
                </label>
            </div>
            <div class="employee-items-add-form employee-inline-add-form">
                <input type="number" min="1" step="1" id="employee-item-new-qtd" value="1" aria-label="Quantidade">
                <input type="text" id="employee-item-new-nome" placeholder="Descrição do item" autocomplete="new-password">
                <input type="text" id="employee-item-new-ca" placeholder="C.A." autocomplete="new-password">
                <input type="text" id="employee-item-new-entrega" placeholder="Data de entrega" autocomplete="new-password">
                <input type="text" id="employee-item-new-obs" placeholder="OBS" autocomplete="new-password">
                <button type="button" onclick="adicionarItemFuncionarioEditado('${escapeJsString(key)}')">Adicionar</button>
            </div>
            <div class="employee-items-editor-list">
                ${items.length ? items.map((epi, index) => `
                    <div class="employee-items-editor-row employee-inline-editor-row">
                        <input type="number" min="1" step="1" value="${Number(epi.quantidade || 1)}" placeholder="Qtd" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'quantidade', this.value)" aria-label="Quantidade">
                        <input type="text" value="${escapeHtml(epi.nome || "")}" placeholder="Descrição do item" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'nome', this.value)" aria-label="Descrição do item">
                        <input type="text" value="${escapeHtml(epi.ca || "")}" placeholder="C.A." onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'ca', this.value)" aria-label="C.A.">
                        <input type="text" value="${escapeHtml(epi.dataEntrega || "")}" placeholder="Data de entrega" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'dataEntrega', this.value)" aria-label="Data de entrega">
                        <input type="text" value="${escapeHtml(epi.observacao || "")}" placeholder="OBS" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'observacao', this.value)" aria-label="Observação">
                        <button type="button" class="employee-item-remove-btn" onclick="removerItemFuncionarioEditado('${escapeJsString(key)}', ${index})">Remover</button>
                    </div>
                `).join("") : `<p class="employee-empty-epis">Nenhum item cadastrado para esta pessoa.</p>`}
            </div>
        </div>
    `;
}

async function persistirItensFuncionarioEditado(key, shouldRenderEditor = false) {
    const items = employeeEpisByPerson[key] || [];
    employeeEpisByPerson[key] = items.map((epi, index) => normalizeEmployeeEpiItem(epi, index)).filter(epi => epi.nome);
    syncFuncionarioExtraFromEditableEpis(key);
    await salvarConfiguracoes();
    if (shouldRenderEditor) {
        if (funcionarioItensEditandoKey === key) renderFuncionariosPage();
        else renderEditorItensFuncionario(key);
    }
}

async function adicionarItemFuncionarioEditado(key) {
    if (getVistoriadorAtivo() !== "Alisson") return;
    const items = getEditableFuncionarioEpis(key);
    const quantidade = Number(document.getElementById("employee-item-new-qtd")?.value || 1);
    const nome = document.getElementById("employee-item-new-nome")?.value.trim() || "";
    const ca = document.getElementById("employee-item-new-ca")?.value.trim() || "";
    const dataEntrega = document.getElementById("employee-item-new-entrega")?.value.trim() || "";
    const observacao = document.getElementById("employee-item-new-obs")?.value.trim() || "";

    if (!nome) {
        alert("Informe a descrição do item.");
        return;
    }

    items.push(normalizeEmployeeEpiItem({
        id: `epi-funcionario-${Date.now()}`,
        nome,
        quantidade,
        ca,
        dataEntrega,
        observacao,
        ativo: true,
        valor: 0,
        substituicoes: []
    }, items.length));

    await persistirItensFuncionarioEditado(key, true);
}

async function editarItemFuncionarioEditado(key, index, campo, valor) {
    if (getVistoriadorAtivo() !== "Alisson") return;
    const items = getEditableFuncionarioEpis(key);
    const item = items[Number(index)];
    if (!item || !["quantidade", "nome", "ca", "dataEntrega", "observacao"].includes(campo)) return;

    item[campo] = campo === "quantidade" ? Number(valor || 1) : String(valor || "").trim();
    items[Number(index)] = normalizeEmployeeEpiItem(item, Number(index));
    await persistirItensFuncionarioEditado(key);
}

async function removerItemFuncionarioEditado(key, index) {
    if (getVistoriadorAtivo() !== "Alisson") return;
    const items = getEditableFuncionarioEpis(key);
    if (!items[Number(index)]) return;
    if (!confirm("Deseja remover este item do funcionário?")) return;

    items.splice(Number(index), 1);
    await persistirItensFuncionarioEditado(key, true);
}

function renderFuncionariosPage() {
    const list = document.getElementById("funcionarios-list");
    const totalLabel = document.getElementById("funcionarios-total");
    const search = document.getElementById("funcionario-search")?.value || "";
    if (!list) return;

    const funcionariosData = getFuncionariosData();
    const termo = normalizeSearch(search);
    const filtrados = funcionariosData.filter(funcionario => {
        const matchesSearch = !termo
            || normalizeSearch(funcionario.nome).includes(termo)
            || normalizeSearch(funcionario.cpf).includes(termo)
            || normalizeSearch(funcionario.funcao).includes(termo);
        return matchesSearch;
    }).sort((a, b) => {
        const viaturaA = Number(a.viaturaId || Number.MAX_SAFE_INTEGER);
        const viaturaB = Number(b.viaturaId || Number.MAX_SAFE_INTEGER);
        if (viaturaA !== viaturaB) return viaturaA - viaturaB;

        const roleOrder = getFuncionarioRoleOrder(a.funcao) - getFuncionarioRoleOrder(b.funcao);
        if (roleOrder !== 0) return roleOrder;

        return String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR");
    });

    if (totalLabel) {
        totalLabel.textContent = filtrados.length === funcionariosData.length
            ? String(funcionariosData.length)
            : `${filtrados.length}/${funcionariosData.length}`;
    }

    list.innerHTML = filtrados.length
        ? filtrados.map(renderFuncionarioCard).join("")
        : `<p class="placeholder">Nenhum funcionário encontrado.</p>`;
}

function abrirPaginaHistoricoVistorias() {
    const vistoriador = getVistoriadorAtivo();
    if (vistoriador !== "Alisson") {
        alert("Somente Alisson tem permissão para acessar o histórico de alterações.");
        return;
    }

    showPage("admin");
    showAdminConfigTab("historico");
}

function preencherResponsaveisViatura() {
    const responsaveis = ensureResponsaveisEquipe(state.selectedViatura);
    const tecnicoNomeInput = document.getElementById("tecnico-nome");
    const tecnicoCpfInput = document.getElementById("tecnico-cpf");
    const auxiliarNomeInput = document.getElementById("auxiliar-nome");
    const auxiliarCpfInput = document.getElementById("auxiliar-cpf");

    if (tecnicoNomeInput) {
        tecnicoNomeInput.value = responsaveis?.tecnico || "";
        updateInputFontSize(tecnicoNomeInput);
    }
    if (tecnicoCpfInput) tecnicoCpfInput.value = responsaveis?.tecnicoCpf || "";
    if (auxiliarNomeInput) auxiliarNomeInput.value = responsaveis?.auxiliar || "";
    if (auxiliarCpfInput) auxiliarCpfInput.value = responsaveis?.auxiliarCpf || "";
    
    renderAuxiliaresList();
    renderEpiPessoaOptions();
    renderTeamList();
}

function updateInputFontSize(input) {
    if (!input) return;
    const val = input.value || "";
    // Ajusta a fonte se o nome ultrapassar 25 caracteres para manter visibilidade
    if (val.length > 25) {
        const factor = Math.max(0.48, 0.65 - (val.length - 25) * 0.01); 
        input.style.fontSize = `${factor}rem`;
    } else {
        input.style.fontSize = "";
    }
}

function renderAuxiliaresList() {
    const container = document.getElementById("lista-auxiliares-selecionados");
    if (!container) return;

    const viaturaId = state.selectedViatura;
    const responsaveis = ensureResponsaveisEquipe(viaturaId);
    const auxiliares = responsaveis.auxiliares;

    if (auxiliares.length === 0) {
        container.innerHTML = '<p class="placeholder" style="grid-column: 1/-1;">Nenhum auxiliar adicionado.</p>';
        return;
    }

    container.innerHTML = auxiliares.map((aux, index) => {
        const nameStyle = (aux.nome || "").length > 28 ? 'style="font-size: 0.68rem;"' : '';
        return `
        <div class="assistant-card">
            <div class="assistant-card-info">
                <span class="assistant-card-name" ${nameStyle}>${escapeHtml(aux.nome)}</span>
                <span class="assistant-card-cpf">CPF: ${escapeHtml(aux.cpf || "Não informado")}</span>
            </div>
            <button type="button" class="btn-remove-assistant" onclick="removerAuxiliarExtra(${index})" title="Remover auxiliar">
                <span class="remove-icon">×</span>
            </button>
        </div>
    `; }).join("");
}

function cloneResponsaveisEquipe(responsaveis = {}) {
    return {
        ...responsaveis,
        tecnicos: Array.isArray(responsaveis.tecnicos)
            ? responsaveis.tecnicos.map(tecnico => ({ ...tecnico }))
            : [],
        auxiliares: Array.isArray(responsaveis.auxiliares)
            ? responsaveis.auxiliares.map(auxiliar => ({ ...auxiliar }))
            : []
    };
}

function ensureResponsaveisEquipe(viaturaId) {
    const id = String(viaturaId || state.selectedViatura || "");
    if (!id) return { tecnico: "", tecnicoCpf: "", auxiliar: "", auxiliarCpf: "", tecnicos: [], auxiliares: [] };

    if (!viaturaResponsaveis[id]) {
        viaturaResponsaveis[id] = { tecnico: "", tecnicoCpf: "", auxiliar: "", auxiliarCpf: "", tecnicos: [], auxiliares: [] };
    }

    const responsaveis = viaturaResponsaveis[id];
    if (!Array.isArray(responsaveis.tecnicos)) {
        responsaveis.tecnicos = responsaveis.tecnico
            ? [{ nome: responsaveis.tecnico, cpf: responsaveis.tecnicoCpf || "" }]
            : [];
    }

    responsaveis.tecnicos = responsaveis.tecnicos
        .filter(tecnico => tecnico?.nome)
        .map(tecnico => ({
            nome: String(tecnico.nome || "").trim(),
            cpf: String(tecnico.cpf || "").trim()
        }));

    const hasExplicitAuxiliar = Object.prototype.hasOwnProperty.call(responsaveis, "auxiliar");
    if (hasExplicitAuxiliar && !String(responsaveis.auxiliar || "").trim()) {
        responsaveis.auxiliar = "";
        responsaveis.auxiliarCpf = "";
        responsaveis.auxiliares = [];
        return responsaveis;
    }

    if (!Array.isArray(responsaveis.auxiliares)) {
        responsaveis.auxiliares = responsaveis.auxiliar
            ? [{ nome: responsaveis.auxiliar, cpf: responsaveis.auxiliarCpf || "" }]
            : [];
    }

    responsaveis.auxiliares = responsaveis.auxiliares
        .filter(auxiliar => auxiliar?.nome)
        .map(auxiliar => ({
            nome: String(auxiliar.nome || "").trim(),
            cpf: String(auxiliar.cpf || "").trim()
        }));

    syncAuxiliarPrincipal(responsaveis);
    return responsaveis;
}

function syncAuxiliarPrincipal(responsaveis) {
    const first = Array.isArray(responsaveis.auxiliares) ? responsaveis.auxiliares[0] : null;
    responsaveis.auxiliar = first?.nome || "";
    responsaveis.auxiliarCpf = first?.cpf || "";
}

function getFuncionarioExtraByPessoa(nome, cpf) {
    const key = getFuncionarioKeyFromFields(nome, cpf);
    return funcionariosExtras.find(funcionario =>
        getFuncionarioKeyFromFields(funcionario.nome, funcionario.cpf) === key
    ) || null;
}

function isFuncionarioAuxiliar(funcionario) {
    return normalizeSearch(funcionario?.funcao || "").includes("auxiliar");
}

function atualizarVinculoAuxiliarExtra(nome, cpf, viaturaId) {
    const funcionario = getFuncionarioExtraByPessoa(nome, cpf);
    if (!funcionario || !isFuncionarioAuxiliar(funcionario)) return;
    funcionario.viaturaId = String(viaturaId || "");
}

function limparVinculoAuxiliarExtra(nome, cpf, viaturaId) {
    const funcionario = getFuncionarioExtraByPessoa(nome, cpf);
    if (!funcionario || !isFuncionarioAuxiliar(funcionario)) return;
    if (String(funcionario.viaturaId || "") === String(viaturaId || "")) {
        funcionario.viaturaId = "";
    }
}

function snapshotVinculoAuxiliarExtra(nome, cpf) {
    const funcionario = getFuncionarioExtraByPessoa(nome, cpf);
    if (!funcionario || !isFuncionarioAuxiliar(funcionario)) return null;
    return { funcionario, viaturaId: funcionario.viaturaId || "" };
}

function restoreVinculoAuxiliarExtra(snapshot) {
    if (!snapshot?.funcionario) return;
    snapshot.funcionario.viaturaId = snapshot.viaturaId || "";
}

function restoreResponsaveisEquipe(viaturaId, responsaveis) {
    viaturaResponsaveis[viaturaId] = cloneResponsaveisEquipe(responsaveis);
    refreshEquipeResponsavelUI();
}

function refreshEquipeResponsavelUI() {
    renderAuxiliaresList();
    renderEpiPessoaOptions();
    preencherResponsaveisViatura();
    renderViaturaDashboard();
    updateMenuStatus();
}

async function adicionarAuxiliarExtra(nomeSelecionado = "") {
    const viaturaId = state.selectedViatura;
    const responsaveis = ensureResponsaveisEquipe(viaturaId);
    const previous = cloneResponsaveisEquipe(responsaveis);
    let vinculoAnterior = null;

    try {
        const input = document.getElementById("responsavel-pesquisa");
        const nome = String(nomeSelecionado || input?.value || "").trim();
        if (!nome) {
            alert("Selecione um nome na lista para adicionar um auxiliar.");
            return;
        }

        const pessoa = findTecnicoByName(nome);
        const pessoaNome = pessoa?.nome || nome;
        const pessoaCpf = pessoa?.cpf || "";

        const pessoaKey = getFuncionarioKeyFromFields(pessoaNome, pessoaCpf);
        const jaExiste = responsaveis.auxiliares.some(auxiliar =>
            getFuncionarioKeyFromFields(auxiliar.nome, auxiliar.cpf) === pessoaKey
        );
        if (jaExiste) {
            alert(`O auxiliar "${pessoaNome}" já está na lista.`);
            input.value = "";
            return;
        }

        if (!confirmarResponsavelDuplicadoVistoria(pessoaNome, pessoaCpf)) {
            input.value = "";
            return;
        }

        vinculoAnterior = snapshotVinculoAuxiliarExtra(pessoaNome, pessoaCpf);
        responsaveis.auxiliares.push({ nome: pessoaNome, cpf: pessoaCpf });
        syncAuxiliarPrincipal(responsaveis);
        atualizarVinculoAuxiliarExtra(pessoaNome, pessoaCpf, viaturaId);

        input.value = "";
        refreshEquipeResponsavelUI();

        await salvarConfiguracoes();
        refreshEquipeResponsavelUI();
    } catch (error) {
        restoreVinculoAuxiliarExtra(vinculoAnterior);
        restoreResponsaveisEquipe(viaturaId, previous);
        console.error("Erro ao salvar auxiliar na equipe responsável.", error);
        alert("Não foi possível adicionar o auxiliar. Verifique sua conexão/permissão e tente novamente.");
    }
}

async function removerAuxiliarExtra(index) {
    const viaturaId = state.selectedViatura;
    const responsaveis = ensureResponsaveisEquipe(viaturaId);
    const previous = cloneResponsaveisEquipe(responsaveis);
    let vinculoAnterior = null;

    try {
        const itemIndex = Number(index);
        if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= responsaveis.auxiliares.length) return;

        const [removido] = responsaveis.auxiliares.splice(itemIndex, 1);
        vinculoAnterior = snapshotVinculoAuxiliarExtra(removido?.nome, removido?.cpf);
        syncAuxiliarPrincipal(responsaveis);
        limparVinculoAuxiliarExtra(removido?.nome, removido?.cpf, viaturaId);
        refreshEquipeResponsavelUI();

        await salvarConfiguracoes();
        refreshEquipeResponsavelUI();
    } catch (error) {
        restoreVinculoAuxiliarExtra(vinculoAnterior);
        restoreResponsaveisEquipe(viaturaId, previous);
        console.error("Erro ao remover auxiliar da equipe responsável.", error);
        alert("Não foi possível remover o auxiliar. Verifique sua conexão/permissão e tente novamente.");
    }
}

function getSelectedEpiPessoaKey() {
    return document.getElementById("epi-pessoa")?.value || "";
}

function getEpiSurveyMap(viaturaId = state.selectedViatura) {
    const id = String(viaturaId);
    if (!state.epiSurveyStatus[id]) state.epiSurveyStatus[id] = {};
    return state.epiSurveyStatus[id];
}

function getEpiPessoasObrigatorias(viaturaId = state.selectedViatura) {
    return getEpiPessoaOptions(viaturaId);
}

function todosEpisObrigatoriosVistoriados(viaturaId = state.selectedViatura) {
    const pessoas = getEpiPessoasObrigatorias(viaturaId);
    const vistoriadas = getEpiSurveyMap(viaturaId);
    return pessoas.length === 0 || pessoas.every(pessoa => vistoriadas[pessoa.key]);
}

function getEpiPessoasPendentes(viaturaId = state.selectedViatura) {
    const vistoriadas = getEpiSurveyMap(viaturaId);
    return getEpiPessoasObrigatorias(viaturaId).filter(pessoa => !vistoriadas[pessoa.key]);
}

function scrollParaBotaoGerarPdf(category) {
    const button = document.getElementById(`btn-pdf-${category}`);
    const generalButton = document.getElementById("btn-encerrar-geral");
    const target = button && button.offsetParent !== null
        ? button
        : generalButton && generalButton.offsetParent !== null
            ? generalButton
            : null;

    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderEpiPessoaButtons() {
    const container = document.getElementById("epi-pessoa-buttons");
    if (!container) return;

    const pessoas = getEpiPessoaOptions(state.selectedViatura);
    const vistoriadas = getEpiSurveyMap(state.selectedViatura);
    const selectedKey = getSelectedEpiPessoaKey();

    container.innerHTML = pessoas.length
        ? pessoas.map(pessoa => {
            const isDone = !!vistoriadas[pessoa.key];
            const statusText = isDone ? "✓" : "⚠ PENDENTE";
            return `
                <button type="button" class="epi-person-button ${pessoa.key === selectedKey ? "active" : ""} ${isDone ? "done" : "pending"}" data-epi-key="${escapeHtml(pessoa.key)}">
                    <span class="epi-btn-role-name">${escapeHtml(pessoa.tipo)} - ${escapeHtml(pessoa.nome)}</span>
                    <span class="epi-btn-status-label">${statusText}</span>
                </button>
            `;
        }).join("")
        : `<span class="placeholder">Nenhum técnico ou auxiliar cadastrado.</span>`;

    container.querySelectorAll(".epi-person-button").forEach(button => {
        button.addEventListener("click", () => {
            const select = document.getElementById("epi-pessoa");
            if (select) select.value = button.dataset.epiKey || "";
            selecionarPessoaEpi();
        });
    });
}

function renderEpiPessoaOptions() {
    const select = document.getElementById("epi-pessoa");
    if (!select) return;

    const valorAtual = select.value;
    const pessoas = getEpiPessoaOptions(state.selectedViatura);
    select.innerHTML = pessoas.length
        ? pessoas.map(pessoa => `
            <option value="${escapeHtml(pessoa.key)}">${escapeHtml(pessoa.tipo)}</option>
        `).join("")
        : `<option value="">Nenhum técnico ou auxiliar cadastrado</option>`;
    select.value = pessoas.some(pessoa => pessoa.key === valorAtual) ? valorAtual : (pessoas[0]?.key || "");
    renderEpiPessoaButtons();
}

function selecionarPessoaEpi() {
    renderEpiPessoaButtons();
    renderItems("epis");
}

function sincronizarItemAdicionadoChecklist({ category, viaturaId, pessoaKey = "" } = {}) {
    if (!category || !viaturaId) return;

    setSelectedViatura(viaturaId);
    renderViaturaDashboard();

    if (category === "epis" && pessoaKey) {
        renderEpiPessoaOptions();
        const pessoaSelect = document.getElementById("epi-pessoa");
        if (pessoaSelect && [...pessoaSelect.options].some(option => option.value === pessoaKey)) {
            pessoaSelect.value = pessoaKey;
            renderEpiPessoaButtons();
        }
    }

    const activePage = document.querySelector(".tab-content.active");
    if (activePage?.id === category) {
        renderItems(category);
    }
}

function renderItems(pageId) {
    const containerMapping = {
        ferramentas: "lista-ferramentas",
        epis: "lista-epis",
        viaturas: "lista-viaturas",
        tablets: "lista-tablets",
        notebooks: "lista-notebooks"
    };
    const container = document.getElementById(containerMapping[pageId]);
    if (pageId === "epis") renderEpiPessoaOptions();
    const items = getChecklistItemsForPessoa(pageId, state.selectedViatura, getSelectedEpiPessoaKey()).filter(item => item.ativo !== false);
    if (!container || !items) return;

    container.innerHTML = items.map((item, index) => {
        const itemName = getItemName(item);
        const defaults = resolveChecklistItemData(pageId, item, state.selectedViatura, index);
        const quantidade = Number(defaults.quantidade || 1);
        const valor = Number(defaults.valor || 0);
        const total = quantidade * valor;
        const epiExtraFields = pageId === "epis" ? `
                <label>
                    <span>C.A.</span>
                    <input type="text" id="ca-${pageId}-${index}" value="${escapeHtml(defaults.ca || "")}" placeholder="Certificado de aprovação">
                </label>
                <label>
                    <span>Data de entrega</span>
                    <input type="text" id="entrega-${pageId}-${index}" value="${escapeHtml(defaults.dataEntrega || "")}" placeholder="dd/mm/aaaa">
                </label>
        ` : "";
        const ultimaSubstituicao = item.substituicoes?.at?.(-1);
        const descricaoSubstituicao = ultimaSubstituicao
            ? `${ultimaSubstituicao.itemAnterior} foi substituído por ${ultimaSubstituicao.itemNovo || itemName}.`
            : "";

        return `
        <div class="checklist-item" id="row-${pageId}-${index}">
            <div class="checklist-item-header">
                <label class="item-label">${escapeHtml(itemName)}<span class="error-msg">⚠️ Seleção obrigatória</span></label>
                <div class="item-quantity-field">
                    <label for="qtd-${pageId}-${index}">QTD</label>
                    <input type="number" id="qtd-${pageId}-${index}" min="0" step="1" value="${quantidade}" oninput="atualizarTotalItem('${pageId}', ${index})" onkeydown="salvarItemComEnter(event, '${pageId}')">
                </div>
                <div class="item-value-field">
                    <label for="valor-${pageId}-${index}">Valor</label>
                    <input type="number" id="valor-${pageId}-${index}" min="0" step="0.01" value="${valor.toFixed(2)}" oninput="atualizarTotalItem('${pageId}', ${index})">
                </div>
                <div class="item-total-field">
                    <label for="total-${pageId}-${index}">Total</label>
                    <input type="text" id="total-${pageId}-${index}" value="${formatCurrency(total)}" readonly>
                </div>
            </div>
            <div class="status-options">
                <label class="status-opt">
                    <input type="radio" name="status-${pageId}-${index}" value="ok" onchange="limparErroItem('${pageId}', ${index})">
                    <span class="label-ok">✅ OK</span>
                </label>
                <label class="status-opt">
                    <input type="radio" name="status-${pageId}-${index}" value="pendente" onchange="limparErroItem('${pageId}', ${index})">
                    <span class="label-pendente">⚠️ Pendente</span>
                </label>
                <label class="status-opt">
                    <input type="radio" name="status-${pageId}-${index}" value="perdeu" onchange="limparErroItem('${pageId}', ${index})">
                    <span class="label-perdeu">❌ Perdeu</span>
                </label>
                <label class="status-opt">
                    <input type="radio" name="status-${pageId}-${index}" value="quebrou" onchange="limparErroItem('${pageId}', ${index})">
                    <span class="label-quebrou">🛠️ Quebrou</span>
                </label>
                ${ultimaSubstituicao ? `
                    <button type="button" class="status-opt substitution-status" onclick="mostrarSubstituicaoItem('${escapeJsString(ultimaSubstituicao.data)}', '${escapeJsString(descricaoSubstituicao)}')">
                        <span>Substituição</span>
                    </button>
                ` : ""}
            </div>
            <div class="checklist-extra-fields">
                ${epiExtraFields}
                <label>
                    <span>OBS</span>
                    <textarea id="obs-${pageId}-${index}" rows="1" placeholder="Observação do item">${escapeHtml(defaults.observacao || "")}</textarea>
                </label>
            </div>
        </div>
    `;
    }).join("");

    if (pageId === "viaturas") {
        updateVehicleMapImage();
        renderDamageMarkers();
        renderDamageList();
        renderFotoPreviews('viaturas');
    }

    if (pageId === "tablets") {
        updateTabletInfo();
        syncSpecialVistoriadores();
        renderTabletDamageMarkers();
        renderTabletDamageList();
        renderFotoPreviews('tablets');
    }

    if (pageId === "notebooks") {
        syncSpecialVistoriadores();
        renderNotebookDamageMarkers();
        renderNotebookDamageList();
        renderFotoPreviews('notebooks');
    }
}

function limparErroItem(pageId, index) {
    document.getElementById(`row-${pageId}-${index}`)?.classList.remove("error");
}

function marcarTodosComoOk(pageId) {
    const containerMapping = {
        ferramentas: "lista-ferramentas",
        epis: "lista-epis",
        viaturas: "lista-viaturas",
        tablets: "lista-tablets",
        notebooks: "lista-notebooks"
    };
    const container = document.getElementById(containerMapping[pageId]);
    if (!container) return;

    container.querySelectorAll(`input[type="radio"][name^="status-${pageId}-"][value="ok"]`).forEach(input => {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function atualizarTotalItem(pageId, index) {
    const quantidade = Number(document.getElementById(`qtd-${pageId}-${index}`)?.value || 0);
    const valor = Number(document.getElementById(`valor-${pageId}-${index}`)?.value || 0);
    const totalInput = document.getElementById(`total-${pageId}-${index}`);
    if (totalInput) totalInput.value = formatCurrency(quantidade * valor);
}

function handleViaturaInteraction(e, viaturaId) {
    // Impede interação se o menu já estiver aberto
    if (document.getElementById("long-press-menu")?.classList.contains("active")) return;

    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTapTime;

    // Se o intervalo entre cliques for curto na mesma viatura, abre o painel rápido
    if (lastTapViaturaId === viaturaId && tapLength < 350 && tapLength > 50) {
        // Coordenadas para o menu rápido (fallback para centro da tela se e.clientX for 0)
        const x = e.clientX || (e.touches?.[0]?.clientX) || window.innerWidth / 2;
        const y = e.clientY || (e.touches?.[0]?.clientY) || window.innerHeight / 2;
        
        showLongPressMenu(x, y, viaturaId);
        lastTapTime = 0;
    } else {
        // Clique simples: apenas seleciona a viatura normalmente
        selectViatura(viaturaId);
        lastTapTime = currentTime;
        lastTapViaturaId = viaturaId;
    }
}

function showLongPressMenu(x, y, viaturaId) {
    // Garante que a viatura alvo do menu esteja selecionada internamente
    if (state.selectedViatura !== viaturaId) {
        selectViatura(viaturaId);
    }

    const menu = document.getElementById("long-press-menu");
    const titleLabel = document.getElementById("lp-menu-title");
    const viatura = getViaturaById(viaturaId);
    
    if (!menu || !titleLabel) return;
    titleLabel.innerText = viatura?.nome || `Viatura ${formatTwoDigits(viaturaId)}`;
    
    // Atualiza o status visual dos itens no menu rápido
    const status = state.surveyStatus[viaturaId] || {};
    const itemsConfig = {
        ferramentas: '🔧 Ferramentas',
        epis: '🦺 EPIs',
        viaturas: '🚗 Viatura',
        tablets: '📱 Tablet',
        notebooks: '💻 Notebook'
    };

    menu.querySelectorAll(".long-press-item").forEach(item => {
        const cat = item.getAttribute("data-category");
        const isDone = !!status[cat];
        item.classList.toggle("completed", isDone);
        item.innerHTML = isDone ? `${itemsConfig[cat]} <span style="margin-left: auto;">✅</span>` : itemsConfig[cat];
    });

    // No PC segue o mouse, no Celular o CSS via media query cuida da centralização (left: 50%)
    if (window.innerWidth > 480) {
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 10}px`;
        if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 10}px`;
    } else {
        // Reset de posições inline para o CSS fixo do mobile funcionar
        menu.style.left = "";
        menu.style.top = "";
    }

    isLongPressActive = true;
    menuJustOpened = true; 
    menu.classList.add("active");

    // Destrava após 500ms para permitir fechar clicando fora
    setTimeout(() => { menuJustOpened = false; }, 500);

    if (navigator.vibrate) navigator.vibrate(50); // Vibração leve no celular
}

function hideLongPressMenu() {
    if (menuJustOpened) return; // Impede fechar se acabou de abrir
    document.getElementById("long-press-menu")?.classList.remove("active");
}

function handleLongPressAction(category) {
    if (!lastTapViaturaId) return;
    
    const vistoriador = getVistoriadorAtivo();
    if (!podeAcessarCategoria(category, vistoriador)) {
        alert(getAccessDeniedMessage(category, vistoriador));
        hideLongPressMenu();
        return;
    }

    selectViatura(lastTapViaturaId);
    showPage(category);
    hideLongPressMenu();
}

function salvarItemComEnter(event, pageId) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    finalizarVistoria(pageId);
}

function mostrarSubstituicaoItem(data, descricao) {
    alert(`Data: ${data}\nDescrição: ${descricao}`);
}

function renderViaturaDashboard() {
    const grid = document.getElementById("viaturas-grid");
    if (!grid) return;

    grid.innerHTML = "";
    const expanded = getViaturasGridExpanded();
    updateSelectedViaturaBanner();
    grid.hidden = !expanded;

    if (!expanded) {
        updateViaturasToggleButton();
        return;
    }

    state.viaturas.forEach((viatura) => {
        const id = viatura.id;
        const status = state.surveyStatus[id] || {};
        const isActive = state.selectedViatura === id;
        const isFullyConcluded = status.ferramentas && status.epis && status.viaturas && status.tablets;
        const isDisabled = viatura.ativa === false;
        const responsaveis = viaturaResponsaveis[id] || {};
        const tecnicos = Array.isArray(responsaveis.tecnicos) && responsaveis.tecnicos.length
            ? responsaveis.tecnicos.map(tecnico => tecnico.nome).filter(Boolean)
            : (responsaveis.tecnico && responsaveis.tecnico !== "Veículo sem Técnico" ? [responsaveis.tecnico] : []);
        const auxiliares = Array.isArray(responsaveis.auxiliares) && responsaveis.auxiliares.length
            ? responsaveis.auxiliares.map(auxiliar => auxiliar.nome).filter(Boolean)
            : (responsaveis.auxiliar ? [responsaveis.auxiliar] : []);
        const tecnico = tecnicos.length ? tecnicos.join(", ") : "Sem técnico";
        const auxiliaresTexto = auxiliares.length ? auxiliares.join(", ") : "Sem auxiliar";

        const card = document.createElement("div");
        card.className = `viatura-card ${isActive ? "active" : ""} ${isDisabled ? "disabled" : ""} ${isFullyConcluded ? "fully-concluded" : ""}`;
        
        // Substituído por clique simples/duplo unificado
        card.onclick = (e) => handleViaturaInteraction(e, id);

        card.innerHTML = `
            <span class="viatura-name">${escapeHtml(viatura.nome)}</span>
            ${isFullyConcluded ? '<span class="viatura-concluded-label">Vistoria concluída</span>' : ''}
            ${isDisabled ? `<span class="viatura-disabled-label">Desativada</span>` : ""}
            <span class="viatura-responsaveis">${escapeHtml(tecnico)} / ${escapeHtml(auxiliaresTexto)}</span>
            <div class="status-dots">
                <span class="dot ${status.ferramentas ? "done" : ""}" title="Ferramentas">🔧</span>
                <span class="dot ${status.epis ? "done" : ""}" title="EPIs">🦺</span>
                <span class="dot ${status.viaturas ? "done" : ""}" title="Viatura">🚗</span>
                <span class="dot ${status.tablets ? "done" : ""}" title="Tablet">📱</span>
            </div>
        `;
        grid.appendChild(card);
    });

    updateViaturasToggleButton();
}

function updateSelectedViaturaBanner() {
    const viatura = getViaturaById(state.selectedViatura);
    const label = viatura?.nome || `Viatura ${formatTwoDigits(state.selectedViatura)}`;

    const headerName = document.getElementById("header-selected-viatura");
    if (headerName) {
        headerName.textContent = label;
        headerName.title = label;
    }
}

function getViaturasGridExpanded() {
    return localStorage.getItem("viaturasGridExpanded") !== "0";
}

function updateViaturasToggleButton() {
    const button = document.getElementById("btn-toggle-viaturas-grid");
    if (!button) return;
    const expanded = getViaturasGridExpanded();
    button.textContent = expanded ? "Ocultar viaturas" : "Visualizar todas as viaturas";
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function toggleViaturasGrid() {
    const expanded = getViaturasGridExpanded();
    localStorage.setItem("viaturasGridExpanded", expanded ? "0" : "1");
    renderViaturaDashboard();
}

function selectViatura(id) {
    const viatura = getViaturaById(id);
    if (viatura?.ativa === false) {
        alert("Esta viatura está desativada.");
        return;
    }
    setSelectedViatura(id);
    renderViaturaDashboard();
    updateMenuStatus();
    updateVistoriaModeUI();
    ocultarOpcoesModoVistoria();
    preencherResponsaveisViatura();
    updateVehicleMapImage(id);
    updateTabletInfo(id);
    limparCamposViatura();

    renderFotoPreviews('viaturas');
    renderFotoPreviews('tablets');
    renderFotoPreviews('notebooks');

    const activeTab = document.querySelector(".tab-content.active");
    if (activeTab) renderItems(activeTab.id);
    abrirModalTipoVistoria();
}

function limparCamposViatura() {
    const kmInput = document.getElementById("km");
    const combustivelInput = document.getElementById("combustivel");

    if (kmInput) kmInput.value = "";
    if (combustivelInput) combustivelInput.value = "";
}

function updateVistoriaModeUI() {
    const label = document.getElementById("vistoria-mode-label");
    updateSelectedViaturaBanner();
    if (!label) return;

    const viatura = getViaturaById(state.selectedViatura);
    const viaturaPrefix = viatura?.nome ? `${viatura.nome} - ` : "";
    const categorias = getCategoriasVistoria(state.selectedViatura)
        .map(category => vistoriaCategoriaLabels[category] || categoryNames[category])
        .join(", ");
    label.innerText = isVistoriaParcial()
        ? `${viaturaPrefix}Modo: Vistoria parcial (${categorias})`
        : `${viaturaPrefix}Modo: Vistoria completa`;

    const mode = isVistoriaParcial() ? "parcial" : "completa";
    document.querySelectorAll(".vistoria-mode-option").forEach((button) => {
        button.classList.toggle("active", button.dataset.mode === mode);
    });
}

function setModalPartialCategoriasVisible(visible) {
    const container = document.getElementById("vistoria-partial-categories");
    if (container) container.classList.toggle("active", visible);
}

function selecionarTipoVistoriaModal(mode) {
    const radio = document.querySelector(`input[name="vistoria-mode-required"][value="${mode}"]`);
    if (radio) radio.checked = true;
    setModalPartialCategoriasVisible(mode === "parcial");
    const error = document.getElementById("vistoria-mode-error");
    if (error) error.innerText = "";
}

function getCategoriasSelecionadasModal() {
    return Array.from(document.querySelectorAll("#vistoria-partial-categories input[type='checkbox']:checked"))
        .map(input => input.value)
        .filter(category => checklistReportCategories.includes(category));
}

function preencherModalTipoVistoria() {
    const viatura = getViaturaById(state.selectedViatura);
    const title = document.getElementById("vistoria-mode-modal-title");
    const subtitle = document.getElementById("vistoria-mode-modal-subtitle");
    if (title) title.innerText = `Definir tipo de vistoria - ${viatura?.nome || "Viatura"}`;
    if (subtitle) subtitle.innerText = "Escolha completa ou parcial antes de iniciar a vistoria.";

    const mode = state.vistoriaMode[state.selectedViatura] === "parcial" ? "parcial" : "completa";
    const categoriasAtuais = mode === "parcial" ? getCategoriasVistoria(state.selectedViatura) : ["tablets"];

    document.querySelectorAll("input[name='vistoria-mode-required']").forEach(input => {
        input.checked = input.value === mode;
    });
    document.querySelectorAll("#vistoria-partial-categories input[type='checkbox']").forEach(input => {
        input.checked = categoriasAtuais.includes(input.value);
    });

    selecionarTipoVistoriaModal(mode);
}

function abrirModalTipoVistoria() {
    preencherModalTipoVistoria();
    const modal = document.getElementById("vistoria-mode-modal");
    if (modal) modal.style.display = "flex";
}

function fecharModalTipoVistoria() {
    const modal = document.getElementById("vistoria-mode-modal");
    if (modal) modal.style.display = "none";
}

function confirmarTipoVistoriaModal() {
    const selectedMode = document.querySelector("input[name='vistoria-mode-required']:checked")?.value || "completa";
    const categorias = selectedMode === "parcial" ? getCategoriasSelecionadasModal() : [...checklistReportCategories];
    const error = document.getElementById("vistoria-mode-error");

    if (selectedMode === "parcial" && categorias.length === 0) {
        if (error) error.innerText = "Selecione pelo menos uma categoria para a vistoria parcial.";
        return;
    }

    setModoVistoria(state.selectedViatura, selectedMode, categorias);
    fecharModalTipoVistoria();
    updateVistoriaModeUI();
    updateMenuStatus();
    ocultarOpcoesModoVistoria();

    const activeTab = document.querySelector(".tab-content.active");
    if (activeTab && !isCategoriaNaVistoriaAtual(activeTab.id)) {
        showPage(getCategoriasVistoria(state.selectedViatura)[0] || "tablets");
    }
}

function mostrarOpcoesModoVistoria() {
    const container = document.getElementById("vistoria-actions-container");
    const btn = document.getElementById("btn-toggle-mode");
    if (container && btn) {
        container.classList.add("show");
        btn.classList.add("active");
    }
}

function ocultarOpcoesModoVistoria() {
    const container = document.getElementById("vistoria-actions-container");
    const btn = document.getElementById("btn-toggle-mode");
    if (container && btn) {
        container.classList.remove("show");
        btn.classList.remove("active");
    }
}

function toggleVistoriaActions() {
    const container = document.getElementById("vistoria-actions-container");
    const btn = document.getElementById("btn-toggle-mode");
    if (container && btn) {
        container.classList.toggle("show");
        btn.classList.toggle("active");
    }
}

function toggleTeamActions() {
    const container = document.getElementById("team-actions-container");
    const btn = document.getElementById("btn-toggle-team");
    if (container && btn) {
        container.classList.toggle("show");
        btn.classList.toggle("active");
    }
}

function renderTeamList() {
    const viaturaId = state.selectedViatura;
    if (!viaturaId) return;
    
    const resp = viaturaResponsaveis[viaturaId] || {};
    const team = [];

    if (Array.isArray(resp.tecnicos) && resp.tecnicos.length > 0) {
        resp.tecnicos.forEach(tecnico => {
            if (tecnico.nome) team.push({ nome: tecnico.nome, cpf: tecnico.cpf, tipo: "Técnico" });
        });
    } else if (resp.tecnico && resp.tecnico !== "Veículo sem Técnico") {
        team.push({ nome: resp.tecnico, cpf: resp.tecnicoCpf, tipo: "Técnico" });
    }

    if (Array.isArray(resp.auxiliares) && resp.auxiliares.length > 0) {
        resp.auxiliares.forEach(aux => {
            if (aux.nome) team.push({ nome: aux.nome, cpf: aux.cpf, tipo: "Auxiliar técnico" });
        });
    } else if (resp.auxiliar) {
        team.push({ nome: resp.auxiliar, cpf: resp.auxiliarCpf, tipo: "Auxiliar técnico" });
    }

    const countLabel = document.getElementById("team-count-label");
    if (!countLabel) return;

    countLabel.innerText = `Equipe Responsável (${team.length})`;
}

function configurarModoVistoria() {
    abrirModalTipoVistoria();
}

function definirModoVistoria(mode) {
    if (mode === "parcial") {
        abrirModalTipoVistoria();
        selecionarTipoVistoriaModal("parcial");
        return;
    }

    setModoVistoria(state.selectedViatura, "completa", checklistReportCategories);
    updateVistoriaModeUI();
    updateMenuStatus();
}

function updateMenuStatus() {
    const status = state.surveyStatus[state.selectedViatura] || {};
    let concluidas = 0;
    const vistoriaParcial = isVistoriaParcial(state.selectedViatura);

    // Verifica se há pelo menos um EPI individual concluído para esta viatura (mesmo que não todos)
    const algumEpiFeito = Object.values(state.epiSurveyStatus[state.selectedViatura] || {}).some(v => v === true);

    Object.keys(categoryNames).forEach(category => {
        const link = document.getElementById(`menu-${category}`);
        const btnPdfCategoria = document.getElementById(`btn-pdf-${category}`);
        const categoriaNaVistoria = isCategoriaNaVistoriaAtual(category);

        if (link && status[category]) {
            link.classList.add("completed");
            concluidas++;
        } else if (link) {
            link.classList.remove("completed");
        }

        if (link) {
            link.classList.toggle("not-in-scope", !categoriaNaVistoria);
            link.setAttribute("aria-disabled", categoriaNaVistoria ? "false" : "true");
        }

        if (btnPdfCategoria) {
            btnPdfCategoria.style.display = vistoriaParcial && categoriaNaVistoria && status[category] ? "block" : "none";
        }
    });

    const vistoriaCompleta = todasEtapasConcluidas(state.selectedViatura);
    const btnEncerrar = document.getElementById("btn-encerrar-geral");

    if (btnEncerrar) {
        // O botão aparece se a vistoria completa estiver pronta (Modo Completo)
        // OU se houver QUALQUER progresso (Modo Parcial: qualquer categoria ou EPI individual)
        const mostrarNoModoParcial = vistoriaParcial && (concluidas > 0 || algumEpiFeito);
        const mostrarNoModoCompleto = !vistoriaParcial && vistoriaCompleta;

        btnEncerrar.style.display = (mostrarNoModoParcial || mostrarNoModoCompleto) ? "block" : "none";
        btnEncerrar.innerText = vistoriaParcial 
            ? `📁 Gerar PDF da Vistoria Parcial (Viatura ${String(state.selectedViatura).padStart(2, "0")})`
            : `📁 Encerrar Vistoria Viatura ${String(state.selectedViatura).padStart(2, "0")} (Gerar PDF)`;
    }
}

async function gerarPdfCategoria(category) {
    if (!categoryNames[category]) return;

    if (!isVistoriaParcial(state.selectedViatura)) {
        alert("O PDF por etapa fica disponível no modo de vistoria parcial.");
        return;
    }

    if (!state.surveyStatus[state.selectedViatura]?.[category]) {
        alert(`Finalize ${categoryNames[category]} antes de gerar o PDF desta etapa.`);
        return;
    }

    await gerarRelatorioViatura(state.selectedViatura, {
        confirmar: true,
        resetarStatus: true,
        categorias: [category]
    });
}

/**
 * Processa a foto tirada pelo celular, comprime e armazena no estado temporário
 */
async function handleFotoUpload(input, categoria) {
    const files = Array.from(input.files);
    if (files.length === 0) return;
    const viaturaId = state.selectedViatura;
    const slotIndex = input.dataset?.slotIndex !== undefined ? Number(input.dataset.slotIndex) : null;

    if (!state.fotosEvidencia) state.fotosEvidencia = {};
    if (!state.fotosEvidencia[viaturaId]) state.fotosEvidencia[viaturaId] = {};
    if (!Array.isArray(state.fotosEvidencia[viaturaId][categoria])) {
        state.fotosEvidencia[viaturaId][categoria] = [];
    }

    for (const file of files) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800;
                const scale = MAX_WIDTH / img.width;
                canvas.width = MAX_WIDTH;
                canvas.height = img.height * scale;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6);
                if (categoria === "notebooks" && Number.isInteger(slotIndex)) {
                    state.fotosEvidencia[viaturaId][categoria][slotIndex] = compressedBase64;
                } else {
                    state.fotosEvidencia[viaturaId][categoria].push(compressedBase64);
                }
                localStorage.setItem("fotosEvidencia", JSON.stringify(state.fotosEvidencia));
                renderFotoPreviews(categoria);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
        if (categoria === "notebooks" && Number.isInteger(slotIndex)) break;
    }
    input.value = ""; // Limpa o input para permitir nova seleção
}

function renderFotoPreviews(categoria) {
    const containerId = { viaturas: 'previews-viaturas', tablets: 'previews-tablets', notebooks: 'previews-notebooks' }[categoria];
    const counterId = { viaturas: 'count-viaturas', tablets: 'count-tablets', notebooks: 'count-notebooks' }[categoria];

    const container = document.getElementById(containerId);
    const counter = document.getElementById(counterId);

    if (!container) return;

    const viaturaId = state.selectedViatura;
    const fotos = state.fotosEvidencia?.[viaturaId]?.[categoria] || [];
    const fotosValidas = fotos.filter(Boolean);
    
    if (counter) {
        counter.innerText = `(${fotosValidas.length} foto${fotosValidas.length === 1 ? '' : 's'})`;
    }

    if (categoria === "notebooks") {
        const slots = ["Tampa superior", "Traseira", "Lateral direita", "Lateral esquerda"];
        const mainSlotsHtml = slots.map((label, index) => {
            const foto = fotos[index] || "";
            const hasPhoto = Boolean(foto);
            return `
                <div class="notebook-photo-slot ${hasPhoto ? "has-photo" : ""}">
                    <div class="notebook-photo-slot-label">
                        <strong>${label}</strong>
                    </div>
                    <div class="notebook-photo-slot-preview">
                        ${hasPhoto ? `<img src="${foto}" alt="${label}">` : '<span>Nenhuma foto</span>'}
                    </div>
                    <div class="notebook-photo-slot-actions">
                        <label for="foto-notebook-slot-${index}" class="notebook-photo-action">${hasPhoto ? "Substituir" : "Adicionar"}</label>
                        <input type="file" id="foto-notebook-slot-${index}" accept="image/*" data-slot-index="${index}" onchange="handleFotoUpload(this, 'notebooks')" style="display: none;">
                        <button type="button" class="btn-remove-photo" onclick="removerFoto('notebooks', ${index})" ${hasPhoto ? "" : "disabled"}>Excluir</button>
                    </div>
                </div>
            `;
        }).join("");
        const extraPhotos = fotos
            .map((foto, index) => ({ foto, index }))
            .filter(item => item.index >= slots.length && Boolean(item.foto));
        const lastExtraPhotoIndex = extraPhotos.at(-1)?.index ?? -1;
        const extraPhotosHtml = extraPhotos.map(({ foto, index }, extraIndex) => `
            <div class="notebook-extra-photo-item">
                <img src="${foto}" alt="Foto extra ${extraIndex + 1}">
            </div>
        `).join("");
        container.innerHTML = `
            ${mainSlotsHtml}
            <div class="notebook-photo-slot notebook-extra-photo-slot">
                <div class="notebook-photo-slot-label">
                    <strong>Fotos extras</strong>
                </div>
                <div class="notebook-photo-slot-preview notebook-extra-photo-previews">
                    ${extraPhotosHtml || '<span>Nenhuma foto extra</span>'}
                </div>
                <div class="notebook-photo-slot-actions">
                    <label for="foto-notebook-extra" class="notebook-photo-action">Adicionar</label>
                    <input type="file" id="foto-notebook-extra" accept="image/*" multiple onchange="handleFotoUpload(this, 'notebooks')" style="display: none;">
                    <button type="button" class="btn-remove-photo" onclick="removerFoto('notebooks', ${lastExtraPhotoIndex})" ${lastExtraPhotoIndex >= 0 ? "" : "disabled"}>Excluir</button>
                </div>
            </div>
        `;
        return;
    }

    container.innerHTML = fotos.map((foto, index) => `
        <div class="photo-preview-item">
            <img src="${foto}" alt="Preview">
            <button type="button" class="btn-remove-photo" onclick="removerFoto('${categoria}', ${index})">×</button>
        </div>
    `).join("");
}

function removerFoto(categoria, index) {
    const viaturaId = state.selectedViatura;
    if (state.fotosEvidencia?.[viaturaId]?.[categoria]) {
        if (categoria === "notebooks") {
            state.fotosEvidencia[viaturaId][categoria][index] = null;
        } else {
            state.fotosEvidencia[viaturaId][categoria].splice(index, 1);
        }
        localStorage.setItem("fotosEvidencia", JSON.stringify(state.fotosEvidencia));
        renderFotoPreviews(categoria);
    }
}

async function finalizarVistoria(category) {
    const kmInput = document.getElementById("km");
    const combustivelInput = document.getElementById("combustivel");
    const dataVistoriaInput = document.getElementById("checking-date");
    const tecnicoNomeInput = document.getElementById("tecnico-nome");
    const tecnicoCpfInput = document.getElementById("tecnico-cpf");
    const auxiliarNomeInput = document.getElementById("auxiliar-nome");
    const auxiliarCpfInput = document.getElementById("auxiliar-cpf");
    const vistoriadorGeral = document.getElementById("vistoriador-atual").value;
    const vistoriadorTablet = document.getElementById("tablet-vistoriador")?.value || "";
    const vistoriadorNotebook = document.getElementById("notebook-vistoriador")?.value || "";
    const analistaNome = document.getElementById("notebook-analista-nome")?.value.trim() || "";
    const analistaCpf = document.getElementById("notebook-analista-cpf")?.value || "";
    const notebookModelo = document.getElementById("notebook-modelo")?.value.trim() || "";
    const notebookNumeroSerie = document.getElementById("notebook-serial")?.value.trim() || "";
    const vistoriador = category === "tablets" ? vistoriadorTablet : (category === "notebooks" ? vistoriadorNotebook : vistoriadorGeral);
    const vistoriadorAcesso = category === "notebooks" ? vistoriadorGeral : vistoriador;

    if (!podeAcessarCategoria(category, vistoriadorAcesso)) {
        alert(getAccessDeniedMessage(category, vistoriadorAcesso));
        if (category === "tablets") showPage("tablets");
        if (category === "notebooks") showPage("notebooks");
        return;
    }

    if (category === "notebooks" && vistoriador && !vistoriadoresAcessoNotebook.includes(vistoriador)) {
        alert(`O responsável pela vistoria de notebooks deve ser: ${vistoriadoresAcessoNotebook.join(" ou ")}.`);
        return;
    }

    if (category === "viaturas" && (!kmInput || !kmInput.value)) {
        alert("Por favor, informe o KM atual da viatura antes de finalizar.");
        return;
    }

    if (category === "viaturas" && (!combustivelInput || !combustivelInput.value)) {
        alert("Por favor, informe o nível de combustível antes de finalizar.");
        return;
    }

    if (!vistoriador) {
        let msg = "Por favor, selecione quem está realizando a vistoria no topo da página.";
        if (category === "tablets") msg = `Por favor, selecione um responsável de tablets: ${vistoriadoresTablet.join(", ")}.`;
        if (category === "notebooks") msg = `Por favor, selecione um responsável de notebooks: ${vistoriadoresAcessoNotebook.join(", ")}.`;
        alert(msg);
        return;
    }

    const epiPessoa = category === "epis" ? getEpiPessoaByKey(state.selectedViatura, getSelectedEpiPessoaKey()) : null;
    let msgConfirm = `Deseja finalizar a vistoria de ${categoryNames[category]}?`;
    if (category === "epis" && epiPessoa) {
        msgConfirm = `Deseja finalizar a vistoria de EPIs de ${epiPessoa.tipo} - ${epiPessoa.nome}?`;
    }

    if (!confirm(msgConfirm)) {
        return;
    }

    const items = getChecklistItemsForPessoa(category, state.selectedViatura, getSelectedEpiPessoaKey()).filter(item => item.ativo !== false);
    const checklistResults = [];
    const quantidadesAumentadas = [];
    let temErro = false;

    for (let i = 0; i < items.length; i++) {
        const radio = document.querySelector(`input[name="status-${category}-${i}"]:checked`);
        const row = document.getElementById(`row-${category}-${i}`);
        if (!radio) {
            if (row) row.classList.add("error");
            temErro = true;
            continue;
        }
        const quantidade = Number(document.getElementById(`qtd-${category}-${i}`)?.value || 0);
        const valorUnitario = Number(document.getElementById(`valor-${category}-${i}`)?.value || 0);
        const observacao = document.getElementById(`obs-${category}-${i}`)?.value.trim() || "";
        const ca = category === "epis" ? document.getElementById(`ca-${category}-${i}`)?.value.trim() || "" : "";
        const dataEntrega = category === "epis" ? document.getElementById(`entrega-${category}-${i}`)?.value.trim() || "" : "";
        const itemName = getItemName(items[i]);
        const defaults = resolveChecklistItemData(category, items[i], state.selectedViatura, i);
        const quantidadeOriginal = Number(defaults.quantidade || 1);

        if (quantidade > quantidadeOriginal) {
            quantidadesAumentadas.push({
                item: itemName,
                original: quantidadeOriginal,
                nova: quantidade
            });
        }

        checklistResults.push({
            item: itemName,
            quantidade,
            valorUnitario,
            total: quantidade * valorUnitario,
            status: radio.value,
            observacao,
            ca,
            dataEntrega
        });
    }

    if (temErro) {
        alert("Existem itens sem marcação. Por favor, verifique os campos destacados em vermelho.");
        return;
    }

    // Feedback visual e bloqueio de duplo clique
    const btnOriginal = document.querySelector(`#${category} .btn-submit`);
    const originalText = btnOriginal ? btnOriginal.innerText : "";
    if (btnOriginal) {
        btnOriginal.disabled = true;
        btnOriginal.innerText = "⌛ Enviando...";
    }

    if (category === "notebooks") {
        await salvarNotebookCadastro(true);
    }

    if (quantidadesAumentadas.length > 0) {
        const detalhes = quantidadesAumentadas
            .slice(0, 6)
            .map(item => `- ${item.item}: ${item.original} para ${item.nova}`)
            .join("\n");
        const restante = quantidadesAumentadas.length > 6
            ? `\n...e mais ${quantidadesAumentadas.length - 6} item(ns).`
            : "";

        if (!confirm(`Você aumentou a QTD de alguns itens:\n\n${detalhes}${restante}\n\nDeseja realmente salvar assim?`)) {
            if (btnOriginal) {
                btnOriginal.disabled = false;
                btnOriginal.innerText = originalText;
            }
            return;
        }
    }

    state.dadosTemporariosVistoria = {
        viaturaId: state.selectedViatura,
        tabletId: category === "tablets" ? state.selectedViatura : null,
        vistoriador: vistoriador,
        analistaNome: category === 'notebooks' ? analistaNome : null,
        analistaCpf: category === 'notebooks' ? analistaCpf : null,
        dataVistoria: dataVistoriaInput?.value || new Date().toLocaleDateString("sv-SE"),        
        tecnicoNome: category !== 'notebooks' ? (tecnicoNomeInput?.value.trim() || "") : "",
        tecnicoCpf: category !== 'notebooks' ? (tecnicoCpfInput?.value.trim() || "") : "",
        auxiliarTecnico: category !== 'notebooks' ? (auxiliarNomeInput?.value.trim() || "") : "",
        auxiliarCpf: category !== 'notebooks' ? (auxiliarCpfInput?.value.trim() || "") : "",
        auxiliares: viaturaResponsaveis[state.selectedViatura]?.auxiliares || [],
        epiResponsavelTipo: epiPessoa?.tipo || null,
        epiResponsavelNome: epiPessoa?.nome || null,
        epiResponsavelCpf: epiPessoa?.cpf || null,
        categoria: category,
        tipoVistoria: category === "notebooks" ? "parcial" : (state.vistoriaMode[state.selectedViatura] || "completa"),
        itens: checklistResults,
        km: category === "viaturas" ? kmInput.value : null,
        combustivel: category === "viaturas" ? (combustivelInput?.value || null) : null,
        avarias: category === "viaturas" ? [...state.vehicleDamages[state.selectedViatura]] : [],
        observacoesViatura: category === "viaturas" ? (document.getElementById("viatura-observacoes")?.value.trim() || "") : "",
        avariasTablet: category === "tablets" ? [...state.tabletDamages[state.selectedViatura]] : [],
        observacoesTablet: category === "tablets" ? (document.getElementById("tablet-observacoes")?.value.trim() || "") : "",
        avariasNotebook: category === "notebooks" ? [...state.notebookDamages[state.selectedViatura]] : [],
        notebookTermType: category === "notebooks" ? (document.getElementById("notebook-term-type")?.value || "RETIRADA") : null,
        notebookModelo: category === "notebooks" ? notebookModelo : "",
        notebookNumeroSerie: category === "notebooks" ? notebookNumeroSerie : "",
        observacoesNotebook: category === "notebooks" ? (document.getElementById("notebook-observacoes")?.value.trim() || "") : "",
        fotosEvidencia: (state.fotosEvidencia?.[state.selectedViatura]?.[category] || []).filter(Boolean)
    };

    const pendentes = checklistResults.filter(r => r.status === "pendente");
    if (pendentes.length > 0) {
        abrirModalRevisao(pendentes);
        if (btnOriginal) {
            btnOriginal.disabled = false;
            btnOriginal.innerText = originalText;
        }
    } else {
        await enviarVistoriaAoFirebase();
        if (btnOriginal) {
            btnOriginal.disabled = false;
            btnOriginal.innerText = originalText;
        }
    }
}

function abrirModalRevisao(pendentes) {
    const revisaoBody = document.getElementById("revisao-body");
    revisaoBody.innerHTML = pendentes.map((p, index) => `
        <div class="revisao-item">
            <label><strong>${p.item}</strong> (${p.status.toUpperCase()})</label>
            <textarea id="rev-obs-${index}" placeholder="Descreva o motivo (obrigatório)..." required>${escapeHtml(p.observacao || "")}</textarea>
        </div>
    `).join("");
    document.getElementById("revisao-modal").style.display = "block";
}

async function confirmarEnvioFinal() {
    const pendentesAJustificar = state.dadosTemporariosVistoria.itens.filter(r => r.status === "pendente");

    for (let i = 0; i < pendentesAJustificar.length; i++) {
        const obs = document.getElementById(`rev-obs-${i}`).value;
        if (!obs || !obs.trim()) {
            alert("Por favor, preencha todos os motivos das pendências.");
            return;
        }
        pendentesAJustificar[i].observacao = obs;
    }

    document.getElementById("revisao-modal").style.display = "none";
    await enviarVistoriaAoFirebase();
}

function fecharModalRevisao() {
    document.getElementById("revisao-modal").style.display = "none";
}

function getSignatureCanvasContext() {
    const canvas = document.getElementById("signature-pad");
    if (!canvas) return null;

    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f172a";
    return ctx;
}

function getSignaturePoint(event) {
    const canvas = document.getElementById("signature-pad");
    const source = event.touches?.[0] || event.changedTouches?.[0] || event;
    const rect = canvas.getBoundingClientRect();
    return {
        x: (source.clientX - rect.left) * (canvas.width / rect.width),
        y: (source.clientY - rect.top) * (canvas.height / rect.height)
    };
}

function initSignatureCanvas() {
    if (signatureCanvasInitialized) return;

    const canvas = document.getElementById("signature-pad");
    const ctx = getSignatureCanvasContext();
    if (!canvas || !ctx) return;

    const start = (event) => {
        event.preventDefault();
        signatureDrawing = true;
        const point = getSignaturePoint(event);
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
    };

    const move = (event) => {
        if (!signatureDrawing) return;
        event.preventDefault();
        const point = getSignaturePoint(event);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
    };

    const end = () => {
        signatureDrawing = false;
    };

    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);
    signatureCanvasInitialized = true;
}

function limparAssinaturaCanvas() {
    const canvas = document.getElementById("signature-pad");
    const ctx = getSignatureCanvasContext();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function abrirModalAssinatura(type = "tecnico", index = 0) {
    signatureTarget = { type, index: Number(index) || 0 };
    const modal = document.getElementById("signature-modal");
    const title = document.getElementById("signature-title");
    if (title) {
        title.innerText = type === "auxiliar"
            ? `Assinatura do Auxiliar ${signatureTarget.index + 1}`
            : "Assinatura do Técnico";
    }
    if (modal) modal.style.display = "block";
    initSignatureCanvas();
    limparAssinaturaCanvas();
}

function confirmarAssinatura() {
    const canvas = document.getElementById("signature-pad");
    if (!canvas) return;

    state.assinaturas = state.assinaturas || { auxiliares: [] };
    const dataUrl = canvas.toDataURL("image/png");

    if (signatureTarget.type === "auxiliar") {
        if (!Array.isArray(state.assinaturas.auxiliares)) state.assinaturas.auxiliares = [];
        state.assinaturas.auxiliares[signatureTarget.index] = dataUrl;
    } else {
        state.assinaturas.tecnico = dataUrl;
    }

    fecharModalAssinatura();
}

function fecharModalAssinatura() {
    const modal = document.getElementById("signature-modal");
    if (modal) modal.style.display = "none";
    signatureDrawing = false;
}

async function enviarVistoriaAoFirebase() {
    try {
        if (!state.dadosTemporariosVistoria) {
            throw new Error("Dados da vistoria não encontrados para envio.");
        }
        const docData = { ...state.dadosTemporariosVistoria, dataEnvio: serverTimestamp() };

        const categoriaSalva = state.dadosTemporariosVistoria.categoria;
        const viaturaSalva = state.selectedViatura;
        const epiPessoaKeySalva = categoriaSalva === "epis" ? getSelectedEpiPessoaKey() : "";
        
        // Lógica simplificada: sempre salva a vistoria da categoria no Firebase.
        await addDoc(collection(db, "vistorias"), docData);
        
        salvarVistoriaLocal({
            ...state.dadosTemporariosVistoria,
            dataEnvioLocal: new Date()
        });

        if (document.getElementById("km")) document.getElementById("km").value = "";
        if (document.getElementById("combustivel")) document.getElementById("combustivel").value = "";
        if (categoriaSalva === "viaturas") {
            state.vehicleDamages[state.selectedViatura] = [];
            const observacoesViatura = document.getElementById("viatura-observacoes");
            if (observacoesViatura) observacoesViatura.value = "";
            renderDamageMarkers();
            renderDamageList();
        }
        if (categoriaSalva === "tablets") {
            state.tabletDamages[state.selectedViatura] = [];
            const observacoesTablet = document.getElementById("tablet-observacoes");
            if (observacoesTablet) observacoesTablet.value = "";
            renderTabletDamageMarkers();
            renderTabletDamageList();
        }
        if (categoriaSalva === "notebooks") {
            state.notebookDamages[state.selectedViatura] = [];
            const observacoesNotebook = document.getElementById("notebook-observacoes");
            if (observacoesNotebook) observacoesNotebook.value = "";
            renderNotebookDamageMarkers();
            renderNotebookDamageList();
            await carregarNotebookUsageStatus();
        }
        
        // Limpa a foto após o envio
        if (state.fotosEvidencia?.[viaturaSalva]) {
            state.fotosEvidencia[viaturaSalva][categoriaSalva] = [];
            localStorage.setItem("fotosEvidencia", JSON.stringify(state.fotosEvidencia));
        }
        const inputIdMapping = { viaturas: 'foto-viatura', tablets: 'foto-tablet', notebooks: 'foto-notebook' };
        const inputFoto = document.getElementById(inputIdMapping[categoriaSalva]);
        if (inputFoto) inputFoto.value = "";

        renderFotoPreviews(categoriaSalva);

        if (categoriaSalva === "epis") {
            if (epiPessoaKeySalva) getEpiSurveyMap(viaturaSalva)[epiPessoaKeySalva] = true;
            state.surveyStatus[state.selectedViatura][categoriaSalva] = todosEpisObrigatoriosVistoriados(viaturaSalva);
            renderEpiPessoaButtons();
        } else if (categoriaSalva !== "notebooks") {
            state.surveyStatus[state.selectedViatura][categoriaSalva] = true;
        }
        
        alert("✅ Vistoria salva com sucesso!");
        window.scrollTo({ top: 0, behavior: "smooth" });

        // Volta para a página inicial para mostrar o botão de PDF.
        // Agora volta sempre se for modo parcial (mesmo que apenas 1 EPI tenha sido feito)
        // ou se a categoria salva foi finalizada por completo.
        const ehParcial = isVistoriaParcial(viaturaSalva);
        if (ehParcial || categoriaSalva !== "epis" || state.surveyStatus[viaturaSalva][categoriaSalva]) {
            showHome();
        }

        renderViaturaDashboard();
        updateMenuStatus();
        state.vistoriasCache = [];
        state.dadosTemporariosVistoria = null;

        if (categoriaSalva === "epis" && !state.surveyStatus[state.selectedViatura][categoriaSalva]) {
            const pendentes = getEpiPessoasPendentes(viaturaSalva);
            const proximaPessoa = pendentes[0];
            if (proximaPessoa) {
                const select = document.getElementById("epi-pessoa");
                if (select) select.value = proximaPessoa.key;
                selecionarPessoaEpi();
            } else {
                renderEpiPessoaOptions();
            }
            alert(`✅ EPIs salvos para esta pessoa. Ainda falta vistoriar: ${pendentes.map(pessoa => `${pessoa.tipo} - ${pessoa.nome}`).join(", ")}.`);
            return;
        }

        if (!isVistoriaParcial(viaturaSalva) && categoriaSalva === "tablets" && todasEtapasConcluidas(viaturaSalva)) {
            await gerarRelatorioViatura(viaturaSalva, {
                confirmar: true,
                resetarStatus: true,
                categorias: ["ferramentas", "epis", "viaturas", "tablets"]
            });
        }

        if (categoriaSalva === "notebooks") {
            await gerarRelatorioViatura(viaturaSalva, {
                confirmar: true,
                resetarStatus: true,
                categorias: ["notebooks"]
            });
        }
    } catch (error) {
        console.error("Erro ao salvar no Firestore: ", error);
        alert("Erro ao salvar dados no Firebase.");
    }
}

/**
 * Escuta as vistorias de hoje no Firebase e atualiza as bolinhas (dots)
 * de status no Dashboard em tempo real para todos os aparelhos.
 */
function sincronizarStatusViaturasRealtime() {
    if (statusViaturasUnsubscribe) return;

    const agora = new Date();
    const dataLimite = new Date(agora);
    // Busca vistorias das últimas 24 horas para evitar problemas de fuso horário ou virada de dia.
    dataLimite.setDate(dataLimite.getDate() - 1);
    
    // Filtramos no Firebase para trazer APENAS vistorias de hoje
    // Isso evita processar lixo de dias anteriores
    const q = query(
        collection(db, "vistorias"), 
        // A consulta agora busca documentos das últimas 24 horas.
        where("dataEnvio", ">=", dataLimite),
        orderBy("dataEnvio", "desc")
    );

    statusViaturasUnsubscribe = onSnapshot(q, (snapshot) => {
        const newSurveyStatus = {};
        const newEpiSurveyStatus = {};

        state.viaturas.forEach(v => {
            newSurveyStatus[v.id] = { ferramentas: false, epis: false, viaturas: false, tablets: false, notebooks: false };
            newEpiSurveyStatus[v.id] = {};
        });

        const modoAtualizadoPorViatura = new Set();

        snapshot.forEach(doc => {
            const data = doc.data();
            
            // Ignora registros de resolução de pendência (não contam como nova vistoria)
            if (data.tipoRegistro === "resolucaoPendencia") return;
            
            const viaturaId = String(data.viaturaId);
            const categoria = data.categoria;
            if (categoria !== "notebooks" && !modoAtualizadoPorViatura.has(viaturaId) && ["completa", "parcial"].includes(data.tipoVistoria)) {
                state.vistoriaMode[viaturaId] = data.tipoVistoria;
                modoAtualizadoPorViatura.add(viaturaId);
            }
            
            if (newSurveyStatus[viaturaId]) {
                if (categoria === 'epis') {
                    const nome = String(data.epiResponsavelNome || "").trim();

                    // Se for uma vistoria completa, todos os EPIs são marcados como feitos
                    if (data.categoria === 'todas') {
                        getEpiPessoaOptions(viaturaId).forEach(pessoa => {
                            newEpiSurveyStatus[viaturaId][pessoa.key] = true;
                        });
                    }

                    const cpf = String(data.epiResponsavelCpf || "").trim();
                    const pessoaKey = getFuncionarioKeyFromFields(nome, cpf);

                    newEpiSurveyStatus[viaturaId][pessoaKey] = true;
                    
                    // Temporariamente atualiza o status para cálculo
                    state.epiSurveyStatus[viaturaId] = newEpiSurveyStatus[viaturaId];
                    newSurveyStatus[viaturaId].epis = todosEpisObrigatoriosVistoriados(viaturaId);
                } else if (categoria === 'todas') {
                    newSurveyStatus[viaturaId].ferramentas = true;
                    newSurveyStatus[viaturaId].epis = true;
                    newSurveyStatus[viaturaId].viaturas = true;
                    newSurveyStatus[viaturaId].tablets = true;
                } else if (categoria !== "notebooks" && newSurveyStatus[viaturaId][categoria] !== undefined) {
                    newSurveyStatus[viaturaId][categoria] = true;
                }
            }
        });

        state.surveyStatus = newSurveyStatus;
        state.epiSurveyStatus = newEpiSurveyStatus;

        renderViaturaDashboard();
        updateMenuStatus();
        updateVistoriaModeUI();

        // Atualiza os botões de seleção de pessoa na página de EPIs se ela estiver aberta
        if (document.getElementById("epis")?.classList.contains("active")) {
            renderEpiPessoaOptions();
        }
    }, (error) => {
        statusViaturasUnsubscribe = null;
        console.warn("Não foi possível sincronizar o status das viaturas em tempo real.", error);
    });
}

/**
 * Reinicia a vistoria atual da viatura selecionada.
 * Limpa avarias e campos preenchidos localmente.
 * Se o usuário for Alisson, permite limpar os registros de hoje no banco para resetar o status.
 */
async function reiniciarVistoria() {
    const vistoriador = getVistoriadorAtivo();
    const viaturaId = state.selectedViatura;
    const viatura = getViaturaById(viaturaId);

    if (!viaturaId) return;

    let msg = `Deseja reiniciar a vistoria da ${viatura?.nome || 'viatura'}?\n\nIsso limpará as marcações de avarias e campos preenchidos nesta tela.`;
    
    const isAlisson = (vistoriador === "Alisson");
    if (!confirm(msg)) return;

    // 1. Limpeza Local
    state.vehicleDamages[viaturaId] = [];
    state.tabletDamages[viaturaId] = [];
    state.notebookDamages[viaturaId] = [];
    
    if (document.getElementById("km")) document.getElementById("km").value = "";
    if (document.getElementById("viatura-observacoes")) document.getElementById("viatura-observacoes").value = "";
    if (document.getElementById("tablet-observacoes")) document.getElementById("tablet-observacoes").value = "";
    if (document.getElementById("notebook-observacoes")) document.getElementById("notebook-observacoes").value = "";

    // 2. Se for Alisson, perguntar se quer limpar o banco (status/bolinhas)
    if (isAlisson) {
        if (confirm("Deseja também APAGAR os registros de vistorias realizados HOJE para esta viatura no banco de dados?\n\nIsso fará com que as bolinhas verdes voltem a ficar cinzas para todos.")) {
            try {
                const hoje = new Date();
                hoje.setHours(0, 0, 0, 0);
                
                // Buscamos todas as vistorias de hoje e filtramos a viatura na memória
                // Isso evita o erro de "índice composto" do Firebase
                const q = query(
                    collection(db, "vistorias"), 
                    where("dataEnvio", ">=", hoje)
                );
                
                const snapshot = await getDocs(q);
                const docsParaDeletar = snapshot.docs.filter(docSnap => String(docSnap.data().viaturaId) === String(viaturaId));

                if (docsParaDeletar.length > 0) {
                    const promessas = docsParaDeletar.map(docSnap => deleteDoc(firestoreDoc(db, "vistorias", docSnap.id)));
                    await Promise.all(promessas);
                    alert("Registros de hoje removidos com sucesso. O painel será atualizado automaticamente.");
                } else {
                    alert("Nenhum registro de hoje encontrado para esta viatura.");
                }
            } catch (error) {
                console.error("Erro ao reiniciar no banco:", error);
                alert("Erro ao limpar registros no banco de dados.");
            }
        }
    }

    // 3. Atualizar UI
    const activeTab = document.querySelector(".tab-content.active");
    if (activeTab && categoryNames[activeTab.id]) {
        renderItems(activeTab.id);
    }
    
    renderViaturaDashboard();
    updateMenuStatus();
    renderDamageMarkers();
    renderDamageList();
    renderTabletDamageMarkers();
    renderTabletDamageList();
    renderNotebookDamageMarkers();
    renderNotebookDamageList();

    if (!isAlisson) alert("Campos e avarias limpos localmente. Você pode começar novamente.");
}

/**
 * Reinicia as vistorias de TODAS as viaturas.
 * Se for Alisson, permite limpar o banco de dados de hoje.
 */
async function reiniciarTodasVistorias() {
    const vistoriador = getVistoriadorAtivo();
    if (!confirm("Deseja realmente reiniciar as vistorias de TODAS as viaturas?\n\nIsso limpará as marcações locais e observações de todos os veículos.")) return;

    const isAlisson = (vistoriador === "Alisson");
    
    // 1. Limpeza Local de dados temporários e danos para todas
    state.viaturas.forEach(v => {
        state.vehicleDamages[v.id] = [];
        state.tabletDamages[v.id] = [];
        state.notebookDamages[v.id] = [];
        if (state.surveyStatus[v.id]) {
            state.surveyStatus[v.id] = { ferramentas: false, epis: false, viaturas: false, tablets: false, notebooks: false };
        }
        state.epiSurveyStatus[v.id] = {};
    });

    // Limpar campos visuais da tela atual
    if (document.getElementById("km")) document.getElementById("km").value = "";
    if (document.getElementById("viatura-observacoes")) document.getElementById("viatura-observacoes").value = "";
    if (document.getElementById("tablet-observacoes")) document.getElementById("tablet-observacoes").value = "";
    if (document.getElementById("notebook-observacoes")) document.getElementById("notebook-observacoes").value = "";
    if (state.fotosEvidencia) state.fotosEvidencia = {};

    // 2. Se for Alisson, resetar o status global (banco de dados)
    if (isAlisson) {
        if (confirm("Deseja também APAGAR os registros de vistorias de todas as viaturas realizados HOJE no banco de dados?\n\nIsso fará com que as bolinhas voltem a ficar cinzas em todos os celulares.")) {
            try {
                const hoje = new Date();
                hoje.setHours(0, 0, 0, 0);
                
                const q = query(
                    collection(db, "vistorias"), 
                    where("dataEnvio", ">=", hoje)
                );
                
                const snapshot = await getDocs(q);
                if (snapshot.docs.length > 0) {
                    const promessas = snapshot.docs.map(docSnap => deleteDoc(firestoreDoc(db, "vistorias", docSnap.id)));
                    await Promise.all(promessas);
                    alert("Painel resetado com sucesso no sistema!");
                } else {
                    alert("Nenhum registro de hoje encontrado para apagar.");
                }
            } catch (error) {
                console.error("Erro ao reiniciar todas no banco:", error);
                alert("Erro ao limpar registros no banco de dados.");
            }
        }
    }

    // 3. Atualizar a Interface
    renderViaturaDashboard();
    updateMenuStatus();
    renderDamageMarkers();
    renderDamageList();
    renderTabletDamageMarkers();
    renderTabletDamageList();
    renderNotebookDamageMarkers();
    renderNotebookDamageList();

    const activeTab = document.querySelector(".tab-content.active");
    if (activeTab && categoryNames[activeTab.id]) {
        renderItems(activeTab.id);
    }

    if (!isAlisson) alert("Vistorias reiniciadas localmente.");
}

function bindWindowFunctions() {
    Object.assign(window, {
        toggleMenu,
        scrollToTop,
        loginApp,
        selecionarVistoriadorAtivo,
        selecionarResponsavelTablet,
        selecionarResponsavelNotebook,
        renderNotebookSelectOptions,
        selecionarNotebookCadastrado,
        renderAnalistasSelectOptions,
        selecionarAnalistaCadastrado,
        alternarStatusAnalista,
        abrirGerenciadorAnalistas,
        fecharGerenciadorAnalistas,
        removerNotebookCadastradoSelecionado,
        salvarCpfAnalista,
        removerCpfAnalista,
        salvarNotebookCadastro,
        selecionarTecnicoVistoriaAtual,
        salvarCpfTecnicoVistoriaAtual,
        selecionarAuxiliarVistoriaAtual,
        selecionarResponsavelPorPesquisa,
        configurarModoVistoria,
        updateInputFontSize,
        toggleTeamActions,
        toggleNotebookInspectionInfo,
        showHome,
        showPage,
        selecionarPessoaEpi,
        marcarTodosComoOk,
        gerarPdfCategoria,
        finalizarVistoria,
        selectViatura,
        loginAdmin,
        logoutAdmin,
        limparHistoricoConfig,
        toggleExibirTodosHistoricoConfig,
        toggleExibirTodosHistoricoVistorias,
        exibirMenosHistoricoVistorias,
        limparFiltrosHistoricoVistorias,
        importarPDFs,
        processarPDFsImportados,
        verDetalhes,
        closeModal,
        encerrarVistoriaCompleta,
        exportarHistoricoPDF,
        exportarVistoriasSelecionadasPDF,
        resolverPendenciasSelecionadas,
        aplicarFiltros,
        carregarHistorico,
        toggleSelecionarVistoria,
        toggleSelecionarTodasVistorias,
        excluirVistoriasSelecionadas,
        adicionarViatura,
        adicionarFuncionarioExtra,
        adicionarEpiFuncionarioExtra,
        editarFuncionarioExtra,
        finalizarCadastroFuncionarioExtra,
        editarEpiFuncionarioExtra,
        removerFuncionarioExtra,
        removerEpiFuncionarioExtra,
        removerVistoriador,
        removerResponsavelViatura,
        editarNomeViatura,
        editarResponsavelViatura,
        selecionarTecnicoViatura,
        selecionarAuxiliarViatura,
        alternarViaturaAtiva,
        adicionarResponsavelViatura,
        removerViatura,
        renderAdminChecklist,
        renderAdminHistory,
        showAdminConfigTab,
        showAdminPeopleTab,
        toggleAdicionarResponsavelViatura,
        abrirPaginaHistoricoVistorias,
        adicionarItemChecklist,
        atualizarTotalItemChecklistAdmin,
        atualizarTotalNovoItemChecklist,
        adicionarVistoriador,
        alterarPermissoesVistoriador,
        editarItemChecklist,
        alternarItemChecklist,
        removerItemChecklist,
        substituirItemChecklist,
        confirmarEnvioFinal,
        abrirModalRevisao,
        abrirModalAssinatura,
        confirmarAssinatura,
        limparAssinaturaCanvas,
        fecharModalAssinatura,
        renderFuncionariosPage,
        alterarStatusFuncionario,
        excluirFuncionario,
        editarDadosFuncionario,
        abrirEditorItensFuncionario,
        fecharEditorItensFuncionario,
        adicionarItemFuncionarioEditado,
        editarItemFuncionarioEditado,
        removerItemFuncionarioEditado,
        atualizarTotalItem,
        salvarItemComEnter,
        limparErroItem,
        mostrarSubstituicaoItem,
        fecharModalRevisao,
        sincronizarVistoriadorLogado,
        sincronizarItemAdicionadoChecklist,
        setDamageType,
        marcarAvaria,
        handleFotoUpload,
        removerAvaria,
        limparAvariasViatura,
        setTabletDamageType,
        marcarAvariaTablet,
        removerAvariaTablet,
        limparAvariasTablet,
        setNotebookDamageType,
        marcarAvariaNotebook,
        removerAvariaNotebook,
        limparAvariasNotebook,
        removerFoto,
        reiniciarVistoria,
        reiniciarTodasVistorias,
        handleLongPressAction,
        toggleVistoriaActions,
        definirModoVistoria,
        selecionarTipoVistoriaModal,
        confirmarTipoVistoriaModal,
        fecharModalTipoVistoria,
        toggleViaturasGrid,
        adicionarAuxiliarExtra,
        removerAuxiliarExtra
    });
}

window.onclick = function(event) {
    if (!event.target.matches(".menu-btn")) {
        const dropdown = document.getElementById("menu-list");
        if (dropdown.classList.contains("show")) dropdown.classList.remove("show");
    }
    if (!event.target.closest(".tech-field") && !event.target.closest(".search-field-wrapper")) {
        hideResponsavelPicker(document.getElementById("tecnico-nome"));
        hideResponsavelPicker(document.getElementById("responsavel-pesquisa"));
    }
    hideLongPressMenu();
};

window.addEventListener('scroll', () => {
    // Fechamos o menu de clique longo automaticamente ao rolar a página (PC e Mobile)
    document.getElementById("long-press-menu")?.classList.remove("active");
}, { passive: true });

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await carregarConfiguracoes();
        const vistoriadorSalvo = localStorage.getItem("vistoriadorAtivo");
        renderVistoriadorOptions();
        const vistoriadorSelect = document.getElementById("vistoriador-atual");
        if (vistoriadorSalvo && vistoriadorSelect) vistoriadorSelect.value = vistoriadorSalvo;
        const checkingDate = document.getElementById("checking-date");
        if (checkingDate && !checkingDate.value) checkingDate.value = new Date().toLocaleDateString("sv-SE");
        renderTecnicoDatalist();
        setupResponsavelPickers();
        preencherResponsaveisViatura();
        renderTeamList();

        setPdfUiCallbacks({ renderViaturaDashboard, updateMenuStatus });

        try {
            state.fotosEvidencia = JSON.parse(localStorage.getItem("fotosEvidencia") || "{}");
        } catch (e) {
            state.fotosEvidencia = {};
        }

        setAuthReadyCallback(async () => {
            try {
                await carregarConfiguracoes();
                const vistoriadorAtual = getVistoriadorAtivo();
                renderVistoriadorOptions();
                const vistoriadorSelect = document.getElementById("vistoriador-atual");
                if (vistoriadorAtual && vistoriadorSelect) vistoriadorSelect.value = vistoriadorAtual;
                selecionarVistoriadorPorLogin();
                renderTecnicoDatalist();
                setupResponsavelPickers();
                preencherResponsaveisViatura();
                renderViaturaDashboard();
                updateVehicleMapImage();
                updateTabletInfo();
                updateMenuStatus();
                updateVistoriaModeUI();
                selecionarVistoriadorAtivo(true);

                const cadastrosPromise = carregarCadastrosAposAutenticacao()
                    .then(() => {
                        updateTabletInfo();
                        renderViaturaDashboard();
                    })
                    .catch((error) => {
                        console.error("Erro ao carregar cadastros após login:", error);
                    });

                sincronizarStatusViaturasRealtime();
                if (sessionStorage.getItem("abrirPainelAdmin") === "1" && auth.currentUser) { // Verifica se há usuário logado antes de abrir o painel
                    sessionStorage.removeItem("abrirPainelAdmin");
                    showPage("admin");
                } else {
                    showHome();
                }
                void cadastrosPromise;
            } catch (e) {
                console.error('Erro durante inicialização de auth-ready:', e);
                alert('Erro ao inicializar os dados do usuário. Verifique o console.');
            }
        });
        initAdminAuthListener();
    } catch (error) {
        console.error('Erro inicializando a aplicação:', error);
        alert('Erro ao inicializar a aplicação. Veja o console para detalhes.');
    }
});

bindWindowFunctions();

let lastGlobalErrorMessage = "";
let lastGlobalErrorTime = 0;

function getGlobalErrorMessage(error) {
    return String(error?.message || error?.reason?.message || error || "");
}

function shouldIgnoreGlobalError(message = "") {
    return /extension|chrome-extension|google-analytics|gtag|ResizeObserver loop/i.test(message);
}

function notifyGlobalError(type, error) {
    const message = getGlobalErrorMessage(error);
    if (shouldIgnoreGlobalError(message)) return;

    const now = Date.now();
    if (message === lastGlobalErrorMessage && now - lastGlobalErrorTime < 10000) return;

    lastGlobalErrorMessage = message;
    lastGlobalErrorTime = now;
    console.error(type, error);
}

// Captura global de erros sem criar uma cascata de alertas repetidos.
window.addEventListener('error', (ev) => {
    notifyGlobalError('[UNHANDLED ERROR]', ev.error || ev.message || ev);
});

window.addEventListener('unhandledrejection', (ev) => {
    notifyGlobalError('[UNHANDLED PROMISE REJECTION]', ev.reason);
});

window.refreshAppAfterConfigChange = function() {
    const vistoriadorAtual = getVistoriadorAtivo();
    renderVistoriadorOptions();
    const vistoriadorSelect = document.getElementById("vistoriador-atual");
    if (vistoriadorAtual && vistoriadorSelect && [...vistoriadorSelect.options].some(option => option.value === vistoriadorAtual)) {
        vistoriadorSelect.value = vistoriadorAtual;
    }
    renderTecnicoDatalist();
    preencherResponsaveisViatura();
    syncSpecialVistoriadores();
    updateAccessByVistoriador();
    renderViaturaDashboard();
    updateMenuStatus();
    const activeTab = document.querySelector(".tab-content.active");
    if (document.getElementById("funcionarios-list")) {
        renderFuncionariosPage();
    }
    if (activeTab && activeTab.id !== "funcionarios") {
        renderItems(activeTab.id);
    }
    renderAdminHistory();
};
