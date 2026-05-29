import { categoryNames, employeeEpisByPerson, formatTwoDigits, funcionariosExtras, getChecklistItemsForPessoa, getEpiPessoaByKey, getEpiPessoaOptions, getFuncionarioKeyFromFields, getFuncionariosData, getItemName, getChecklistItemDefaults, normalizeEmployeeEpiItem, viaturaResponsaveis, vistoriadoresTablet } from "./js/config.js";
import {
    addDoc,
    auth,
    collection,
    db,
    serverTimestamp
} from "./js/firebase.js";
import {
    limparAvariasTablet,
    limparAvariasViatura,
    marcarAvaria,
    marcarAvariaTablet,
    removerAvaria,
    removerAvariaTablet,
    renderDamageList,
    renderDamageMarkers,
    renderTabletDamageList,
    renderTabletDamageMarkers,
    setDamageType,
    setTabletDamageType,
    updateTabletInfo,
    updateVehicleMapImage
} from "./js/damages.js";
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
    adicionarItemChecklist,
    adicionarEpiFuncionarioExtra,
    adicionarFuncionarioExtra,
    finalizarCadastroFuncionarioExtra,
    adicionarViatura,
    alternarItemChecklist,
    alternarViaturaAtiva,
    editarItemChecklist,
    editarEpiFuncionarioExtra,
    editarFuncionarioExtra,
    editarNomeViatura,
    editarResponsavelViatura,
    removerViatura,
    removerEpiFuncionarioExtra,
    removerFuncionarioExtra,
    removerItemChecklist,
    renderAdminChecklist,
    selecionarAuxiliarViatura,
    selecionarTecnicoViatura,
    setAuthReadyCallback,
    showAdminConfigTab,
    substituirItemChecklist,
    resolverPendenciasSelecionadas,
    toggleSelecionarTodasVistorias,
    toggleSelecionarVistoria,
    verDetalhes
} from "./js/admin.js";
import {
    encerrarVistoriaCompleta,
    gerarRelatorioViatura,
    setPdfUiCallbacks
} from "./js/pdf.js";
import {
    getCategoriasConcluidas,
    getActiveViaturas,
    getViaturaById,
    isVistoriaParcial,
    salvarVistoriaLocal,
    setSelectedViatura,
    state,
    todasEtapasConcluidas
} from "./js/state.js";
import { salvarConfiguracoes } from "./js/settings.js";

let funcionarioItensEditandoKey = "";

function getVistoriadorAtivo() {
    return document.getElementById("vistoriador-atual")?.value || "";
}

const vistoriadorPorEmail = {
    "alisson.tavares@digitalonline.com.br": "Alisson",
    "marcos@digitalonline.com.br": "Marcos",
    "italo@digitalonline.com.br": "Italo",
    "matheus@digitalonline.com.br": "Matheus"
};

