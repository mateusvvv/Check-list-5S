import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, serverTimestamp, where, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Configuração do Firebase do seu Web App
const firebaseConfig = {
  apiKey: "AIzaSyBu78yhEoIHxfi3CeSi64PFAxh3k5MDj4M",
  authDomain: "checklist-5s.firebaseapp.com",
  projectId: "checklist-5s",
  storageBucket: "checklist-5s.firebasestorage.app",
  messagingSenderId: "236598402594",
  appId: "1:236598402594:web:65b15d6ab449c5fd55b47b",
  measurementId: "G-BZ55C36L1Q"
};

// Inicializa o Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);

/**
 * Configuração dos itens de vistoria
 * Adicione ou remova itens aqui para manter o HTML limpo
 */
const checklistData = {
    ferramentas: [
        "Controle de Portão do Estacionamento",
        "Adaptador ethernet TIPO C DELL",
        "Tablet Active 3 Samsung + capa + bolsa",
        "Telefone Gôndola com fio Intelbras TC20 Preto",
        "Power Meter ORIENTEK TPN-35",
        "Optical Power Meter G10",
        "Bolsa para KIT de CONECTOR FAST",
        "Caneta Laser",
        "Clivador de Alta Precisão Aua-S2",
        "Alicate Decapador 3 Furos Cfs-2",
        "Alicate Flat",
        "Estilete Profissional",
        "Multímetro/Teste de Cabo",
        "Pincel Retrátil para Detalhamento",
        "Caneta para Limpeza de Conectores SC",
        "Bolsa para Ferramentas CG460",
        "Alicate de Bico",
        "Alicate de Corte",
        "Alicate de Crimpar",
        "Alicate Universal",
        "Broca de 06mm Concreto Curta",
        "Broca de 08mm Concreto Curta",
        "Broca de 06mm de ferro",
        "Broca de 10mm Concreto Longa",
        "Chave de fenda 1/4 x 4\"",
        "Chave Philips 3/16 x 4\"",
        "Chave de boca 10/11\"",
        "Martelo Nº 20",
        "Ponteira Estrela PH2",
        "Furadeira Elétrica Bosch impacto 850W",
        "Arco de Serra F.G",
        "Baú Madeira Ferramentas (Caixote)",
        "Passa Fio Alma de Aço 15M",
        "Extensão 15 metros cabo PP",
        "Escada 6 Metros",
        "Cinta (catraca) da Escada /6m",
        "Carrinho dobrável para bobina DROP",
        "Escada tesoura cogumelo RF-5",
        "Carretel recolhedor com fita de sinalização",
        "Cone Sinalização Flexível 75cm Laranja e Branco",
        "Garrafa Térmica 5L Cor Azul",
        "Pasta"
    ],
    epis: [
        "Capacete de Segurança Branco",
        "Talabart de Posicionamento",
        "Cinturão de Segurança TAM02",
        "Mosquetão Trava Quedas",
        "Botina de Segurança Nº 41",
        "Luvas Flex Cut",
        "Caneta Detecção de Tensão CAT II 100V Fepro-DT90",
        "Óculos de Segurança",
        "Bolsa EPI CG 445",
        "Pochete Carbografite"
    ],
    viaturas: ["Nível de Óleo", "Reservatório do líquido de arrefecimento", "Pressão dos Pneus", "Luzes de Sinalização", "Limpeza Interna", "Estepe", "Macaco", "Triângulo"]
};

/**
 * Estado das vistorias por viatura
 */
/**
 * Estado Global
 */
let selectedViatura = "1";
const surveyStatus = {};
const totalViaturas = 9;

let vistoriasCache = []; // Armazena dados para o modal e exportação
let dadosTemporariosVistoria = null; // Armazena dados enquanto detalha pendências
let selectedDamageType = "arranhao";
const vehicleDamages = {};

/**
 * Inicializa o status para todas as viaturas
 */
for (let i = 1; i <= totalViaturas; i++) {
    surveyStatus[i.toString()] = { ferramentas: false, epis: false, viaturas: false };
    vehicleDamages[i.toString()] = [];
}

