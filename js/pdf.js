import { categoryNames, damageTypeNames, formatTwoDigits, getVehicleMapConfig, vehicleViewNames } from "./config.js";
import { collection, db, getDocs, orderBy, query, where } from "./firebase.js";
import { getDamageColor, getDamageMarkerLabel, renderDamageList, renderDamageMarkers, renderTabletDamageList, renderTabletDamageMarkers } from "./damages.js";
import {
    buscarVistoriasLocaisHoje,
    buscarVistoriasLocaisViatura,
    getActiveViaturas,
    isVistoriaParcial,
    state,
    todasEtapasConcluidas
} from "./state.js";
import { getDataEnvioDate, getInicioFimData, getInicioFimHoje, sortVistoriasPorCategoria } from "./utils.js";

const uiCallbacks = {
    renderViaturaDashboard: () => {},
    updateMenuStatus: () => {}
};

const CHECKLIST_REPORT_CATEGORIES = ["ferramentas", "epis", "viaturas", "tablets"];
const PDF_REPORT_CATEGORIES = [...CHECKLIST_REPORT_CATEGORIES, "notebooks"];

export function setPdfUiCallbacks(callbacks = {}) {
    Object.assign(uiCallbacks, callbacks);
}


function getTipoVistoriaLabel(tipo) {
    return tipo === "parcial" ? "Vistoria parcial" : "Vistoria completa";
}

function inferirTipoVistoria(dados, categorias = []) {
    const tipos = [...new Set(dados.map(vistoria => vistoria.tipoVistoria).filter(Boolean))];
    if (tipos.length === 1) return tipos[0] === "parcial" ? "parcial" : "completa";
    const categoriasSelecionadas = categorias.length
        ? categorias
        : [...new Set(dados.map(vistoria => vistoria.categoria).filter(Boolean))];
    return categoriasSelecionadas.length === Object.keys(categoryNames).length ? "completa" : "parcial";
}

function normalizeNotebookTermType(value) {
    const normalized = String(value || "")
        .trim()
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    if (normalized === "RETORNO" || normalized === "DEVOLUCAO") return "RETORNO";
    return "SAIDA";
}

function getNotebookPdfFileName(notebookTermType) {
    return normalizeNotebookTermType(notebookTermType) === "RETORNO"
        ? "vistoria devolução.pdf"
        : "vistoria retirada.pdf";
}

function getPdfSaveFileName(titulo, dados = [], options = {}) {
    if (options.fileName) return options.fileName;

    const categorias = Array.isArray(options.categorias) && options.categorias.length > 0
        ? options.categorias
        : [...new Set(dados.map(vistoria => vistoria?.categoria).filter(Boolean))];

    if (categorias.length === 1 && categorias[0] === "notebooks") {
        const notebook = dados.find(vistoria => vistoria?.categoria === "notebooks") || {};
        return getNotebookPdfFileName(options.notebookTermType || notebook.notebookTermType);
    }

    return `${titulo.replace(/\s+/g, "_")}.pdf`;
}

function getEpiPessoaKey(vistoria) {
    return vistoria.epiResponsavelCpf || vistoria.epiResponsavelNome || "sem-responsavel";
}

function getVistoriaReportKey(vistoria) {
    if (vistoria.categoria === "epis") return `epis:${getEpiPessoaKey(vistoria)}`;
    return vistoria.categoria;
}

function getVistoriaDataChaves(vistoria) {
    const datas = new Set();
    const dataVistoria = String(vistoria.dataVistoria || "").trim();
    if (dataVistoria) datas.add(dataVistoria);

    const dataEnvio = getDataEnvioDate(vistoria);
    if (dataEnvio.getTime() > 0) datas.add(dataEnvio.toLocaleDateString("sv-SE"));

    return datas.size > 0 ? [...datas] : [""];
}

function getVistoriaConsolidadaKeys(vistoria) {
    const viaturaId = String(vistoria.viaturaId || "").trim();
    return getVistoriaDataChaves(vistoria).map(data => `${viaturaId}|${data}`);
}

function normalizarDadosRelatorio(dados = []) {
    const lista = Array.isArray(dados) ? dados.filter(Boolean) : [];
    const chavesComConsolidado = new Set();

    lista.forEach((vistoria) => {
        if (vistoria.categoria !== "todas") return;
        getVistoriaConsolidadaKeys(vistoria).forEach(key => chavesComConsolidado.add(key));
    });

    if (chavesComConsolidado.size === 0) return lista;

    return lista.filter((vistoria) => {
        if (vistoria.categoria === "todas") return true;
        if (vistoria.tipoVistoria === "parcial") return true;
        return !getVistoriaConsolidadaKeys(vistoria).some(key => chavesComConsolidado.has(key));
    });
}

function selecionarVistoriasMaisRecentes(dados, viaturaId, categorias) {
    const categoriasSet = new Set(categorias);
    const isCompleteReport = CHECKLIST_REPORT_CATEGORIES.every(category => categoriasSet.has(category));

    if (isCompleteReport) {
        const completas = dados
            .filter(vistoria => vistoria.tipoRegistro !== "resolucaoPendencia")
            .filter(vistoria => String(vistoria.viaturaId) === String(viaturaId))
            .filter(vistoria => vistoria.categoria === "todas")
            .sort((a, b) => getDataEnvioDate(b).getTime() - getDataEnvioDate(a).getTime());

        if (completas.length > 0) return [completas[0]];
    }

    const porChave = new Map();

    dados.forEach((vistoria) => {
        if (vistoria.tipoRegistro === "resolucaoPendencia") return;
        if (String(vistoria.viaturaId) !== String(viaturaId)) return;
        if (vistoria.categoria === "todas") return;
        if (!categoriasSet.has(vistoria.categoria)) return;

        const key = getVistoriaReportKey(vistoria);
        const atual = porChave.get(key);
        const dataAtual = atual ? getDataEnvioDate(atual).getTime() : 0;
        const dataNova = getDataEnvioDate(vistoria).getTime();
        if (!atual || dataNova >= dataAtual) porChave.set(key, vistoria);
    });

    return sortVistoriasPorCategoria([...porChave.values()]);
}

