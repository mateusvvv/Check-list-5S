import { categoryNames, checklistDataByViatura, cloneEmployeeEpis, damageTypeNames, defaultViaturas, employeeEpisByPerson, ensureChecklistForViatura, formatTwoDigits, funcionariosExtras, getChecklistItemsForPessoa, getEpiPessoaOptions, getFuncionarioKeyFromFields, getFuncionariosData, getItemName, getVistoriadorByEmail, normalizeEmployeeEpiItem, normalizeChecklistItem, normalizeVistoriador, normalizeVistoriadorPermissoes, resolveChecklistItemData, viaturaResponsaveis, vehicleViewNames, vistoriadorPermissionCategories, vistoriadores, syncVistoriadoresTablet } from "./config.js";
import { addDoc, auth, collection, criarUsuarioAuthSecundario, db, deleteDoc, firestoreDoc, onAuthStateChanged, onSnapshot, orderBy, query, serverTimestamp, signInWithEmailAndPassword, signOut, updateDoc, storage, storageRef, uploadBytes, getDownloadURL } from "./firebase.js";
import { getDamageMarkerLabel } from "./damages.js?v=3";
import { gerarPDF, gerarRelatorioComEscolha } from "./pdf.js?v=10";
import { carregarConfiguracoes, salvarConfiguracoes } from "./settings.js?v=4";
import { ensureViaturaState, getActiveViaturas, setSelectedViatura, state } from "./state.js?v=2";

let authReadyCallback = async () => {};
let historyUnsubscribe = null;
const HISTORICO_PAGE_SIZE = 20;
const HISTORICO_INITIAL_VISIBLE = 5;
const HISTORICO_MAX_VISIBLE = 100;
const CONFIG_HISTORY_COLLAPSED_LIMIT = 6;
let historicoFiltradoAtual = [];
let historicoVisibleCount = HISTORICO_INITIAL_VISIBLE;
let historicoGroups = {};
let configHistoryShowAll = false;
let adminAddResponsavelOpen = null;

function stringToSafeId(value = "") {
    return String(value)
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 64);
}

function getVistoriaGroupKey(vistoria) {
    if (!vistoria || vistoria.tipoVistoria !== "completa") return null;
    if (vistoria.categoria === "todas" || vistoria.categoria === "notebooks") return null;
    const viaturaId = String(vistoria.viaturaId || "").trim();
    const dataVistoria = String(vistoria.dataVistoria || "").trim();
    const dataEnvioDate = vistoria.dataEnvio?.toDate?.();
    const dataEnvio = dataEnvioDate ? dataEnvioDate.toLocaleDateString("sv-SE") : "";
    return `${viaturaId}|${dataVistoria || dataEnvio}`;
}

function getGroupStatus(docs) {
    if (docs.some(doc => getStatusVistoria(doc) === "pendente")) return "pendente";
    if (docs.some(doc => getStatusVistoria(doc) === "resolvida")) return "resolvida";
    return "ok";
}

function agruparVistoriasHistorico(dados) {
    historicoGroups = {};
    const grupos = new Map();
    const list = [];

    dados.forEach((vistoria) => {
        const key = getVistoriaGroupKey(vistoria);
        if (!key) {
            list.push({
                ...vistoria,
                ids: [vistoria.id],
                grouped: false
            });
            return;
        }

        const grupo = grupos.get(key) || { ids: [], docs: [], representative: vistoria };
        grupo.ids.push(vistoria.id);
        grupo.docs.push(vistoria);

        if (getDataEnvioDate(vistoria) > getDataEnvioDate(grupo.representative)) {
            grupo.representative = vistoria;
        }

        grupos.set(key, grupo);
    });

    grupos.forEach((group, key) => {
        const syntheticId = `group-${stringToSafeId(key)}`;
        const representative = group.representative;
        const status = getGroupStatus(group.docs);

        historicoGroups[syntheticId] = group;
        list.push({
            ...representative,
            id: syntheticId,
            ids: group.ids,
            docs: group.docs,
            grouped: true,
            categoria: "completa",
            statusGroup: status
        });
    });

    return list.sort((a, b) => getDataEnvioDate(b).getTime() - getDataEnvioDate(a).getTime());
}

function findVistoriaById(docId) {
    if (docId.startsWith("group-") && historicoGroups[docId]) {
        return historicoGroups[docId].docs[0];
    }
    return state.vistoriasCache.find(v => v.id === docId);
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
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "");
}

function parseNumberField(value, fallback = 0) {
    const normalized = String(value ?? "").replace(",", ".");
    const number = Number(normalized);
    return Number.isFinite(number) ? number : fallback;
}

function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    });
}

function getAdminItemTotal(quantidade, valor) {
    return Number(quantidade || 0) * Number(valor || 0);
}

export function atualizarTotalNovoItemChecklist() {
    const quantidade = parseNumberField(document.getElementById("admin-item-quantity")?.value, 1);
    const valor = parseNumberField(document.getElementById("admin-item-value")?.value, 0);
    const totalInput = document.getElementById("admin-item-total");
    if (totalInput) totalInput.value = formatCurrency(getAdminItemTotal(quantidade, valor));
}

export function atualizarTotalItemChecklistAdmin(index) {
    const quantidade = parseNumberField(document.getElementById(`admin-checklist-qtd-${index}`)?.value, 1);
    const valor = parseNumberField(document.getElementById(`admin-checklist-valor-${index}`)?.value, 0);
    const totalInput = document.getElementById(`admin-checklist-total-${index}`);
    if (totalInput) totalInput.value = formatCurrency(getAdminItemTotal(quantidade, valor));
}

function formatDateBR(date = new Date()) {
    return date.toLocaleDateString("pt-BR");
}

function formatDateTimeBR(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Data indisponível" : date.toLocaleString("pt-BR");
}

function getDataEnvioDate(vistoria) {
    if (!vistoria) return new Date(0);
    if (vistoria.dataEnvio && typeof vistoria.dataEnvio.toDate === "function") {
        return vistoria.dataEnvio.toDate();
    }
    if (vistoria.dataEnvioLocal) {
        return new Date(vistoria.dataEnvioLocal);
    }
    const date = new Date(vistoria.dataEnvio || vistoria.dataVistoria || 0);
    return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function getDataVistoriaDate(vistoria) {
    const value = String(vistoria?.dataVistoria || "").trim();
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        const [, year, month, day] = match.map(Number);
        return new Date(year, month - 1, day);
    }

    const dataEnvio = getDataEnvioDate(vistoria);
    if (dataEnvio.getTime() > 0) {
        return new Date(dataEnvio.getFullYear(), dataEnvio.getMonth(), dataEnvio.getDate());
    }

    return null;
}

function getVistoriadorResponsavel() {
    const email = String(auth.currentUser?.email || "").trim().toLowerCase();
    return document.getElementById("vistoriador-atual")?.value
        || getVistoriadorByEmail(email)?.nome
        || auth.currentUser?.email
        || "Não identificado";
}

function getViaturaLabel(viaturaId) {
    const viatura = state.viaturas.find(item => item.id === String(viaturaId));
    return viatura?.nome || `Viatura ${formatTwoDigits(viaturaId)}`;
}