// Mapeamento para nomes amigáveis na exibição do status
const categoryNames = { ferramentas: "Ferramentas", epis: "EPIs", viaturas: "Viatura" };
const damageTypeNames = {
    arranhao: "Arranhão",
    amassado: "Amassado",
    trincado: "Trincado",
    quebrado: "Quebrado"
};
const vehicleViewNames = {
    frente: "Frente",
    "lateral-esquerda": "Lateral esquerda",
    "lateral-direita": "Lateral direita",
    traseira: "Traseira",
    veiculo: "Mapa visual da viatura"
};

const vehicleMapConfig = {
    default: {
        src: "assets/strada-mapa.png",
        alt: "Vistas lateral, traseira e frontal da Fiat Strada"
    },
    mobi: {
        src: "assets/mobi-mapa.png",
        alt: "Vistas lateral, traseira e frontal do Fiat Mobi"
    }
};

function getVehicleMapConfig(viaturaId = selectedViatura) {
    const idNumber = Number(viaturaId);
    return [7, 8].includes(idNumber) ? vehicleMapConfig.mobi : vehicleMapConfig.default;
}

/**
 * Alterna a visibilidade do menu dropdown
 */
function toggleMenu() {
    const menuList = document.getElementById('menu-list');
    menuList.classList.toggle('show');
}

/**
 * Função para alternar entre as abas de vistoria
 * @param {string} pageId - O ID da seção que deve ser mostrada
 */
