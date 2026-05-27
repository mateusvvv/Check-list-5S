import { categoryNames, damageTypeNames, formatTwoDigits, getVehicleMapConfig, vehicleViewNames } from "./config.js";
import { collection, db, getDocs, limit, orderBy, query } from "./firebase.js";
import { getDamageColor, getDamageMarkerLabel, renderDamageList, renderDamageMarkers, renderTabletDamageList, renderTabletDamageMarkers } from "./damages.js";
import {
    buscarVistoriasLocaisHoje,
    buscarVistoriasLocaisViatura,
    getCategoriasConcluidas,
    getActiveViaturas,
    isVistoriaParcial,
    state,
    todasEtapasConcluidas
} from "./state.js";

let uiCallbacks = {
    renderViaturaDashboard: () => {},
    updateMenuStatus: () => {}
};

export function setPdfUiCallbacks(callbacks) {
    uiCallbacks = { ...uiCallbacks, ...callbacks };
}

export function getInicioFimHoje() {
    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    const fim = new Date();
    fim.setHours(23, 59, 59, 999);
    return { inicio, fim };
}

export function getDataEnvioDate(vistoria) {
    return vistoria?.dataEnvio?.toDate?.() || vistoria?.dataEnvioLocal || new Date();
}

export function sortVistoriasPorCategoria(dados) {
    return dados.sort((a, b) => {
        const viaturaDiff = Number(a.viaturaId || 0) - Number(b.viaturaId || 0);
        if (viaturaDiff !== 0) return viaturaDiff;
        return Object.keys(categoryNames).indexOf(a.categoria) - Object.keys(categoryNames).indexOf(b.categoria);
    });
}

function ensurePdfSpace(pdf, currentY, neededSpace) {
    if (currentY + neededSpace > 280) {
        pdf.addPage();
        return 20;
    }
    return currentY;
}

function addWrappedPdfText(pdf, text, x, y, width, lineHeight = 4) {
    const lines = pdf.splitTextToSize(text, width);
    lines.forEach((line) => {
        y = ensurePdfSpace(pdf, y, lineHeight + 2);
        pdf.text(line, x, y);
        y += lineHeight;
    });
    return y;
}

function adicionarTermoResponsabilidade(pdf, startY) {
    let y = ensurePdfSpace(pdf, startY, 60);
    const termo = [
        "TERMO DE RESPONSABILIDADE DE USO DE FERRAMENTAS",
        "Na condição de funcionário da empresa DIGITAL, inscrita no CNPJ/MF sob o nº 07.578.965/0001-05, com sede na cidade de Belo Jardim, Estado de Pernambuco, declaro receber, neste ato, o equipamento de trabalho administrativo, neste ato designado de BEM, em perfeito estado de conservação e funcionamento, e comprometo-me, pelo presente TERMO DE RESPONSABILIDADE, a usá-lo, exclusivamente, no desempenho de minhas funções, bem como a conservá-lo no mesmo estado, e, ainda, a devolvê-lo à empresa, por sua solicitação ou quando vier a me desligar de seus quadros funcionais, ocasião em que será devolvida a via deste Termo por mim assinada, ora entregue à empresa.",
        "Estou ciente de que o consumo em ligações ou o consumo de outros serviços da operadora realizado que não estejam no grupo de serviços gratuitos informados pela empresa, ou ainda, danos porventura causados ao BEM, decorrentes de culpa minha, autorizarão a empresa a proceder aos descontos de meus créditos salariais ou rescisórios, conforme autorizam os artigos 462 § 1º e 477, § 5º, ambos da CLT.",
        "Comprometo-me assim especificamente a:",
        "Não emprestar ou permitir o uso do BEM por terceiros;",
        "A acionar de imediato o Departamento Responsável ao detectar qualquer problema no equipamento para prévia manutenção;",
        "Em caso de furto ou roubo do equipamento, prestar queixa à delegacia policial e apresentar à empresa a cópia do Boletim de Ocorrência ou informar ao Departamento responsável o mais rápido possível."
    ];

    pdf.setFontSize(10);
    pdf.setFont("helvetica", "bold");
    pdf.text(termo[0], 10, y);
    y += 7;
    pdf.setFont("helvetica", "normal");

    termo.slice(1).forEach((paragraph) => {
        y = ensurePdfSpace(pdf, y, 24);
        y = addWrappedPdfText(pdf, paragraph, 10, y, 188, 4) + 4;
    });

    y = ensurePdfSpace(pdf, y, 48);
    y += 8;
    pdf.line(10, y, 92, y);
    pdf.line(112, y, 194, y);
    y += 5;
    pdf.text("Técnico responsável da viatura", 17, y);
    pdf.text("Auxiliar técnico", 137, y);
    y += 8;
    pdf.text("Nome:", 10, y);
    pdf.line(24, y, 92, y);
    pdf.text("Nome:", 112, y);
    pdf.line(126, y, 194, y);
    y += 9;
    pdf.text("Assinatura:", 10, y);
    pdf.line(31, y, 92, y);
    pdf.text("Assinatura:", 112, y);
    pdf.line(133, y, 194, y);

    return y + 10;
}