function normalizeNotebookTermType(vistoria) {
    return String(vistoria?.notebookTermType || "")
        .trim()
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function getNotebookTermLabel(vistoria) {
    const termType = normalizeNotebookTermType(vistoria);

    return termType === "RETORNO" || termType === "DEVOLUCAO" ? "Devolução" : "Retirada";
}

function isNotebookDevolucao(vistoria) {
    const termType = normalizeNotebookTermType(vistoria);
    return termType === "RETORNO" || termType === "DEVOLUCAO";
}

function normalizeNotebookLookup(value = "") {
    return String(value)
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ");
}

function getNotebookIdentity(vistoria) {
    const serial = normalizeNotebookLookup(vistoria?.notebookNumeroSerie);
    if (serial) return `serial:${serial}`;

    const modelo = normalizeNotebookLookup(vistoria?.notebookModelo);
    return modelo ? `modelo:${modelo}` : "";
}

function getNotebookAnalystIdentity(vistoria) {
    const cpf = String(vistoria?.analistaCpf || "").replace(/\D/g, "");
    if (cpf) return `cpf:${cpf}`;

    const nome = normalizeNotebookLookup(vistoria?.analistaNome);
    return nome ? `nome:${nome}` : "";
}

function getNotebookUsageInfo(vistoria) {
    if (vistoria?.categoria !== "notebooks" || !isNotebookDevolucao(vistoria)) return null;

    const notebookIdentity = getNotebookIdentity(vistoria);
    const analystIdentity = getNotebookAnalystIdentity(vistoria);
    const dataDevolucao = getDataVistoriaDate(vistoria);
    if (!notebookIdentity || !analystIdentity || !dataDevolucao) return null;

    const retirada = state.vistoriasCache
        .filter(item => (
            item.id !== vistoria.id
            && item.categoria === "notebooks"
            && !isNotebookDevolucao(item)
            && getNotebookIdentity(item) === notebookIdentity
            && getNotebookAnalystIdentity(item) === analystIdentity
        ))
        .map(item => ({ item, data: getDataVistoriaDate(item) }))
        .filter(({ data }) => data && data <= dataDevolucao)
        .sort((a, b) => b.data.getTime() - a.data.getTime())[0];

    if (!retirada) return null;

    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const dias = Math.max(0, Math.round((dataDevolucao.getTime() - retirada.data.getTime()) / MS_PER_DAY));
    return {
        dias,
        dataRetirada: retirada.data
    };
}

function getCategoriaHistoricoLabel(vistoria) {
    if (vistoria.grouped || vistoria.categoria === "todas") return "Todas as categorias";
    if (vistoria.categoria === "notebooks") return `Notebook - ${getNotebookTermLabel(vistoria)}`;
    return categoryNames[vistoria.categoria] || vistoria.categoria;
}

function getPessoaHistoricoLabel(pessoaKey = "") {
    if (!pessoaKey) return "";
    const pessoa = getFuncionariosData().find(funcionario => (
        getFuncionarioKeyFromFields(funcionario.nome, funcionario.cpf) === pessoaKey
    ));
    return pessoa?.nome ? ` de ${pessoa.nome}` : "";
}

function getChecklistHistoryContext(viaturaId, category, pessoaKey = "") {
    const categoria = categoryNames[category] || category;
    const pessoa = category === "epis" ? getPessoaHistoricoLabel(pessoaKey) : "";
    return `${categoria}${pessoa} em ${getViaturaLabel(viaturaId)}`;
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

function isAlissonAdmin() {
    const email = String(auth.currentUser?.email || "").trim().toLowerCase();
    return getVistoriadorResponsavel() === "Alisson" || getVistoriadorByEmail(email)?.nome === "Alisson";
}

function normalizeSearch(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function getTecnicoOptions() {
    const porChave = new Map();
    const addOption = (funcionario) => {
        if (!funcionario?.nome || !funcionario?.cpf) return;
        const key = `${normalizeSearch(funcionario.nome)}|${funcionario.cpf}`;
        if (!porChave.has(key)) {
            porChave.set(key, {
                nome: funcionario.nome,
                cpf: funcionario.cpf
            });
        }
    };

    getFuncionariosData()
        .filter(funcionario => funcionario?.nome && funcionario?.cpf)
        .forEach(addOption);

    addOption({
        nome: "SIDNEY MANOEL DO NASCIMENTO",
        cpf: "099.077.164-48"
    });
    [
        { nome: "JOSE RANDSON SILVA", cpf: "125.442.764-36" },
        { nome: "LUCAS MATEUS BEZERRA CABRAL", cpf: "144.054.924-92" },
        { nome: "ISAEL FORTUNATO DE LIMA", cpf: "182.838.664-27" },
        { nome: "JOSENILDO VINICIUS ALVES LOPES SILVA", cpf: "131.000.574-57" },
        { nome: "MIKE RYAN LIMA CRUZ", cpf: "159.056.184-88" }
    ].forEach(addOption);

    return [...porChave.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function normalizePessoaResponsavel(pessoa = {}) {
    return {
        nome: String(pessoa.nome || "").trim(),
        cpf: String(pessoa.cpf || "").trim()
    };
}

function getResponsaveisLista(responsaveis = {}, tipo = "tecnico") {
    const arrayField = tipo === "tecnico" ? "tecnicos" : "auxiliares";
    const nomeField = tipo === "tecnico" ? "tecnico" : "auxiliar";
    const cpfField = tipo === "tecnico" ? "tecnicoCpf" : "auxiliarCpf";
    const emptyLabel = tipo === "tecnico" ? "Sem técnico" : "Sem auxiliar";
    const lista = Array.isArray(responsaveis[arrayField])
        ? responsaveis[arrayField].map(normalizePessoaResponsavel)
        : [];

    if (!isEmptyResponsavelName(responsaveis[nomeField], emptyLabel)) {
        lista.unshift({
            nome: String(responsaveis[nomeField] || "").trim(),
            cpf: String(responsaveis[cpfField] || "").trim()
        });
    }

    const seen = new Set();
    return lista.filter((pessoa) => {
        if (!pessoa.nome) return false;
        const key = getFuncionarioKeyFromFields(pessoa.nome, pessoa.cpf);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function syncResponsavelPrincipal(responsaveis, tipo = "tecnico") {
    const lista = getResponsaveisLista(responsaveis, tipo);
    setResponsaveisLista(responsaveis, tipo, lista);
}

function setResponsaveisLista(responsaveis, tipo = "tecnico", lista = []) {
    const normalized = lista.map(normalizePessoaResponsavel).filter(pessoa => pessoa.nome);
    const first = normalized[0] || {};
    if (tipo === "tecnico") {
        responsaveis.tecnico = first.nome || "";
        responsaveis.tecnicoCpf = first.cpf || "";
        responsaveis.tecnicos = normalized;
    } else {
        responsaveis.auxiliar = first.nome || "";
        responsaveis.auxiliarCpf = first.cpf || "";
        responsaveis.auxiliares = normalized;
    }
}

function getFuncionariosResponsaveisOptions() {
    return getTecnicoOptions();
}

function findTecnicoByName(nome) {
    const termo = normalizeSearch(nome);
    if (!termo) return null;
    const options = getTecnicoOptions();
    return options.find(tecnico => normalizeSearch(tecnico.nome) === termo)
        || options.find(tecnico => normalizeSearch(tecnico.nome).includes(termo))
        || null;
}

function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
}

function findResponsavelEmOutraViatura(viaturaIdAtual, nome, cpf) {
    const nomeNormalizado = normalizeSearch(nome);
    const cpfNormalizado = onlyDigits(cpf);
    if (!nomeNormalizado && !cpfNormalizado) return null;

    for (const [viaturaId, responsaveis] of Object.entries(viaturaResponsaveis)) {
        if (String(viaturaId) === String(viaturaIdAtual)) continue;

        const pessoas = [
            { tipo: "técnico", nome: responsaveis.tecnico, cpf: responsaveis.tecnicoCpf },
            { tipo: "auxiliar", nome: responsaveis.auxiliar, cpf: responsaveis.auxiliarCpf },
            ...(Array.isArray(responsaveis.tecnicos)
                ? responsaveis.tecnicos.map(tecnico => ({ tipo: "técnico", nome: tecnico.nome, cpf: tecnico.cpf }))
                : []),
            ...(Array.isArray(responsaveis.auxiliares)
                ? responsaveis.auxiliares.map(auxiliar => ({ tipo: "auxiliar", nome: auxiliar.nome, cpf: auxiliar.cpf }))
                : [])
        ];

        const encontrada = pessoas.find(pessoa => {
            if (!pessoa.nome || pessoa.nome === "Veículo sem Técnico") return false;
            const mesmoCpf = cpfNormalizado && onlyDigits(pessoa.cpf) === cpfNormalizado;
            const mesmoNome = nomeNormalizado && normalizeSearch(pessoa.nome) === nomeNormalizado;
            return mesmoCpf || mesmoNome;
        });

        if (encontrada) {
            const viatura = state.viaturas.find(item => item.id === String(viaturaId));
            return {
                ...encontrada,
                viaturaId,
                viaturaNome: viatura?.nome || `Viatura ${formatTwoDigits(viaturaId)}`
            };
        }
    }

    return null;
}

function confirmarResponsavelDuplicado(viaturaId, campo, valor) {
    const responsaveisAtuais = viaturaResponsaveis[String(viaturaId)] || {};
    const proximos = { ...responsaveisAtuais, [campo]: valor.trim() };
    const isTecnico = campo.startsWith("tecnico");
    const nome = isTecnico ? proximos.tecnico : proximos.auxiliar;
    const cpf = isTecnico ? proximos.tecnicoCpf : proximos.auxiliarCpf;
    const duplicado = findResponsavelEmOutraViatura(viaturaId, nome, cpf);

    if (!duplicado) return true;

    alert(`${duplicado.nome} já está cadastrado como ${duplicado.tipo} em ${duplicado.viaturaNome}. Remova esse vínculo antes de adicionar em outra viatura.`);
    return false;
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
    Object.values(state.surveyStatus || {}).forEach((status) => {
        Object.keys(status).forEach((category) => {
            status[category] = false;
        });
    });
    state.epiSurveyStatus = {};
    document.querySelectorAll(".nav-links a.completed").forEach(link => link.classList.remove("completed"));
    document.getElementById("btn-encerrar-geral")?.style.setProperty("display", "none");
}

function renderAdminConfig() {
    renderAdminViaturas();
    renderAdminFilterViaturaOptions();
    renderAdminViaturaOptions();
    renderAdminChecklist();
    renderAdminFuncionariosExtras();
    renderAdminVistoriadores();
    renderAdminHistory();
    updateAdminTabsPermissions();

    if (document.getElementById("admin-config-historico")?.classList.contains("active")) {
        carregarHistorico();
    }
}

/**
 * Controla a visibilidade e permissão das abas do painel admin.
 * Se não for o Alisson, os botões ficam transparentes e bloqueados.
 */
function updateAdminTabsPermissions() {
    const isAlisson = isAlissonAdmin();
    const tabs = ["viaturas", "itens", "funcionarios", "tec-externos", "notebooks", "historico"];
    
    tabs.forEach(tabId => {
        const btn = getAdminConfigTabButton(tabId);
        if (btn) {
            if (!isAlisson) {
                btn.classList.add("restricted");
                btn.style.pointerEvents = "none"; // Bloqueia o clique completamente
                btn.style.cursor = "not-allowed";
                btn.title = "Acesso restrito ao administrador Alisson";
            } else {
                btn.classList.remove("restricted");
                btn.style.pointerEvents = "auto";
                btn.style.cursor = "pointer";
                btn.title = "";
            }
        }
    });
}

function getAdminConfigTabButton(tab) {
    return document.getElementById(tab === "tec-externos" ? "menu-funcionarios" : `admin-tab-${tab}`);
}

export function showAdminConfigTab(tab) {
    if (!isAlissonAdmin()) {
        alert("Somente Alisson tem permissão para acessar estas configurações.");
        return;
    }
    const tabs = ["viaturas", "itens", "funcionarios", "tec-externos", "notebooks", "historico"];
    const targetButton = getAdminConfigTabButton(tab);
    const isAlreadyOpen = targetButton?.classList.contains("active");
    if (isAlreadyOpen) {
        tabs.forEach(item => {
            getAdminConfigTabButton(item)?.classList.remove("active");
            document.getElementById(`admin-config-${item}`)?.classList.remove("active");
        });
        return;
    }

    tabs.forEach(item => {
        getAdminConfigTabButton(item)?.classList.toggle("active", tab === item);
        document.getElementById(`admin-config-${item}`)?.classList.toggle("active", tab === item);
    });

    if (tab === "tec-externos") window.renderFuncionariosPage?.();
    if (tab === "historico") carregarHistorico();
}

function refreshAppAfterConfigChange() {
    window.refreshAppAfterConfigChange?.();
    renderAdminConfig();
}

export function renderAdminViaturas() {
    const container = document.getElementById("admin-viaturas-list");
    if (!container) return;

    const tecnicoOptions = getTecnicoOptions();
    const renderPessoaField = ({ viaturaId, tipo, nome, cpf, datalistId, index = 0, editable = true, removable = false }) => {
        const cpfCampo = tipo === "tecnico" ? "tecnicoCpf" : "auxiliarCpf";
        const nomeHandler = tipo === "tecnico" ? "selecionarTecnicoViatura" : "selecionarAuxiliarViatura";
        const emptyName = tipo === "tecnico" ? "Sem técnico" : "Sem auxiliar";
        const label = tipo === "tecnico" ? "Técnico" : `Auxiliar${index > 0 ? ` ${index + 1}` : ""}`;
        const readonlyAttrs = editable ? "" : "readonly";
        const nameChange = editable
            ? `onchange="${nomeHandler}('${viaturaId}', this.value)"`
            : "";
        const cpfChange = editable
            ? `onchange="editarResponsavelViatura('${viaturaId}', '${cpfCampo}', this.value)"`
            : "";

        return `
            <div class="admin-vehicle-person ${editable ? "" : "readonly"}">
                <span class="admin-person-icon" aria-hidden="true">👤</span>
                <div class="admin-person-fields">
                    <label>
                        <span>${label}</span>
                        <textarea rows="2" placeholder="${emptyName}" data-admin-responsavel="true" data-viatura-id="${viaturaId}" data-tipo="${tipo}" ${nameChange} ${readonlyAttrs}>${escapeHtml(nome || "")}</textarea>
                    </label>
                    <label class="admin-person-cpf">
                        <span>CPF</span>
                        <input type="text" value="${escapeHtml(cpf || "")}" placeholder="CPF não informado" ${cpfChange} ${readonlyAttrs}>
                    </label>
                </div>
            </div>
        `;
    };
    const renderGroupHeader = ({ viaturaId, tipo, count }) => {
        const label = tipo === "tecnico" ? "Técnicos" : "Auxiliares";
        const icon = tipo === "tecnico" ? "👥" : "👤";
        return `
            <div class="admin-people-group-header">
                <h4>${icon} ${label} (${count})</h4>
                <button type="button" class="admin-add-person-btn admin-person-actions-btn" onclick="toggleAcoesResponsavelViatura('${viaturaId}', '${tipo}')" aria-label="Ações de ${label.toLowerCase()}">
                    <span aria-hidden="true">👤+ ×</span>
                </button>
                <div class="admin-add-person-list" id="admin-add-${tipo}-${viaturaId}" hidden></div>
            </div>
        `;
    };

    container.innerHTML = state.viaturas.map((viatura) => {
        const responsaveis = viaturaResponsaveis[viatura.id] || {};
        const tecnicos = getResponsaveisLista(responsaveis, "tecnico");
        const auxiliares = getResponsaveisLista(responsaveis, "auxiliar");
        const tecnicoTemNome = tecnicos.length > 0;
        const auxiliarTemNome = auxiliares.length > 0;
        const tecnicoDatalistId = `tecnicos-viatura-${viatura.id}`;
        const auxiliarDatalistId = `auxiliares-viatura-${viatura.id}`;
        const tecnicoCount = tecnicos.length;
        const auxiliarCount = auxiliares.length;
        return `
            <div class="admin-config-row admin-vehicle-row ${viatura.ativa === false ? "inactive" : ""}">
                <div class="admin-vehicle-main">
                    <div class="admin-vehicle-title">
                        <span class="admin-vehicle-icon" aria-hidden="true">🚙</span>
                        <input type="text" value="${escapeHtml(viatura.nome)}" onchange="editarNomeViatura('${viatura.id}', this.value)" aria-label="Nome da viatura">
                    </div>
                    <div class="admin-config-actions">
                        <button type="button" class="${viatura.ativa === false ? "" : "btn-muted"}" onclick="alternarViaturaAtiva('${viatura.id}')">${viatura.ativa === false ? "Ativar" : "Desativar"}</button>
                        <button type="button" class="btn-danger" onclick="removerViatura('${viatura.id}')">Remover viatura</button>
                    </div>
                </div>
                <div class="admin-responsaveis-grid">
                    <section class="admin-vehicle-people-group">
                        ${renderGroupHeader({ viaturaId: viatura.id, tipo: "tecnico", count: tecnicoCount })}
                        ${
                            tecnicoTemNome
                                ? tecnicos.map((tecnico, index) => renderPessoaField({
                                    viaturaId: viatura.id,
                                    tipo: "tecnico",
                                    nome: tecnico.nome || "",
                                    cpf: tecnico.cpf || "",
                                    datalistId: tecnicoDatalistId,
                                    index,
                                    editable: index === 0,
                                    removable: true
                                })).join("")
                                : renderPessoaField({
                                    viaturaId: viatura.id,
                                    tipo: "tecnico",
                                    nome: "",
                                    cpf: "",
                                    datalistId: tecnicoDatalistId
                                })
                        }
                        <datalist id="${tecnicoDatalistId}">
                            ${tecnicoOptions.map(tecnico => `<option value="${escapeHtml(tecnico.nome)}" label="${escapeHtml(tecnico.cpf)}"></option>`).join("")}
                        </datalist>
                    </section>
                    <section class="admin-vehicle-people-group">
                        ${renderGroupHeader({ viaturaId: viatura.id, tipo: "auxiliar", count: auxiliarCount })}
                        ${
                            auxiliares.length
                                ? auxiliares.map((auxiliar, index) => renderPessoaField({
                                    viaturaId: viatura.id,
                                    tipo: "auxiliar",
                                    nome: auxiliar.nome || "",
                                    cpf: auxiliar.cpf || "",
                                    datalistId: auxiliarDatalistId,
                                    index,
                                    editable: index === 0,
                                    removable: true
                                })).join("")
                                : renderPessoaField({
                                    viaturaId: viatura.id,
                                    tipo: "auxiliar",
                                    nome: "",
                                    cpf: "",
                                    datalistId: auxiliarDatalistId
                                })
                        }
                        <datalist id="${auxiliarDatalistId}">
                            ${tecnicoOptions.map(tecnico => `<option value="${escapeHtml(tecnico.nome)}" label="${escapeHtml(tecnico.cpf)}"></option>`).join("")}
                        </datalist>
                    </section>
                </div>
                <div class="admin-vehicle-footer">Cadastro da viatura: ${escapeHtml(viatura.nome)}</div>
            </div>
        `;
    }).join("");
    setupAdminResponsavelPickers(container);
    setupAdminAddResponsavelLists(container);
    if (adminAddResponsavelOpen) {
        const list = getAdminAddResponsavelList(adminAddResponsavelOpen.viaturaId, adminAddResponsavelOpen.tipo);
        if (list) {
            if (adminAddResponsavelOpen.mode === "add") {
                renderAdminAddResponsavelList(adminAddResponsavelOpen.viaturaId, adminAddResponsavelOpen.tipo);
            } else if (adminAddResponsavelOpen.mode === "remove") {
                renderAdminRemoveResponsavelList(adminAddResponsavelOpen.viaturaId, adminAddResponsavelOpen.tipo);
            } else {
                renderAdminResponsavelActionList(adminAddResponsavelOpen.viaturaId, adminAddResponsavelOpen.tipo);
            }
            list.hidden = false;
        }
    }
}

function getAdminResponsavelOptions(term = "") {
    const normalizedTerm = normalizeSearch(term);
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

function getAdminAddResponsavelList(viaturaId, tipo) {
    return document.getElementById(`admin-add-${tipo}-${viaturaId}`);
}

function hideAdminAddResponsavelLists(except = null) {
    document.querySelectorAll(".admin-add-person-list").forEach((list) => {
        if (list !== except) list.hidden = true;
    });
    if (!except) adminAddResponsavelOpen = null;
}

function renderAdminAddResponsavelList(viaturaId, tipo) {
    const list = getAdminAddResponsavelList(viaturaId, tipo);
    if (!list) return;

    const responsaveis = viaturaResponsaveis[String(viaturaId)] || {};
    const atuais = new Set(getResponsaveisLista(responsaveis, tipo).map(pessoa => getFuncionarioKeyFromFields(pessoa.nome, pessoa.cpf)));
    const options = getFuncionariosResponsaveisOptions();

    list.innerHTML = options.length
        ? options.map((pessoa) => {
            const key = getFuncionarioKeyFromFields(pessoa.nome, pessoa.cpf);
            const selected = atuais.has(key);
            return `
                <button type="button" class="admin-add-person-item ${selected ? "selected" : ""}" data-admin-action="add-person" data-viatura-id="${escapeHtml(viaturaId)}" data-tipo="${escapeHtml(tipo)}" data-nome="${escapeHtml(pessoa.nome)}" ${selected ? "disabled" : ""}>
                    <span>${selected ? "✓" : "+"}</span>
                    <strong>${escapeHtml(pessoa.nome)}</strong>
                    <small>${escapeHtml(pessoa.cpf || "CPF não informado")}</small>
                </button>
            `;
        }).join("")
        : '<div class="responsavel-picker-empty">Nenhum funcionário cadastrado.</div>';
}

function renderAdminRemoveResponsavelList(viaturaId, tipo) {
    const list = getAdminAddResponsavelList(viaturaId, tipo);
    if (!list) return;

    const responsaveis = viaturaResponsaveis[String(viaturaId)] || {};
    const atuais = getResponsaveisLista(responsaveis, tipo);

    list.innerHTML = atuais.length
        ? atuais.map((pessoa, index) => `
            <button type="button" class="admin-add-person-item admin-remove-person-item" data-admin-action="remove-person" data-viatura-id="${escapeHtml(viaturaId)}" data-tipo="${escapeHtml(tipo)}" data-index="${index}">
                <span aria-hidden="true">×</span>
                <strong>${escapeHtml(pessoa.nome || "Sem nome")}</strong>
            </button>
        `).join("")
        : '<div class="responsavel-picker-empty">Nenhum nome para remover.</div>';
}

function renderAdminResponsavelActionList(viaturaId, tipo) {
    const list = getAdminAddResponsavelList(viaturaId, tipo);
    if (!list) return;

    const label = tipo === "tecnico" ? "técnico" : "auxiliar";
    list.innerHTML = `
        <div class="admin-action-menu-title">Ações de ${escapeHtml(label)}</div>
        <button type="button" class="admin-action-menu-item" data-admin-action="show-add" data-viatura-id="${escapeHtml(viaturaId)}" data-tipo="${escapeHtml(tipo)}">
            <span aria-hidden="true">+</span>
            <strong>Adicionar ${escapeHtml(label)}</strong>
            <small>Mostrar lista de nomes cadastrados</small>
        </button>
        <button type="button" class="admin-action-menu-item danger" data-admin-action="show-remove" data-viatura-id="${escapeHtml(viaturaId)}" data-tipo="${escapeHtml(tipo)}">
            <span aria-hidden="true">×</span>
            <strong>Remover ${escapeHtml(label)}</strong>
            <small>Escolher um nome já vinculado</small>
        </button>
    `;
}

function setupAdminAddResponsavelLists(container = document) {
    container.querySelectorAll(".admin-add-person-list").forEach((list) => {
        const [, , tipo, viaturaId] = list.id.split("-");
        renderAdminResponsavelActionList(viaturaId, tipo);
    });
}

export function toggleAcoesResponsavelViatura(viaturaId, tipo) {
    const list = getAdminAddResponsavelList(viaturaId, tipo);
    if (!list) return;
    const shouldOpen = list.hidden || adminAddResponsavelOpen?.mode !== "actions";
    hideOtherAdminResponsavelPickers();
    hideAdminAddResponsavelLists(list);
    if (shouldOpen) {
        adminAddResponsavelOpen = { viaturaId: String(viaturaId), tipo, mode: "actions" };
        renderAdminResponsavelActionList(viaturaId, tipo);
        list.hidden = false;
    } else {
        adminAddResponsavelOpen = null;
        list.hidden = true;
    }
}

export function toggleAdicionarResponsavelViatura(viaturaId, tipo) {
    const list = getAdminAddResponsavelList(viaturaId, tipo);
    if (!list) return;
    const shouldOpen = list.hidden || adminAddResponsavelOpen?.mode !== "add";
    hideOtherAdminResponsavelPickers();
    hideAdminAddResponsavelLists(list);
    if (shouldOpen) {
        adminAddResponsavelOpen = { viaturaId: String(viaturaId), tipo, mode: "add" };
        renderAdminAddResponsavelList(viaturaId, tipo);
        list.hidden = false;
    } else {
        adminAddResponsavelOpen = null;
        list.hidden = true;
    }
}

export function toggleRemoverResponsavelViatura(viaturaId, tipo) {
    const list = getAdminAddResponsavelList(viaturaId, tipo);
    if (!list) return;
    const shouldOpen = list.hidden || adminAddResponsavelOpen?.mode !== "remove";
    hideOtherAdminResponsavelPickers();
    hideAdminAddResponsavelLists(list);
    if (shouldOpen) {
        adminAddResponsavelOpen = { viaturaId: String(viaturaId), tipo, mode: "remove" };
        renderAdminRemoveResponsavelList(viaturaId, tipo);
        list.hidden = false;
    } else {
        adminAddResponsavelOpen = null;
        list.hidden = true;
    }
}

export async function adicionarResponsavelViatura(viaturaId, tipo, nome) {
    const id = String(viaturaId);
    if (!viaturaResponsaveis[id]) {
        viaturaResponsaveis[id] = { tecnico: "", tecnicoCpf: "", auxiliar: "", auxiliarCpf: "", tecnicos: [], auxiliares: [] };
    }

    const pessoa = findTecnicoByName(nome);
    const pessoaNome = pessoa?.nome || String(nome || "").trim();
    const pessoaCpf = pessoa?.cpf || "";
    if (!pessoaNome) return;

    const responsaveis = viaturaResponsaveis[id];
    const arrayField = tipo === "tecnico" ? "tecnicos" : "auxiliares";
    const atuais = getResponsaveisLista(responsaveis, tipo);
    const key = getFuncionarioKeyFromFields(pessoaNome, pessoaCpf);
    if (atuais.some(item => getFuncionarioKeyFromFields(item.nome, item.cpf) === key)) {
        renderAdminAddResponsavelList(id, tipo);
        return;
    }

    const duplicado = findResponsavelEmOutraViatura(id, pessoaNome, pessoaCpf);
    if (duplicado) {
        alert(`${duplicado.nome} já está cadastrado como ${duplicado.tipo} em ${duplicado.viaturaNome}. Remova esse vínculo antes de adicionar em outra viatura.`);
        renderAdminAddResponsavelList(id, tipo);
        return;
    }

    responsaveis[arrayField] = [...atuais, { nome: pessoaNome, cpf: pessoaCpf }];
    syncResponsavelPrincipal(responsaveis, tipo);
    registrarHistoricoConfig(
        tipo === "tecnico" ? "Técnico adicionado" : "Auxiliar adicionado",
        `${pessoaNome} foi adicionado em ${getViaturaLabel(id)}.`
    );
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
    adminAddResponsavelOpen = null;
    renderAdminViaturas();
}

export async function removerResponsavelViatura(viaturaId, tipo, index) {
    const id = String(viaturaId);
    const responsaveis = viaturaResponsaveis[id];
    if (!responsaveis) return;

    const lista = getResponsaveisLista(responsaveis, tipo);
    const itemIndex = Number(index);
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= lista.length) return;

    const label = tipo === "tecnico" ? "técnicos" : "auxiliares";
    const removido = lista[itemIndex];
    if (!confirm(`Remover ${removido.nome} dos ${label} da ${getViaturaLabel(id)}?`)) return;

    lista.splice(itemIndex, 1);
    setResponsaveisLista(responsaveis, tipo, lista);
    registrarHistoricoConfig(
        tipo === "tecnico" ? "Técnico removido" : "Auxiliar removido",
        `${removido.nome} foi removido de ${getViaturaLabel(id)}.`
    );
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

function ensureAdminResponsavelPicker(input) {
    let picker = input.parentElement?.querySelector(".admin-responsavel-picker");
    if (!picker) {
        picker = document.createElement("div");
        picker.className = "responsavel-picker-list admin-responsavel-picker";
        picker.setAttribute("role", "listbox");
        input.insertAdjacentElement("afterend", picker);
    }
    return picker;
}

function hideAdminResponsavelPicker(input) {
    const picker = input?.parentElement?.querySelector(".admin-responsavel-picker");
    if (picker) picker.hidden = true;
}

function hideOtherAdminResponsavelPickers(activeInput = null) {
    document.querySelectorAll(".admin-responsavel-picker").forEach((picker) => {
        if (activeInput?.parentElement?.contains(picker)) return;
        picker.hidden = true;
    });
}

function showAdminResponsavelPicker(input, { showAll = false } = {}) {
    if (!input) return;
    hideOtherAdminResponsavelPickers(input);
    hideAdminAddResponsavelLists();
    const picker = ensureAdminResponsavelPicker(input);
    const options = getAdminResponsavelOptions(showAll ? "" : input.value);

    picker.innerHTML = options.length
        ? options.map((pessoa) => `
            <button type="button" class="responsavel-picker-item" data-nome="${escapeHtml(pessoa.nome)}">
                <strong>${escapeHtml(pessoa.nome)}</strong>
                <span>${escapeHtml(pessoa.cpf)}</span>
            </button>
        `).join("")
        : '<div class="responsavel-picker-empty">Nenhum nome encontrado.</div>';

    picker.hidden = false;
    picker.querySelectorAll(".responsavel-picker-item").forEach((button) => {
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", async () => {
            const nome = button.dataset.nome || "";
            input.value = nome;
            hideAdminResponsavelPicker(input);
            if (input.dataset.tipo === "tecnico") {
                await selecionarTecnicoViatura(input.dataset.viaturaId, nome);
            } else {
                await selecionarAuxiliarViatura(input.dataset.viaturaId, nome);
            }
        });
    });
}

function setupAdminResponsavelPickers(container = document) {
    container.querySelectorAll('textarea[data-admin-responsavel="true"]').forEach((input) => {
        if (input.dataset.adminPickerBound === "true") return;
        input.dataset.adminPickerBound = "true";
        input.setAttribute("readonly", "readonly");
        input.setAttribute("autocomplete", "off");
        input.addEventListener("focus", () => showAdminResponsavelPicker(input, { showAll: true }));
        input.addEventListener("click", () => showAdminResponsavelPicker(input, { showAll: true }));
        input.addEventListener("beforeinput", (event) => event.preventDefault());
        input.addEventListener("input", () => showAdminResponsavelPicker(input, { showAll: true }));
        input.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                hideAdminResponsavelPicker(input);
                return;
            }
            if (["Tab", "Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
                if (event.key !== "Tab") event.preventDefault();
                showAdminResponsavelPicker(input, { showAll: true });
                return;
            }
            event.preventDefault();
        });
    });
}

function isEmptyResponsavelName(value, emptyLabel) {
    const normalized = normalizeSearch(value);
    return !normalized
        || normalized === normalizeSearch(emptyLabel)
        || normalized === normalizeSearch("Veículo sem Técnico");
}

export async function selecionarTecnicoViatura(id, nome) {
    const viaturaId = String(id);
    if (!viaturaResponsaveis[viaturaId]) {
        viaturaResponsaveis[viaturaId] = { tecnico: "", tecnicoCpf: "", auxiliar: "", auxiliarCpf: "" };
    }

    if (isEmptyResponsavelName(nome, "Sem técnico")) {
        const anterior = viaturaResponsaveis[viaturaId].tecnico || "Sem técnico";
        viaturaResponsaveis[viaturaId].tecnico = "";
        viaturaResponsaveis[viaturaId].tecnicoCpf = "";
        viaturaResponsaveis[viaturaId].tecnicos = [];
        if (anterior !== "Sem técnico") {
            registrarHistoricoConfig("Técnico alterado", `${getViaturaLabel(viaturaId)}: técnico alterado de "${anterior}" para "Sem técnico".`);
        }
        await salvarConfiguracoes();
        refreshAppAfterConfigChange();
        return;
    }

    const tecnico = findTecnicoByName(nome);
    const tecnicoNome = tecnico?.nome || nome.trim();
    const tecnicoCpf = tecnico?.cpf || viaturaResponsaveis[viaturaId].tecnicoCpf || "";

    const duplicado = findResponsavelEmOutraViatura(viaturaId, tecnicoNome, tecnicoCpf);
    if (duplicado) {
        alert(`${duplicado.nome} já está cadastrado como ${duplicado.tipo} em ${duplicado.viaturaNome}. Remova esse vínculo antes de adicionar em outra viatura.`);
        refreshAppAfterConfigChange();
        return;
    }

    const anterior = viaturaResponsaveis[viaturaId].tecnico || "Sem técnico";
    viaturaResponsaveis[viaturaId].tecnico = tecnicoNome;
    if (tecnico) viaturaResponsaveis[viaturaId].tecnicoCpf = tecnicoCpf;
    syncResponsavelPrincipal(viaturaResponsaveis[viaturaId], "tecnico");

    if (anterior !== tecnicoNome) {
        registrarHistoricoConfig("Técnico alterado", `${getViaturaLabel(viaturaId)}: técnico alterado de "${anterior}" para "${tecnicoNome || "Sem técnico"}".`);
    }
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function selecionarAuxiliarViatura(id, nome) {
    const viaturaId = String(id);
    if (!viaturaResponsaveis[viaturaId]) {
        viaturaResponsaveis[viaturaId] = { tecnico: "", tecnicoCpf: "", auxiliar: "", auxiliarCpf: "" };
    }

    if (isEmptyResponsavelName(nome, "Sem auxiliar")) {
        const anterior = viaturaResponsaveis[viaturaId].auxiliar || "Sem auxiliar";
        viaturaResponsaveis[viaturaId].auxiliar = "";
        viaturaResponsaveis[viaturaId].auxiliarCpf = "";
        viaturaResponsaveis[viaturaId].auxiliares = [];
        if (anterior !== "Sem auxiliar") {
            registrarHistoricoConfig("Auxiliar alterado", `${getViaturaLabel(viaturaId)}: auxiliar alterado de "${anterior}" para "Sem auxiliar".`);
        }
        await salvarConfiguracoes();
        refreshAppAfterConfigChange();
        return;
    }

    const auxiliar = findTecnicoByName(nome);
    const auxiliarNome = auxiliar?.nome || nome.trim();
    const auxiliarCpf = auxiliar?.cpf || viaturaResponsaveis[viaturaId].auxiliarCpf || "";

    const duplicado = findResponsavelEmOutraViatura(viaturaId, auxiliarNome, auxiliarCpf);
    if (duplicado) {
        alert(`${duplicado.nome} já está cadastrado como ${duplicado.tipo} em ${duplicado.viaturaNome}. Remova esse vínculo antes de adicionar em outra viatura.`);
        refreshAppAfterConfigChange();
        return;
    }

    const anterior = viaturaResponsaveis[viaturaId].auxiliar || "Sem auxiliar";
    viaturaResponsaveis[viaturaId].auxiliar = auxiliarNome;
    if (auxiliar) viaturaResponsaveis[viaturaId].auxiliarCpf = auxiliarCpf;

    const resp = viaturaResponsaveis[viaturaId];
    if (!Array.isArray(resp.auxiliares)) resp.auxiliares = [];
    if (resp.auxiliares.length > 0) {
        resp.auxiliares[0] = { nome: auxiliarNome, cpf: resp.auxiliarCpf || "" };
    } else {
        resp.auxiliares.push({ nome: auxiliarNome, cpf: resp.auxiliarCpf || "" });
    }

    if (anterior !== auxiliarNome) {
        registrarHistoricoConfig("Auxiliar alterado", `${getViaturaLabel(viaturaId)}: auxiliar alterado de "${anterior}" para "${auxiliarNome || "Sem auxiliar"}".`);
    }
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

document.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-admin-action]");
    if (actionButton) {
        event.preventDefault();
        event.stopPropagation();
        const viaturaId = actionButton.dataset.viaturaId;
        const tipo = actionButton.dataset.tipo;
        const action = actionButton.dataset.adminAction;

        if (action === "show-add") {
            toggleAdicionarResponsavelViatura(viaturaId, tipo);
            return;
        }
        if (action === "show-remove") {
            toggleRemoverResponsavelViatura(viaturaId, tipo);
            return;
        }
        if (action === "add-person") {
            adicionarResponsavelViatura(viaturaId, tipo, actionButton.dataset.nome || "");
            return;
        }
        if (action === "remove-person") {
            removerResponsavelViatura(viaturaId, tipo, actionButton.dataset.index);
            return;
        }
    }

    const removeButton = event.target.closest(".admin-remove-person-btn");
    if (removeButton) {
        event.preventDefault();
        event.stopPropagation();
        removerResponsavelViatura(
            removeButton.dataset.viaturaId,
            removeButton.dataset.tipo,
            removeButton.dataset.index
        );
        return;
    }

    if (event.target.closest(".admin-people-group-header")) return;
    if (event.target.closest(".admin-person-fields label:first-child")) return;
    document.querySelectorAll(".admin-responsavel-picker").forEach((picker) => {
        picker.hidden = true;
    });
    hideAdminAddResponsavelLists();
});

export function renderAdminHistory() {
    const container = document.getElementById("admin-config-history-list");
    if (!container) return;

    const toggleButton = document.getElementById("btn-toggle-config-history");
    const totalBadge = document.getElementById("history-alteracoes-count");
    const searchTerm = normalizeSearch(document.getElementById("filter-config-history")?.value || "");
    const filteredHistory = searchTerm
        ? state.configHistory.filter((item) => {
            const dateLabel = formatDateTimeBR(item.data);
            const text = [
                item.vistoriador,
                item.email,
                item.data,
                dateLabel,
                item.tipo,
                item.descricao
            ].join(" ");
            return normalizeSearch(text).includes(searchTerm);
        })
        : state.configHistory;

    if (totalBadge) {
        const total = filteredHistory.length;
        const suffix = searchTerm ? ` de ${state.configHistory.length}` : "";
        totalBadge.innerText = `${total}${suffix} ${total === 1 ? "registro" : "registros"}`;
    }

    if (toggleButton) {
        toggleButton.style.display = filteredHistory.length > CONFIG_HISTORY_COLLAPSED_LIMIT ? "inline-flex" : "none";
        toggleButton.textContent = configHistoryShowAll ? "Mostrar menos" : "Exibir todos";
    }

    if (!filteredHistory.length) {
        container.innerHTML = `<p class="admin-history-empty">${searchTerm ? "Nenhuma alteração encontrada." : "Nenhuma alteração registrada."}</p>`;
        return;
    }

    const visibleHistory = configHistoryShowAll
        ? filteredHistory
        : filteredHistory.slice(0, CONFIG_HISTORY_COLLAPSED_LIMIT);

    container.innerHTML = visibleHistory.map(item => `
        <div class="admin-history-row">
            <div class="admin-history-change">
                <strong>${escapeHtml(item.tipo)}</strong>
                <p>${escapeHtml(item.descricao)}</p>
            </div>
            <div class="admin-history-meta">
                <span>${escapeHtml(item.vistoriador || "Não identificado")}</span>
                <small>${escapeHtml(formatDateTimeBR(item.data))}</small>
            </div>
        </div>
    `).join("");
}

export function toggleExibirTodosHistoricoConfig() {
    configHistoryShowAll = !configHistoryShowAll;
    renderAdminHistory();
}

export async function limparHistoricoConfig() {
    if (!state.configHistory.length) return;
    if (!confirm("Deseja limpar todo o histórico de alterações?")) return;

    state.configHistory = [];
    configHistoryShowAll = false;
    await salvarConfiguracoes();
    await carregarConfiguracoes();
    renderAdminHistory();
}

export async function adicionarViatura() {
    const proximoId = String(Math.max(0, ...state.viaturas.map(viatura => Number(viatura.id) || 0)) + 1);
    const nome = `Viatura ${formatTwoDigits(proximoId)}`;
    state.viaturas.push({ id: proximoId, nome, ativa: true });
    ensureViaturaState(proximoId);
    ensureChecklistForViatura(proximoId);
    if (!viaturaResponsaveis[proximoId]) {
        viaturaResponsaveis[proximoId] = { tecnico: "", tecnicoCpf: "", auxiliar: "", auxiliarCpf: "", auxiliares: [] };
    }
    setSelectedViatura(proximoId);
    registrarHistoricoConfig("Viatura adicionada", `${nome} foi adicionada.`);
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function editarNomeViatura(id, nome) {
    const viatura = state.viaturas.find(item => item.id === String(id));
    if (!viatura) return;
    const nomeAnterior = viatura.nome;
    viatura.nome = nome.trim() || `Viatura ${formatTwoDigits(id)}`;
    if (nomeAnterior !== viatura.nome) {
        registrarHistoricoConfig("Viatura renomeada", `${nomeAnterior} foi renomeada para ${viatura.nome}.`);
    }
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function editarResponsavelViatura(id, campo, valor) {
    const viaturaId = String(id);
    if (!viaturaResponsaveis[viaturaId]) {
        viaturaResponsaveis[viaturaId] = { tecnico: "", tecnicoCpf: "", auxiliar: "", auxiliarCpf: "" };
    }
    if (!["tecnico", "tecnicoCpf", "auxiliar", "auxiliarCpf"].includes(campo)) return;
    if (!confirmarResponsavelDuplicado(viaturaId, campo, valor)) {
        refreshAppAfterConfigChange();
        return;
    }
    const labels = {
        tecnico: "Técnico",
        tecnicoCpf: "CPF do técnico",
        auxiliar: "Auxiliar",
        auxiliarCpf: "CPF do auxiliar"
    };
    const anterior = viaturaResponsaveis[viaturaId][campo] || "Vazio";
    const valorLimpo = valor.trim();
    viaturaResponsaveis[viaturaId][campo] = valorLimpo;

    if (campo === "tecnico" && isEmptyResponsavelName(valorLimpo, "Sem técnico")) {
        viaturaResponsaveis[viaturaId].tecnico = "";
        viaturaResponsaveis[viaturaId].tecnicoCpf = "";
        viaturaResponsaveis[viaturaId].tecnicos = [];
    }

    if (campo === "tecnicoCpf" && isEmptyResponsavelName(viaturaResponsaveis[viaturaId].tecnico, "Sem técnico")) {
        viaturaResponsaveis[viaturaId].tecnicoCpf = "";
    }

    if (campo === "tecnico" || campo === "tecnicoCpf") {
        const resp = viaturaResponsaveis[viaturaId];
        if (!Array.isArray(resp.tecnicos)) resp.tecnicos = [];
        if (isEmptyResponsavelName(resp.tecnico, "Sem técnico")) {
            resp.tecnico = "";
            resp.tecnicoCpf = "";
            resp.tecnicos = [];
        } else if (resp.tecnicos.length > 0) {
            resp.tecnicos[0] = { nome: resp.tecnico, cpf: resp.tecnicoCpf };
        } else if (resp.tecnico) {
            resp.tecnicos.push({ nome: resp.tecnico, cpf: resp.tecnicoCpf });
        }
    }

    if (campo === "auxiliar" || campo === "auxiliarCpf") {
        const resp = viaturaResponsaveis[viaturaId];
        if (!Array.isArray(resp.auxiliares)) resp.auxiliares = [];
        if (isEmptyResponsavelName(resp.auxiliar, "Sem auxiliar")) {
            resp.auxiliar = "";
            resp.auxiliarCpf = "";
            resp.auxiliares = [];
        } else if (resp.auxiliares.length > 0) {
            resp.auxiliares[0] = { nome: resp.auxiliar, cpf: resp.auxiliarCpf };
        } else if (resp.auxiliar) {
            resp.auxiliares.push({ nome: resp.auxiliar, cpf: resp.auxiliarCpf });
        }
    }

    const novoValor = viaturaResponsaveis[viaturaId][campo] || "Vazio";
    if (anterior !== novoValor) {
        registrarHistoricoConfig(`${labels[campo]} alterado`, `${getViaturaLabel(viaturaId)}: ${labels[campo]} alterado de "${anterior}" para "${novoValor}".`);
    }
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function alternarViaturaAtiva(id) {
    const viatura = state.viaturas.find(item => item.id === String(id));
    if (!viatura) return;
    viatura.ativa = viatura.ativa === false;

    // Garante que o objeto viatura tenha a propriedade 'ativa' definida explicitamente
    const index = state.viaturas.findIndex(v => v.id === String(id));
    if (index !== -1) {
        state.viaturas[index].ativa = viatura.ativa;
    }

    registrarHistoricoConfig(viatura.ativa ? "Viatura ativada" : "Viatura desativada", `${viatura.nome} foi ${viatura.ativa ? "ativada" : "desativada"}.`);
    if (state.selectedViatura === String(id) && viatura.ativa === false) {
        setSelectedViatura(getActiveViaturas()[0]?.id || id);
    }
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function removerViatura(id) {
    const viaturaId = String(id);
    const index = state.viaturas.findIndex(item => item.id === viaturaId);
    const viatura = state.viaturas[index];
    if (!viatura) return;

    if (!confirm(`Deseja remover ${viatura.nome}?`)) return;

    registrarHistoricoConfig("Viatura removida", `${viatura.nome} foi removida.`);

    state.viaturas.splice(index, 1);
    delete checklistDataByViatura[viaturaId];
    delete viaturaResponsaveis[viaturaId];
    delete state.surveyStatus[viaturaId];
    delete state.epiSurveyStatus[viaturaId];
    delete state.vehicleDamages[viaturaId];
    delete state.tabletDamages[viaturaId];
    delete state.notebookDamages[viaturaId];
    delete state.vistoriaMode[viaturaId];
    delete state.vistoriasLocais[viaturaId];
    delete state.fotosEvidencia[viaturaId];

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
        category === "epis" ? normalizeEmployeeEpiItem(item, index) : resolveChecklistItemData(category, item, viaturaId, index)
    )));

    container.innerHTML = items.map((item, index) => {
        const ultimaSubstituicao = item.substituicoes?.at?.(-1);
        const nota = ultimaSubstituicao
            ? `<span class="substitution-note">Substituiu "${escapeHtml(ultimaSubstituicao.itemAnterior)}" em ${escapeHtml(ultimaSubstituicao.data)}</span>`
            : "";
        const quantidade = Number(item.quantidade || 1);
        const valor = Number(item.valor || 0);
        const total = getAdminItemTotal(quantidade, valor);

        return `
            <div class="admin-config-row admin-checklist-row ${item.ativo === false ? "inactive" : ""}">
                <div class="admin-checklist-fields">
                    <label class="admin-checklist-name-field">
                        <span>Item</span>
                        <input type="text" value="${escapeHtml(getItemName(item))}" onchange="editarItemChecklist('${viaturaId}', '${category}', ${index}, 'nome', this.value, '${escapeJsString(pessoaKey)}')">
                    </label>
                    <label>
                        <span>Qtd</span>
                        <input type="number" id="admin-checklist-qtd-${index}" min="0" step="1" value="${quantidade}" oninput="atualizarTotalItemChecklistAdmin(${index})" onchange="editarItemChecklist('${viaturaId}', '${category}', ${index}, 'quantidade', this.value, '${escapeJsString(pessoaKey)}')">
                    </label>
                    <label>
                        <span>Valor</span>
                        <input type="number" id="admin-checklist-valor-${index}" min="0" step="0.01" value="${valor.toFixed(2)}" oninput="atualizarTotalItemChecklistAdmin(${index})" onchange="editarItemChecklist('${viaturaId}', '${category}', ${index}, 'valor', this.value, '${escapeJsString(pessoaKey)}')">
                    </label>
                    <label>
                        <span>Total</span>
                        <input type="text" id="admin-checklist-total-${index}" value="${escapeHtml(formatCurrency(total))}" readonly>
                    </label>
                    <label>
                        <span>C.A.</span>
                        <input type="text" value="${escapeHtml(item.ca || "")}" onchange="editarItemChecklist('${viaturaId}', '${category}', ${index}, 'ca', this.value, '${escapeJsString(pessoaKey)}')" placeholder="Certificado de aprovação">
                    </label>
                </div>
                <div class="admin-config-actions">
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

export function renderAdminFilterViaturaOptions() {
    const select = document.getElementById("filter-viatura");
    if (!select) return;

    const valorAtual = select.value;
    select.innerHTML = `<option value="">Todas</option>` + state.viaturas.map(viatura => `
        <option value="${viatura.id}">${escapeHtml(viatura.nome)}</option>
    `).join("");
    select.value = [...select.options].some(o => o.value === valorAtual) ? valorAtual : "";
}

function syncFuncionarioExtraEpis(funcionario, oldKey = "") {
    if (oldKey && oldKey !== getFuncionarioKeyFromFields(funcionario.nome, funcionario.cpf)) {
        delete employeeEpisByPerson[oldKey];
    }
    employeeEpisByPerson[getFuncionarioKeyFromFields(funcionario.nome, funcionario.cpf)] = cloneEmployeeEpis(funcionario.epis || []);
}

function requireAlissonAdmin() {
    if (isAlissonAdmin()) return true;
    alert("Somente Alisson pode gerenciar funcionários e vistoriadores.");
    renderAdminFuncionariosExtras();
    return false;
}

function getFuncionarioExtra(index) {
    return funcionariosExtras[Number(index)] || null;
}

export function showAdminPeopleTab(tab) {
    ["funcionarios", "vistoriadores"].forEach(item => {
        document.getElementById(`admin-people-tab-${item}`)?.classList.toggle("active", tab === item);
        document.getElementById(`admin-people-panel-${item}`)?.classList.toggle("active", tab === item);
    });
}

export function renderAdminFuncionariosExtras() {
    const manager = document.getElementById("admin-funcionarios-manager");
    const blocked = document.getElementById("admin-funcionarios-alisson-only");
    const list = document.getElementById("admin-funcionarios-list");
    if (!manager || !blocked || !list) return;

    const canManage = isAlissonAdmin();
    blocked.style.display = canManage ? "none" : "block";
    manager.style.display = canManage ? "block" : "none";
    if (!canManage) return;

    const visibleFuncionarios = funcionariosExtras
        .map((f, i) => ({ ...f, originalIndex: i }))
        .filter(f => !f.finalizado);

    if (!visibleFuncionarios.length) {
        list.innerHTML = '<p class="admin-history-empty">Nenhum funcionário pendente de cadastro.</p>';
        return;
    }

    list.innerHTML = visibleFuncionarios.map((funcionario) => {
        const index = funcionario.originalIndex;
        const epis = Array.isArray(funcionario.epis) ? funcionario.epis : [];
        return `
            <div class="admin-employee-draft">
                <section class="admin-employee-card-panel">
                    <div class="admin-panel-heading">
                        <span class="admin-section-icon small" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg>
                        </span>
                        <h4>Dados do Funcionário</h4>
                    </div>
                    <div class="admin-employee-data-grid">
                        <label>
                            <span>Nome</span>
                            <input type="text" value="${escapeHtml(funcionario.nome || "")}" onchange="editarFuncionarioExtra(${index}, 'nome', this.value)">
                        </label>
                        <label>
                            <span>CPF</span>
                            <input type="text" value="${escapeHtml(funcionario.cpf || "")}" onchange="editarFuncionarioExtra(${index}, 'cpf', this.value)">
                        </label>
                        <label>
                            <span>Função</span>
                            <select onchange="editarFuncionarioExtra(${index}, 'funcao', this.value)">
                                <option value="Técnico" ${funcionario.funcao === "Técnico" ? "selected" : ""}>Técnico</option>
                                <option value="Auxiliar técnico" ${funcionario.funcao === "Auxiliar técnico" ? "selected" : ""}>Auxiliar técnico</option>
                            </select>
                        </label>
                        <label>
                            <span>Status</span>
                            <select onchange="editarFuncionarioExtra(${index}, 'status', this.value)">
                                ${["Ativo", "Férias", "Folga", "Atestado", "Falta"].map(status => `
                                    <option value="${status}" ${funcionario.status === status ? "selected" : ""}>${status}</option>
                                `).join("")}
                            </select>
                        </label>
                    </div>
                    <div class="admin-employee-card-actions">
                        <button type="button" class="btn-submit" onclick="finalizarCadastroFuncionarioExtra(${index})">Salvar</button>
                        <button type="button" class="btn-danger" onclick="removerFuncionarioExtra(${index})">Remover</button>
                    </div>
                </section>
                <section class="admin-employee-card-panel">
                    <div class="admin-panel-heading">
                        <span class="admin-section-icon small" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 2.8 8.2 7 10 4.2-1.8 7-5.5 7-10V6z"></path></svg>
                        </span>
                        <h4>EPIs do Funcionário</h4>
                    </div>
                    <div class="admin-extra-epi-form admin-employee-epi-form">
                        <input type="number" id="extra-epi-qtd-${index}" min="1" step="1" value="1" aria-label="Quantidade">
                        <input type="text" id="extra-epi-nome-${index}" value="" placeholder="Nome do EPI" autocomplete="new-password">
                        <input type="text" id="extra-epi-ca-${index}" value="" placeholder="C.A." autocomplete="new-password">
                        <input type="text" id="extra-epi-entrega-${index}" value="" placeholder="dd/mm/aaaa" autocomplete="new-password">
                        <input type="text" id="extra-epi-obs-${index}" value="" placeholder="Observações (opcional)" autocomplete="new-password">
                        <button type="button" onclick="adicionarEpiFuncionarioExtra(${index})">Salvar EPI</button>
                    </div>
                    <div class="admin-extra-epi-list admin-employee-epi-list">
                        ${epis.length ? epis.map((epi, epiIndex) => `
                            <div class="admin-extra-epi-row admin-employee-epi-row">
                                <input type="number" min="1" step="1" value="${Number(epi.quantidade || 1)}" placeholder="Qtd" onchange="editarEpiFuncionarioExtra(${index}, ${epiIndex}, 'quantidade', this.value)" aria-label="Quantidade do EPI">
                                <input type="text" value="${escapeHtml(epi.nome || "")}" placeholder="Descrição do item" autocomplete="new-password" onchange="editarEpiFuncionarioExtra(${index}, ${epiIndex}, 'nome', this.value)" aria-label="Nome do EPI">
                                <input type="text" value="${escapeHtml(epi.ca || "")}" placeholder="C.A." autocomplete="new-password" onchange="editarEpiFuncionarioExtra(${index}, ${epiIndex}, 'ca', this.value)" aria-label="CA do EPI">
                                <input type="text" value="${escapeHtml(epi.dataEntrega || "")}" placeholder="Data de entrega" autocomplete="new-password" onchange="editarEpiFuncionarioExtra(${index}, ${epiIndex}, 'dataEntrega', this.value)" aria-label="Data de entrega do EPI">
                                <input type="text" value="${escapeHtml(epi.observacao || "")}" placeholder="OBS" autocomplete="new-password" onchange="editarEpiFuncionarioExtra(${index}, ${epiIndex}, 'observacao', this.value)" aria-label="Observação do EPI">
                                <button type="button" class="btn-danger" onclick="removerEpiFuncionarioExtra(${index}, ${epiIndex})">Remover EPI</button>
                            </div>
                        `).join("") : `
                            <div class="admin-employee-empty-epis">
                                <span aria-hidden="true">▱</span>
                                <strong>Nenhum EPI cadastrado para este funcionário.</strong>
                                <p>Adicione os EPIs utilizados por este funcionário.</p>
                            </div>
                        `}
                    </div>
                </section>
            </div>
        `;
    }).join("");
}

export function renderAdminVistoriadores() {
    const list = document.getElementById("admin-vistoriadores-list");
    if (!list) return;

    const permissionHeader = renderVistoriadorPermissionHeaders();
    list.innerHTML = `
        <div class="admin-vistoriadores-table">
            <div class="admin-vistoriador-row admin-vistoriador-head">
                <span>Vistoriador</span>
                <span>E-mail</span>
                ${permissionHeader}
                <span>Ações</span>
            </div>
            ${vistoriadores.map(vistoriador => renderVistoriadorRow(vistoriador)).join("")}
        </div>
    `;
}

function getVistoriadorPermissionLabel(category) {
    const labels = {
        todas: "Todas as categorias",
        ferramentas: "Ferramentas",
        epis: "EPI",
        viaturas: "Viaturas",
        tablets: "Tablets",
        notebooks: "Notebooks"
    };
    return labels[category] || categoryNames[category] || category;
}

function renderVistoriadorPermissionCheckbox({ id, checked, onchange, label, compact = false }) {
    return `
        <label class="admin-permission-check ${compact ? "compact" : ""}" title="${escapeHtml(label)}">
            <input type="checkbox" ${id ? `id="${escapeHtml(id)}"` : ""} ${checked ? "checked" : ""} onchange="${onchange}">
            <span>${escapeHtml(label)}</span>
        </label>
    `;
}

function renderVistoriadorPermissionHeaders() {
    return ["todas", ...vistoriadorPermissionCategories].map(category => `
        <span class="admin-vistoriador-permission-head">${escapeHtml(getVistoriadorPermissionLabel(category))}</span>
    `).join("");
}

function renderVistoriadorRow(vistoriador) {
    const permissoes = normalizeVistoriadorPermissoes(vistoriador);
    const hasAll = vistoriadorPermissionCategories.every(category => permissoes.includes(category));
    return `
        <div class="admin-vistoriador-row">
            <div class="admin-vistoriador-person">
                <span class="admin-vistoriador-avatar">${escapeHtml(getInitials(vistoriador.nome))}</span>
                <span>
                    <strong>${escapeHtml(vistoriador.nome)}</strong>
                    <small>${isAlissonVistoriadorAdmin(vistoriador) ? "Admin" : "Padrão"}</small>
                </span>
            </div>
            <span class="admin-vistoriador-email">${escapeHtml(vistoriador.email)}</span>
            ${renderVistoriadorPermissionCheckbox({
                checked: hasAll,
                onchange: `alterarPermissoesVistoriador('${escapeJsString(vistoriador.id)}', 'todas', this.checked)`,
                label: "Todas as categorias",
                compact: true
            })}
            ${vistoriadorPermissionCategories.map(category => renderVistoriadorPermissionCheckbox({
                checked: permissoes.includes(category),
                onchange: `alterarPermissoesVistoriador('${escapeJsString(vistoriador.id)}', '${category}', this.checked)`,
                label: getVistoriadorPermissionLabel(category),
                compact: true
            })).join("")}
            <div class="admin-config-actions">
                <button type="button" class="btn-danger" onclick="removerVistoriador('${escapeJsString(vistoriador.id)}')">Remover</button>
            </div>
        </div>
    `;
}

function getInitials(name = "") {
    return String(name || "")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part[0] || "")
        .join("")
        .toUpperCase() || "VT";
}

function isAlissonVistoriadorAdmin(vistoriador = {}) {
    return String(vistoriador.nome || "").trim().toLowerCase() === "alisson"
        || String(vistoriador.email || "").trim().toLowerCase() === "alisson.tavares@digitalonline.com.br";
}

export async function alterarPermissoesVistoriador(id, category, checked) {
    if (!requireAlissonAdmin()) return;
    const vistoriador = vistoriadores.find(item => item.id === id);
    if (!vistoriador) return;

    const permissoes = new Set(normalizeVistoriadorPermissoes(vistoriador));
    if (category === "todas") {
        permissoes.clear();
        if (checked) vistoriadorPermissionCategories.forEach(item => permissoes.add(item));
    } else if (checked) {
        permissoes.add(category);
    } else {
        permissoes.delete(category);
    }

    vistoriador.permissoes = [...permissoes].filter(item => vistoriadorPermissionCategories.includes(item));
    vistoriador.tipo = vistoriador.permissoes.length === 1 && vistoriador.permissoes[0] === "tablets" ? "tablets" : "geral";
    syncVistoriadoresTablet();
    registrarHistoricoConfig("Permissões de vistoriador alteradas", `${vistoriador.nome}: ${vistoriador.permissoes.map(getVistoriadorPermissionLabel).join(", ") || "sem categorias"}.`);
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
    renderAdminVistoriadores();
}

function normalizeAdminEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function clearVistoriadorForm() {
    ["admin-vistoriador-nome", "admin-vistoriador-email", "admin-vistoriador-senha"].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = "";
    });
}

async function salvarNovoVistoriador({ nome, email, permissoes }) {
    const vistoriador = normalizeVistoriador({
        id: `vistoriador-${Date.now()}`,
        nome,
        email,
        tipo: permissoes.length === 1 && permissoes[0] === "tablets" ? "tablets" : "geral",
        permissoes,
        padrao: false
    }, vistoriadores.length);
    vistoriadores.push(vistoriador);
    syncVistoriadoresTablet();
    registrarHistoricoConfig("Vistoriador adicionado", `${nome} foi adicionado com permissões: ${permissoes.map(getVistoriadorPermissionLabel).join(", ")}.`);
    await salvarConfiguracoes();
    clearVistoriadorForm();
    showAdminPeopleTab("vistoriadores");
    refreshAppAfterConfigChange();
    renderAdminVistoriadores();
}

export async function adicionarVistoriador() {
    if (!requireAlissonAdmin()) return;

    const nome = document.getElementById("admin-vistoriador-nome")?.value.trim() || "";
    const email = normalizeAdminEmail(document.getElementById("admin-vistoriador-email")?.value || "");
    const senha = document.getElementById("admin-vistoriador-senha")?.value || "";
    const permissoes = [...vistoriadorPermissionCategories];

    if (!nome || !email || !senha) {
        alert("Informe nome, e-mail e senha do novo vistoriador.");
        return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        alert("Informe um e-mail válido para o vistoriador.");
        return;
    }

    if (senha.length < 6) {
        alert("A senha precisa ter pelo menos 6 caracteres.");
        return;
    }

    const vistoriadorComEmail = vistoriadores.find(vistoriador => vistoriador.email === email);
    if (vistoriadorComEmail) {
        alert(`Já existe um vistoriador cadastrado com este e-mail: ${vistoriadorComEmail.nome} (${vistoriadorComEmail.email}).\n\nRemova esse cadastro da lista antes de cadastrar novamente.`);
        return;
    }

    if (vistoriadores.some(vistoriador => vistoriador.nome.toLowerCase() === nome.toLowerCase())) {
        alert("Já existe um vistoriador cadastrado com este nome.");
        return;
    }

    try {
        await criarUsuarioAuthSecundario(email, senha);
        await salvarNovoVistoriador({ nome, email, permissoes });
        alert("Vistoriador criado com sucesso.");
    } catch (error) {
        if (error?.code === "auth/email-already-in-use") {
            if (!confirm("Este e-mail já existe no Firebase Auth. Deseja vincular esse usuário como vistoriador do sistema?")) return;
            await salvarNovoVistoriador({ nome, email, permissoes });
            alert("Vistoriador vinculado ao sistema com sucesso.");
            return;
        }

        console.error("Erro ao criar vistoriador:", error);
        alert(`Erro ao criar vistoriador: ${error?.message || error}`);
    }
}

export async function removerVistoriador(id) {
    if (!requireAlissonAdmin()) return;

    const index = vistoriadores.findIndex(vistoriador => vistoriador.id === id);
    const vistoriador = vistoriadores[index];
    if (!vistoriador) return;

    if (!confirm(`Tem certeza que deseja remover o vistoriador ${vistoriador.nome}?`)) return;

    vistoriadores.splice(index, 1);
    registrarHistoricoConfig("Vistoriador removido", `${vistoriador.nome} foi removido da Gestão de Vistorias.`);
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
    renderAdminVistoriadores();
}

export async function adicionarFuncionarioExtra() {
    if (!requireAlissonAdmin()) return;

    const nomeInput = document.getElementById("admin-funcionario-nome");
    const cpfInput = document.getElementById("admin-funcionario-cpf");
    const funcaoInput = document.getElementById("admin-funcionario-funcao");
    const nome = nomeInput?.value.trim() || "";
    const cpf = cpfInput?.value.trim() || "";
    const funcao = funcaoInput?.value || "Técnico";

    if (!nome || !cpf) {
        alert("Informe o nome e o CPF do funcionário.");
        return;
    }

    if (getFuncionariosData().some(funcionario => onlyDigits(funcionario.cpf) === onlyDigits(cpf))) {
        if (!confirm("Já existe um funcionário com este CPF. Deseja cadastrar mesmo assim?")) return;
    }

    const funcionario = {
        id: `funcionario-extra-${Date.now()}`,
        nome,
        cpf,
        funcao,
        status: "Ativo",
        viaturaId: "",
        epis: []
    };

    funcionariosExtras.push(funcionario);
    syncFuncionarioExtraEpis(funcionario);
    if (nomeInput) nomeInput.value = "";
    if (cpfInput) cpfInput.value = "";
    registrarHistoricoConfig("Funcionário adicionado", `${nome} foi adicionado como ${funcao}.`);
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function editarFuncionarioExtra(index, campo, valor) {
    if (!requireAlissonAdmin()) return;
    const funcionario = getFuncionarioExtra(index);
    if (!funcionario || !["nome", "cpf", "funcao", "status"].includes(campo)) return;

    const oldKey = getFuncionarioKeyFromFields(funcionario.nome, funcionario.cpf);
    const labels = {
        nome: "Nome",
        cpf: "CPF",
        funcao: "Função",
        status: "Status"
    };
    const anterior = funcionario[campo] || "Vazio";
    funcionario[campo] = String(valor || "").trim();
    if (!funcionario.nome) {
        renderAdminFuncionariosExtras();
        return;
    }

    syncFuncionarioExtraEpis(funcionario, oldKey);
    const novoValor = funcionario[campo] || "Vazio";
    if (anterior !== novoValor) {
        registrarHistoricoConfig("Funcionário alterado", `${funcionario.nome}: ${labels[campo]} alterado de "${anterior}" para "${novoValor}".`);
    }
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function removerFuncionarioExtra(index) {
    if (!requireAlissonAdmin()) return;
    const funcionario = getFuncionarioExtra(index);
    if (!funcionario) return;
    if (!confirm(`Tem certeza que deseja remover ${funcionario.nome}? Esta ação também remove os EPIs cadastrados para essa pessoa.`)) return;

    delete employeeEpisByPerson[getFuncionarioKeyFromFields(funcionario.nome, funcionario.cpf)];
    funcionariosExtras.splice(Number(index), 1);
    registrarHistoricoConfig("Funcionário removido", `${funcionario.nome} foi removido.`);
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function adicionarEpiFuncionarioExtra(index) {
    if (!requireAlissonAdmin()) return;
    const funcionario = getFuncionarioExtra(index);
    if (!funcionario) return;

    const quantidade = Number(document.getElementById(`extra-epi-qtd-${index}`)?.value || 1);
    const nome = document.getElementById(`extra-epi-nome-${index}`)?.value.trim() || "";
    const ca = document.getElementById(`extra-epi-ca-${index}`)?.value.trim() || "";
    const dataEntrega = document.getElementById(`extra-epi-entrega-${index}`)?.value.trim() || "";
    const observacao = document.getElementById(`extra-epi-obs-${index}`)?.value.trim() || "";

    if (!nome) {
        alert("Informe o nome do EPI.");
        return;
    }

    funcionario.epis = Array.isArray(funcionario.epis) ? funcionario.epis : [];
    funcionario.epis.push(normalizeEmployeeEpiItem({
        id: `epi-extra-${Date.now()}`,
        nome,
        quantidade,
        ca,
        dataEntrega,
        observacao,
        ativo: true,
        valor: 0,
        substituicoes: []
    }));
    syncFuncionarioExtraEpis(funcionario);
    registrarHistoricoConfig("EPI adicionado", `${nome} foi adicionado para ${funcionario.nome}.`);

    // Limpar campos de entrada do EPI após adicionar para que "sumam"
    ['qtd', 'nome', 'ca', 'entrega', 'obs'].forEach(field => {
        const input = document.getElementById(`extra-epi-${field}-${index}`);
        if (input) {
            input.value = field === 'qtd' ? "1" : "";
        }
    });

    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function editarEpiFuncionarioExtra(index, epiIndex, campo, valor) {
    if (!requireAlissonAdmin()) return;
    const funcionario = getFuncionarioExtra(index);
    const epi = funcionario?.epis?.[Number(epiIndex)];
    if (!epi || !["quantidade", "nome", "ca", "dataEntrega", "observacao"].includes(campo)) return;

    const labels = {
        quantidade: "Quantidade",
        nome: "Nome",
        ca: "C.A.",
        dataEntrega: "Data de entrega",
        observacao: "Observação"
    };
    const nomeAnterior = epi.nome || "EPI";
    const anterior = epi[campo] || "Vazio";
    epi[campo] = campo === "quantidade" ? Number(valor || 1) : String(valor || "").trim();
    funcionario.epis[Number(epiIndex)] = normalizeEmployeeEpiItem(epi, Number(epiIndex));
    syncFuncionarioExtraEpis(funcionario);
    const novoValor = funcionario.epis[Number(epiIndex)][campo] || "Vazio";
    if (String(anterior) !== String(novoValor)) {
        registrarHistoricoConfig("EPI alterado", `${funcionario.nome}: ${labels[campo]} de "${nomeAnterior}" alterado de "${anterior}" para "${novoValor}".`);
    }
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function finalizarCadastroFuncionarioExtra(index) {
    if (!requireAlissonAdmin()) return;
    const funcionario = getFuncionarioExtra(index);
    if (!funcionario) return;

    if (funcionario.epis.length === 0) {
        if (!confirm(`O funcionário ${funcionario.nome} não possui EPIs cadastrados. Deseja finalizar assim mesmo?`)) return;
    }

    funcionario.finalizado = true;
    registrarHistoricoConfig("Funcionário Cadastrado", `${funcionario.nome} foi oficialmente adicionado ao sistema.`);
    
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
    alert(`Funcionário ${funcionario.nome} salvo com sucesso! Agora ele faz parte do sistema como os outros funcionários.`);
}

export async function removerEpiFuncionarioExtra(index, epiIndex) {
    if (!requireAlissonAdmin()) return;
    const funcionario = getFuncionarioExtra(index);
    if (!funcionario?.epis?.[Number(epiIndex)]) return;
    if (!confirm("Tem certeza que deseja remover este EPI?")) return;

    const epi = funcionario.epis[Number(epiIndex)];
    funcionario.epis.splice(Number(epiIndex), 1);
    syncFuncionarioExtraEpis(funcionario);
    registrarHistoricoConfig("EPI removido", `${epi.nome || "EPI"} foi removido de ${funcionario.nome}.`);
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function adicionarItemChecklist() {
    const category = document.getElementById("admin-item-category")?.value || "ferramentas";
    const viaturaId = document.getElementById("admin-item-viatura")?.value || state.selectedViatura;
    const pessoaKey = category === "epis" ? (document.getElementById("admin-item-pessoa")?.value || "") : "";
    const input = document.getElementById("admin-item-name");
    const nome = input?.value.trim();
    const quantidade = parseNumberField(document.getElementById("admin-item-quantity")?.value, 1);
    const valor = parseNumberField(document.getElementById("admin-item-value")?.value, 0);
    const ca = document.getElementById("admin-item-ca")?.value.trim() || "";
    if (!nome) {
        alert("Informe o nome do item.");
        return;
    }

    const normalizeItem = category === "epis" ? normalizeEmployeeEpiItem : normalizeChecklistItem;
    getChecklistItemsForPessoa(category, viaturaId, pessoaKey).push(normalizeItem({
        id: `item-${Date.now()}`,
        nome,
        ativo: true,
        quantidade,
        valor,
        ca,
        substituicoes: []
    }));
    if (input) input.value = "";
    const quantityInput = document.getElementById("admin-item-quantity");
    const valueInput = document.getElementById("admin-item-value");
    const caInput = document.getElementById("admin-item-ca");
    if (quantityInput) quantityInput.value = "1";
    if (valueInput) valueInput.value = "0";
    if (caInput) caInput.value = "";
    atualizarTotalNovoItemChecklist();
    registrarHistoricoConfig("Item adicionado", `${nome} foi adicionado em ${getChecklistHistoryContext(viaturaId, category, pessoaKey)}.`);
    await salvarConfiguracoes();
    setSelectedViatura(viaturaId);
    window.sincronizarItemAdicionadoChecklist?.({ category, viaturaId, pessoaKey });
    refreshAppAfterConfigChange();
}

export async function editarItemChecklist(viaturaId, category, index, campo, valor, pessoaKey = "") {
    const items = getChecklistItemsForPessoa(category, viaturaId, pessoaKey);
    items[index] = category === "epis" ? normalizeEmployeeEpiItem(items[index], index) : normalizeChecklistItem(items[index], index);
    const allowedFields = ["nome", "quantidade", "valor", "ca"];
    if (!allowedFields.includes(campo)) return;

    const labels = {
        nome: "Nome",
        quantidade: "Quantidade",
        valor: "Valor",
        ca: "C.A."
    };
    const anterior = items[index][campo];
    if (campo === "nome") {
        items[index].nome = String(valor || "").trim() || items[index].nome;
    } else if (campo === "quantidade") {
        items[index].quantidade = parseNumberField(valor, 1);
    } else if (campo === "valor") {
        items[index].valor = parseNumberField(valor, 0);
    } else {
        items[index].ca = String(valor || "").trim();
    }

    if (String(anterior ?? "") !== String(items[index][campo] ?? "")) {
        registrarHistoricoConfig("Item alterado", `${getChecklistHistoryContext(viaturaId, category, pessoaKey)}: ${labels[campo]} de "${items[index].nome}" alterado de "${anterior || "Vazio"}" para "${items[index][campo] || "Vazio"}".`);
    }
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function alternarItemChecklist(viaturaId, category, index, pessoaKey = "") {
    const items = getChecklistItemsForPessoa(category, viaturaId, pessoaKey);
    items[index] = category === "epis" ? normalizeEmployeeEpiItem(items[index], index) : normalizeChecklistItem(items[index], index);
    items[index].ativo = items[index].ativo === false;
    registrarHistoricoConfig(
        items[index].ativo ? "Item ativado" : "Item desativado",
        `${getChecklistHistoryContext(viaturaId, category, pessoaKey)}: "${items[index].nome}" foi ${items[index].ativo ? "ativado" : "desativado"}.`
    );
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function removerItemChecklist(viaturaId, category, index, pessoaKey = "") {
    if (!confirm("Deseja remover este item do checklist?")) return;
    const items = getChecklistItemsForPessoa(category, viaturaId, pessoaKey);
    const [removido] = items.splice(index, 1);
    registrarHistoricoConfig("Item removido", `${removido?.nome || "Item"} foi removido de ${getChecklistHistoryContext(viaturaId, category, pessoaKey)}.`);
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

    if (!Array.isArray(item.substituicoes)) item.substituicoes = [];
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

function atualizarHistoricoComSnapshot(querySnapshot) {
    const tbody = document.getElementById("history-tbody");
    if (!tbody) return;

    tbody.innerHTML = "";
    state.vistoriasCache = [];

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
}

export async function carregarHistorico() {
    const tbody = document.getElementById("history-tbody");
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Carregando...</td></tr>';
    state.selectedVistorias.clear();
    atualizarContadorSelecionadas();

    if (historyUnsubscribe) {
        historyUnsubscribe();
        historyUnsubscribe = null;
    }

    return new Promise((resolve) => {
        const q = query(collection(db, "vistorias"), orderBy("dataEnvio", "desc"));
        let resolved = false;

        historyUnsubscribe = onSnapshot(q, (querySnapshot) => {
            atualizarHistoricoComSnapshot(querySnapshot);
            if (!resolved) {
                resolved = true;
                resolve();
            }
        }, (error) => {
            console.error("Erro ao buscar histórico:", error);
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Erro ao carregar dados.</td></tr>';
            if (!resolved) {
                resolved = true;
                resolve();
            }
        });
    });
}

export function aplicarFiltros() {
    const busca = (document.getElementById("filter-history-search")?.value || "").trim().toLowerCase();
    const tipoVistoria = document.getElementById("filter-tipo-vistoria")?.value || "";
    const categoria = document.getElementById("filter-categoria")?.value || "";
    const vistoriador = document.getElementById("filter-vistoriador")?.value || "";
    const viaturaId = document.getElementById("filter-viatura")?.value || "";
    const dataInicio = document.getElementById("filter-data-inicio")?.value || "";
    const dataFim = document.getElementById("filter-data-fim")?.value || "";
    const status = document.getElementById("filter-status")?.value || "";

    if (vistoriador) window.sincronizarVistoriadorLogado?.(vistoriador);

    let filtrados = state.vistoriasCache;

    if (busca) {
        filtrados = filtrados.filter(v => {
            const texto = [
                v.vistoriador,
                v.tipoVistoria || "parcial",
                getViaturaLabel(v.viaturaId),
                getCategoriaHistoricoLabel(v),
                getStatusVistoria(v)
            ].join(" ").toLowerCase();
            return texto.includes(busca);
        });
    }
    if (tipoVistoria) filtrados = filtrados.filter(v => String(v.tipoVistoria || "parcial").toLowerCase() === tipoVistoria);
    if (categoria) filtrados = filtrados.filter(v => String(v.categoria || "").toLowerCase() === categoria);
    if (vistoriador) filtrados = filtrados.filter(v => v.vistoriador === vistoriador);
    if (viaturaId) filtrados = filtrados.filter(v => String(v.viaturaId) === String(viaturaId));
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
    historicoFiltradoAtual = filtrados;
    historicoVisibleCount = HISTORICO_INITIAL_VISIBLE;
    renderHistoricoTable(filtrados);
}

export function limparFiltrosHistoricoVistorias() {
    [
        "filter-history-search",
        "filter-tipo-vistoria",
        "filter-categoria",
        "filter-vistoriador",
        "filter-viatura",
        "filter-data-inicio",
        "filter-data-fim",
        "filter-status"
    ].forEach(id => {
        const field = document.getElementById(id);
        if (field) field.value = "";
    });
    state.selectedVistorias.clear();
    const selectAll = document.getElementById("select-all-vistorias");
    if (selectAll) selectAll.checked = false;
    aplicarFiltros();
}

/**
 * Helper para converter Timestamps do Firebase ou strings em objetos Date.
 */
function converterParaData(valor) {
    if (!valor) return null;
    if (typeof valor.toDate === "function") return valor.toDate();
    const d = new Date(valor);
    return isNaN(d.getTime()) ? null : d;
}

function getDataReferenciaFiltro(vistoria) {
    if (vistoria.pendenciaResolvida?.resolvida) {
        return converterParaData(vistoria.pendenciaResolvida.dataResolucao)
            || converterParaData(vistoria.dataEnvio)
            || new Date();
    }

    return converterParaData(vistoria.dataEnvio) || new Date();
}

function getStatusVistoria(vistoria) {
    if (vistoria.pendenciaResolvida?.resolvida) return "resolvida";
    if (vistoriaTemPendencia(vistoria)) return "pendente";
    return "ok";
}

function getStatusHistoricoLabel(status) {
    const labels = {
        ok: "Tudo OK",
        pendente: "Pendência",
        resolvida: "Pendência resolvida"
    };
    return labels[status] || "Tudo OK";
}

function vistoriaTemPendencia(vistoria) {
    if (vistoria.pendenciaResolvida?.resolvida) return false;

    const itens = Array.isArray(vistoria.itens) ? vistoria.itens : [];
    const temItemPendente = itens.some(i => i.status !== "ok");
    const temAvariaVisual = Array.isArray(vistoria.avarias) && vistoria.avarias.length > 0;
    const temAvariaTablet = Array.isArray(vistoria.avariasTablet) && vistoria.avariasTablet.length > 0;
    const temAvariaNotebook = Array.isArray(vistoria.avariasNotebook) && vistoria.avariasNotebook.length > 0;
    return temItemPendente || temAvariaVisual || temAvariaTablet || temAvariaNotebook;
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
    const dadosAgrupados = agruparVistoriasHistorico(dados);
    const total = dadosAgrupados.length;
    const pendentes = dadosAgrupados.filter((vistoria) => (
        vistoria.grouped ? vistoria.statusGroup === "pendente" : vistoriaTemPendencia(vistoria)
    )).length;

    const totalBadge = document.getElementById("history-vistorias-count");
    if (totalBadge) totalBadge.innerText = `${total} ${total === 1 ? "registro" : "registros"}`;
    if (document.getElementById("stat-total")) document.getElementById("stat-total").innerText = total;
    if (document.getElementById("stat-pending")) document.getElementById("stat-pending").innerText = pendentes;
    if (document.getElementById("stat-ok")) document.getElementById("stat-ok").innerText = total - pendentes;
    const users = document.getElementById("stat-users");
    if (users) users.innerText = vistoriadores.length;
}

function renderHistoricoTable(dados) {
    const tbody = document.getElementById("history-tbody");
    tbody.innerHTML = "";

    if (dados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Nenhuma vistoria encontrada com os filtros aplicados.</td></tr>';
        renderHistoricoPager(0, 0);
        return;
    }

    const dadosAgrupados = agruparVistoriasHistorico(dados);
    const limiteDisponivel = Math.min(dadosAgrupados.length, HISTORICO_MAX_VISIBLE);
    const quantidadeVisivel = Math.min(historicoVisibleCount, limiteDisponivel);
    const dadosVisiveis = dadosAgrupados.slice(0, quantidadeVisivel);

    dadosVisiveis.forEach((data) => {
        const dateObj = getDataReferenciaFiltro(data);
        const viaturaLabel = data.categoria === "notebooks"
            ? "Vistoria"
            : getViaturaLabel(data.viaturaId);

        const tipoVistoriaLabel = (data.tipoVistoria || "").toString().toUpperCase() || "PARCIAL";
        const tipoClass = tipoVistoriaLabel === "COMPLETA" ? "complete" : "partial";
        const todasCategoriasLabel = getCategoriaHistoricoLabel(data);
        const checkboxChecked = (data.ids || [data.id]).every(id => state.selectedVistorias.has(id));
        const status = data.grouped ? (data.statusGroup || "ok") : getStatusVistoria(data);
        const statusLabel = getStatusHistoricoLabel(status);

        tbody.innerHTML += `
            <tr onclick="verDetalhes('${data.id}')">
                <td onclick="event.stopPropagation();">
                    <input type="checkbox" class="history-select" value="${data.id}" ${checkboxChecked ? "checked" : ""} onchange="toggleSelecionarVistoria('${data.id}', this.checked)">
                </td>
                <td><span class="history-type-badge ${tipoClass}">${tipoVistoriaLabel}</span></td>
                <td>${escapeHtml(viaturaLabel)}</td>
                <td>${escapeHtml(todasCategoriasLabel)}</td>
                <td>${dateObj.toLocaleString("pt-BR")}</td>
                <td><span class="status-${status}">${escapeHtml(statusLabel)}</span></td>
                <td class="history-actions-cell" onclick="event.stopPropagation();">
                    <button type="button" class="history-row-action" onclick="verDetalhes('${data.id}')" aria-label="Ver detalhes">Detalhes</button>
                </td>
            </tr>
        `;
    });
    renderHistoricoPager(dadosVisiveis.length, dadosAgrupados.length);
    atualizarContadorSelecionadas();
}

function renderHistoricoPager(visibleCount, totalCount) {
    const displayTotal = Math.min(totalCount, HISTORICO_MAX_VISIBLE);
    const hasMore = visibleCount < displayTotal;
    const canShowLess = visibleCount > HISTORICO_INITIAL_VISIBLE;
    const tableScroll = document.querySelector("#history-tbody")?.closest(".table-scroll");
    if (!tableScroll) return;

    let pager = document.getElementById("history-load-more");
    if (!pager) {
        pager = document.createElement("div");
        pager.id = "history-load-more";
        pager.className = "history-load-more";
        tableScroll.insertAdjacentElement("afterend", pager);
    }

    pager.innerHTML = totalCount > HISTORICO_INITIAL_VISIBLE
        ? `
            <span>Mostrando ${visibleCount} de ${displayTotal} registros${totalCount > HISTORICO_MAX_VISIBLE ? " mais recentes" : ""}.</span>
            <button type="button" onclick="exibirMenosHistoricoVistorias()" ${canShowLess ? "" : "disabled"}>Exibir menos</button>
            ${hasMore ? '<button type="button" onclick="toggleExibirTodosHistoricoVistorias()">Exibir mais</button>' : ""}
        `
        : "";
    pager.style.display = pager.innerHTML ? "flex" : "none";
}

export function toggleExibirTodosHistoricoVistorias() {
    const totalAgrupado = agruparVistoriasHistorico(historicoFiltradoAtual).length;
    const limiteDisponivel = Math.min(totalAgrupado, HISTORICO_MAX_VISIBLE);
    historicoVisibleCount = Math.min(historicoVisibleCount + HISTORICO_PAGE_SIZE, limiteDisponivel);
    renderHistoricoTable(historicoFiltradoAtual);
}

export function exibirMenosHistoricoVistorias() {
    historicoVisibleCount = Math.max(historicoVisibleCount - HISTORICO_PAGE_SIZE, HISTORICO_INITIAL_VISIBLE);
    renderHistoricoTable(historicoFiltradoAtual);
}

export function toggleSelecionarVistoria(id, checked) {
    const group = historicoGroups[id];
    const idsToToggle = group ? group.ids : [id];
    idsToToggle.forEach((itemId) => {
        if (checked) state.selectedVistorias.add(itemId);
        else state.selectedVistorias.delete(itemId);
    });
    atualizarContadorSelecionadas();
}

export function toggleSelecionarTodasVistorias(checked) {
    document.querySelectorAll(".history-select").forEach(checkbox => {
        checkbox.checked = checked;
        toggleSelecionarVistoria(checkbox.value, checked);
    });
}

function atualizarContadorSelecionadas() {
    const countedIds = new Set();
    let count = 0;

    Object.values(historicoGroups).forEach((group) => {
        if (group.ids.length > 0 && group.ids.every(id => state.selectedVistorias.has(id))) {
            count += 1;
            group.ids.forEach(id => countedIds.add(id));
        }
    });

    state.selectedVistorias.forEach((id) => {
        if (!countedIds.has(id)) count += 1;
    });

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

        let selecionadas = ids
            .map(id => state.vistoriasCache.find(vistoria => vistoria.id === id))
            .filter(Boolean);

        if (selecionadas.length === 0) {
            alert("Nenhuma vistoria válida foi selecionada no histórico carregado.");
            return;
        }

        const pdfManuais = selecionadas.filter(v => v.categoria === "manuais_pdf");
        if (pdfManuais.length > 0) {
            alert(`Atenção: ${pdfManuais.length} PDF(s) de manual foram selecionados, mas o sistema não armazena o conteúdo desses arquivos. Apenas os PDFs gerados a partir de vistorias de checklist podem ser baixados.`);
            selecionadas = selecionadas.filter(v => v.categoria !== "manuais_pdf");
        }
        if (selecionadas.length === 0) return;
        const exportButton = document.querySelector(".btn-export-selected");
        if (exportButton) exportButton.disabled = true;

        const selectedSet = new Set(selecionadas.map(v => v.id));
        const gruposCompleto = [];
        const handledIds = new Set();

        Object.values(historicoGroups).forEach((group) => {
            if (group.ids.every(id => selectedSet.has(id))) {
                gruposCompleto.push(group);
                group.ids.forEach(id => handledIds.add(id));
            }
        });

        let exportCount = 0;

        for (const group of gruposCompleto) {
            const representative = group.representative || group.docs[0];
            const categorias = [...new Set(group.docs.map(v => v.categoria))];
            const isNotebookGroup = categorias.includes("notebooks") && categorias.length === 1;
            const viaturaId = representative.viaturaId;
            const equipamento = isNotebookGroup
                ? "Vistoria"
                : `Viatura_${formatTwoDigits(viaturaId)}`;
            const data = (representative.dataEnvio?.toDate?.() || new Date()).toISOString().slice(0, 10);

            await gerarPDF(`Relatorio_${equipamento}_Completa_${data}`, group.docs, {
                reportName: isNotebookGroup ? "Vistoria - Completa" : `${getViaturaLabel(viaturaId)} - Vistoria completa`,
                tipoVistoria: "completa",
                categorias
            });
            exportCount += 1;
        }

        const remaining = selecionadas.filter(v => !handledIds.has(v.id));
        for (const vistoria of remaining) {
            const isNotebook = vistoria.categoria === "notebooks";
            const equipamento = vistoria.categoria === "tablets"
                ? `Tablet_${formatTwoDigits(vistoria.tabletId || vistoria.viaturaId)}_Viatura_${formatTwoDigits(vistoria.viaturaId)}`
                : isNotebook
                    ? "Vistoria"
                    : `Viatura_${formatTwoDigits(vistoria.viaturaId)}`;
            const categoria = vistoria.categoria === "todas"
                ? "Completa"
                : (categoryNames[vistoria.categoria] || vistoria.categoria);
            const data = (vistoria.dataEnvio?.toDate?.() || new Date()).toISOString().slice(0, 10);

            await gerarPDF(`Relatorio_${equipamento}_${categoria}_${data}`, [vistoria], {
                reportName: `${equipamento.replace(/_/g, " ")} - ${categoria}`,
                tipoVistoria: vistoria.tipoVistoria || "parcial",
                categorias: [vistoria.categoria]
            });
            exportCount += 1;
        }

        alert(`${exportCount} PDF${exportCount === 1 ? "" : "s"} baixado${exportCount === 1 ? "" : "s"} com sucesso.`);
    } catch (error) {
        console.error("Erro ao baixar PDFs selecionados:", error);
        alert(`Erro ao baixar PDFs selecionados: ${error?.message || error}`);
    } finally {
        const exportButton = document.querySelector(".btn-export-selected");
        if (exportButton) exportButton.disabled = false;
    }
}

export function verDetalhes(docId) {
    const vistoria = findVistoriaById(docId);
    if (!vistoria) return;

    const modal = document.getElementById("details-modal");
    const body = document.getElementById("modal-body");
    const title = document.getElementById("modal-title");

    const equipamentoTitulo = vistoria.categoria === "tablets"
        ? `Tablet ${vistoria.tabletId || vistoria.viaturaId}`
        : vistoria.categoria === "notebooks"
            ? "Vistoria"
            : `Viatura ${vistoria.viaturaId}`;
    const categoriaTitulo = vistoria.categoria === "todas"
        ? "Vistoria completa"
        : (categoryNames[vistoria.categoria] || vistoria.categoria);
    title.innerText = `Detalhes: ${categoriaTitulo} - ${equipamentoTitulo}`;

    const itens = Array.isArray(vistoria.itens) ? vistoria.itens : [];
    const pendentes = itens.filter(i => i.status !== "ok");

    let html = `<p><strong>Vistoriador:</strong> ${vistoria.vistoriador}</p>`;
    if (vistoria.categoria === "manuais_pdf" && vistoria.nomeArquivo) {
        const linkHtml = vistoria.urlArquivo
            ? `<a href="${vistoria.urlArquivo}" target="_blank" class="btn-admin-pdf" style="display:inline-block; margin-top:10px; padding: 5px 10px; text-decoration:none;">📄 Abrir Arquivo PDF</a>`
            : `<br><small style="color: #e53e3e;">(Arquivo físico não disponível no servidor)</small>`;
        html += `<p><strong>Manual:</strong> ${vistoria.nomeArquivo} ${linkHtml}</p>`;
    }
    if (vistoria.dataVistoria) html += `<p><strong>Data da vistoria:</strong> ${String(vistoria.dataVistoria).split("-").reverse().join("/")}</p>`;
    if (vistoria.tecnicoNome) html += `<p><strong>Técnico:</strong> ${vistoria.tecnicoNome}</p>`;
    if (vistoria.tecnicoCpf) html += `<p><strong>CPF Técnico:</strong> ${vistoria.tecnicoCpf}</p>`;

    const auxiliares = Array.isArray(vistoria.auxiliares) ? vistoria.auxiliares : [];
    if (vistoria.categoria !== "notebooks" && auxiliares.length > 0) {
        auxiliares.forEach((aux, idx) => {
            html += `<p><strong>Auxiliar Técnico ${auxiliares.length > 1 ? idx + 1 : ""}:</strong> ${aux.nome} ${aux.cpf ? `(CPF: ${aux.cpf})` : ""}</p>`;
        });
    } else if (vistoria.categoria !== "notebooks" && vistoria.auxiliarTecnico) {
        html += `<p><strong>Auxiliar Técnico:</strong> ${vistoria.auxiliarTecnico}</p>`;
        if (vistoria.auxiliarCpf) html += `<p><strong>CPF Auxiliar:</strong> ${vistoria.auxiliarCpf}</p>`;
    }

    if (vistoria.categoria === "epis" && vistoria.epiResponsavelNome) {
        html += `<p><strong>EPIs vistoriados:</strong> ${vistoria.epiResponsavelTipo || "Funcionário"} - ${vistoria.epiResponsavelNome}</p>`;
    }
    if (vistoria.categoria === "notebooks") {
        const analistaNome = String(vistoria.analistaNome || "").trim();
        const analistaCpf = String(vistoria.analistaCpf || "").trim();
        const notebookModelo = String(vistoria.notebookModelo || "").trim();
        const notebookNumeroSerie = String(vistoria.notebookNumeroSerie || "").trim();

        html += `<p><strong>Movimentação:</strong> ${getNotebookTermLabel(vistoria)}</p>`;
        html += `<p><strong>Analista:</strong> ${escapeHtml(analistaNome || "Não informado")}</p>`;
        html += `<p><strong>CPF do analista:</strong> ${escapeHtml(analistaCpf || "Não informado")}</p>`;
        html += `<p><strong>Notebook:</strong> ${escapeHtml(notebookModelo || "Não informado")}</p>`;
        html += `<p><strong>Nº de série:</strong> ${escapeHtml(notebookNumeroSerie || "Não informado")}</p>`;
        const usageInfo = getNotebookUsageInfo(vistoria);
        if (usageInfo) {
            const diasLabel = usageInfo.dias === 1 ? "1 dia" : `${usageInfo.dias} dias`;
            html += `<p><strong>Tempo com o notebook:</strong> ${diasLabel} <small>(retirado em ${usageInfo.dataRetirada.toLocaleDateString("pt-BR")})</small></p>`;
        }
    }
    if (vistoria.km) html += `<p><strong>KM:</strong> ${vistoria.km}</p>`;
    if (vistoria.categoria === "viaturas" && vistoria.observacoesViatura) html += `<p><strong>Observações:</strong> ${vistoria.observacoesViatura}</p>`;
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
            const formatarMoeda = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            html += `<li><strong>${labelStatus} ${quantidade || "-"}x ${p.item} - R$ ${formatarMoeda(valor)} - Total R$ ${formatarMoeda(total)}${epiMeta}:</strong> ${p.observacao || "Sem observação"}</li>`;
        });
        html += "</ul>";
    } else {
        html += '<p class="status-ok details-ok">✅ Nenhum item pendente encontrado.</p>';
    }

    if (vistoria.pendenciaResolvida?.resolvida) {
        const dataResolucao = converterParaData(vistoria.pendenciaResolvida.dataResolucao);
        html += '<div class="resolution-box">';
        html += '<h4>Pendência Resolvida</h4>';
        html += `<p><strong>Observação:</strong> ${vistoria.pendenciaResolvida.observacao || "Sem observação"}</p>`;
        html += `<p><strong>Resolvido por:</strong> ${vistoria.pendenciaResolvida.resolvidoPor || "Admin"}</p>`;
        if (dataResolucao) html += `<p><strong>Data:</strong> ${dataResolucao.toLocaleString("pt-BR")}</p>`;
        html += "</div>";
    }

    body.innerHTML = html;
    modal.style.display = "block";
    document.getElementById("modal-body").scrollTop = 0;
}

export function closeModal() {
    document.getElementById("details-modal").style.display = "none";
}

export function importarPDFs() {
    document.getElementById("import-pdf-input")?.click();
}

export async function processarPDFsImportados(input) {
    const files = Array.from(input.files || []);
    if (files.length === 0) return;

    if (!confirm(`Deseja adicionar ${files.length} registro(s) de PDF ao histórico?`)) {
        input.value = "";
        return;
    }

    const vistoriador = getVistoriadorResponsavel();
    const viaturaId = prompt("Informe o número da viatura para estes PDFs:", state.selectedViatura) || state.selectedViatura;

    try {
        console.log("Iniciando upload para o Storage...");

        for (const file of files) {
            // 1. Upload para o Firebase Storage
            const path = `manuais_pdf/viatura_${viaturaId}/${file.name}`;
            const fileReference = storageRef(storage, path);
            const uploadSnapshot = await uploadBytes(fileReference, file);

            // 2. Obter a URL pública para download
            const downloadURL = await getDownloadURL(uploadSnapshot.ref);

            // 3. Salvar registro no Firestore com a URL
            await addDoc(collection(db, "vistorias"), {
                vistoriador,
                viaturaId: String(viaturaId),
                categoria: "manuais_pdf",
                tipoRegistro: "pdf_manual",
                nomeArquivo: file.name,
                urlArquivo: downloadURL, // URL real do Storage
                dataEnvio: serverTimestamp(),
                itens: [],
                status: "ok"
            });
        }
        alert(`${files.length} arquivo(s) enviados e registrados com sucesso!`);
        await carregarHistorico();
    } catch (error) {
        console.error("Erro ao registrar PDFs:", error);
        alert("Erro ao registrar PDFs: " + error.message);
    } finally {
        input.value = "";
    }
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
        const header = document.querySelector("header");
        const main = document.querySelector("main");
        const loginSec = document.getElementById("admin-login-section");
        const panelSec = document.getElementById("admin-panel-section");

        if (!user) {
            document.body.classList.add("is-logged-out");
            document.getElementById("menu-list")?.classList.remove("show");
            if (loginScreen) loginScreen.style.display = "grid";
            if (header) header.style.display = "none";
            if (main) main.style.display = "none";
            if (loginSec) loginSec.style.display = "block";
            if (panelSec) panelSec.style.display = "none";
            const vistoriadorSelect = document.getElementById("vistoriador-atual");
            if (vistoriadorSelect) vistoriadorSelect.disabled = false;
            return;
        }

        document.body.classList.remove("is-logged-out");
        if (loginScreen) loginScreen.style.display = "none";
        if (loginSec) loginSec.style.display = "none";
        if (panelSec) panelSec.style.display = "block";

        try {
            await authReadyCallback();
            if (auth.currentUser !== user) return;
            setTimeout(renderAdminConfig, 0);
        } catch (error) {
            console.error("Erro ao preparar interface após login:", error);
            alert("Erro ao carregar dados iniciais. A tela será aberta com os dados locais disponíveis.");
        } finally {
            if (header) header.style.display = "flex";
            if (main) main.style.display = "block";
        }
    });
}