function getItensSemDuplicidade(itens = []) {
    const vistos = new Set();
    return itens.filter((item) => {
        const key = [
            limparTextoRelatorio(item.item).toLowerCase(),
            Number(item.quantidade || 0),
            Number(item.valorUnitario || 0),
            String(item.status || ""),
            limparTextoRelatorio(item.ca || ""),
            limparTextoRelatorio(item.dataEntrega || ""),
            limparTextoRelatorio(item.observacao || "")
        ].join("|");
        if (vistos.has(key)) return false;
        vistos.add(key);
        return true;
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

function limparTextoRelatorio(value) {
    return String(value ?? "")
        .replace(/\bSansung\b/gi, "Samsung")
        .replace(/\bBoch\b/gi, "Bosch")
        .replace(/\bMaquina\b/g, "Máquina")
        .replace(/\bmaquina\b/g, "máquina")
        .replace(/\bFlexivel\b/g, "Flexível")
        .replace(/\bflexivel\b/g, "flexível")
        .replace(/\bAluminio\b/g, "Alumínio")
        .replace(/\baluminio\b/g, "alumínio")
        .replace(/\bAmperimétro\b/gi, "Amperímetro")
        .replace(/\bImpresora\b/gi, "Impressora")
        .replace(/\bMassarico\b/gi, "Maçarico")
        .replace(/\bGuicho\b/gi, "Guincho")
        .replace(/\bVERGALHÂO\b/gi, "Vergalhão")
        .replace(/\bKir localizador\b/gi, "Kit localizador")
        .replace(/\bsobresalente\b/gi, "sobressalente")
        .replace(/\bPolda galho\b/gi, "poda galho")
        .replace(/\bresponsaveie\b/gi, "responsáveis")
        .replace(/\bresponsabiliade\b/gi, "responsabilidade")
        .replace(/\bnegrio\b/gi, "negrito")
        .replace(/\s*\+\s*/g, " + ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

const TERMO_NOTEBOOK_SAIDA = [
    "TERMO DE RESPONSABILIDADE DE RETIRADA DE EQUIPAMENTOS (SAÍDA)",
    "OBJETIVO: O presente Termo tem por finalidade registrar a entrega dos equipamentos de propriedade da empresa ao colaborador acima identificado, para utilização durante plantões, atendimentos e atividades realizadas em finais de semana e feriados.",
    "RESPONSABILIDADES DO COLABORADOR: Declaro que recebi os equipamentos acima relacionados em perfeitas condições de uso, conforme checklist realizado pelo Técnico de Informática responsável.",
    "Comprometo-me a:",
    "• Utilizar os equipamentos exclusivamente para atividades relacionadas à empresa;",
    "• Zelar pela conservação e segurança dos equipamentos durante todo o período de posse;",
    "• Não emprestar, ceder ou transferir os equipamentos a terceiros;",
    "• Comunicar imediatamente qualquer dano, perda, furto, roubo ou mau funcionamento;",
    "• Devolver todos os equipamentos recebidos ao término do plantão ou quando solicitado pela empresa;",
    "• Entregar os equipamentos nas mesmas condições em que foram recebidos, ressalvado o desgaste natural decorrente do uso adequado.",
    "DECLARAÇÃO: Declaro estar ciente de que os equipamentos são patrimônio da empresa e que sua utilização deve ocorrer de forma responsável, observando as normas internas e políticas de segurança da informação."
];

const TERMO_NOTEBOOK_RETORNO = [
    "TERMO DE DEVOLUÇÃO DE EQUIPAMENTOS (RETORNO)",
    "DECLARAÇÃO DE DEVOLUÇÃO",
    "O colaborador declara que realizou a devolução dos equipamentos relacionados neste termo. A equipe de T.I realizou a conferência dos itens e registrou o estado dos equipamentos no momento da devolução."
];

export function adicionarTermoResponsabilidade(pdf, startY, signatures = {}, options = {}) {
    let y = ensurePdfSpace(pdf, startY, 60);
    let termo = [];
    const isNotebookOnly = options.categorias?.length === 1 && options.categorias[0] === 'notebooks';

    if (isNotebookOnly && options.notebookTermType === "SAIDA") {
        termo = TERMO_NOTEBOOK_SAIDA;
    } else if (isNotebookOnly && options.notebookTermType === "RETORNO") {
        termo = TERMO_NOTEBOOK_RETORNO;
    } else {
        termo = [
            "TERMO DE RESPONSABILIDADE E ASSINATURA DOS RESPONSÁVEIS",
            "Na condição de funcionário da empresa DIGITAL, inscrita no CNPJ/MF sob o nº 07.578.965/0001-05, com sede na cidade de Belo Jardim, Estado de Pernambuco, declaro receber, neste ato, os equipamentos, ferramentas, EPIs, veículo e tablet relacionados neste relatório, em perfeito estado de conservação e funcionamento, comprometendo-me a utilizá-los exclusivamente no desempenho de minhas funções.",
            "Comprometo-me a conservar os bens no mesmo estado em que foram recebidos e a devolvê-los à empresa quando solicitado ou no momento de meu desligamento do quadro funcional.",
            "Estou ciente de que danos causados aos bens por mau uso, negligência ou culpa poderão autorizar a empresa a proceder aos descontos cabíveis em meus créditos salariais ou rescisórios, conforme a legislação vigente.",
            "Comprometo-me assim especificamente a:",
            "Não emprestar ou permitir o uso dos bens por terceiros;",
            "Acionar imediatamente o departamento responsável ao detectar qualquer problema nos equipamentos;",
            "Em caso de furto ou roubo, registrar boletim de ocorrência e apresentar cópia à empresa ou informar o departamento responsável o mais rápido possível."
        ];
    }

    pdf.setFontSize(10);
    pdf.setFont("helvetica", "bold");
    pdf.text(termo[0], 10, y);
    y += 7;
    pdf.setFont("helvetica", "normal");

    termo.slice(1).forEach((paragraph) => {
        y = ensurePdfSpace(pdf, y, 24);
        const spacing = (isNotebookOnly && paragraph.startsWith("•")) ? 1 : 4;
        y = addWrappedPdfText(pdf, paragraph, 10, y, 188, 4) + spacing;
    });

    const signatureTeam = options.signatureTeam || {};
    const auxiliaresEquipe = Array.isArray(signatureTeam.auxiliares) ? signatureTeam.auxiliares : [];
    const assinaturasAuxiliares = Array.isArray(signatures.auxiliares) ? signatures.auxiliares : [];
    const auxiliarCount = isNotebookOnly ? 0 : Math.max(1, auxiliaresEquipe.length, assinaturasAuxiliares.length);
    const fieldWidth = 82;
    const fieldGap = 18;
    const columns = 2;
    const startX = 20;
    const fieldHeight = 28;
    const auxiliarRows = Math.ceil(auxiliarCount / columns);

    y = ensurePdfSpace(pdf, y, 36 + auxiliarRows * fieldHeight);
    const labelTecnico = isNotebookOnly
        ? "Analista responsável"
        : "Técnico responsável pela viatura";

    function drawSignatureField(x, lineY, width, label, imageData) {
        if (imageData) {
            pdf.addImage(imageData, 'PNG', x + 2, lineY - 15, width - 4, 12);
        }

        pdf.setDrawColor(15, 82, 160);
        pdf.setLineWidth(0.5);
        pdf.line(x, lineY, x + width, lineY);

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(0, 0, 0);
        const labelLines = pdf.splitTextToSize(label, width).slice(0, 2);
        pdf.text(labelLines, x + width / 2, lineY + 5, { align: "center" });
    }

    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(0, 0, 0);
    const tecnicoLineY = y + 18;
    const tecnicoLabel = !isNotebookOnly && signatureTeam.tecnico?.nome
        ? `${labelTecnico} - ${signatureTeam.tecnico.nome}`
        : labelTecnico;
    drawSignatureField(startX, tecnicoLineY, fieldWidth, tecnicoLabel, signatures.tecnico);

    for (let i = 0; i < auxiliarCount; i++) {
        const row = Math.floor(i / columns);
        const col = i % columns;
        const x = startX + col * (fieldWidth + fieldGap);
        const lineY = tecnicoLineY + fieldHeight + row * fieldHeight;
        const auxiliar = auxiliaresEquipe[i] || {};
        const labelBase = `Auxiliar técnico ${auxiliarCount > 1 ? i + 1 : ""}`.trim();
        const labelAux = auxiliar.nome ? `${labelBase} - ${auxiliar.nome}` : labelBase;

        drawSignatureField(x, lineY, fieldWidth, labelAux, assinaturasAuxiliares[i]);
    }

    y = tecnicoLineY + 12 + auxiliarRows * fieldHeight;
    return y;
}

function getSignatureTeam(dados = []) {
    const team = { tecnico: null, auxiliares: [] };
    const auxiliaresKeys = new Set();

    dados.forEach((vistoria) => {
        if (!team.tecnico && vistoria.tecnicoNome) {
            team.tecnico = {
                nome: vistoria.tecnicoNome,
                cpf: vistoria.tecnicoCpf || ""
            };
        }

        const auxiliares = Array.isArray(vistoria.auxiliares) && vistoria.auxiliares.length > 0
            ? vistoria.auxiliares
            : (vistoria.auxiliarTecnico ? [{ nome: vistoria.auxiliarTecnico, cpf: vistoria.auxiliarCpf || "" }] : []);

        auxiliares.forEach((auxiliar) => {
            const nome = String(auxiliar?.nome || "").trim();
            const cpf = String(auxiliar?.cpf || "").trim();
            const key = `${nome.toLowerCase()}|${cpf}`;
            if (!nome || auxiliaresKeys.has(key)) return;

            auxiliaresKeys.add(key);
            team.auxiliares.push({ nome, cpf });
        });
    });

    return team;
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
        tablets: "tablets",
        notebook: "notebooks",
        notebooks: "notebooks"
    };

    return aliases[normalized] || null;
}

function getCategoriesFromInput(value) {
    const normalized = value.trim().toUpperCase();
    if (normalized === "TODAS" || normalized === "TODOS") {
        return CHECKLIST_REPORT_CATEGORIES;
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
        if (categorias[0] === "notebooks") {
            return "Vistoria de Notebook";
        }
        return `Vistoria Viatura ${formatTwoDigits(viaturaId)} - ${categoryNames[categorias[0]]}`;
    }
    return `Vistoria Viatura ${formatTwoDigits(viaturaId)}`;
}

function getResponsaveisPorCategoria(dados) {
    return Object.keys(categoryNames)
        .map((category) => {
            const nomes = [...new Set(
                dados
                    .filter(vistoria => vistoria.categoria === category)
                    .map(vistoria => vistoria.vistoriador || "Não identificado")
            )];

            return {
                category,
                label: categoryNames[category],
                nomes
            };
        })
        .filter(item => item.nomes.length > 0);
}

function carregarImagem(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
    });
}

async function carregarImagemDataUrl(src) {
    const image = await carregarImagem(src);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);

    return {
        dataUrl: canvas.toDataURL("image/png"),
        width: image.naturalWidth,
        height: image.naturalHeight
    };
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
    dados = normalizarDadosRelatorio(dados);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const reportName = options.reportName || titulo.replace(/_/g, " ");
    const tipoVistoria = options.tipoVistoria || inferirTipoVistoria(dados, options.categorias || []);

    try {
        console.info('[PDF] Gerando PDF:', reportName, '| categorias:', (options.categorias || []).join(','), '| tipoVistoria:', tipoVistoria);
    } catch (e) {
        console.debug('[PDF] log falhou', e);
    }
    const tipoVistoriaLabel = getTipoVistoriaLabel(tipoVistoria);
    const columnWidth = 90;
    const contentStartY = 55;
    const columns = [{ x: 10, y: contentStartY }, { x: 108, y: contentStartY }];
    const cursor = { col: 0, y: contentStartY };
    const ordemPaginas = [["todas"], ["ferramentas", "epis"], ["viaturas"], ["tablets"], ["notebooks"]];
    let logoData = null;
    const generatedAt = new Date().toLocaleString("pt-BR");

    try {
        logoData = await carregarImagemDataUrl("assets/logo.png");
    } catch (error) {
        console.warn("Não foi possível carregar a logo no PDF.", error);
    }

    function addPdfHeader() {
        doc.setFillColor(15, 82, 160);
        doc.rect(0, 0, 210, 45, "F");
        doc.setFillColor(236, 246, 255);
        doc.rect(0, 45, 210, 4, "F");
        doc.setTextColor(255, 255, 255);

        if (logoData) {
            const logoWidth = 48;
            const logoHeight = Math.min(20, logoWidth * (logoData.height / logoData.width));
            doc.addImage(logoData.dataUrl, "PNG", 10, 7, logoWidth, logoHeight);
        } else {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(15);
            doc.text("DIGITAL", 10, 15);
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        const titleLines = doc.splitTextToSize(reportName, 112).slice(0, 2);
        doc.text(titleLines, 64, 12);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text(`${tipoVistoriaLabel} | Data e hora: ${generatedAt}`, 64, 20);

        // Resumo dos responsáveis no topo (Grid compacta)
        const responsaveis = getResponsaveisPorCategoria(dados);
        const startX = 64;
        const colWidth = 35;
        const row1Y = 30; // Etiqueta da categoria
        const row2Y = 35; // Nome do responsável

        responsaveis.forEach((grupo, i) => {
            const currentX = startX + (i * colWidth);
            if (currentX > 200) return;

            doc.setFont("helvetica", "bold");
            doc.setFontSize(6.5);
            doc.text(grupo.label.toUpperCase(), currentX, row1Y);
            
            doc.setFont("helvetica", "normal");
            doc.setFontSize(7.5);
            const nomesStr = grupo.nomes.join(", ");
            doc.text(doc.splitTextToSize(nomesStr, colWidth - 2)[0], currentX, row2Y);
        });

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
        const size = opts.size || 8;
        const lineHeight = opts.lineHeight || 4;
        doc.setFont("helvetica", opts.bold ? "bold" : "normal");
        doc.setFontSize(size);
        doc.setTextColor(...(opts.color || [51, 51, 51]));
        const lines = doc.splitTextToSize(limparTextoRelatorio(text), columnWidth);
        lines.forEach((line) => {
            ensureColumnSpace(lineHeight + 2);
            const x = columns[cursor.col].x;
            doc.text(line, x, cursor.y);
            cursor.y += lineHeight;
        });
        doc.setTextColor(51, 51, 51);
    }

    function addPageLabel(label) {
        ensureColumnSpace(14);
        const x = columns[cursor.col].x;
        doc.setDrawColor(15, 82, 160);
        doc.setTextColor(15, 82, 160);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(limparTextoRelatorio(label), x, cursor.y);
        doc.line(x, cursor.y + 2, x + columnWidth, cursor.y + 2);
        doc.setTextColor(51, 51, 51);
        cursor.y += 10;
    }

    function addResponsaveisResumo() {
        const grupos = getResponsaveisPorCategoria(dados);
        if (grupos.length === 0) {
            addColumnText("Nenhum responsável identificado nas vistorias selecionadas.");
            return;
        }

        grupos.forEach((grupo) => {
            addColumnText(grupo.label, { bold: true, color: [15, 82, 160] });
            grupo.nomes.forEach(nome => addColumnText(`- ${nome}`));
            addSectionDivider();
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
        const imageWidth = columnWidth;
        const imageHeight = imageWidth * (imageData.height / imageData.width);
        ensureColumnSpace(imageHeight + 8);
        const x = columns[cursor.col].x;
        doc.addImage(imageData.dataUrl, "PNG", x, cursor.y, imageWidth, imageHeight);
        cursor.y += imageHeight + 6;
    }

    function addChecklistItem(item) {
        const status = item.status || "pendente";
        const itemOk = String(status).toLowerCase() === "ok";
        const quantidade = Number(item.quantidade || 0);
        const valor = Number(item.valorUnitario || 0);
        const total = Number(item.total || quantidade * valor);
        const formatarMoeda = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const statusLabel = itemOk ? "OK" : status.toUpperCase();
        const statusColor = itemOk ? [22, 128, 78] : [190, 82, 24];
        const itemColor = itemOk ? [22, 128, 78] : [190, 82, 24];
        const itemName = limparTextoRelatorio(item.item);
        const detailParts = [
            `Qtd.: ${quantidade || "-"}`,
            `Valor: R$ ${formatarMoeda(valor)}`,
            `Total: R$ ${formatarMoeda(total)}`,
            `Status: ${statusLabel}`
        ];

        if (item.ca) detailParts.push(`C.A.: ${limparTextoRelatorio(item.ca)}`);
        if (item.dataEntrega) detailParts.push(`Entrega: ${limparTextoRelatorio(item.dataEntrega)}`);
        if (item.observacao) detailParts.push(`Motivo/observação: ${limparTextoRelatorio(item.observacao)}`);

        const nameLines = doc.splitTextToSize(itemName, columnWidth - 4);
        const detailLines = doc.splitTextToSize(detailParts.join(" | "), columnWidth - 4);
        const rowHeight = 2 + (nameLines.length * 3.4) + (detailLines.length * 2.8);
        ensureColumnSpace(rowHeight + 2);
        const x = columns[cursor.col].x;

        doc.setDrawColor(...itemColor);
        doc.line(x, cursor.y - 1.5, x, cursor.y + rowHeight - 2);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.1);
        doc.setTextColor(...itemColor);
        nameLines.forEach((line) => {
            doc.text(line, x + 2, cursor.y);
            cursor.y += 3.4;
        });

        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.2);
        doc.setTextColor(...statusColor);
        detailLines.forEach((line) => {
            doc.text(line, x + 2, cursor.y);
            cursor.y += 2.8;
        });
        doc.setTextColor(51, 51, 51);
        cursor.y += 1.5;
    }

    async function addVistoria(v) {
        ensureColumnSpace(28);
        if (cursor.y > columns[cursor.col].y) cursor.y += 3;

        const dataObj = getDataEnvioDate(v);
        let equipamento = v.categoria === "tablets"
            ? `Tablet ${formatTwoDigits(v.tabletId || v.viaturaId)} / Viatura ${formatTwoDigits(v.viaturaId)}`
            : `Viatura ${formatTwoDigits(v.viaturaId)}`;
        // Para notebooks, o título do bloco não deve usar a viatura vinculada.
        let categoryLabel = v.categoria === "todas" ? "Vistoria completa" : (categoryNames[v.categoria] || v.categoria);
        if (v.categoria === 'notebooks') {
            const termType = normalizeNotebookTermType(v.notebookTermType || options.notebookTermType);
            equipamento = "Vistoria";
            if (termType === 'RETORNO') categoryLabel = 'devolução';
            else categoryLabel = 'retirada';
        }
        addColumnText(`${equipamento} - ${categoryLabel}`, { bold: true, size: 10, lineHeight: 5, color: [15, 82, 160] });
        addColumnText(`Responsável pela etapa: ${v.vistoriador || "Não identificado"}`, { color: [15, 82, 160], bold: true });
        if (v.tecnicoNome) addColumnText(`Técnico: ${v.tecnicoNome}`, { color: [30, 30, 30], bold: true });
        if (v.tecnicoCpf) addColumnText(`CPF do técnico: ${v.tecnicoCpf}`, { color: [100, 100, 100] });

        const auxiliares = Array.isArray(v.auxiliares) ? v.auxiliares : [];
        if (auxiliares.length > 0) {
            auxiliares.forEach((aux, idx) => {
                addColumnText(`Auxiliar técnico ${auxiliares.length > 1 ? idx + 1 : ""}: ${aux.nome}`, { color: [30, 30, 30], bold: true });
                if (aux.cpf) addColumnText(`CPF do auxiliar: ${aux.cpf}`, { color: [100, 100, 100] });
            });
        } else if (v.auxiliarTecnico) {
            // Fallback para vistorias antigas que não usavam o array de auxiliares
            addColumnText(`Auxiliar técnico: ${v.auxiliarTecnico}`, { color: [30, 30, 30], bold: true });
            if (v.auxiliarCpf) addColumnText(`CPF do auxiliar: ${v.auxiliarCpf}`, { color: [100, 100, 100] });
        }

        // Mensagem de destaque para identificar de quem são os EPIs (Técnico ou Auxiliar)
        if (v.categoria === "epis" && v.epiResponsavelNome) {
            const labelRole = String(v.epiResponsavelTipo || "Funcionário").toUpperCase();
            addColumnText("--------------------------------------------------", { color: [15, 82, 160] });
            addColumnText(`CONFERÊNCIA DE EPI: ${labelRole}`, { bold: true, size: 9, color: [15, 82, 160] });
            addColumnText(`NOME: ${v.epiResponsavelNome}`, { bold: true, size: 9 });
            addColumnText("--------------------------------------------------", { color: [15, 82, 160] });
        }

        const dateRef = v.dataVistoria ? String(v.dataVistoria).split("-").reverse().join("/") : dataObj.toLocaleDateString("pt-BR");
        addColumnText(`Data e hora: ${dateRef} às ${dataObj.toLocaleTimeString("pt-BR")}`, { color: [100, 100, 100], bold: true });

        if (v.km) addColumnText(`KM: ${v.km}`);
        if (v.combustivel) addColumnText(`Combustível: ${v.combustivel}`);
        if (v.categoria === "viaturas" && v.observacoesViatura) addColumnText(`Observações: ${v.observacoesViatura}`);
        if (v.categoria === "tablets" && v.observacoesTablet) addColumnText(`Observações: ${v.observacoesTablet}`);

        if (v.categoria === "viaturas" || v.categoria === "todas") {
            const avariasViatura = Array.isArray(v.avarias) ? v.avarias : [];
            addColumnText("Mapa visual da viatura:", { bold: true, color: [15, 82, 160] });
            if (avariasViatura.length > 0) {
                addColumnText("Avarias marcadas:", { bold: true });
            } else {
                addColumnText("Nenhuma avaria marcada.", { color: [22, 128, 78] });
            }
            avariasViatura.forEach((avaria) => {
                const linhaAvaria = `${getDamageMarkerLabel(avaria.type)} - ${damageTypeNames[avaria.type] || avaria.type} - ${vehicleViewNames[avaria.view] || avaria.view}`;
                addColumnText(linhaAvaria);
            });
            try {
                const vehicleImage = await criarMapaAvariasDataUrl(getVehicleMapConfig(v.viaturaId).src, avariasViatura, { useTypeLabels: true });
                addColumnImage(vehicleImage);
            } catch (error) {
                console.warn("Não foi possível adicionar o mapa da viatura ao PDF.", error);
                addColumnText("Não foi possível carregar o desenho da viatura.", { color: [190, 82, 24] });
            }
        }

        if (v.categoria === "tablets" || v.categoria === "todas") {
            const avariasTablet = Array.isArray(v.avariasTablet) ? v.avariasTablet : [];
            addColumnText("Mapa visual do tablet:", { bold: true, color: [15, 82, 160] });
            if (avariasTablet.length > 0) {
                addColumnText("Avarias marcadas:", { bold: true });
            } else {
                addColumnText("Nenhuma avaria marcada.", { color: [22, 128, 78] });
            }
            avariasTablet.forEach((avaria) => {
                const linhaAvaria = `${getDamageMarkerLabel(avaria.type)} - ${damageTypeNames[avaria.type] || avaria.type} - ${avaria.view}`;
                addColumnText(linhaAvaria);
            });
            try {
                const tabletImage = await criarMapaAvariasDataUrl("assets/tablet-mapa.png", avariasTablet, { useTypeLabels: true });
                addColumnImage(tabletImage);
            } catch (error) {
                console.warn("Não foi possível adicionar o mapa do tablet ao PDF.", error);
                addColumnText("Não foi possível carregar o desenho do tablet.", { color: [190, 82, 24] });
            }
        }

        if (v.categoria === "notebooks" || v.categoria === "todas") {
            const avariasNotebook = Array.isArray(v.avariasNotebook) ? v.avariasNotebook : [];
            if (v.categoria === "notebooks" || avariasNotebook.length > 0 || v.observacoesNotebook) {
                addColumnText("Mapa visual do notebook:", { bold: true, color: [15, 82, 160] });
            }
            if (avariasNotebook.length > 0) {
                addColumnText("Avarias marcadas:", { bold: true });
            } else if (v.categoria === "notebooks") {
                addColumnText("Nenhuma avaria marcada.", { color: [22, 128, 78] });
            }
            avariasNotebook.forEach((avaria) => {
                const linhaAvaria = `${getDamageMarkerLabel(avaria.type)} - ${damageTypeNames[avaria.type] || avaria.type} - ${avaria.view}`;
                addColumnText(linhaAvaria);
            });
            try {
                if (v.categoria === "todas" && avariasNotebook.length === 0 && !v.observacoesNotebook) {
                    throw new Error("Sem dados de notebook no relatório consolidado.");
                }
                const notebookImage = await criarMapaAvariasDataUrl("assets/notebook.png", avariasNotebook, { useTypeLabels: true });
                addColumnImage(notebookImage);
            } catch (error) {
                if (v.categoria !== "todas") {
                    console.warn("Não foi possível adicionar o mapa do notebook ao PDF.", error);
                    addColumnText("Não foi possível carregar o desenho do notebook.", { color: [190, 82, 24] });
                }
            }
            if (v.observacoesNotebook) {
                addColumnText(`Observações: ${v.observacoesNotebook}`);
            }
        }

        const fotos = Array.isArray(v.fotosEvidencia) ? v.fotosEvidencia : (v.fotoEvidencia ? [v.fotoEvidencia] : []);
        if (fotos.length > 0) {
            addColumnText("FOTOS DE EVIDÊNCIA CAPTURADAS:", { bold: true, size: 11, color: [190, 0, 0] });
            for (const foto of fotos) {
                try {
                    const imgData = await carregarImagemDataUrl(foto);
                    addColumnImage(imgData);
                } catch (e) {
                    console.warn("Falha ao incluir uma das fotos no PDF", e);
                }
            }
        }

        addColumnText("Itens:", { bold: true, color: [15, 82, 160] });
        getItensSemDuplicidade(v.itens).forEach(item => addChecklistItem(item));

        addSectionDivider();
    }

    addPdfHeader();
    resetCursor();

    const dadosPorCategoria = {};
    sortVistoriasPorCategoria(dados).forEach((vistoria) => {
        if (!dadosPorCategoria[vistoria.categoria]) dadosPorCategoria[vistoria.categoria] = [];
        dadosPorCategoria[vistoria.categoria].push(vistoria);
    });

    // Variável para controlar a economia de página: o primeiro grupo de conteúdo não quebra página
    let isFirstContentGroup = true;
    for (const categoriasDaPagina of ordemPaginas) {
        const dadosDaPagina = categoriasDaPagina.flatMap(category => dadosPorCategoria[category] || []);
        if (dadosDaPagina.length === 0) continue;

        if (!isFirstContentGroup) addContentPage();
        else isFirstContentGroup = false;

        const pageTitle = categoriasDaPagina.length > 1
            ? "Ferramentas e EPIs"
            : categoriasDaPagina[0] === "todas"
                ? "Vistoria completa"
                : categoriasDaPagina[0] === "viaturas"
                    ? "Viatura"
                    : categoriasDaPagina[0] === "tablets"
                        ? "Tablets"
                        : "Notebooks";
        addPageLabel(pageTitle);
        for (const vistoria of dadosDaPagina) await addVistoria(vistoria);
    }

    doc.addPage();
    addPdfHeader();
    resetCursor();
    addPageLabel("Assinatura dos responsáveis e termo de responsabilidade");
    adicionarTermoResponsabilidade(doc, cursor.y, state.assinaturas || {}, {
        ...options,
        signatureTeam: getSignatureTeam(dados)
    });
    
    // Limpa assinaturas após gerar para a próxima vistoria
    state.assinaturas = null;
    const fileName = getPdfSaveFileName(titulo, dados, options);
    doc.save(fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`);
}

async function buscarVistoriasPorPeriodo(inicio, fim) {
    const q = query(
        collection(db, "vistorias"),
        where("dataEnvio", ">=", inicio),
        where("dataEnvio", "<=", fim)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function buscarVistoriasDeHoje(retroativoDias = 1) {
    // Agora busca por padrão vistorias de hoje e ontem para garantir que 
    // vistorias finalizadas perto da meia-noite não sumam
    const { inicio } = getInicioFimHoje();
    const dataLimite = new Date(inicio);
    dataLimite.setDate(dataLimite.getDate() - retroativoDias);

    const q = query(collection(db, "vistorias"), orderBy("dataEnvio", "desc"));
    const snapshot = await getDocs(q);
    const dados = [];
    snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const dataEnvio = data.dataEnvio?.toDate?.();
        if (dataEnvio && dataEnvio >= dataLimite) {
            dados.push({ id: docSnap.id, ...data });
        }
    });
    return dados;
}

export async function gerarRelatorioViatura(viaturaId = state.selectedViatura, options = {}) {
    const defaultCategorias = CHECKLIST_REPORT_CATEGORIES;
    const { confirmar = true, resetarStatus = true, categorias = defaultCategorias } = options;
    const isCompleteByCategories = defaultCategorias.every(cat => categorias.includes(cat));
    const tipoVistoria = options.tipoVistoria || (isCompleteByCategories ? "completa" : "parcial");
    const periodo = options.periodo || getInicioFimHoje();
    try {
        let dadosViatura = [];

        try {
            const todasVistorias = await buscarVistoriasPorPeriodo(periodo.inicio, periodo.fim);
            dadosViatura = selecionarVistoriasMaisRecentes(todasVistorias, viaturaId, categorias);
        } catch (error) {
            console.warn("Não foi possível ler o histórico no Firebase. Usando vistorias locais da sessão.", error);
            dadosViatura = buscarVistoriasLocaisViatura(viaturaId, categorias, sortVistoriasPorCategoria);
        }

        if (dadosViatura.length === 0) {
            const dadosLocais = buscarVistoriasLocaisViatura(viaturaId, categorias, sortVistoriasPorCategoria);
            if (dadosLocais.length > 0) dadosViatura = dadosLocais;
        }

        if (dadosViatura.length === 0) {
            const categoriasLabel = categorias.map(category => categoryNames[category]).join(", ");
            alert(`Nenhuma vistoria salva foi encontrada para: ${categoriasLabel}. Se ela foi salva em outro aparelho, faça login no Painel Admin para gerar pelo histórico.`);
            return;
        }

        const isNotebookOnly = categorias.length === 1 && categorias[0] === 'notebooks';
        const msgConfirm = `Deseja gerar o relatório PDF da Viatura ${formatTwoDigits(viaturaId)}?`;
        const shouldGenerate = isNotebookOnly ? true : (!confirmar || confirm(msgConfirm));

        if (shouldGenerate) {
            const sufixoCategoria = categorias.length === 1 ? `_${categoryNames[categorias[0]]}` : "";

            let notebookTermType = options.notebookTermType
                || (dadosViatura[0]?.notebookTermType ?? "SAIDA");

            notebookTermType = normalizeNotebookTermType(notebookTermType);

            const fileNamePrefix = isNotebookOnly ? "Relatorio_Vistoria_Notebook" : `Relatorio_Vistoria_Viatura_${formatTwoDigits(viaturaId)}`;
            await gerarPDF(`${fileNamePrefix}${sufixoCategoria}`, dadosViatura, {
                reportName: buildReportTitle(viaturaId, categorias),
                tipoVistoria,
                categorias,
                notebookTermType,
                fileName: isNotebookOnly ? getNotebookPdfFileName(notebookTermType) : null
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

async function gerarRelatorioTodasViaturasPeriodo(categorias = PDF_REPORT_CATEGORIES, periodo = getInicioFimHoje(), options = {}) {
    let filtrados = [];
    const { inicio, fim } = periodo;
    const isCompleteChecklistReport = CHECKLIST_REPORT_CATEGORIES.every(category => categorias.includes(category));

    try {
        const dados = await buscarVistoriasPorPeriodo(inicio, fim);
        filtrados = dados.filter(v => (
            categorias.includes(v.categoria)
            || (isCompleteChecklistReport && v.categoria === "todas")
        ));
    } catch (error) {
        console.warn("Não foi possível ler as vistorias do dia no Firebase. Usando vistorias locais da sessão.", error);
        filtrados = buscarVistoriasLocaisHoje(categorias, sortVistoriasPorCategoria, () => periodo, getDataEnvioDate);
    }

    if (filtrados.length === 0) {
        const categoriasLabel = categorias.map(category => categoryNames[category]).join(", ");
        alert(`Nenhuma vistoria salva hoje foi encontrada para: ${categoriasLabel}.`);
        return;
    }

    sortVistoriasPorCategoria(filtrados);
    const sufixoCategoria = categorias.length === 1 ? `_${categoryNames[categorias[0]]}` : "";

    let notebookTermType = options.notebookTermType
        || (filtrados[0]?.notebookTermType ?? "SAIDA");

    notebookTermType = normalizeNotebookTermType(notebookTermType);

    // Monta um label amistoso com os nomes das categorias (ex: 'ferramentas, epi, viatura e tablet')
    const shortNamesMap = { ferramentas: 'ferramentas', epis: 'epi', viaturas: 'viatura', tablets: 'tablet' };
    const buildCategoryListLabel = (cats) => {
        const labels = cats.map(c => (shortNamesMap[c] || (categoryNames[c] || c).toLowerCase()));
        if (labels.length === 0) return '';
        if (labels.length === 1) return labels[0];
        if (labels.length === 2) return `${labels[0]} e ${labels[1]}`;
        return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`;
    };

    const reportName = categorias.length === 1
        ? `Vistoria 5S - ${categoryNames[categorias[0]]} do dia`
        : `Vistoria 5S - ${buildCategoryListLabel(categorias)} do dia`;

    await gerarPDF(`Relatorio_5S_Todas_Viaturas_Hoje${sufixoCategoria}`, filtrados, {
        reportName,
        tipoVistoria: CHECKLIST_REPORT_CATEGORIES.every(category => categorias.includes(category)) ? "completa" : "parcial",
        categorias,
        notebookTermType
    });
}

export async function gerarRelatorioComEscolha(options = {}) {
    const today = new Date();
    const defaultDate = today.toLocaleDateString("pt-BR");
    const respostaData = prompt(
        "Informe a data das vistorias que deseja exportar (DD/MM/AAAA):",
        defaultDate
    );

    if (!respostaData) return;

    const parts = respostaData.split("/");
    if (parts.length !== 3) {
        alert("Formato de data inválido. Use DD/MM/AAAA (ex: 14/06/2026).");
        return;
    }
    const formattedDate = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
    const periodo = getInicioFimData(formattedDate);

    const resposta = prompt(
        `Gerar PDF de qual vistoria?\n\nDigite o número da viatura, por exemplo: ${state.selectedViatura.padStart(2, "0")}\nOu digite TODAS para gerar todas as viaturas vistoriadas no período.`,
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

    const tipoRelatorio = prompt(
        "Deseja baixar a vistoria COMPLETA ou por ETAPAS?\n\nDigite COMPLETA para incluir tudo ou ETAPAS para selecionar partes específicas.",
        "COMPLETA"
    );

    if (!tipoRelatorio) return;

    let categorias = CHECKLIST_REPORT_CATEGORIES;
    if (tipoRelatorio.trim().toUpperCase() === "ETAPAS") {
        const respostaCategoria = prompt(
            "Informe as etapas separadas por vírgula:\nFERRAMENTAS, EPIS, VIATURA, TABLET.",
            "FERRAMENTAS"
        );
        if (!respostaCategoria) return;
        categorias = getCategoriesFromInput(respostaCategoria);
        if (categorias.length === 0) {
            alert("Informe pelo menos uma etapa válida: FERRAMENTAS, EPIS, VIATURA ou TABLET.");
            return;
        }
    }

    if (gerarTodas) {
        await gerarRelatorioTodasViaturasPeriodo(categorias, periodo, options);
        return;
    }

    await gerarRelatorioViatura(viaturaId, {
        confirmar: false,
        resetarStatus: options.resetarStatus && viaturaId === state.selectedViatura,
        categorias,
        periodo
    });
}

export async function encerrarVistoriaCompleta() {
    if (!confirm("Deseja realmente encerrar a vistoria e gerar o relatório final?")) {
        return;
    }

    if (!isVistoriaParcial() && todasEtapasConcluidas(state.selectedViatura)) {
        await gerarRelatorioViatura(state.selectedViatura, {
            confirmar: false,
            resetarStatus: true,
            categorias: CHECKLIST_REPORT_CATEGORIES
        });
        return;
    }

    await gerarRelatorioComEscolha({ resetarStatus: true });
}