function getCategoryFromInput(value) {
    const normalized = value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    const aliases = {
        ferramentas: "ferramentas",
        ferramenta: "ferramentas",
        epis: "epis",
        epi: "epis",
        viatura: "viaturas",
        viaturas: "viaturas",
        carro: "viaturas",
        tablet: "tablets",
        tablets: "tablets"
    };

    return aliases[normalized] || null;
}

function getCategoriesFromInput(value) {
    const normalized = value.trim().toUpperCase();
    if (normalized === "TODAS" || normalized === "TODOS") {
        return Object.keys(categoryNames);
    }

    return value
        .split(/[,;+]/)
        .map(part => getCategoryFromInput(part))
        .filter((category, index, list) => category && list.indexOf(category) === index);
}

function getCategoryPromptDefault() {
    const activeTab = document.querySelector(".tab-content.active");
    return categoryNames[activeTab?.id] ? categoryNames[activeTab.id] : "TODAS";
}

function buildReportTitle(viaturaId, categorias) {
    if (categorias.length === 1) {
        return `Vistoria Viatura ${formatTwoDigits(viaturaId)} - ${categoryNames[categorias[0]]}`;
    }
    return `Vistoria Viatura ${formatTwoDigits(viaturaId)}`;
}

function carregarImagem(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
    });
}