function getVistoriadorPorEmail(email) {
    return vistoriadorPorEmail[String(email || "").trim().toLowerCase()] || "";
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

function isTabletOnlyUser(vistoriador = getVistoriadorAtivo()) {
    return vistoriadoresTablet.includes(vistoriador);
}

function podeAcessarCategoria(category, vistoriador = getVistoriadorAtivo()) {
    if (!categoryNames[category]) return true;
    if (category === "tablets") return isTabletOnlyUser(vistoriador);
    return !isTabletOnlyUser(vistoriador);
}

function getAccessDeniedMessage(category, vistoriador) {
    if (category === "tablets") {
        return "A vistoria de tablets só pode ser acessada por Italo ou Matheus.";
    }

    if (isTabletOnlyUser(vistoriador)) {
        return `${vistoriador} pode realizar apenas vistorias de tablets.`;
    }

    return "Selecione um vistoriador autorizado para acessar esta vistoria.";
}

function updateVistoriadorLogado() {
    const vistoriador = getVistoriadorAtivo();
    const label = document.getElementById("vistoriador-logado");
    if (!label) return;

    if (!vistoriador) {
        label.innerText = "Nenhum vistoriador selecionado";
        label.classList.remove("active");
        return;
    }

    label.innerText = isTabletOnlyUser(vistoriador)
        ? `Logado: ${vistoriador} - Tablets`
        : `Logado: ${vistoriador}`;
    label.classList.add("active");
}

function syncTabletVistoriador() {
    const vistoriador = getVistoriadorAtivo();
    const tabletSelect = document.getElementById("tablet-vistoriador");
    if (!tabletSelect) return;

    tabletSelect.value = isTabletOnlyUser(vistoriador) ? vistoriador : "";
}

function updateAccessByVistoriador() {
    const vistoriador = getVistoriadorAtivo();
    Object.keys(categoryNames).forEach(category => {
        const link = document.getElementById(`menu-${category}`);
        if (!link) return;
        const shouldRestrict = category !== "tablets" && !podeAcessarCategoria(category, vistoriador);
        link.classList.toggle("restricted", shouldRestrict);
    });
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
    syncTabletVistoriador();
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

    if (!vistoriadorSelect || !vistoriadoresTablet.includes(responsavel)) return;

    vistoriadorSelect.value = responsavel;
    selecionarVistoriadorAtivo(true);
}

function solicitarVistoriadorTablet() {
    const vistoriadorAutenticado = getVistoriadorAutenticado();
    if (vistoriadorAutenticado && !isTabletOnlyUser(vistoriadorAutenticado)) {
        alert("A vistoria de tablets só pode ser acessada por Italo ou Matheus.");
        return false;
    }

    const atual = isTabletOnlyUser() ? getVistoriadorAtivo() : "";
    const resposta = prompt(
        "Para acessar a vistoria de tablets, informe o vistoriador logado: ITALO ou MATHEUS.",
        atual
    );

    if (!resposta) return false;

    const normalizado = resposta.trim().toLowerCase();
    const vistoriador = vistoriadoresTablet.find(nome => nome.toLowerCase() === normalizado);

    if (!vistoriador) {
        alert("A vistoria de tablets só pode ser acessada por Italo ou Matheus.");
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

function showHome() {
    showPage(isTabletOnlyUser() ? "tablets" : "ferramentas");
}

function showPage(pageId) {
    let vistoriador = getVistoriadorAtivo();
    if (pageId === "tablets" && !isTabletOnlyUser(vistoriador)) {
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

    const headerInfo = document.querySelector(".header-info");
    if (headerInfo) headerInfo.style.display = ["admin", "funcionarios"].includes(pageId) ? "none" : "block";
    document.body.classList.toggle("page-funcionarios", pageId === "funcionarios");

    document.querySelectorAll(".tab-content").forEach(content => content.classList.remove("active"));

    const activePage = document.getElementById(pageId);
    if (activePage) {
        activePage.classList.add("active");
        renderItems(pageId);
    }

    if (pageId === "funcionarios") renderFuncionariosPage();
    if (pageId === "admin" && auth.currentUser) carregarHistorico();

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
    if (getFuncionarioStatus(funcionario) !== "Ativo") return "";
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

    return [...porChave.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function findTecnicoByName(nome) {
    const termo = normalizeSearch(nome).trim();
    if (!termo) return null;
    const options = getTecnicoOptions();
    return options.find(tecnico => normalizeSearch(tecnico.nome).trim() === termo)
        || options.find(tecnico => normalizeSearch(tecnico.nome).includes(termo))
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
            { tipo: "auxiliar", nome: responsaveis.auxiliar, cpf: responsaveis.auxiliarCpf }
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

function selecionarTecnicoVistoriaAtual(nome) {
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
        viaturaResponsaveis[state.selectedViatura][campoNome] = pessoaNome;
        viaturaResponsaveis[state.selectedViatura][campoCpf] = pessoaCpf;
        await salvarConfiguracoes();
    }
    if (pesquisaInput) pesquisaInput.value = "";
    renderEpiPessoaOptions();
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
    const status = getFuncionarioStatus(funcionario);
    const key = getFuncionarioKey(funcionario);
    const editKey = getFuncionarioEditKey(funcionario);
    const isEditingItems = funcionarioItensEditandoKey === editKey;
    const displayViaturaId = getFuncionarioDisplayViaturaId(funcionario);
    const statusClass = getFuncionarioStatusClass(status);
    const deleteControl = getVistoriadorAtivo() === "Alisson"
        ? `<button type="button" class="employee-delete-btn" onclick="excluirFuncionario('${escapeJsString(editKey)}')">Excluir</button>`
        : "";
    const editControl = getVistoriadorAtivo() === "Alisson"
        ? `<button type="button" class="employee-edit-items-btn ${isEditingItems ? "editing" : ""}" onclick="abrirEditorItensFuncionario('${escapeJsString(editKey)}')">${isEditingItems ? "Concluir edição" : "Editar itens"}</button>`
        : "";
    const statusControl = getVistoriadorAtivo() === "Alisson"
        ? `
            <label class="employee-status-control">
                <span>Situação</span>
                <select class="employee-status-select ${statusClass}" onchange="alterarStatusFuncionario('${escapeJsString(key)}', this.value)">
                    ${["Ativo", "Férias", "Folga", "Atestado", "Falta"].map(option => `
                        <option value="${option}" ${status === option ? "selected" : ""}>${option}</option>
                    `).join("")}
                </select>
            </label>
        `
        : `<span class="employee-status ${statusClass}">${escapeHtml(status)}</span>`;
    const actionsHtml = deleteControl || editControl || statusControl
        ? `<div class="employee-card-actions">${deleteControl}${editControl}${statusControl}</div>`
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
    await salvarConfiguracoes();
    renderTecnicoDatalist();
    preencherResponsaveisViatura();
    renderFuncionariosPage();
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
                    <input type="number" min="1" step="1" value="${Number(epi.quantidade || 1)}" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'quantidade', this.value)" aria-label="Quantidade">
                    <input type="text" value="${escapeHtml(epi.nome || "")}" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'nome', this.value)" aria-label="Descrição do item">
                    <input type="text" value="${escapeHtml(epi.ca || "")}" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'ca', this.value)" aria-label="C.A.">
                    <input type="text" value="${escapeHtml(epi.dataEntrega || "")}" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'dataEntrega', this.value)" aria-label="Data de entrega">
                    <input type="text" value="${escapeHtml(epi.observacao || "")}" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'observacao', this.value)" aria-label="Observação">
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
                        <input type="number" min="1" step="1" value="${Number(epi.quantidade || 1)}" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'quantidade', this.value)" aria-label="Quantidade">
                        <input type="text" value="${escapeHtml(epi.nome || "")}" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'nome', this.value)" aria-label="Descrição do item">
                        <input type="text" value="${escapeHtml(epi.ca || "")}" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'ca', this.value)" aria-label="C.A.">
                        <input type="text" value="${escapeHtml(epi.dataEntrega || "")}" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'dataEntrega', this.value)" aria-label="Data de entrega">
                        <input type="text" value="${escapeHtml(epi.observacao || "")}" onchange="editarItemFuncionarioEditado('${escapeJsString(key)}', ${index}, 'observacao', this.value)" aria-label="Observação">
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
    const status = document.getElementById("funcionario-status-filter")?.value || "";
    if (!list) return;

    const funcionariosData = getFuncionariosData();
    const termo = normalizeSearch(search);
    const filtrados = funcionariosData.filter(funcionario => {
        const matchesSearch = !termo
            || normalizeSearch(funcionario.nome).includes(termo)
            || normalizeSearch(funcionario.cpf).includes(termo)
            || normalizeSearch(funcionario.funcao).includes(termo);
        const matchesStatus = !status || getFuncionarioStatus(funcionario) === status;
        return matchesSearch && matchesStatus;
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
    const confirmado = confirm("Você será direcionado para uma página exclusiva do histórico de alterações. Deseja continuar?");
    if (confirmado) window.location.href = "historico.html";
}

function preencherResponsaveisViatura() {
    const responsaveis = viaturaResponsaveis[state.selectedViatura];
    const tecnicoNomeInput = document.getElementById("tecnico-nome");
    const tecnicoCpfInput = document.getElementById("tecnico-cpf");
    const auxiliarNomeInput = document.getElementById("auxiliar-nome");
    const auxiliarCpfInput = document.getElementById("auxiliar-cpf");

    if (tecnicoNomeInput) tecnicoNomeInput.value = responsaveis?.tecnico || "";
    if (tecnicoCpfInput) tecnicoCpfInput.value = responsaveis?.tecnicoCpf || "";
    if (auxiliarNomeInput) auxiliarNomeInput.value = responsaveis?.auxiliar || "";
    if (auxiliarCpfInput) auxiliarCpfInput.value = responsaveis?.auxiliarCpf || "";
    renderEpiPessoaOptions();
}

function getSelectedEpiPessoaKey() {
    return document.getElementById("epi-pessoa")?.value || "";
}

function renderEpiPessoaOptions() {
    const select = document.getElementById("epi-pessoa");
    if (!select) return;

    const valorAtual = select.value;
    const pessoas = getEpiPessoaOptions(state.selectedViatura);
    select.innerHTML = pessoas.length
        ? pessoas.map(pessoa => `
            <option value="${escapeHtml(pessoa.key)}">${escapeHtml(pessoa.tipo)} - ${escapeHtml(pessoa.nome)}</option>
        `).join("")
        : `<option value="">Nenhum técnico ou auxiliar cadastrado</option>`;
    select.value = pessoas.some(pessoa => pessoa.key === valorAtual) ? valorAtual : (pessoas[0]?.key || "");
}

function selecionarPessoaEpi() {
    renderItems("epis");
}

function renderItems(pageId) {
    const containerMapping = {
        ferramentas: "lista-ferramentas",
        epis: "lista-epis",
        viaturas: "lista-viaturas",
        tablets: "lista-tablets"
    };
    const container = document.getElementById(containerMapping[pageId]);
    if (pageId === "epis") renderEpiPessoaOptions();
    const items = getChecklistItemsForPessoa(pageId, state.selectedViatura, getSelectedEpiPessoaKey()).filter(item => item.ativo !== false);
    if (!container || !items) return;

    container.innerHTML = items.map((item, index) => {
        const itemName = getItemName(item);
        const defaults = pageId === "epis" ? item : getChecklistItemDefaults(pageId, itemName, state.selectedViatura);
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
                <div class="item-quantity-field">
                    <label for="qtd-${pageId}-${index}">QTD</label>
                    <input type="number" id="qtd-${pageId}-${index}" min="0" step="1" value="${quantidade}" oninput="atualizarTotalItem('${pageId}', ${index})" onkeydown="salvarItemComEnter(event, '${pageId}')">
                </div>
                <label class="item-label">${escapeHtml(itemName)}<span class="error-msg">⚠️ Seleção obrigatória</span></label>
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
                    <span>✅ OK</span>
                </label>
                <label class="status-opt">
                    <input type="radio" name="status-${pageId}-${index}" value="pendente" onchange="limparErroItem('${pageId}', ${index})">
                    <span>⚠️ Pendente</span>
                </label>
                <label class="status-opt">
                    <input type="radio" name="status-${pageId}-${index}" value="perdeu" onchange="limparErroItem('${pageId}', ${index})">
                    <span>❌ Perdeu</span>
                </label>
                <label class="status-opt">
                    <input type="radio" name="status-${pageId}-${index}" value="quebrou" onchange="limparErroItem('${pageId}', ${index})">
                    <span>🛠️ Quebrou</span>
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
    }

    if (pageId === "tablets") {
        updateTabletInfo();
        syncTabletVistoriador();
        renderTabletDamageMarkers();
        renderTabletDamageList();
    }
}

function limparErroItem(pageId, index) {
    document.getElementById(`row-${pageId}-${index}`)?.classList.remove("error");
}

function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    });
}

