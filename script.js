import { checklistData, categoryNames, totalViaturas, vistoriadoresTablet } from "./js/config.js";
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
    exportarHistoricoPDF,
    initAdminAuthListener,
    loginAdmin,
    logoutAdmin,
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
    isVistoriaParcial,
    salvarVistoriaLocal,
    setSelectedViatura,
    state,
    todasEtapasConcluidas
} from "./js/state.js";

function getVistoriadorAtivo() {
    return document.getElementById("vistoriador-atual")?.value || "";
}

function isTabletOnlyUser(vistoriador = getVistoriadorAtivo()) {
    return vistoriadoresTablet.includes(vistoriador);
}

function podeAcessarCategoria(category, vistoriador = getVistoriadorAtivo()) {
    if (!categoryNames[category]) return true;
    return !isTabletOnlyUser(vistoriador) || category === "tablets";
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
        link.classList.toggle("restricted", !podeAcessarCategoria(category, vistoriador));
    });
}

function selecionarVistoriadorAtivo(silent = false) {
    const vistoriador = getVistoriadorAtivo();
    localStorage.setItem("vistoriadorAtivo", vistoriador);
    updateVistoriadorLogado();
    syncTabletVistoriador();
    updateAccessByVistoriador();

    const activeTab = document.querySelector(".tab-content.active");
    if (activeTab && !podeAcessarCategoria(activeTab.id, vistoriador)) {
        if (!silent) alert(`${vistoriador} pode realizar apenas vistorias de tablets.`);
        showPage("tablets");
    }
}

function selecionarResponsavelTablet() {
    const tabletSelect = document.getElementById("tablet-vistoriador");
    const vistoriadorSelect = document.getElementById("vistoriador-atual");
    const responsavel = tabletSelect?.value || "";

    if (!vistoriadorSelect || !vistoriadoresTablet.includes(responsavel)) return;

    vistoriadorSelect.value = responsavel;
    selecionarVistoriadorAtivo(true);
}

function toggleMenu() {
    document.getElementById("menu-list").classList.toggle("show");
}

function showHome() {
    showPage(isTabletOnlyUser() ? "tablets" : "ferramentas");
}

function showPage(pageId) {
    const vistoriador = getVistoriadorAtivo();
    if (!podeAcessarCategoria(pageId, vistoriador)) {
        alert(`${vistoriador} pode realizar apenas vistorias de tablets.`);
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
    const items = checklistData[pageId];
    if (!container || !items) return;

    container.innerHTML = items.map((item, index) => `
        <div class="checklist-item" id="row-${pageId}-${index}">
            <label class="item-label">${item}<span class="error-msg">⚠️ Seleção obrigatória</span></label>
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
            </div>
        </div>
    `).join("");

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

function renderViaturaDashboard() {
    const grid = document.getElementById("viaturas-grid");
    if (!grid) return;

    grid.innerHTML = "";

    for (let i = 1; i <= totalViaturas; i++) {
        const id = i.toString();
        const status = state.surveyStatus[id];
        const isActive = state.selectedViatura === id;

        const card = document.createElement("div");
        card.className = `viatura-card ${isActive ? "active" : ""}`;
        card.onclick = () => selectViatura(id);
        card.innerHTML = `
            <span class="viatura-name">Viatura ${id.padStart(2, "0")}</span>
            <div class="status-dots">
                <span class="dot ${status.ferramentas ? "done" : ""}" title="Ferramentas">🔧</span>
                <span class="dot ${status.epis ? "done" : ""}" title="EPIs">🦺</span>
                <span class="dot ${status.viaturas ? "done" : ""}" title="Viatura">🚗</span>
                <span class="dot ${status.tablets ? "done" : ""}" title="Tablet">📱</span>
            </div>
        `;
        grid.appendChild(card);
    }
}

function selectViatura(id) {
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

    const items = checklistData[category];
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
        checklistResults.push({ item: items[i], status: radio.value, observacao: "" });
    }

    if (temErro) {
        alert("Existem itens sem marcação. Por favor, verifique os campos destacados em vermelho.");
        return;
    }

    state.dadosTemporariosVistoria = {
        viaturaId: state.selectedViatura,
        tabletId: category === "tablets" ? state.selectedViatura : null,
        vistoriador,
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
            <textarea id="rev-obs-${index}" placeholder="Descreva o motivo (obrigatório)..." required></textarea>
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
        selecionarVistoriadorAtivo,
        selecionarResponsavelTablet,
        configurarModoVistoria,
        showHome,
        showPage,
        finalizarVistoria,
        selectViatura,
        loginAdmin,
        logoutAdmin,
        verDetalhes,
        closeModal,
        encerrarVistoriaCompleta,
        exportarHistoricoPDF,
        aplicarFiltros,
        carregarHistorico,
        toggleSelecionarVistoria,
        toggleSelecionarTodasVistorias,
        excluirVistoriasSelecionadas,
        confirmarEnvioFinal,
        abrirModalRevisao,
        limparErroItem,
        fecharModalRevisao,
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

    setPdfUiCallbacks({ renderViaturaDashboard, updateMenuStatus });
    initAdminAuthListener();
    renderItems("ferramentas");
    renderViaturaDashboard();
    updateVehicleMapImage();
    updateTabletInfo();
    updateMenuStatus();
    updateVistoriaModeUI();
    selecionarVistoriadorAtivo(true);
});

bindWindowFunctions();