async function criarMapaAvariasDataUrl(src, avarias, options = {}) {
    const image = await carregarImagem(src);
    const maxWidth = 900;
    const scale = Math.min(1, maxWidth / image.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    avarias.forEach((avaria, index) => {
        const x = (Number(avaria.x) / 100) * canvas.width;
        const y = (Number(avaria.y) / 100) * canvas.height;
        const radius = Math.max(12, canvas.width * 0.018);

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = getDamageColor(avaria.type);
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${Math.round(radius * 1.05)}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(options.useTypeLabels ? getDamageMarkerLabel(avaria.type) : String(index + 1), x, y);
    });

    return {
        dataUrl: canvas.toDataURL("image/png"),
        width: canvas.width,
        height: canvas.height
    };
}

export async function gerarPDF(titulo, dados, options = {}) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const reportName = options.reportName || titulo.replace(/_/g, " ");
    const columnWidth = 90;
    const columns = [{ x: 10, y: 36 }, { x: 108, y: 36 }];
    const cursor = { col: 0, y: 36 };
    const ordemPaginas = [["ferramentas", "epis"], ["viaturas", "tablets"]];

    function addPdfHeader() {
        doc.setFillColor(0, 86, 179);
        doc.rect(0, 0, 210, 24, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text("DIGITAL Vistoria", 10, 10);
        doc.setFontSize(10);
        doc.text(reportName, 10, 17);
        doc.setFont("helvetica", "normal");
        doc.text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, 140, 10);
        doc.setTextColor(51, 51, 51);
    }

    function resetCursor() {
        cursor.col = 0;
        cursor.y = columns[0].y;
    }

    function addContentPage() {
        doc.addPage();
        addPdfHeader();
        resetCursor();
    }

    function nextColumn() {
        if (cursor.col === 0) {
            cursor.col = 1;
            cursor.y = columns[1].y;
            return;
        }
        addContentPage();
    }

    function ensureColumnSpace(height) {
        if (cursor.y + height > 282) nextColumn();
    }

    function addColumnText(text, opts = {}) {
        const x = columns[cursor.col].x;
        const size = opts.size || 8;
        const lineHeight = opts.lineHeight || 4;
        doc.setFont("helvetica", opts.bold ? "bold" : "normal");
        doc.setFontSize(size);
        const lines = doc.splitTextToSize(text, columnWidth);
        lines.forEach((line) => {
            ensureColumnSpace(lineHeight + 2);
            doc.text(line, x, cursor.y);
            cursor.y += lineHeight;
        });
    }

    function addSectionDivider() {
        ensureColumnSpace(8);
        const x = columns[cursor.col].x;
        doc.setDrawColor(220, 220, 220);
        doc.line(x, cursor.y, x + columnWidth, cursor.y);
        cursor.y += 6;
    }

    function addColumnImage(imageData) {
        const x = columns[cursor.col].x;
        const imageWidth = columnWidth;
        const imageHeight = imageWidth * (imageData.height / imageData.width);
        ensureColumnSpace(imageHeight + 8);
        doc.addImage(imageData.dataUrl, "PNG", x, cursor.y, imageWidth, imageHeight);
        cursor.y += imageHeight + 6;
    }

    async function addVistoria(v) {
        ensureColumnSpace(28);
        if (cursor.y > columns[cursor.col].y) cursor.y += 3;

        const dataObj = getDataEnvioDate(v);
        const equipamento = v.categoria === "tablets"
            ? `Tablet ${formatTwoDigits(v.tabletId || v.viaturaId)} / Viatura ${formatTwoDigits(v.viaturaId)}`
            : `Viatura ${formatTwoDigits(v.viaturaId)}`;
        addColumnText(`${equipamento} - ${categoryNames[v.categoria] || v.categoria}`, { bold: true, size: 10, lineHeight: 5 });
        addColumnText(`Vistoriador: ${v.vistoriador}`);
        if (v.tecnicoCpf) addColumnText(`CPF Técnico: ${v.tecnicoCpf}`);
        if (v.auxiliarTecnico) addColumnText(`Auxiliar Técnico: ${v.auxiliarTecnico}`);
        if (v.auxiliarCpf) addColumnText(`CPF Auxiliar: ${v.auxiliarCpf}`);
        if (v.dataVistoria) addColumnText(`Data da vistoria: ${String(v.dataVistoria).split("-").reverse().join("/")}`);
        addColumnText(`Data: ${dataObj.toLocaleString("pt-BR")}`);

        if (v.km) addColumnText(`KM: ${v.km}`);
        if (v.categoria === "tablets" && v.observacoesTablet) addColumnText(`Observações: ${v.observacoesTablet}`);

        if (v.avarias && v.avarias.length > 0) {
            addColumnText("Avarias visuais:", { bold: true });
            v.avarias.forEach((avaria) => {
                const linhaAvaria = `${getDamageMarkerLabel(avaria.type)} - ${damageTypeNames[avaria.type] || avaria.type} - ${vehicleViewNames[avaria.view] || avaria.view}`;
                addColumnText(linhaAvaria);
            });
            const vehicleImage = await criarMapaAvariasDataUrl(getVehicleMapConfig(v.viaturaId).src, v.avarias, { useTypeLabels: true });
            addColumnImage(vehicleImage);
        }

        if (v.avariasTablet && v.avariasTablet.length > 0) {
            addColumnText("Avarias do tablet:", { bold: true });
            v.avariasTablet.forEach((avaria) => {
                const linhaAvaria = `${getDamageMarkerLabel(avaria.type)} - ${damageTypeNames[avaria.type] || avaria.type} - ${avaria.view}`;
                addColumnText(linhaAvaria);
            });
            const tabletImage = await criarMapaAvariasDataUrl("assets/tablet-mapa.png", v.avariasTablet, { useTypeLabels: true });
            addColumnImage(tabletImage);
        }

        addColumnText("Itens:", { bold: true });
        v.itens.forEach(item => {
            const s = item.status || "pendente";
            const quantidade = Number(item.quantidade || 0);
            const valor = Number(item.valorUnitario || 0);
            const total = Number(item.total || quantidade * valor);
            let linha = `${quantidade || "-"}x ${item.item} - R$ ${valor.toFixed(2)} - Total R$ ${total.toFixed(2)} - ${s === "ok" ? "[OK]" : `[${s.toUpperCase()}]`}`;
            if (item.observacao) linha += ` - Motivo: ${item.observacao}`;
            addColumnText(linha);
        });

        addSectionDivider();
    }

    addPdfHeader();

    const dadosPorCategoria = {};
    sortVistoriasPorCategoria(dados).forEach((vistoria) => {
        if (!dadosPorCategoria[vistoria.categoria]) dadosPorCategoria[vistoria.categoria] = [];
        dadosPorCategoria[vistoria.categoria].push(vistoria);
    });

    let wrotePage = false;
    for (const categoriasDaPagina of ordemPaginas) {
        const dadosDaPagina = categoriasDaPagina.flatMap(category => dadosPorCategoria[category] || []);
        if (dadosDaPagina.length === 0) continue;

        if (wrotePage) addContentPage();
        resetCursor();
        for (const vistoria of dadosDaPagina) await addVistoria(vistoria);
        wrotePage = true;
    }

    doc.addPage();
    addPdfHeader();
    adicionarTermoResponsabilidade(doc, 36);
    doc.save(`${titulo.replace(/\s+/g, "_")}.pdf`);
}