function atualizarTotalItem(pageId, index) {
    const quantidade = Number(document.getElementById(`qtd-${pageId}-${index}`)?.value || 0);
    const valor = Number(document.getElementById(`valor-${pageId}-${index}`)?.value || 0);
    const totalInput = document.getElementById(`total-${pageId}-${index}`);
    if (totalInput) totalInput.value = formatCurrency(quantidade * valor);
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

    getActiveViaturas().forEach((viatura) => {
        const id = viatura.id;
        const status = state.surveyStatus[id];
        const isActive = state.selectedViatura === id;

        const card = document.createElement("div");
        card.className = `viatura-card ${isActive ? "active" : ""}`;
        card.onclick = () => selectViatura(id);
        card.innerHTML = `
            <span class="viatura-name">${escapeHtml(viatura.nome)}</span>
            <div class="status-dots">
                <span class="dot ${status.ferramentas ? "done" : ""}" title="Ferramentas">🔧</span>
                <span class="dot ${status.epis ? "done" : ""}" title="EPIs">🦺</span>
                <span class="dot ${status.viaturas ? "done" : ""}" title="Viatura">🚗</span>
                <span class="dot ${status.tablets ? "done" : ""}" title="Tablet">📱</span>
            </div>
        `;
        grid.appendChild(card);
    });
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
    preencherResponsaveisViatura();
    updateVehicleMapImage(id);
    updateTabletInfo(id);

    const activeTab = document.querySelector(".tab-content.active");
    if (activeTab) renderItems(activeTab.id);
}