function showPage(pageId) {
    // Oculta o painel de seleção de viaturas se for Admin para dar foco ao gerenciamento
    const headerInfo = document.querySelector('.header-info');
    if (headerInfo) headerInfo.style.display = pageId === 'admin' ? 'none' : 'block';

    // Remove a classe active de todos os conteúdos
    const contents = document.querySelectorAll('.tab-content');
    contents.forEach(content => {
        content.classList.remove('active');
    });

    // Adiciona a classe active na página selecionada
    const activePage = document.getElementById(pageId);
    if (activePage) {
        activePage.classList.add('active');
        renderItems(pageId);
    }
    
    if (pageId === 'admin' && auth.currentUser) {
        carregarHistorico();
    }

    // Fecha o menu após selecionar uma opção
    document.getElementById('menu-list').classList.remove('show');

    // Scroll para o topo ao trocar de aba
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Renderiza os itens do checklist na tela
 */
function renderItems(pageId) {
    const containerMapping = {
        'ferramentas': 'lista-ferramentas',
        'epis': 'lista-epis',
        'viaturas': 'lista-viaturas'
    };
    const containerId = containerMapping[pageId];

    const container = document.getElementById(containerId);
    if (!container) return;

    const items = checklistData[pageId];
    if (!items) return;
    
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
    `).join('');

    if (pageId === 'viaturas') {
        updateVehicleMapImage();
        renderDamageMarkers();
        renderDamageList();
    }
}

/**
 * Remove a sinalização de erro quando o usuário seleciona uma opção
 */
function limparErroItem(pageId, index) {
    const row = document.getElementById(`row-${pageId}-${index}`);
    if (row) row.classList.remove('error');
}

/**
 * Renderiza o dashboard de viaturas
 */
function renderViaturaDashboard() {
    const grid = document.getElementById('viaturas-grid');
    if (!grid) return;

    grid.innerHTML = '';

    for (let i = 1; i <= totalViaturas; i++) {
        const id = i.toString();
        const status = surveyStatus[id];
        const isActive = selectedViatura === id;

        const card = document.createElement('div');
        card.className = `viatura-card ${isActive ? 'active' : ''}`;
        card.onclick = () => selectViatura(id);

        card.innerHTML = `
            <span class="viatura-name">Viatura ${id.padStart(2, '0')}</span>
            <div class="status-dots">
                <span class="dot ${status.ferramentas ? 'done' : ''}" title="Ferramentas">🔧</span>
                <span class="dot ${status.epis ? 'done' : ''}" title="EPIs">🦺</span>
                <span class="dot ${status.viaturas ? 'done' : ''}" title="Viatura">🚗</span>
            </div>
        `;
        grid.appendChild(card);
    }
}

/**
 * Seleciona uma viatura e atualiza a interface
 */
function selectViatura(id) {
    selectedViatura = id;
    renderViaturaDashboard();
    updateMenuStatus();
    updateVehicleMapImage(id);
    
    // Recarrega os itens da aba atual para a nova viatura
    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab) renderItems(activeTab.id);
}

function updateVehicleMapImage(viaturaId = selectedViatura) {
    const image = document.getElementById('vehicle-map-image');
    const config = getVehicleMapConfig(viaturaId);

    if (image) {
        if (!image.src.endsWith(config.src)) image.src = config.src;
        image.alt = config.alt;
    }
}

function setDamageType(type) {
    selectedDamageType = type;
    document.querySelectorAll('.damage-type').forEach(button => {
        button.classList.toggle('active', button.dataset.type === type);
    });
}

function marcarAvaria(event, view) {
    const panel = event.currentTarget;
    const rect = panel.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const detectedView = view === 'veiculo' ? detectarRegiaoVeiculo(x, y) : view;

    vehicleDamages[selectedViatura].push({
        view: detectedView,
        mapView: view,
        type: selectedDamageType,
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2))
    });

    renderDamageMarkers();
    renderDamageList();
}

function renderDamageMarkers() {
    document.querySelectorAll('.damage-marker').forEach(marker => marker.remove());

    const map = document.getElementById('vehicle-map');
    if (!map) return;

    vehicleDamages[selectedViatura].forEach((damage, index) => {
        const viewPanel = map.querySelector(`[data-view="${damage.mapView || damage.view}"]`);
        if (!viewPanel) return;

        const marker = document.createElement('span');
        marker.className = `damage-marker ${damage.type}`;
        marker.style.left = `${damage.x}%`;
        marker.style.top = `${damage.y}%`;
        marker.title = `${damageTypeNames[damage.type]} - ${vehicleViewNames[damage.view]}`;
        marker.textContent = String(index + 1);
        marker.onclick = (event) => {
            event.stopPropagation();
            removerAvaria(index);
        };
        viewPanel.appendChild(marker);
    });
}

function detectarRegiaoVeiculo(x, y) {
    if (y < 34) return "lateral-direita";
    if (y < 68) return "lateral-esquerda";
    if (x < 45) return "traseira";
    return "frente";
}

function renderDamageList() {
    const list = document.getElementById('damage-list');
    if (!list) return;

    const damages = vehicleDamages[selectedViatura];
    if (damages.length === 0) {
        list.innerHTML = '<li class="empty">Nenhuma avaria marcada.</li>';
        return;
    }

    list.innerHTML = damages.map((damage, index) => `
        <li>
            <span><strong>${index + 1}. ${damageTypeNames[damage.type]}</strong> - ${vehicleViewNames[damage.view]}</span>
            <button type="button" onclick="removerAvaria(${index})">Remover</button>
        </li>
    `).join('');
}

function removerAvaria(index) {
    vehicleDamages[selectedViatura].splice(index, 1);
    renderDamageMarkers();
    renderDamageList();
}

function limparAvariasViatura() {
    if (vehicleDamages[selectedViatura].length === 0) return;
    if (!confirm(`Deseja limpar todas as marcações da Viatura ${selectedViatura}?`)) return;
    vehicleDamages[selectedViatura] = [];
    renderDamageMarkers();
    renderDamageList();
}

/**
 * Atualiza visualmente o menu indicando quais vistorias foram concluídas para a viatura atual
 */
function updateMenuStatus() {
    const status = surveyStatus[selectedViatura];

    let concluidas = 0;
    Object.keys(categoryNames).forEach(category => {
        const link = document.getElementById(`menu-${category}`);
        if (link) {
            if (status[category]) {
                link.classList.add('completed');
                concluidas++;
            } else {
                link.classList.remove('completed');
            }
        }
    });

    // Mostrar botão de encerrar se as 3 estiverem prontas
    const btnEncerrar = document.getElementById('btn-encerrar-geral');
    if (btnEncerrar) {
        btnEncerrar.style.display = (concluidas === 3) ? 'block' : 'none';
        btnEncerrar.innerText = `📁 Encerrar Vistoria Viatura ${selectedViatura} (Gerar PDF)`;
    }
}

/**
 * Finaliza a vistoria da categoria selecionada e informa o status da viatura
 * @param {string} category - A categoria concluída
 */
async function finalizarVistoria(category) {
    const kmInput = document.getElementById('km');
    const vistoriador = document.getElementById('vistoriador-atual').value;
    
    // Validação: Se for a aba de viaturas, o KM é obrigatório
    if (category === 'viaturas' && (!kmInput || !kmInput.value)) {
        alert("Por favor, informe o KM atual da viatura antes de finalizar.");
        return;
    }

    if (!vistoriador) {
        alert("Por favor, selecione quem está realizando a vistoria no topo da página.");
        return;
    }

    // 1. Coletar os dados atuais do checklist
    const items = checklistData[category];
    const checklistResults = [];
    let temErro = false;
    
    for (let i = 0; i < items.length; i++) {
        const radio = document.querySelector(`input[name="status-${category}-${i}"]:checked`);
        const row = document.getElementById(`row-${category}-${i}`);
        if (!radio) {
            if (row) row.classList.add('error');
            temErro = true;
            continue;
        }
        checklistResults.push({
            item: items[i],
            status: radio.value,
            observacao: ""
        });
    }

    if (temErro) {
        alert("Existem itens sem marcação. Por favor, verifique os campos destacados em vermelho.");
        return;
    }

    // Prepara os dados temporários para o salvamento posterior
    dadosTemporariosVistoria = {
        viaturaId: selectedViatura,
        vistoriador: vistoriador,
        categoria: category,
        itens: checklistResults,
        km: (category === 'viaturas') ? kmInput.value : null,
        avarias: (category === 'viaturas') ? [...vehicleDamages[selectedViatura]] : []
    };

    // Agora o modal abre APENAS para o status 'pendente'
    const pendentes = checklistResults.filter(r => r.status === 'pendente');

    if (pendentes.length > 0) {
        abrirModalRevisao(pendentes);
    } else {
        await enviarVistoriaAoFirebase();
    }
}

/**
 * Abre o modal de revisão para itens que não estão 'OK'
 */
function abrirModalRevisao(pendentes) {
    const revisaoBody = document.getElementById('revisao-body');
    revisaoBody.innerHTML = pendentes.map((p, index) => `
        <div class="revisao-item">
            <label><strong>${p.item}</strong> (${p.status.toUpperCase()})</label>
            <textarea id="rev-obs-${index}" placeholder="Descreva o motivo (obrigatório)..." required></textarea>
        </div>
    `).join('');
    document.getElementById('revisao-modal').style.display = 'block';
}

/**
 * Valida as justificativas no modal e envia os dados
 */
async function confirmarEnvioFinal() {
    // Filtra apenas os itens que foram realmente exibidos no modal (status 'pendente')
    const pendentesAJustificar = dadosTemporariosVistoria.itens.filter(r => r.status === 'pendente');
    
    for (let i = 0; i < pendentesAJustificar.length; i++) {
        const obs = document.getElementById(`rev-obs-${i}`).value;
        if (!obs || !obs.trim()) {
            alert("Por favor, preencha todos os motivos das pendências.");
            return;
        }
        pendentesAJustificar[i].observacao = obs;
    }

    document.getElementById('revisao-modal').style.display = 'none';
    await enviarVistoriaAoFirebase();
}

/**
 * Fecha o modal de revisão sem salvar os dados
 */
function fecharModalRevisao() {
    document.getElementById('revisao-modal').style.display = 'none';
}

/**
 * Envio real dos dados para o Firestore
 */
async function enviarVistoriaAoFirebase() {
    try {
        const docData = { ...dadosTemporariosVistoria, dataEnvio: serverTimestamp() };
        await addDoc(collection(db, "vistorias"), docData);
        
        if (document.getElementById('km')) document.getElementById('km').value = '';
        if (dadosTemporariosVistoria.categoria === 'viaturas') {
            vehicleDamages[selectedViatura] = [];
            renderDamageMarkers();
            renderDamageList();
        }
        
        surveyStatus[selectedViatura][dadosTemporariosVistoria.categoria] = true;
        renderViaturaDashboard();
        updateMenuStatus();
        
        // Limpa o cache para forçar recarregamento no histórico admin
        vistoriasCache = [];
        
        alert("✅ Vistoria salva com sucesso!");
        dadosTemporariosVistoria = null;
    } catch (error) {
        console.error("Erro ao salvar no Firestore: ", error);
        alert("Erro ao salvar dados no Firebase.");
    }
}

/**
 * Autenticação e Funções Admin
 */
async function loginAdmin() {
    const email = document.getElementById('admin-email').value;
    const pass = document.getElementById('admin-password').value;
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (error) {
        alert("Erro no login: " + error.message);
    }
}

async function logoutAdmin() {
    await signOut(auth);
}

async function carregarHistorico() {
    const tbody = document.getElementById('history-tbody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Carregando...</td></tr>';
    
    try {
        const q = query(collection(db, "vistorias"), orderBy("dataEnvio", "desc"));
        const querySnapshot = await getDocs(q);
        
        tbody.innerHTML = '';
        vistoriasCache = [];

        querySnapshot.forEach((doc) => {
            vistoriasCache.push({ id: doc.id, ...doc.data() });
        });

        aplicarFiltros();
    } catch (error) {
        console.error("Erro ao buscar histórico:", error);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:red;">Erro ao carregar dados.</td></tr>';
    }
}

/**
 * Filtra os dados do cache e renderiza a tabela
 */
function aplicarFiltros() {
    const vistoriador = document.getElementById('filter-vistoriador').value;
    const dataInicio = document.getElementById('filter-data-inicio').value;
    const dataFim = document.getElementById('filter-data-fim').value;

    let filtrados = vistoriasCache;

    if (vistoriador) {
        filtrados = filtrados.filter(v => v.vistoriador === vistoriador);
    }

    if (dataInicio) {
        const dInicio = new Date(dataInicio + "T00:00:00");
        filtrados = filtrados.filter(v => (v.dataEnvio?.toDate() || new Date()) >= dInicio);
    }

    if (dataFim) {
        const dFim = new Date(dataFim + "T23:59:59");
        filtrados = filtrados.filter(v => (v.dataEnvio?.toDate() || new Date()) <= dFim);
    }

    atualizarCardsEstatisticas(filtrados);
    renderHistoricoTable(filtrados);
}

/**
 * Atualiza os números nos cartões do Dashboard Admin
 */
function atualizarCardsEstatisticas(dados) {
    const total = dados.length;
    const pendentes = dados.filter(v => {
        const temItemPendente = v.itens.some(i => i.status !== 'ok');
        const temAvariaVisual = Array.isArray(v.avarias) && v.avarias.length > 0;
        return temItemPendente || temAvariaVisual;
    }).length;
    const ok = total - pendentes;

    document.getElementById('stat-total').innerText = total;
    document.getElementById('stat-pending').innerText = pendentes;
    document.getElementById('stat-ok').innerText = ok;
}

/**
 * Gera as linhas da tabela com base nos dados fornecidos
 */
function renderHistoricoTable(dados) {
    const tbody = document.getElementById('history-tbody');
    tbody.innerHTML = '';

    if (dados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhuma vistoria encontrada com os filtros aplicados.</td></tr>';
        return;
    }

    dados.forEach((data) => {
        const dateObj = data.dataEnvio?.toDate() || new Date();
        const temPendencia = data.itens.some(i => i.status !== 'ok') || (Array.isArray(data.avarias) && data.avarias.length > 0);
        const statusHTML = temPendencia 
            ? `<span class="status-pendente">Pendência</span>` 
            : `<span class="status-ok">Tudo OK</span>`;

        tbody.innerHTML += `
            <tr onclick="verDetalhes('${data.id}')">
                <td>${dateObj.toLocaleString('pt-BR')}</td>
                <td>${data.vistoriador}</td>
                <td>Viatura ${data.viaturaId}</td>
                <td>${categoryNames[data.categoria] || data.categoria}</td>
                <td>${statusHTML}</td>
            </tr>
        `;
    });
}

/**
 * Exibe modal com detalhes de itens pendentes
 */
function verDetalhes(docId) {
    const vistoria = vistoriasCache.find(v => v.id === docId);
    if (!vistoria) return;

    const modal = document.getElementById('details-modal');
    const body = document.getElementById('modal-body');
    const title = document.getElementById('modal-title');

    title.innerText = `Detalhes: ${categoryNames[vistoria.categoria]} - Viatura ${vistoria.viaturaId}`;
    
    const pendentes = vistoria.itens.filter(i => i.status !== 'ok');
    
    let html = `<p><strong>Vistoriador:</strong> ${vistoria.vistoriador}</p>`;
    if (vistoria.km) html += `<p><strong>KM:</strong> ${vistoria.km}</p>`;
    if (vistoria.avarias && vistoria.avarias.length > 0) {
        html += `<h4>Avarias marcadas:</h4><ul class="pending-list">`;
        vistoria.avarias.forEach((avaria, index) => {
            html += `<li><strong>${index + 1}. ${damageTypeNames[avaria.type] || avaria.type}:</strong> ${vehicleViewNames[avaria.view] || avaria.view}</li>`;
        });
        html += `</ul>`;
    }
    
    if (pendentes.length > 0) {
        html += `<h4>Itens Pendentes:</h4><ul class="pending-list">`;
        pendentes.forEach(p => {
            const iconMap = { pendente: '⚠️', perdeu: '❌', quebrou: '🛠️' };
            const labelStatus = iconMap[p.status] || '❓';
            html += `<li><strong>${labelStatus} ${p.item}:</strong> ${p.observacao || 'Sem observação'}</li>`;
        });
        html += `</ul>`;
    } else {
        html += `<p class="status-ok" style="margin-top:15px;">✅ Nenhum item pendente encontrado.</p>`;
    }

    body.innerHTML = html;
    modal.style.display = 'block';
}

function closeModal() {
    document.getElementById('details-modal').style.display = 'none';
}

/**
 * Gera PDF de uma vistoria específica ou do histórico
 */
async function gerarPDF(titulo, dados) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = 20;

    doc.setFontSize(16);
    doc.text(titulo, 10, y);
    y += 10;
    doc.setFontSize(10);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 10, y);
    y += 10;
    doc.line(10, y, 200, y);
    y += 10;

    dados.forEach((v) => {
        if (y > 270) { doc.addPage(); y = 20; }
        
        const dataObj = v.dataEnvio?.toDate() || new Date();
        doc.setFont("helvetica", "bold");
        doc.text(`Viatura ${v.viaturaId} - ${v.vistoriador}`, 10, y);
        y += 5;
        doc.setFont("helvetica", "normal");
        doc.text(`Data: ${dataObj.toLocaleString('pt-BR')} | Categoria: ${categoryNames[v.categoria] || v.categoria}`, 10, y);
        y += 7;

        if (v.km) {
            doc.text(`KM: ${v.km}`, 10, y);
            y += 5;
        }

        if (v.avarias && v.avarias.length > 0) {
            doc.setFont("helvetica", "bold");
            doc.text("Avarias visuais:", 10, y);
            y += 5;
            doc.setFont("helvetica", "normal");
            v.avarias.forEach((avaria, index) => {
                if (y > 280) { doc.addPage(); y = 20; }
                const linhaAvaria = `${index + 1}. ${damageTypeNames[avaria.type] || avaria.type} - ${vehicleViewNames[avaria.view] || avaria.view}`;
                doc.text(linhaAvaria, 10, y);
                y += 5;
            });
            y += 3;
        }

        doc.setFontSize(8);
        v.itens.forEach(item => {
            if (y > 280) { doc.addPage(); y = 20; }
            const s = item.status || 'pendente';
            let statusLabel = s === 'ok' ? '[OK]' : `[${s.toUpperCase()}]`;
            let linha = `${statusLabel} ${item.item}`;
            if (item.observacao) linha += ` - Motivo: ${item.observacao}`;
            
            const textSplit = doc.splitTextToSize(linha, 180);
            doc.text(textSplit, 10, y);
            y += (textSplit.length * 4);
        });

        doc.setFontSize(10);
        y += 10;
        doc.line(10, y, 100, y);
        y += 10;
    });

    doc.save(`${titulo.replace(/\s+/g, '_')}.pdf`);
}

/**
 * Encerrar a vistoria global da viatura e gerar PDF do que foi feito agora
 */
async function encerrarVistoriaCompleta() {
    const vistoriador = document.getElementById('vistoriador-atual').value;
    if (!vistoriador) return alert("Por favor, selecione o vistoriador no topo da página.");

    try {
        // Busca as 3 categorias mais recentes enviadas para esta viatura diretamente do banco
        const q = query(
            collection(db, "vistorias"),
            where("viaturaId", "==", selectedViatura),
            orderBy("dataEnvio", "desc"),
            limit(3)
        );
        
        const querySnapshot = await getDocs(q);
        const dadosViatura = [];
        querySnapshot.forEach(doc => dadosViatura.push(doc.data()));

        if (dadosViatura.length === 0) {
            alert("Nenhum dado encontrado para gerar o relatório. Realize as vistorias primeiro.");
            return;
        }

        if (confirm(`Deseja encerrar a vistoria da Viatura ${selectedViatura} e gerar o relatório PDF?`)) {
            await gerarPDF(`Relatorio_Vistoria_Viatura_${selectedViatura}`, dadosViatura);
            
            surveyStatus[selectedViatura] = { ferramentas: false, epis: false, viaturas: false };
            vehicleDamages[selectedViatura] = [];
            renderViaturaDashboard();
            renderDamageMarkers();
            renderDamageList();
            updateMenuStatus();
            alert("Vistoria encerrada e PDF gerado!");
        }
    } catch (error) {
        console.error("Erro detalhado do Firebase:", error);
        if (error.message.includes("index")) {
            alert("⚠️ Atenção: O banco de dados precisa de um índice para gerar este relatório.\n\nComo resolver:\n1. Pressione F12 no seu teclado para abrir o Console.\n2. Clique no link azul (URL) que aparece na mensagem de erro.\n3. Clique no botão 'Criar Índice' na página que abrir.\n4. Aguarde 2 minutos e tente gerar o PDF novamente.");
        } else {
            alert("Erro ao buscar dados no Firebase: " + error.message);
        }
    }
}

function exportarHistoricoPDF() {
    if (vistoriasCache.length === 0) return alert("Nenhum dado para exportar.");
    gerarPDF("Historico_Geral_Vistorias_5S", vistoriasCache);
}

onAuthStateChanged(auth, (user) => {
    const loginSec = document.getElementById('admin-login-section');
    const panelSec = document.getElementById('admin-panel-section');
    loginSec.style.display = user ? 'none' : 'block';
    panelSec.style.display = user ? 'block' : 'none';
    if (user) carregarHistorico();
});

/**
 * Fecha o menu se o usuário clicar fora dele
 */
window.onclick = function(event) {
    if (!event.target.matches('.menu-btn')) {
        const dropdown = document.getElementById('menu-list');
        if (dropdown.classList.contains('show')) {
            dropdown.classList.remove('show');
        }
    }
}

// Carrega a primeira página ao iniciar
document.addEventListener('DOMContentLoaded', () => {
    renderItems('ferramentas');
    renderViaturaDashboard();
    updateVehicleMapImage();
    updateMenuStatus();
});

// Como o script agora é um módulo, as funções precisam ser vinculadas ao objeto window
// para que os atributos 'onclick' no seu HTML continuem funcionando.
window.toggleMenu = toggleMenu;
window.showPage = showPage;
window.finalizarVistoria = finalizarVistoria;
window.selectViatura = selectViatura;
window.loginAdmin = loginAdmin;
window.logoutAdmin = logoutAdmin;
window.verDetalhes = verDetalhes;
window.closeModal = closeModal;
window.encerrarVistoriaCompleta = encerrarVistoriaCompleta;
window.exportarHistoricoPDF = exportarHistoricoPDF;
window.aplicarFiltros = aplicarFiltros;
window.carregarHistorico = carregarHistorico;
window.confirmarEnvioFinal = confirmarEnvioFinal;
window.abrirModalRevisao = abrirModalRevisao;
window.limparErroItem = limparErroItem;
window.fecharModalRevisao = fecharModalRevisao;
window.setDamageType = setDamageType;
window.marcarAvaria = marcarAvaria;
window.removerAvaria = removerAvaria;
window.limparAvariasViatura = limparAvariasViatura;