export async function buscarVistoriasDeHoje() {
    const { inicio, fim } = getInicioFimHoje();
    const q = query(collection(db, "vistorias"), orderBy("dataEnvio", "desc"));
    const snapshot = await getDocs(q);
    const dados = [];
    snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const dataEnvio = data.dataEnvio?.toDate?.();
        if (dataEnvio && dataEnvio >= inicio && dataEnvio <= fim) {
            dados.push({ id: docSnap.id, ...data });
        }
    });
    return dados;
}

export async function gerarRelatorioViatura(viaturaId = state.selectedViatura, options = {}) {
    const { confirmar = true, resetarStatus = true, categorias = Object.keys(categoryNames) } = options;
    try {
        let dadosViatura = [];

        try {
            const q = query(collection(db, "vistorias"), orderBy("dataEnvio", "desc"), limit(200));
            const querySnapshot = await getDocs(q);
            const porCategoria = {};
            querySnapshot.forEach(doc => {
                const data = doc.data();
                if (String(data.viaturaId) !== String(viaturaId)) return;
                if (!porCategoria[data.categoria]) porCategoria[data.categoria] = data;
            });
            dadosViatura = categorias.map(category => porCategoria[category]).filter(Boolean);
            sortVistoriasPorCategoria(dadosViatura);
        } catch (error) {
            console.warn("Não foi possível ler o histórico no Firebase. Usando vistorias locais da sessão.", error);
            dadosViatura = buscarVistoriasLocaisViatura(viaturaId, categorias, sortVistoriasPorCategoria);
        }

        if (dadosViatura.length === 0) {
            const categoriasLabel = categorias.map(category => categoryNames[category]).join(", ");
            alert(`Nenhuma vistoria salva foi encontrada para: ${categoriasLabel}. Se ela foi salva em outro aparelho, faça login no Painel Admin para gerar pelo histórico.`);
            return;
        }

        if (!confirmar || confirm(`Deseja gerar o relatório PDF da Viatura ${formatTwoDigits(viaturaId)}?`)) {
            const sufixoCategoria = categorias.length === 1 ? `_${categoryNames[categorias[0]]}` : "";
            await gerarPDF(`Relatorio_Vistoria_Viatura_${formatTwoDigits(viaturaId)}${sufixoCategoria}`, dadosViatura, {
                reportName: buildReportTitle(viaturaId, categorias)
            });

            if (resetarStatus) {
                const categoriasGeradas = [...new Set(dadosViatura.map(v => v.categoria))];
                categoriasGeradas.forEach((category) => {
                    if (state.surveyStatus[viaturaId]) state.surveyStatus[viaturaId][category] = false;
                });
                if (categoriasGeradas.includes("viaturas")) state.vehicleDamages[viaturaId] = [];
                if (categoriasGeradas.includes("tablets")) state.tabletDamages[viaturaId] = [];
                uiCallbacks.renderViaturaDashboard();
                renderDamageMarkers();
                renderDamageList();
                renderTabletDamageMarkers();
                renderTabletDamageList();
                uiCallbacks.updateMenuStatus();
            }
            alert("Vistoria encerrada e PDF gerado!");
        }
    } catch (error) {
        console.error("Erro detalhado do Firebase:", error);
        alert("Erro ao buscar dados no Firebase: " + error.message);
    }
}

