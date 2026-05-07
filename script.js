import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, serverTimestamp, where, limit, deleteDoc, doc as firestoreDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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
    viaturas: ["Nível de Óleo", "Reservatório do líquido de arrefecimento", "Pressão dos Pneus", "Luzes de Sinalização", "Limpeza Interna", "Estepe", "Macaco", "Triângulo"],
    tablets: ["Tela", "Carcaça", "Câmera", "Botões físicos", "Entrada de carregador", "Caneta", "Capa de proteção", "Carregador", "Funcionamento do toque", "Aplicativos de trabalho"]
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
let selectedTabletDamageType = "arranhao";
const vehicleDamages = {};
const tabletDamages = {};
const selectedVistorias = new Set();

/**
 * Inicializa o status para todas as viaturas
 */
for (let i = 1; i <= totalViaturas; i++) {
    surveyStatus[i.toString()] = { ferramentas: false, epis: false, viaturas: false, tablets: false };
    vehicleDamages[i.toString()] = [];
    tabletDamages[i.toString()] = [];
}

// Mapeamento para nomes amigáveis na exibição do status
const categoryNames = { ferramentas: "Ferramentas", epis: "EPIs", viaturas: "Viatura", tablets: "Tablet" };
const damageTypeNames = {
    arranhao: "Arranhão",
    amassado: "Amassado",
    trincado: "Trincado",
    quebrado: "Quebrado",
    sem_caneta: "Sem caneta"
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
        'viaturas': 'lista-viaturas',
        'tablets': 'lista-tablets'
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

    if (pageId === 'tablets') {
        updateTabletInfo();
        renderTabletDamageMarkers();
        renderTabletDamageList();
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
                <span class="dot ${status.tablets ? 'done' : ''}" title="Tablet">📱</span>
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
    updateTabletInfo(id);
    
    // Recarrega os itens da aba atual para a nova viatura
    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab) renderItems(activeTab.id);
}

function updateTabletInfo(viaturaId = selectedViatura) {
    const label = document.getElementById('tablet-current-label');
    if (label) label.innerText = `Tablet ${viaturaId.toString().padStart(2, '0')}`;
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

function setTabletDamageType(type) {
    selectedTabletDamageType = type;
    document.querySelectorAll('.tablet-damage-type').forEach(button => {
        button.classList.toggle('active', button.dataset.type === type);
    });
}

function marcarAvariaTablet(event) {
    const panel = event.currentTarget;
    const rect = panel.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;

    tabletDamages[selectedViatura].push({
        view: detectarRegiaoTablet(x, y),
        type: selectedTabletDamageType,
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2))
    });

    renderTabletDamageMarkers();
    renderTabletDamageList();
}

function detectarRegiaoTablet(x, y) {
    if (x < 43) return "Frente";
    if (x < 82) return "Traseira";
    return "Lateral/caneta";
}

function renderTabletDamageMarkers() {
    document.querySelectorAll('.tablet-damage-marker').forEach(marker => marker.remove());

    const map = document.getElementById('tablet-map');
    const viewPanel = map?.querySelector('[data-view="tablet"]');
    if (!viewPanel) return;

    tabletDamages[selectedViatura].forEach((damage, index) => {
        const marker = document.createElement('span');
        marker.className = `damage-marker tablet-damage-marker ${damage.type}`;
        marker.style.left = `${damage.x}%`;
        marker.style.top = `${damage.y}%`;
        marker.title = `${damageTypeNames[damage.type]} - ${damage.view}`;
        marker.textContent = String(index + 1);
        marker.onclick = (event) => {
            event.stopPropagation();
            removerAvariaTablet(index);
        };
        viewPanel.appendChild(marker);
    });
}

function renderTabletDamageList() {
    const list = document.getElementById('tablet-damage-list');
    if (!list) return;

    const damages = tabletDamages[selectedViatura];
    if (damages.length === 0) {
        list.innerHTML = '<li class="empty">Nenhuma avaria marcada.</li>';
        return;
    }

    list.innerHTML = damages.map((damage, index) => `
        <li>
            <span><strong>${index + 1}. ${damageTypeNames[damage.type]}</strong> - ${damage.view}</span>
            <button type="button" onclick="removerAvariaTablet(${index})">Remover</button>
        </li>
    `).join('');
}

function removerAvariaTablet(index) {
    tabletDamages[selectedViatura].splice(index, 1);
    renderTabletDamageMarkers();
    renderTabletDamageList();
}

