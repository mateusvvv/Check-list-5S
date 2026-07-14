import { categoryNames, checklistDataByViatura, cloneEmployeeEpis, damageTypeNames, defaultViaturas, employeeEpisByPerson, ensureChecklistForViatura, formatTwoDigits, funcionariosExtras, getChecklistItemsForPessoa, getEpiPessoaOptions, getFuncionarioKeyFromFields, getFuncionariosData, getItemName, getVistoriadorByEmail, normalizeEmployeeEpiItem, normalizeChecklistItem, normalizeVistoriador, viaturaResponsaveis, vehicleViewNames, vistoriadores, syncVistoriadoresTablet } from "./config.js";
import { addDoc, auth, collection, criarUsuarioAuthSecundario, db, deleteDoc, firestoreDoc, getDocs, onAuthStateChanged, onSnapshot, orderBy, query, serverTimestamp, signInWithEmailAndPassword, signOut, updateDoc, storage, storageRef, uploadBytes, getDownloadURL } from "./firebase.js";
import { getDamageMarkerLabel } from "./damages.js";
import { gerarPDF, gerarRelatorioComEscolha } from "./pdf.js?v=8";
import { carregarConfiguracoes, salvarConfiguracoes } from "./settings.js";
import { ensureViaturaState, getActiveViaturas, setSelectedViatura, state } from "./state.js";

let authReadyCallback = async () => {};
let historyUnsubscribe = null;
const HISTORICO_PAGE_SIZE = 20;
let historicoFiltradoAtual = [];
let historicoVisibleCount = HISTORICO_PAGE_SIZE;
let historicoGroups = {};

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

function getNotebookTermLabel(vistoria) {
    const termType = String(vistoria?.notebookTermType || "")
        .trim()
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    return termType === "RETORNO" || termType === "DEVOLUCAO" ? "Devolução" : "Retirada";
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
            { tipo: "auxiliar", nome: responsaveis.auxiliar, cpf: responsaveis.auxiliarCpf }
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

    return confirm(
        `Atenção: ${duplicado.nome} já está cadastrado como ${duplicado.tipo} em ${duplicado.viaturaNome}.\n\n` +
        "Motivo: a mesma pessoa ficará vinculada a mais de uma viatura.\n\n" +
        "Tem certeza que deseja cadastrar mesmo assim?"
    );
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
    renderAdminFilterViaturaOptions();
    renderAdminViaturaOptions();
    renderAdminChecklist();
    renderAdminFuncionariosExtras();
    renderAdminVistoriadores();
    renderAdminHistory();
    updateAdminTabsPermissions();
}

/**
 * Controla a visibilidade e permissão das abas do painel admin.
 * Se não for o Alisson, os botões ficam transparentes e bloqueados.
 */
function updateAdminTabsPermissions() {
    const isAlisson = isAlissonAdmin();
    const tabs = ["viaturas", "itens", "funcionarios", "notebooks", "historico"];
    
    tabs.forEach(tabId => {
        const btn = document.getElementById(`admin-tab-${tabId}`);
        if (btn) {
            if (!isAlisson) {
                btn.style.opacity = "0.4";
                btn.style.filter = "grayscale(1)";
                btn.style.pointerEvents = "none"; // Bloqueia o clique completamente
                btn.style.cursor = "not-allowed";
                btn.title = "Acesso restrito ao administrador Alisson";
            } else {
                btn.style.opacity = "1";
                btn.style.filter = "none";
                btn.style.pointerEvents = "auto";
                btn.style.cursor = "pointer";
                btn.title = "";
            }
        }
    });
}

