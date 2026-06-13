import { categoryNames, damageTypeNames, formatTwoDigits, getVehicleMapConfig, vehicleViewNames } from "./config.js";
import { collection, db, getDocs, orderBy, query } from "./firebase.js";
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
        
        const catA = Object.keys(categoryNames).indexOf(a.categoria);
        const catB = Object.keys(categoryNames).indexOf(b.categoria);
        if (catA !== catB) return catA - catB;

        // Destaque: Técnico sempre antes do Auxiliar na listagem de EPIs
        if (a.categoria === "epis" && b.categoria === "epis") {
            const isAuxA = String(a.epiResponsavelTipo || "").toLowerCase().includes("auxiliar");
            const isAuxB = String(b.epiResponsavelTipo || "").toLowerCase().includes("auxiliar");
            if (isAuxA !== isAuxB) return isAuxA ? 1 : -1;
        }

        return 0;
    });
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

function getEpiPessoaKey(vistoria) {
    return vistoria.epiResponsavelCpf || vistoria.epiResponsavelNome || "sem-responsavel";
}

function getVistoriaReportKey(vistoria) {
    if (vistoria.categoria === "epis") return `epis:${getEpiPessoaKey(vistoria)}`;
    return vistoria.categoria;
}

function selecionarVistoriasMaisRecentes(dados, viaturaId, categorias) {
    const categoriasSet = new Set(categorias);
    const porChave = new Map();

    dados.forEach((vistoria) => {
        if (vistoria.tipoRegistro === "resolucaoPendencia") return;
        if (String(vistoria.viaturaId) !== String(viaturaId)) return;
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

export function adicionarTermoResponsabilidade(pdf, startY, signatures = {}) {
    let y = ensurePdfSpace(pdf, startY, 60);
    const termo = [
        "TERMO DE RESPONSABILIDADE E ASSINATURA DOS RESPONSÁVEIS",
        "Na condição de funcionário da empresa DIGITAL, inscrita no CNPJ/MF sob o nº 07.578.965/0001-05, com sede na cidade de Belo Jardim, Estado de Pernambuco, declaro receber, neste ato, os equipamentos, ferramentas, EPIs, veículo e tablet relacionados neste relatório, em perfeito estado de conservação e funcionamento, comprometendo-me a utilizá-los exclusivamente no desempenho de minhas funções.",
        "Comprometo-me a conservar os bens no mesmo estado em que foram recebidos e a devolvê-los à empresa quando solicitado ou no momento de meu desligamento do quadro funcional.",
        "Estou ciente de que danos causados aos bens por mau uso, negligência ou culpa poderão autorizar a empresa a proceder aos descontos cabíveis em meus créditos salariais ou rescisórios, conforme a legislação vigente.",
        "Comprometo-me assim especificamente a:",
        "Não emprestar ou permitir o uso dos bens por terceiros;",
        "Acionar imediatamente o departamento responsável ao detectar qualquer problema nos equipamentos;",
        "Em caso de furto ou roubo, registrar boletim de ocorrência e apresentar cópia à empresa ou informar o departamento responsável o mais rápido possível."
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
    pdf.text("Técnico responsável pela viatura", 17, y);
    pdf.text("Auxiliar técnico", 137, y);
    y += 8;
    pdf.text("Nome:", 10, y);
    pdf.line(24, y, 92, y);
    pdf.text("Nome:", 112, y);
    pdf.line(126, y, 194, y);
    y += 9;

    if (signatures.tecnico) {
        pdf.addImage(signatures.tecnico, 'PNG', 15, y - 18, 70, 15);
    }
    if (signatures.auxiliar) {
        pdf.addImage(signatures.auxiliar, 'PNG', 117, y - 18, 70, 15);
    }

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
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const reportName = options.reportName || titulo.replace(/_/g, " ");
    const tipoVistoria = options.tipoVistoria || inferirTipoVistoria(dados, options.categorias || []);
    const tipoVistoriaLabel = getTipoVistoriaLabel(tipoVistoria);
    const columnWidth = 90;
    const contentStartY = 55;
    const columns = [{ x: 10, y: contentStartY }, { x: 108, y: contentStartY }];
    const cursor = { col: 0, y: contentStartY };
    const ordemPaginas = [["ferramentas", "epis"], ["viaturas"], ["tablets"]];
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
        const equipamento = v.categoria === "tablets"
            ? `Tablet ${formatTwoDigits(v.tabletId || v.viaturaId)} / Viatura ${formatTwoDigits(v.viaturaId)}`
            : `Viatura ${formatTwoDigits(v.viaturaId)}`;
        addColumnText(`${equipamento} - ${categoryNames[v.categoria] || v.categoria}`, { bold: true, size: 10, lineHeight: 5, color: [15, 82, 160] });
        addColumnText(`Responsável pela etapa: ${v.vistoriador || "Não identificado"}`, { color: [15, 82, 160], bold: true });
        if (v.tecnicoNome) addColumnText(`Técnico: ${v.tecnicoNome}`, { color: [30, 30, 30], bold: true });
        if (v.tecnicoCpf) addColumnText(`CPF do técnico: ${v.tecnicoCpf}`, { color: [100, 100, 100] });
        if (v.auxiliarTecnico) addColumnText(`Auxiliar técnico: ${v.auxiliarTecnico}`, { color: [30, 30, 30], bold: true });
        if (v.auxiliarCpf) addColumnText(`CPF do auxiliar: ${v.auxiliarCpf}`, { color: [100, 100, 100] });

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
        if (v.categoria === "viaturas" && v.observacoesViatura) addColumnText(`Observações: ${v.observacoesViatura}`);
        if (v.categoria === "tablets" && v.observacoesTablet) addColumnText(`Observações: ${v.observacoesTablet}`);

        if (v.categoria === "viaturas") {
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

        if (v.categoria === "tablets") {
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

        const fotos = Array.isArray(v.fotosEvidencia) ? v.fotosEvidencia : (v.fotoEvidencia ? [v.fotoEvidencia] : []);
        if (fotos.length > 0) {
            addColumnText("Fotos de evidência capturadas:", { bold: true, color: [15, 82, 160] });
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
            : categoriasDaPagina[0] === "viaturas"
                ? "Viatura"
                : "Tablets";
        addPageLabel(pageTitle);
        for (const vistoria of dadosDaPagina) await addVistoria(vistoria);
    }

    doc.addPage();
    addPdfHeader();
    resetCursor();
    addPageLabel("Assinatura dos responsáveis e termo de responsabilidade");
    adicionarTermoResponsabilidade(doc, cursor.y, state.assinaturas || {});
    
    // Limpa assinaturas após gerar para a próxima vistoria
    state.assinaturas = null;
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
    const todasCategoriasSelecionadas = categorias.length === Object.keys(categoryNames).length;
    const tipoVistoria = options.tipoVistoria
        || (todasCategoriasSelecionadas && !isVistoriaParcial(viaturaId) ? "completa" : "parcial");
    try {
        let dadosViatura = [];

        try {
            dadosViatura = selecionarVistoriasMaisRecentes(await buscarVistoriasDeHoje(), viaturaId, categorias);
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
                reportName: buildReportTitle(viaturaId, categorias),
                tipoVistoria,
                categorias
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
            : "Vistoria 5S - Todas as viaturas do dia",
        tipoVistoria: categorias.length === Object.keys(categoryNames).length ? "completa" : "parcial",
        categorias
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
    if (!confirm("Deseja realmente encerrar a vistoria e gerar o relatório final?")) {
        return;
    }

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