function limparAvariasTablet() {
    if (tabletDamages[selectedViatura].length === 0) return;
    if (!confirm(`Deseja limpar todas as marcações do Tablet ${selectedViatura.padStart(2, '0')}?`)) return;
    tabletDamages[selectedViatura] = [];
    renderTabletDamageMarkers();
    renderTabletDamageList();
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
        btnEncerrar.style.display = (concluidas === Object.keys(categoryNames).length) ? 'block' : 'none';
        btnEncerrar.innerText = `📁 Encerrar Vistoria Viatura ${selectedViatura} (Gerar PDF)`;
    }
}

/**
 * Finaliza a vistoria da categoria selecionada e informa o status da viatura
 * @param {string} category - A categoria concluída
 */
async function finalizarVistoria(category) {
    const kmInput = document.getElementById('km');
    const vistoriadorGeral = document.getElementById('vistoriador-atual').value;
    const vistoriadorTablet = document.getElementById('tablet-vistoriador')?.value || "";
    const vistoriador = category === 'tablets' ? vistoriadorTablet : vistoriadorGeral;
    
    // Validação: Se for a aba de viaturas, o KM é obrigatório
    if (category === 'viaturas' && (!kmInput || !kmInput.value)) {
        alert("Por favor, informe o KM atual da viatura antes de finalizar.");
        return;
    }

    if (!vistoriador) {
        alert(category === 'tablets'
            ? "Por favor, selecione Matheus ou Italo como responsável pela vistoria do tablet."
            : "Por favor, selecione quem está realizando a vistoria no topo da página.");
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
        tabletId: (category === 'tablets') ? selectedViatura : null,
        vistoriador: vistoriador,
        categoria: category,
        itens: checklistResults,
        km: (category === 'viaturas') ? kmInput.value : null,
        avarias: (category === 'viaturas') ? [...vehicleDamages[selectedViatura]] : [],
        avariasTablet: (category === 'tablets') ? [...tabletDamages[selectedViatura]] : []
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
        const categoriaSalva = dadosTemporariosVistoria.categoria;
        const viaturaSalva = selectedViatura;
        
        if (document.getElementById('km')) document.getElementById('km').value = '';
        if (dadosTemporariosVistoria.categoria === 'viaturas') {
            vehicleDamages[selectedViatura] = [];
            renderDamageMarkers();
            renderDamageList();
        }
        if (dadosTemporariosVistoria.categoria === 'tablets') {
            tabletDamages[selectedViatura] = [];
            renderTabletDamageMarkers();
            renderTabletDamageList();
        }
        
        surveyStatus[selectedViatura][dadosTemporariosVistoria.categoria] = true;
        renderViaturaDashboard();
        updateMenuStatus();
        
        // Limpa o cache para forçar recarregamento no histórico admin
        vistoriasCache = [];
        
        dadosTemporariosVistoria = null;
        alert("✅ Vistoria salva com sucesso!");

        if (categoriaSalva === 'tablets' && todasEtapasConcluidas(viaturaSalva)) {
            await gerarRelatorioComEscolha({ resetarStatus: true });
        }
    } catch (error) {
        console.error("Erro ao salvar no Firestore: ", error);
        alert("Erro ao salvar dados no Firebase.");
    }
}

function todasEtapasConcluidas(viaturaId = selectedViatura) {
    const status = surveyStatus[viaturaId];
    return Boolean(status) && Object.keys(categoryNames).every(category => status[category]);
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
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Carregando...</td></tr>';
    
    try {
        const q = query(collection(db, "vistorias"), orderBy("dataEnvio", "desc"));
        const querySnapshot = await getDocs(q);
        
        tbody.innerHTML = '';
        vistoriasCache = [];
        selectedVistorias.clear();
        atualizarContadorSelecionadas();

        querySnapshot.forEach((doc) => {
            vistoriasCache.push({ id: doc.id, ...doc.data() });
        });

        aplicarFiltros();
    } catch (error) {
        console.error("Erro ao buscar histórico:", error);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Erro ao carregar dados.</td></tr>';
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
        const temAvariaTablet = Array.isArray(v.avariasTablet) && v.avariasTablet.length > 0;
        return temItemPendente || temAvariaVisual || temAvariaTablet;
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
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nenhuma vistoria encontrada com os filtros aplicados.</td></tr>';
        return;
    }

    dados.forEach((data) => {
        const dateObj = data.dataEnvio?.toDate() || new Date();
        const temPendencia = data.itens.some(i => i.status !== 'ok') 
            || (Array.isArray(data.avarias) && data.avarias.length > 0)
            || (Array.isArray(data.avariasTablet) && data.avariasTablet.length > 0);
        const statusHTML = temPendencia 
            ? `<span class="status-pendente">Pendência</span>` 
            : `<span class="status-ok">Tudo OK</span>`;
        const equipamento = data.categoria === 'tablets'
            ? `Tablet ${data.tabletId || data.viaturaId}`
            : `Viatura ${data.viaturaId}`;

        tbody.innerHTML += `
            <tr onclick="verDetalhes('${data.id}')">
                <td onclick="event.stopPropagation();">
                    <input type="checkbox" class="history-select" value="${data.id}" ${selectedVistorias.has(data.id) ? 'checked' : ''} onchange="toggleSelecionarVistoria('${data.id}', this.checked)">
                </td>
                <td>${dateObj.toLocaleString('pt-BR')}</td>
                <td>${data.vistoriador}</td>
                <td>${equipamento}</td>
                <td>${categoryNames[data.categoria] || data.categoria}</td>
                <td>${statusHTML}</td>
            </tr>
        `;
    });
    atualizarContadorSelecionadas();
}