export function showAdminConfigTab(tab) {
    if (!isAlissonAdmin()) {
        alert("Somente Alisson tem permissão para acessar estas configurações.");
        return;
    }
    const targetButton = document.getElementById(`admin-tab-${tab}`);
    const isAlreadyOpen = targetButton?.classList.contains("active");
    if (isAlreadyOpen) {
        ["viaturas", "itens", "funcionarios", "notebooks", "historico"].forEach(item => {
            document.getElementById(`admin-tab-${item}`)?.classList.remove("active");
            document.getElementById(`admin-config-${item}`)?.classList.remove("active");
        });
        return;
    }

    ["viaturas", "itens", "funcionarios", "notebooks", "historico"].forEach(item => {
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

    const tecnicoOptions = getTecnicoOptions();

    container.innerHTML = state.viaturas.map((viatura) => {
        const responsaveis = viaturaResponsaveis[viatura.id] || {};
        const tecnicoDatalistId = `tecnicos-viatura-${viatura.id}`;
        const auxiliarDatalistId = `auxiliares-viatura-${viatura.id}`;
        return `
            <div class="admin-config-row admin-vehicle-row ${viatura.ativa === false ? "inactive" : ""}">
                <div class="admin-vehicle-main">
                    <input type="text" value="${escapeHtml(viatura.nome)}" onchange="editarNomeViatura('${viatura.id}', this.value)">
                    <div class="admin-config-actions">
                        <button type="button" class="${viatura.ativa === false ? "" : "btn-muted"}" onclick="alternarViaturaAtiva('${viatura.id}')">${viatura.ativa === false ? "Ativar" : "Desativar"}</button>
                        <button type="button" class="btn-danger" onclick="removerViatura('${viatura.id}')">Remover</button>
                    </div>
                </div>
                <div class="admin-responsaveis-grid">
                    <label>
                        <span>Pesquisar técnico</span>
                        <input type="text" list="${tecnicoDatalistId}" value="${escapeHtml(responsaveis.tecnico || "")}" placeholder="Digite o nome do técnico" onchange="selecionarTecnicoViatura('${viatura.id}', this.value)">
                        <datalist id="${tecnicoDatalistId}">
                            ${tecnicoOptions.map(tecnico => `<option value="${escapeHtml(tecnico.nome)}" label="${escapeHtml(tecnico.cpf)}"></option>`).join("")}
                        </datalist>
                    </label>
                    <label>
                        <span>CPF técnico</span>
                        <input type="text" value="${escapeHtml(responsaveis.tecnicoCpf || "")}" onchange="editarResponsavelViatura('${viatura.id}', 'tecnicoCpf', this.value)">
                    </label>
                    <label>
                        <span>Pesquisar auxiliar</span>
                        <input type="text" list="${auxiliarDatalistId}" value="${escapeHtml(responsaveis.auxiliar || "")}" placeholder="Digite o nome do auxiliar" onchange="selecionarAuxiliarViatura('${viatura.id}', this.value)">
                        <datalist id="${auxiliarDatalistId}">
                            ${tecnicoOptions.map(tecnico => `<option value="${escapeHtml(tecnico.nome)}" label="${escapeHtml(tecnico.cpf)}"></option>`).join("")}
                        </datalist>
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

export async function selecionarTecnicoViatura(id, nome) {
    const viaturaId = String(id);
    if (!viaturaResponsaveis[viaturaId]) {
        viaturaResponsaveis[viaturaId] = { tecnico: "", tecnicoCpf: "", auxiliar: "", auxiliarCpf: "" };
    }

    const tecnico = findTecnicoByName(nome);
    const tecnicoNome = tecnico?.nome || nome.trim();
    const tecnicoCpf = tecnico?.cpf || viaturaResponsaveis[viaturaId].tecnicoCpf || "";

    const duplicado = findResponsavelEmOutraViatura(viaturaId, tecnicoNome, tecnicoCpf);
    if (duplicado && !confirm(
        `Atenção: ${duplicado.nome} já está cadastrado como ${duplicado.tipo} em ${duplicado.viaturaNome}.\n\n` +
        "Motivo: a mesma pessoa ficará vinculada a mais de uma viatura.\n\n" +
        "Tem certeza que deseja cadastrar mesmo assim?"
    )) {
        refreshAppAfterConfigChange();
        return;
    }

    const anterior = viaturaResponsaveis[viaturaId].tecnico || "Sem técnico";
    viaturaResponsaveis[viaturaId].tecnico = tecnicoNome;
    if (tecnico) viaturaResponsaveis[viaturaId].tecnicoCpf = tecnicoCpf;

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

    const auxiliar = findTecnicoByName(nome);
    const auxiliarNome = auxiliar?.nome || nome.trim();
    const auxiliarCpf = auxiliar?.cpf || viaturaResponsaveis[viaturaId].auxiliarCpf || "";

    const duplicado = findResponsavelEmOutraViatura(viaturaId, auxiliarNome, auxiliarCpf);
    if (duplicado && !confirm(
        `Atenção: ${duplicado.nome} já está cadastrado como ${duplicado.tipo} em ${duplicado.viaturaNome}.\n\n` +
        "Motivo: a mesma pessoa ficará vinculada a mais de uma viatura.\n\n" +
        "Tem certeza que deseja cadastrar mesmo assim?"
    )) {
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
    await carregarConfiguracoes();
    renderAdminHistory();
}

export async function adicionarViatura() {
    if (state.viaturas.length >= defaultViaturas.length) {
        alert("O sistema está configurado para 9 viaturas.");
        return;
    }

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
    viaturaResponsaveis[viaturaId][campo] = valor.trim();

    if (campo === "auxiliar" || campo === "auxiliarCpf") {
        const resp = viaturaResponsaveis[viaturaId];
        if (!Array.isArray(resp.auxiliares)) resp.auxiliares = [];
        if (resp.auxiliares.length > 0) {
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
    const viatura = state.viaturas.find(item => item.id === viaturaId);
    if (!viatura) return;

    if (!confirm(`Deseja remover ${viatura.nome}?`)) return;

    registrarHistoricoConfig("Viatura removida", `${viatura.nome} foi removida.`);

    // Marcamos como desativada em vez de deletar o objeto, para manter a persistência
    viatura.ativa = false;
    const index = state.viaturas.findIndex(v => v.id === viaturaId);
    if (index !== -1) state.viaturas[index].ativa = false;
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
            <div class="admin-config-row admin-extra-employee-row">
                <div class="admin-responsaveis-grid">
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
                <div class="admin-config-actions">
                    <button type="button" class="btn-submit" onclick="finalizarCadastroFuncionarioExtra(${index})">Finalizar e Salvar no Sistema</button>
                    <button type="button" class="btn-danger" onclick="removerFuncionarioExtra(${index})">Remover</button>
                </div>
                <div class="admin-extra-epi-wrap">
                    <strong>EPIs</strong>
                    <div class="admin-extra-epi-form">
                        <input type="number" id="extra-epi-qtd-${index}" min="1" step="1" value="1" aria-label="Quantidade">
                        <input type="text" id="extra-epi-nome-${index}" value="" placeholder="Nome do EPI" autocomplete="new-password">
                        <input type="text" id="extra-epi-ca-${index}" value="" placeholder="C.A." autocomplete="new-password">
                        <input type="text" id="extra-epi-entrega-${index}" value="" placeholder="Data" autocomplete="new-password">
                        <input type="text" id="extra-epi-obs-${index}" value="" placeholder="OBS" autocomplete="new-password">
                        <button type="button" onclick="adicionarEpiFuncionarioExtra(${index})">Salvar EPI</button>
                    </div>
                    <div class="admin-extra-epi-list">
                        ${epis.length ? epis.map((epi, epiIndex) => `
                            <div class="admin-extra-epi-row">
                                <input type="number" min="1" step="1" value="${Number(epi.quantidade || 1)}" onchange="editarEpiFuncionarioExtra(${index}, ${epiIndex}, 'quantidade', this.value)" aria-label="Quantidade do EPI">
                                <input type="text" value="${escapeHtml(epi.nome || "")}" autocomplete="new-password" onchange="editarEpiFuncionarioExtra(${index}, ${epiIndex}, 'nome', this.value)" aria-label="Nome do EPI">
                                <input type="text" value="${escapeHtml(epi.ca || "")}" autocomplete="new-password" onchange="editarEpiFuncionarioExtra(${index}, ${epiIndex}, 'ca', this.value)" aria-label="CA do EPI">
                                <input type="text" value="${escapeHtml(epi.dataEntrega || "")}" autocomplete="new-password" onchange="editarEpiFuncionarioExtra(${index}, ${epiIndex}, 'dataEntrega', this.value)" aria-label="Data de entrega do EPI">
                                <input type="text" value="${escapeHtml(epi.observacao || "")}" autocomplete="new-password" onchange="editarEpiFuncionarioExtra(${index}, ${epiIndex}, 'observacao', this.value)" aria-label="Observação do EPI">
                                <button type="button" class="btn-danger" onclick="removerEpiFuncionarioExtra(${index}, ${epiIndex})">Remover EPI</button>
                            </div>
                        `).join("") : '<p class="admin-history-empty">Nenhum EPI cadastrado para este funcionário.</p>'}
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

export function renderAdminVistoriadores() {
    const list = document.getElementById("admin-vistoriadores-list");
    if (!list) return;

    list.innerHTML = vistoriadores.map(vistoriador => `
        <div class="admin-config-row">
            <div>
                <strong>${escapeHtml(vistoriador.nome)}</strong>
                <p class="substitution-note">${escapeHtml(vistoriador.email)} - ${vistoriador.tipo === "tablets" ? "Somente tablets" : "Vistorias gerais"}${vistoriador.padrao ? " - padrão" : ""}</p>
            </div>
            <div class="admin-config-actions">
                ${vistoriador.padrao
                    ? ''
                    : `<button type="button" class="btn-danger" onclick="removerVistoriador('${escapeJsString(vistoriador.id)}')">Remover</button>`}
            </div>
        </div>
    `).join("");
}

function normalizeAdminEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function clearVistoriadorForm() {
    ["admin-vistoriador-nome", "admin-vistoriador-email", "admin-vistoriador-senha"].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = "";
    });
    const tipo = document.getElementById("admin-vistoriador-tipo");
    if (tipo) tipo.value = "geral";
}

async function salvarNovoVistoriador({ nome, email, tipo }) {
    const vistoriador = normalizeVistoriador({
        id: `vistoriador-${Date.now()}`,
        nome,
        email,
        tipo,
        padrao: false
    }, vistoriadores.length);
    vistoriadores.push(vistoriador);
    syncVistoriadoresTablet();
    registrarHistoricoConfig("Vistoriador adicionado", `${nome} foi adicionado como ${tipo === "tablets" ? "vistoriador de tablets" : "vistoriador geral"}.`);
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
    const tipo = document.getElementById("admin-vistoriador-tipo")?.value === "tablets" ? "tablets" : "geral";

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
        await salvarNovoVistoriador({ nome, email, tipo });
        alert("Vistoriador criado com sucesso.");
    } catch (error) {
        if (error?.code === "auth/email-already-in-use") {
            if (!confirm("Este e-mail já existe no Firebase Auth. Deseja vincular esse usuário como vistoriador do sistema?")) return;
            await salvarNovoVistoriador({ nome, email, tipo });
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

    if (vistoriador.padrao) {
        alert("Vistoriadores padrão não podem ser removidos.");
        return;
    }

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
    registrarHistoricoConfig("Item adicionado", `${nome} foi adicionado em ${getChecklistHistoryContext(viaturaId, category, pessoaKey)}.`);
    await salvarConfiguracoes();
    refreshAppAfterConfigChange();
}

export async function editarItemChecklist(viaturaId, category, index, nome, pessoaKey = "") {
    const items = getChecklistItemsForPessoa(category, viaturaId, pessoaKey);
    items[index] = category === "epis" ? normalizeEmployeeEpiItem(items[index], index) : normalizeChecklistItem(items[index], index);
    const nomeAnterior = items[index].nome;
    items[index].nome = nome.trim() || items[index].nome;
    if (nomeAnterior !== items[index].nome) {
        registrarHistoricoConfig("Item alterado", `${getChecklistHistoryContext(viaturaId, category, pessoaKey)}: "${nomeAnterior}" foi alterado para "${items[index].nome}".`);
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
    const viaturaId = document.getElementById("filter-viatura")?.value || "";
    const dataInicio = document.getElementById("filter-data-inicio").value;
    const dataFim = document.getElementById("filter-data-fim").value;
    const status = document.getElementById("filter-status")?.value || "";

    if (vistoriador) window.sincronizarVistoriadorLogado?.(vistoriador);

    let filtrados = state.vistoriasCache;

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
    historicoVisibleCount = HISTORICO_PAGE_SIZE;
    renderHistoricoTable(filtrados);
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

    document.getElementById("stat-total").innerText = total;
    document.getElementById("stat-pending").innerText = pendentes;
    document.getElementById("stat-ok").innerText = total - pendentes;
    const users = document.getElementById("stat-users");
    if (users) users.innerText = vistoriadores.length;
}

function renderHistoricoTable(dados) {
    const tbody = document.getElementById("history-tbody");
    tbody.innerHTML = "";

    if (dados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nenhuma vistoria encontrada com os filtros aplicados.</td></tr>';
        renderHistoricoPager(0, 0);
        return;
    }

    const dadosAgrupados = agruparVistoriasHistorico(dados);
    const dadosVisiveis = dadosAgrupados.slice(0, historicoVisibleCount);

    dadosVisiveis.forEach((data) => {
        const dateObj = getDataReferenciaFiltro(data);
        const status = data.grouped ? data.statusGroup : getStatusVistoria(data);
        const statusHTML = status === "pendente"
            ? '<span class="status-pendente">Pendência</span>'
            : status === "resolvida"
                ? '<span class="status-resolvida">Resolvida</span>'
            : '<span class="status-ok">Tudo OK</span>';
        const viaturaLabel = data.categoria === "notebooks"
            ? "Vistoria"
            : getViaturaLabel(data.viaturaId);

        const tipoVistoriaLabel = (data.tipoVistoria || "").toString().toUpperCase() || "PARCIAL";
        const todasCategoriasLabel = getCategoriaHistoricoLabel(data);
        const checkboxChecked = (data.ids || [data.id]).every(id => state.selectedVistorias.has(id));

        tbody.innerHTML += `
            <tr onclick="verDetalhes('${data.id}')">
                <td onclick="event.stopPropagation();">
                    <input type="checkbox" class="history-select" value="${data.id}" ${checkboxChecked ? "checked" : ""} onchange="toggleSelecionarVistoria('${data.id}', this.checked)">
                </td>
                <td>${dateObj.toLocaleString("pt-BR")}</td>
                <td>${tipoVistoriaLabel}</td>
                <td>${escapeHtml(viaturaLabel)}</td>
                <td>${escapeHtml(todasCategoriasLabel)}</td>
                <td>${statusHTML}</td>
            </tr>
        `;
    });
    renderHistoricoPager(dadosVisiveis.length, dadosAgrupados.length);
    atualizarContadorSelecionadas();
}

function renderHistoricoPager(visibleCount, totalCount) {
    const tableScroll = document.querySelector("#history-tbody")?.closest(".table-scroll");
    if (!tableScroll) return;

    let pager = document.getElementById("history-load-more");
    if (!pager) {
        pager = document.createElement("div");
        pager.id = "history-load-more";
        pager.className = "history-load-more";
        tableScroll.insertAdjacentElement("afterend", pager);
    }

    if (totalCount <= HISTORICO_PAGE_SIZE || visibleCount >= totalCount) {
        pager.innerHTML = totalCount > HISTORICO_PAGE_SIZE
            ? `<span>Mostrando ${visibleCount} de ${totalCount} registros.</span>`
            : "";
        pager.style.display = pager.innerHTML ? "flex" : "none";
        return;
    }

    const remainingCount = totalCount - visibleCount;
    const nextCount = Math.min(HISTORICO_PAGE_SIZE, remainingCount);
    pager.style.display = "flex";
    pager.innerHTML = `
        <span>Mostrando ${visibleCount} de ${totalCount} registros.</span>
        <button type="button">Ver mais ${nextCount}</button>
    `;
    pager.querySelector("button")?.addEventListener("click", () => {
        historicoVisibleCount += HISTORICO_PAGE_SIZE;
        renderHistoricoTable(historicoFiltradoAtual);
    });
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
    if (auxiliares.length > 0) {
        auxiliares.forEach((aux, idx) => {
            html += `<p><strong>Auxiliar Técnico ${auxiliares.length > 1 ? idx + 1 : ""}:</strong> ${aux.nome} ${aux.cpf ? `(CPF: ${aux.cpf})` : ""}</p>`;
        });
    } else if (vistoria.auxiliarTecnico) {
        html += `<p><strong>Auxiliar Técnico:</strong> ${vistoria.auxiliarTecnico}</p>`;
        if (vistoria.auxiliarCpf) html += `<p><strong>CPF Auxiliar:</strong> ${vistoria.auxiliarCpf}</p>`;
    }

    if (vistoria.categoria === "epis" && vistoria.epiResponsavelNome) {
        html += `<p><strong>EPIs vistoriados:</strong> ${vistoria.epiResponsavelTipo || "Funcionário"} - ${vistoria.epiResponsavelNome}</p>`;
    }
    if (vistoria.categoria === "notebooks") {
        html += `<p><strong>Movimentação:</strong> ${getNotebookTermLabel(vistoria)}</p>`;
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
            if (loginScreen) loginScreen.style.display = "grid";
            if (header) header.style.display = "none";
            if (main) main.style.display = "none";
            if (loginSec) loginSec.style.display = "block";
            if (panelSec) panelSec.style.display = "none";
            const vistoriadorSelect = document.getElementById("vistoriador-atual");
            if (vistoriadorSelect) vistoriadorSelect.disabled = false;
            return;
        }

        if (loginScreen) loginScreen.style.display = "none";
        if (loginSec) loginSec.style.display = "none";
        if (panelSec) panelSec.style.display = "block";

        try {
            await carregarConfiguracoes();
            await authReadyCallback();
            renderAdminConfig();
            carregarHistorico();
            if (auth.currentUser !== user) return;
        } catch (error) {
            console.error("Erro ao preparar interface após login:", error);
            alert("Erro ao carregar dados iniciais. A tela será aberta com os dados locais disponíveis.");
        } finally {
            if (header) header.style.display = "flex";
            if (main) main.style.display = "block";
        }
    });
}