function updateVistoriaModeUI() {
    const label = document.getElementById("vistoria-mode-label");
    if (!label) return;

    label.innerText = isVistoriaParcial()
        ? "Modo: Vistoria parcial"
        : "Modo: Vistoria completa";
}

function configurarModoVistoria() {
    const atual = isVistoriaParcial() ? "PARCIAL" : "COMPLETA";
    const resposta = prompt(
        "Digite COMPLETA para vistoria completa ou PARCIAL para vistoriar apenas algumas etapas.",
        atual
    );

    if (!resposta) return;

    const valor = resposta.trim().toUpperCase();
    if (valor !== "COMPLETA" && valor !== "PARCIAL") {
        alert("Informe COMPLETA ou PARCIAL.");
        return;
    }

    state.vistoriaMode[state.selectedViatura] = valor === "PARCIAL" ? "parcial" : "completa";
    updateVistoriaModeUI();
    updateMenuStatus();
}

function updateMenuStatus() {
    const status = state.surveyStatus[state.selectedViatura];
    let concluidas = 0;

    Object.keys(categoryNames).forEach(category => {
        const link = document.getElementById(`menu-${category}`);
        if (!link) return;

        if (status[category]) {
            link.classList.add("completed");
            concluidas++;
        } else {
            link.classList.remove("completed");
        }
    });

    const vistoriaCompleta = todasEtapasConcluidas(state.selectedViatura);
    const vistoriaParcial = isVistoriaParcial(state.selectedViatura);
    const btnEncerrar = document.getElementById("btn-encerrar-geral");

    if (btnEncerrar) {
        btnEncerrar.style.display = (vistoriaCompleta || (vistoriaParcial && concluidas > 0)) ? "block" : "none";
        btnEncerrar.innerText = vistoriaParcial && !vistoriaCompleta
            ? `📁 Gerar PDF parcial da Viatura ${state.selectedViatura.padStart(2, "0")}`
            : `📁 Encerrar Vistoria Viatura ${state.selectedViatura.padStart(2, "0")} (Gerar PDF)`;
    }
}

