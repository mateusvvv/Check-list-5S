import { categoryNames, getChecklistItems, getItemName, getChecklistItemDefaults, vistoriadoresTablet } from "./js/config.js";
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
    adicionarViatura,
    alternarItemChecklist,
    alternarViaturaAtiva,
    editarItemChecklist,
    editarNomeViatura,
    removerViatura,
    removerItemChecklist,
    renderAdminChecklist,
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
    if (headerInfo) headerInfo.style.display = pageId === "admin" ? "none" : "block";

    document.querySelectorAll(".tab-content").forEach(content => content.classList.remove("active"));

    const activePage = document.getElementById(pageId);
    if (activePage) {
        activePage.classList.add("active");
        renderItems(pageId);
    }

    if (pageId === "admin" && auth.currentUser) carregarHistorico();

    document.getElementById("menu-list").classList.remove("show");
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderItems(pageId) {
    const containerMapping = {
        ferramentas: "lista-ferramentas",
        epis: "lista-epis",
        viaturas: "lista-viaturas",
        tablets: "lista-tablets"
    };
    const container = document.getElementById(containerMapping[pageId]);
    const items = getChecklistItems(pageId, state.selectedViatura).filter(item => item.ativo !== false);
    if (!container || !items) return;

    container.innerHTML = items.map((item, index) => {
        const itemName = getItemName(item);
        const defaults = getChecklistItemDefaults(pageId, itemName);
        const quantidade = Number(defaults.quantidade || 1);
        const valor = Number(defaults.valor || 0);
        const total = quantidade * valor;
        const ultimaSubstituicao = item.substituicoes?.at?.(-1);
        const descricaoSubstituicao = ultimaSubstituicao
            ? `${ultimaSubstituicao.itemAnterior} foi substituído por ${ultimaSubstituicao.itemNovo || itemName}.`
            : "";

        return `
        <div class="checklist-item" id="row-${pageId}-${index}">
            <div class="checklist-item-header">
                <div class="item-quantity-field">
                    <label for="qtd-${pageId}-${index}">QTD</label>
                    <input type="number" id="qtd-${pageId}-${index}" min="0" step="1" value="${quantidade}" oninput="atualizarTotalItem('${pageId}', ${index})">
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

    const items = getChecklistItems(category, state.selectedViatura).filter(item => item.ativo !== false);
    const checklistResults = [];
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

        checklistResults.push({
            item: getItemName(items[i]),
            quantidade,
            valorUnitario,
            total: quantidade * valorUnitario,
            status: radio.value,
            observacao
        });
    }

    if (temErro) {
        alert("Existem itens sem marcação. Por favor, verifique os campos destacados em vermelho.");
        return;
    }

    state.dadosTemporariosVistoria = {
        viaturaId: state.selectedViatura,
        tabletId: category === "tablets" ? state.selectedViatura : null,
        vistoriador,
        dataVistoria: dataVistoriaInput?.value || new Date().toLocaleDateString("sv-SE"),
        tecnicoCpf: tecnicoCpfInput?.value.trim() || "",
        auxiliarTecnico: auxiliarNomeInput?.value.trim() || "",
        auxiliarCpf: auxiliarCpfInput?.value.trim() || "",
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
        configurarModoVistoria,
        showHome,
        showPage,
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
        editarNomeViatura,
        alternarViaturaAtiva,
        removerViatura,
        renderAdminChecklist,
        showAdminConfigTab,
        adicionarItemChecklist,
        editarItemChecklist,
        alternarItemChecklist,
        removerItemChecklist,
        substituirItemChecklist,
        confirmarEnvioFinal,
        abrirModalRevisao,
        atualizarTotalItem,
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

    setPdfUiCallbacks({ renderViaturaDashboard, updateMenuStatus });
    setAuthReadyCallback(async () => {
        selecionarVistoriadorPorLogin();
        renderItems("ferramentas");
        renderViaturaDashboard();
        updateVehicleMapImage();
        updateTabletInfo();
        updateMenuStatus();
        updateVistoriaModeUI();
        selecionarVistoriadorAtivo(true);
    });
    initAdminAuthListener();
});

bindWindowFunctions();

window.refreshAppAfterConfigChange = function() {
    renderViaturaDashboard();
    updateMenuStatus();
    const activeTab = document.querySelector(".tab-content.active");
    if (activeTab) renderItems(activeTab.id);
};