async function gerarRelatorioTodasViaturasHoje(categorias = Object.keys(categoryNames)) {
    let filtrados = [];

    try {
        const dadosHoje = await buscarVistoriasDeHoje();
        filtrados = dadosHoje.filter(v => categorias.includes(v.categoria));
    } catch (error) {
        console.warn("Não foi possível ler as vistorias do dia no Firebase. Usando vistorias locais da sessão.", error);
        filtrados = buscarVistoriasLocaisHoje(categorias, sortVistoriasPorCategoria, getInicioFimHoje, getDataEnvioDate);
    }

    if (filtrados.length === 0) {
        const categoriasLabel = categorias.map(category => categoryNames[category]).join(", ");
        alert(`Nenhuma vistoria salva hoje foi encontrada para: ${categoriasLabel}.`);
        return;
    }

    sortVistoriasPorCategoria(filtrados);
    const sufixoCategoria = categorias.length === 1 ? `_${categoryNames[categorias[0]]}` : "";
    await gerarPDF(`Relatorio_5S_Todas_Viaturas_Hoje${sufixoCategoria}`, filtrados, {
        reportName: categorias.length === 1
            ? `Vistoria 5S - ${categoryNames[categorias[0]]} do dia`
            : "Vistoria 5S - Todas as viaturas do dia"
    });
}

export async function gerarRelatorioComEscolha(options = {}) {
    const resposta = prompt(
        `Gerar PDF de qual vistoria?\n\nDigite o número da viatura, por exemplo: ${state.selectedViatura.padStart(2, "0")}\nOu digite TODAS para gerar todas as viaturas vistoriadas hoje.`,
        state.selectedViatura.padStart(2, "0")
    );

    if (!resposta) return;

    const valor = resposta.trim().toUpperCase();
    const gerarTodas = valor === "TODAS" || valor === "TODOS";
    const viaturaId = gerarTodas ? null : String(Number(valor));
    const viaturaValida = getActiveViaturas().some(viatura => viatura.id === viaturaId);
    if (!gerarTodas && (!viaturaId || viaturaId === "NaN" || !viaturaValida)) {
        alert("Informe uma viatura ativa válida ou digite TODAS.");
        return;
    }

    const respostaCategoria = prompt(
        "Gerar PDF de qual etapa?\n\nDigite TODAS ou uma/mais etapas separadas por vírgula:\nFERRAMENTAS, EPIS, VIATURA, TABLET.",
        isVistoriaParcial(viaturaId || state.selectedViatura)
            ? getCategoriasConcluidas(viaturaId || state.selectedViatura).map(category => categoryNames[category]).join(", ")
            : getCategoryPromptDefault()
    );

    if (!respostaCategoria) return;

    let categorias = getCategoriesFromInput(respostaCategoria);
    if (categorias.length === 0) {
        alert("Informe uma etapa válida: TODAS, FERRAMENTAS, EPIS, VIATURA ou TABLET.");
        return;
    }

    if (!gerarTodas && isVistoriaParcial(viaturaId)) {
        const concluidas = getCategoriasConcluidas(viaturaId);
        categorias = categorias.filter(category => concluidas.includes(category));
        if (categorias.length === 0) {
            alert("No modo parcial, escolha apenas etapas que já foram finalizadas nesta viatura.");
            return;
        }
    }

    if (gerarTodas) {
        await gerarRelatorioTodasViaturasHoje(categorias);
        return;
    }

    await gerarRelatorioViatura(viaturaId, {
        confirmar: false,
        resetarStatus: options.resetarStatus && viaturaId === state.selectedViatura,
        categorias
    });
}

export async function encerrarVistoriaCompleta() {
    if (!isVistoriaParcial() && todasEtapasConcluidas(state.selectedViatura)) {
        await gerarRelatorioViatura(state.selectedViatura, {
            confirmar: false,
            resetarStatus: true,
            categorias: Object.keys(categoryNames)
        });
        return;
    }

    await gerarRelatorioComEscolha({ resetarStatus: true });
}