function toggleSelecionarVistoria(id, checked) {
    if (checked) {
        selectedVistorias.add(id);
    } else {
        selectedVistorias.delete(id);
    }
    atualizarContadorSelecionadas();
}

function toggleSelecionarTodasVistorias(checked) {
    document.querySelectorAll('.history-select').forEach(checkbox => {
        checkbox.checked = checked;
        toggleSelecionarVistoria(checkbox.value, checked);
    });
}

function atualizarContadorSelecionadas() {
    const count = selectedVistorias.size;
    const label = document.getElementById('selected-count');
    const selectAll = document.getElementById('select-all-vistorias');
    if (label) label.innerText = `${count} selecionada${count === 1 ? '' : 's'}`;
    if (selectAll) {
        const visibleCheckboxes = document.querySelectorAll('.history-select');
        selectAll.checked = visibleCheckboxes.length > 0 && [...visibleCheckboxes].every(checkbox => checkbox.checked);
    }
}

async function excluirVistoriasSelecionadas() {
    const ids = [...selectedVistorias];
    if (ids.length === 0) {
        alert("Selecione pelo menos uma vistoria para excluir.");
        return;
    }

    if (!auth.currentUser) {
        alert("Faça login no Painel Admin antes de excluir vistorias.");
        return;
    }

    if (!confirm(`Deseja excluir ${ids.length} vistoria${ids.length === 1 ? '' : 's'} selecionada${ids.length === 1 ? '' : 's'}? Esta ação não pode ser desfeita.`)) {
        return;
    }

    const deleteButton = document.querySelector('.btn-delete-selected');
    try {
        if (deleteButton) deleteButton.disabled = true;
        for (const id of ids) {
            await deleteDoc(firestoreDoc(db, "vistorias", id));
        }
        selectedVistorias.clear();
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

/**
 * Exibe modal com detalhes de itens pendentes
 */
function verDetalhes(docId) {
    const vistoria = vistoriasCache.find(v => v.id === docId);
    if (!vistoria) return;

    const modal = document.getElementById('details-modal');
    const body = document.getElementById('modal-body');
    const title = document.getElementById('modal-title');

    const equipamentoTitulo = vistoria.categoria === 'tablets'
        ? `Tablet ${vistoria.tabletId || vistoria.viaturaId}`
        : `Viatura ${vistoria.viaturaId}`;
    title.innerText = `Detalhes: ${categoryNames[vistoria.categoria]} - ${equipamentoTitulo}`;
    
    const pendentes = vistoria.itens.filter(i => i.status !== 'ok');
    
    let html = `<p><strong>Vistoriador:</strong> ${vistoria.vistoriador}</p>`;
    if (vistoria.km) html += `<p><strong>KM:</strong> ${vistoria.km}</p>`;
    if (vistoria.categoria === 'tablets') {
        html += `<p><strong>Tablet:</strong> ${String(vistoria.tabletId || vistoria.viaturaId).padStart(2, '0')} vinculado à Viatura ${String(vistoria.viaturaId).padStart(2, '0')}</p>`;
    }
    if (vistoria.avarias && vistoria.avarias.length > 0) {
        html += `<h4>Avarias marcadas:</h4><ul class="pending-list">`;
        vistoria.avarias.forEach((avaria, index) => {
            html += `<li><strong>${index + 1}. ${damageTypeNames[avaria.type] || avaria.type}:</strong> ${vehicleViewNames[avaria.view] || avaria.view}</li>`;
        });
        html += `</ul>`;
    }
    if (vistoria.avariasTablet && vistoria.avariasTablet.length > 0) {
        html += `<h4>Avarias do tablet:</h4><ul class="pending-list">`;
        vistoria.avariasTablet.forEach((avaria, index) => {
            html += `<li><strong>${index + 1}. ${damageTypeNames[avaria.type] || avaria.type}:</strong> ${avaria.view}</li>`;
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

    y = ensurePdfSpace(pdf, y, 36);
    y += 8;
    pdf.line(10, y, 92, y);
    pdf.line(112, y, 194, y);
    y += 5;
    pdf.text("Técnico responsável da viatura", 17, y);
    pdf.text("Auxiliar técnico", 137, y);
    y += 8;
    pdf.text("Nome:", 10, y);
    pdf.text("Nome:", 112, y);

    return y + 10;
}

/**
 * Gera PDF de uma vistoria específica ou do histórico
 */
async function gerarPDF(titulo, dados, options = {}) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const reportName = options.reportName || titulo.replace(/_/g, " ");
    const columnWidth = 90;
    const columns = [{ x: 10, y: 36 }, { x: 108, y: 36 }];
    const cursor = { col: 0, y: 36 };

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
        doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 140, 10);
        doc.setTextColor(51, 51, 51);
    }

    function nextColumn() {
        if (cursor.col === 0) {
            cursor.col = 1;
            cursor.y = columns[1].y;
            return;
        }
        doc.addPage();
        addPdfHeader();
        cursor.col = 0;
        cursor.y = columns[0].y;
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

    addPdfHeader();

    dados.forEach((v) => {
        ensureColumnSpace(24);
        const dataObj = v.dataEnvio?.toDate() || new Date();
        const equipamento = v.categoria === 'tablets'
            ? `Tablet ${v.tabletId || v.viaturaId} / Viatura ${v.viaturaId}`
            : `Viatura ${v.viaturaId}`;
        addColumnText(`${equipamento} - ${categoryNames[v.categoria] || v.categoria}`, { bold: true, size: 10, lineHeight: 5 });
        addColumnText(`Vistoriador: ${v.vistoriador}`);
        addColumnText(`Data: ${dataObj.toLocaleString('pt-BR')}`);

        if (v.km) {
            addColumnText(`KM: ${v.km}`);
        }

        if (v.avarias && v.avarias.length > 0) {
            addColumnText("Avarias visuais:", { bold: true });
            v.avarias.forEach((avaria, index) => {
                const linhaAvaria = `${index + 1}. ${damageTypeNames[avaria.type] || avaria.type} - ${vehicleViewNames[avaria.view] || avaria.view}`;
                addColumnText(linhaAvaria);
            });
        }

        if (v.avariasTablet && v.avariasTablet.length > 0) {
            addColumnText("Avarias do tablet:", { bold: true });
            v.avariasTablet.forEach((avaria, index) => {
                const linhaAvaria = `${index + 1}. ${damageTypeNames[avaria.type] || avaria.type} - ${avaria.view}`;
                addColumnText(linhaAvaria);
            });
        }

        addColumnText("Itens:", { bold: true });
        v.itens.forEach(item => {
            const s = item.status || 'pendente';
            let statusLabel = s === 'ok' ? '[OK]' : `[${s.toUpperCase()}]`;
            let linha = `${statusLabel} ${item.item}`;
            if (item.observacao) linha += ` - Motivo: ${item.observacao}`;
            addColumnText(linha);
        });

        addSectionDivider();
    });

    doc.addPage();
    addPdfHeader();
    adicionarTermoResponsabilidade(doc, 36);

    doc.save(`${titulo.replace(/\s+/g, '_')}.pdf`);
}

/**
 * Encerrar a vistoria global da viatura e gerar PDF do que foi feito agora
 */
async function gerarRelatorioViatura(viaturaId = selectedViatura, options = {}) {
    const { confirmar = true, resetarStatus = true } = options;
    try {
        // Busca pelo histórico já ordenado e filtra a viatura no navegador para evitar índice composto no Firestore.
        const q = query(
            collection(db, "vistorias"),
            orderBy("dataEnvio", "desc"),
            limit(200)
        );
        
        const querySnapshot = await getDocs(q);
        const porCategoria = {};
        querySnapshot.forEach(doc => {
            const data = doc.data();
            if (String(data.viaturaId) !== String(viaturaId)) return;
            if (!porCategoria[data.categoria]) porCategoria[data.categoria] = data;
        });
        const dadosViatura = Object.keys(categoryNames)
            .map(category => porCategoria[category])
            .filter(Boolean);

        if (dadosViatura.length < Object.keys(categoryNames).length) {
            alert("Ainda não foram encontradas todas as etapas salvas para gerar o relatório completo.");
            return;
        }

        if (!confirmar || confirm(`Deseja gerar o relatório PDF da Viatura ${viaturaId}?`)) {
            await gerarPDF(`Relatorio_Vistoria_Viatura_${viaturaId}`, dadosViatura, {
                reportName: `Vistoria Viatura ${String(viaturaId).padStart(2, '0')}`
            });
            
            if (resetarStatus) {
                surveyStatus[viaturaId] = { ferramentas: false, epis: false, viaturas: false, tablets: false };
                vehicleDamages[viaturaId] = [];
                tabletDamages[viaturaId] = [];
                renderViaturaDashboard();
                renderDamageMarkers();
                renderDamageList();
                renderTabletDamageMarkers();
                renderTabletDamageList();
                updateMenuStatus();
            }
            alert("Vistoria encerrada e PDF gerado!");
        }
    } catch (error) {
        console.error("Erro detalhado do Firebase:", error);
        alert("Erro ao buscar dados no Firebase: " + error.message);
    }
}

async function encerrarVistoriaCompleta() {
    await gerarRelatorioComEscolha({ resetarStatus: true });
}

function getInicioFimHoje() {
    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    const fim = new Date();
    fim.setHours(23, 59, 59, 999);
    return { inicio, fim };
}

async function buscarVistoriasDeHoje() {
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

async function gerarRelatorioTodasViaturasHoje() {
    const dadosHoje = await buscarVistoriasDeHoje();
    if (dadosHoje.length === 0) {
        alert("Nenhuma vistoria salva hoje foi encontrada.");
        return;
    }

    dadosHoje.sort((a, b) => {
        const viaturaDiff = Number(a.viaturaId || 0) - Number(b.viaturaId || 0);
        if (viaturaDiff !== 0) return viaturaDiff;
        return Object.keys(categoryNames).indexOf(a.categoria) - Object.keys(categoryNames).indexOf(b.categoria);
    });

    await gerarPDF("Relatorio_5S_Todas_Viaturas_Hoje", dadosHoje, {
        reportName: "Vistoria 5S - Todas as viaturas do dia"
    });
}

async function gerarRelatorioComEscolha(options = {}) {
    const resposta = prompt(
        `Gerar PDF de qual vistoria?\n\nDigite o número da viatura, por exemplo: ${selectedViatura.padStart(2, '0')}\nOu digite TODAS para gerar todas as viaturas vistoriadas hoje.`,
        selectedViatura.padStart(2, '0')
    );

    if (!resposta) return;

    const valor = resposta.trim().toUpperCase();
    if (valor === "TODAS" || valor === "TODOS") {
        await gerarRelatorioTodasViaturasHoje();
        return;
    }

    const viaturaId = String(Number(valor));
    if (!viaturaId || viaturaId === "NaN" || Number(viaturaId) < 1 || Number(viaturaId) > totalViaturas) {
        alert("Informe uma viatura válida ou digite TODAS.");
        return;
    }

    await gerarRelatorioViatura(viaturaId, { confirmar: false, resetarStatus: options.resetarStatus && viaturaId === selectedViatura });
}

async function exportarHistoricoPDF() {
    try {
        if (!auth.currentUser) {
            alert("Faça login no Painel Admin antes de exportar o PDF.");
            return;
        }

        if (vistoriasCache.length === 0) {
            await carregarHistorico();
        }

        await gerarRelatorioComEscolha({ resetarStatus: false });
    } catch (error) {
        console.error("Erro ao exportar PDF:", error);
        alert(`Erro ao exportar PDF: ${error?.message || error}`);
    }
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
    updateTabletInfo();
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
window.toggleSelecionarVistoria = toggleSelecionarVistoria;
window.toggleSelecionarTodasVistorias = toggleSelecionarTodasVistorias;
window.excluirVistoriasSelecionadas = excluirVistoriasSelecionadas;
window.confirmarEnvioFinal = confirmarEnvioFinal;
window.abrirModalRevisao = abrirModalRevisao;
window.limparErroItem = limparErroItem;
window.fecharModalRevisao = fecharModalRevisao;
window.setDamageType = setDamageType;
window.marcarAvaria = marcarAvaria;
window.removerAvaria = removerAvaria;
window.limparAvariasViatura = limparAvariasViatura;
window.setTabletDamageType = setTabletDamageType;
window.marcarAvariaTablet = marcarAvariaTablet;
window.removerAvariaTablet = removerAvariaTablet;
window.limparAvariasTablet = limparAvariasTablet;
