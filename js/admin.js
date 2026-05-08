import { categoryNames, damageTypeNames, formatTwoDigits, vehicleViewNames } from "./config.js";
import { addDoc, auth, collection, db, deleteDoc, firestoreDoc, getDocs, onAuthStateChanged, orderBy, query, serverTimestamp, signInWithEmailAndPassword, signOut, updateDoc } from "./firebase.js";
import { getDamageMarkerLabel } from "./damages.js";
import { gerarPDF, gerarRelatorioComEscolha } from "./pdf.js";
import { state } from "./state.js";

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
    await signOut(auth);
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
    if (vistoria.km) html += `<p><strong>KM:</strong> ${vistoria.km}</p>`;
    if (vistoria.categoria === "viaturas") {
        if (vistoria.nivelCombustivel) html += `<p><strong>Combustível:</strong> ${vistoria.nivelCombustivel}</p>`;
        if (vistoria.luzesAdvertencia) html += `<p><strong>Luzes de advertência:</strong> ${vistoria.luzesAdvertencia}</p>`;
        if (vistoria.quaisLuzes) html += `<p><strong>Quais luzes:</strong> ${vistoria.quaisLuzes}</p>`;
        if (vistoria.solicitarManutencao) html += `<p><strong>Solicitar manutenção:</strong> ${vistoria.solicitarManutencao}</p>`;
        if (vistoria.observacoesManutencao) html += `<p><strong>Observações da manutenção:</strong> ${vistoria.observacoesManutencao}</p>`;
    }
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
            html += `<li><strong>${labelStatus} ${p.item}:</strong> ${p.observacao || "Sem observação"}</li>`;
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
    onAuthStateChanged(auth, (user) => {
        const loginSec = document.getElementById("admin-login-section");
        const panelSec = document.getElementById("admin-panel-section");
        loginSec.style.display = user ? "none" : "block";
        panelSec.style.display = user ? "block" : "none";
        if (user) carregarHistorico();
    });
}