async function finalizarVistoria(category) {
    const kmInput = document.getElementById("km");
    const dataVistoriaInput = document.getElementById("checking-date");
    const tecnicoNomeInput = document.getElementById("tecnico-nome");
    const tecnicoCpfInput = document.getElementById("tecnico-cpf");
    const auxiliarNomeInput = document.getElementById("auxiliar-nome");
    const auxiliarCpfInput = document.getElementById("auxiliar-cpf");
    const vistoriadorGeral = document.getElementById("vistoriador-atual").value;
    const vistoriadorTablet = document.getElementById("tablet-vistoriador")?.value || "";
    const vistoriador = category === "tablets" && !isTabletOnlyUser(vistoriadorGeral)
        ? vistoriadorTablet
        : vistoriadorGeral;

    if (!podeAcessarCategoria(category, vistoriadorGeral)) {
        alert(`${vistoriadorGeral} pode realizar apenas vistorias de tablets.`);
        showPage("tablets");
        return;
    }

    if (category === "viaturas" && (!kmInput || !kmInput.value)) {
        alert("Por favor, informe o KM atual da viatura antes de finalizar.");
        return;
    }

    if (!vistoriador) {
        alert(category === "tablets"
            ? "Por favor, selecione Matheus ou Italo como responsável pela vistoria do tablet."
            : "Por favor, selecione quem está realizando a vistoria no topo da página.");
        return;
    }

    const epiPessoa = category === "epis" ? getEpiPessoaByKey(state.selectedViatura, getSelectedEpiPessoaKey()) : null;
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
        const defaults = category === "epis" ? items[i] : getChecklistItemDefaults(category, itemName, state.selectedViatura);
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

    if (quantidadesAumentadas.length > 0) {
        const detalhes = quantidadesAumentadas
            .slice(0, 6)
            .map(item => `- ${item.item}: ${item.original} para ${item.nova}`)
            .join("\n");
        const restante = quantidadesAumentadas.length > 6
            ? `\n...e mais ${quantidadesAumentadas.length - 6} item(ns).`
            : "";

        if (!confirm(`Você aumentou a QTD de alguns itens:\n\n${detalhes}${restante}\n\nDeseja realmente salvar assim?`)) {
            return;
        }
    }

    state.dadosTemporariosVistoria = {
        viaturaId: state.selectedViatura,
        tabletId: category === "tablets" ? state.selectedViatura : null,
        vistoriador,
        dataVistoria: dataVistoriaInput?.value || new Date().toLocaleDateString("sv-SE"),
        tecnicoNome: tecnicoNomeInput?.value.trim() || "",
        tecnicoCpf: tecnicoCpfInput?.value.trim() || "",
        auxiliarTecnico: auxiliarNomeInput?.value.trim() || "",
        auxiliarCpf: auxiliarCpfInput?.value.trim() || "",
        epiResponsavelTipo: epiPessoa?.tipo || null,
        epiResponsavelNome: epiPessoa?.nome || null,
        epiResponsavelCpf: epiPessoa?.cpf || null,
        categoria: category,
        itens: checklistResults,
        km: category === "viaturas" ? kmInput.value : null,
        avarias: category === "viaturas" ? [...state.vehicleDamages[state.selectedViatura]] : [],
        avariasTablet: category === "tablets" ? [...state.tabletDamages[state.selectedViatura]] : [],
        observacoesTablet: category === "tablets" ? (document.getElementById("tablet-observacoes")?.value.trim() || "") : ""
    };

    const pendentes = checklistResults.filter(r => r.status === "pendente");
    if (pendentes.length > 0) abrirModalRevisao(pendentes);
    else await enviarVistoriaAoFirebase();
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

async function enviarVistoriaAoFirebase() {
    try {
        const docData = { ...state.dadosTemporariosVistoria, dataEnvio: serverTimestamp() };
        await addDoc(collection(db, "vistorias"), docData);
        const categoriaSalva = state.dadosTemporariosVistoria.categoria;
        const viaturaSalva = state.selectedViatura;

        salvarVistoriaLocal({
            ...state.dadosTemporariosVistoria,
            dataEnvioLocal: new Date()
        });

        if (document.getElementById("km")) document.getElementById("km").value = "";
        if (categoriaSalva === "viaturas") {
            state.vehicleDamages[state.selectedViatura] = [];
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

        state.surveyStatus[state.selectedViatura][categoriaSalva] = true;
        renderViaturaDashboard();
        updateMenuStatus();
        state.vistoriasCache = [];
        state.dadosTemporariosVistoria = null;
        alert("✅ Vistoria salva com sucesso!");

        if (!isVistoriaParcial(viaturaSalva) && categoriaSalva === "tablets" && todasEtapasConcluidas(viaturaSalva)) {
            await gerarRelatorioViatura(viaturaSalva, {
                confirmar: false,
                resetarStatus: true,
                categorias: Object.keys(categoryNames)
            });
        }
    } catch (error) {
        console.error("Erro ao salvar no Firestore: ", error);
        alert("Erro ao salvar dados no Firebase.");
    }
}

function bindWindowFunctions() {
    Object.assign(window, {
        toggleMenu,
        loginApp,
        selecionarVistoriadorAtivo,
        selecionarResponsavelTablet,
        selecionarTecnicoVistoriaAtual,
        selecionarAuxiliarVistoriaAtual,
        selecionarResponsavelPorPesquisa,
        configurarModoVistoria,
        showHome,
        showPage,
        selecionarPessoaEpi,
        finalizarVistoria,
        selectViatura,
        loginAdmin,
        logoutAdmin,
        limparHistoricoConfig,
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
        editarNomeViatura,
        editarResponsavelViatura,
        selecionarTecnicoViatura,
        selecionarAuxiliarViatura,
        alternarViaturaAtiva,
        removerViatura,
        renderAdminChecklist,
        showAdminConfigTab,
        abrirPaginaHistoricoVistorias,
        adicionarItemChecklist,
        editarItemChecklist,
        alternarItemChecklist,
        removerItemChecklist,
        substituirItemChecklist,
        confirmarEnvioFinal,
        abrirModalRevisao,
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
        setDamageType,
        marcarAvaria,
        removerAvaria,
        limparAvariasViatura,
        setTabletDamageType,
        marcarAvariaTablet,
        removerAvariaTablet,
        limparAvariasTablet
    });
}

window.onclick = function(event) {
    if (!event.target.matches(".menu-btn")) {
        const dropdown = document.getElementById("menu-list");
        if (dropdown.classList.contains("show")) dropdown.classList.remove("show");
    }
};

document.addEventListener("DOMContentLoaded", () => {
    const vistoriadorSalvo = localStorage.getItem("vistoriadorAtivo");
    const vistoriadorSelect = document.getElementById("vistoriador-atual");
    if (vistoriadorSalvo && vistoriadorSelect) vistoriadorSelect.value = vistoriadorSalvo;
    const checkingDate = document.getElementById("checking-date");
    if (checkingDate && !checkingDate.value) checkingDate.value = new Date().toLocaleDateString("sv-SE");
    renderTecnicoDatalist();
    preencherResponsaveisViatura();

    setPdfUiCallbacks({ renderViaturaDashboard, updateMenuStatus });
    setAuthReadyCallback(async () => {
        selecionarVistoriadorPorLogin();
        renderTecnicoDatalist();
        preencherResponsaveisViatura();
        renderItems("ferramentas");
        renderViaturaDashboard();
        updateVehicleMapImage();
        updateTabletInfo();
        updateMenuStatus();
        updateVistoriaModeUI();
        selecionarVistoriadorAtivo(true);
        if (sessionStorage.getItem("abrirPainelAdmin") === "1") {
            sessionStorage.removeItem("abrirPainelAdmin");
            showPage("admin");
        }
    });
    initAdminAuthListener();
});

bindWindowFunctions();

window.refreshAppAfterConfigChange = function() {
    renderTecnicoDatalist();
    preencherResponsaveisViatura();
    renderViaturaDashboard();
    updateMenuStatus();
    const activeTab = document.querySelector(".tab-content.active");
    if (document.getElementById("funcionarios-list")) {
        renderFuncionariosPage();
    }
    if (activeTab && activeTab.id !== "funcionarios") {
        renderItems(activeTab.id);
    }
};
