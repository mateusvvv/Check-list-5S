/**
 * Configuração dos itens de vistoria
 * Adicione ou remova itens aqui para manter o HTML limpo
 */
const checklistData = {
    ferramentas: [
        "Controle de Porta do Estacionamento",
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

/**
 * Inicializa o status para todas as viaturas
 */
for (let i = 1; i <= totalViaturas; i++) {
    surveyStatus[i.toString()] = { ferramentas: false, epis: false, viaturas: false };
}

// Mapeamento para nomes amigáveis na exibição do status
const categoryNames = { ferramentas: "Ferramentas", epis: "EPIs", viaturas: "Viatura" };

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

    // Fecha o menu após selecionar uma opção
    document.getElementById('menu-list').classList.remove('show');

    // Scroll para o topo ao trocar de aba
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Renderiza os itens do checklist na tela
 */
function renderItems(pageId) {
    const containerId = {
        'ferramentas': 'lista-ferramentas',
        'epis': 'lista-epis',
        'viaturas': 'lista-viaturas'
    }[pageId];

    const container = document.getElementById(containerId);
    if (!container) return;

    const items = checklistData[pageId];
    
    container.innerHTML = items.map((item, index) => `
        <div class="checklist-item">
            <input type="checkbox" id="${pageId}-${index}">
            <label for="${pageId}-${index}">${item}</label>
        </div>
    `).join('');
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
    
    // Recarrega os itens da aba atual para a nova viatura
    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab) renderItems(activeTab.id);
}

/**
 * Atualiza visualmente o menu indicando quais vistorias foram concluídas para a viatura atual
 */
function updateMenuStatus() {
    const status = surveyStatus[selectedViatura];

    Object.keys(categoryNames).forEach(category => {
        const link = document.getElementById(`menu-${category}`);
        if (link) {
            if (status[category]) {
                link.classList.add('completed');
            } else {
                link.classList.remove('completed');
            }
        }
    });
}

/**
 * Finaliza a vistoria da categoria selecionada e informa o status da viatura
 * @param {string} category - A categoria concluída
 */
function finalizarVistoria(category) {
    // Marca a categoria atual como concluída
    surveyStatus[selectedViatura][category] = true;
    
    // Atualiza dashboard e menu
    renderViaturaDashboard();
    updateMenuStatus();
    
    const status = surveyStatus[selectedViatura];
    const pendentes = Object.keys(status)
        .filter(key => !status[key])
        .map(key => categoryNames[key]);

    let mensagem = `✅ Vistoria de ${categoryNames[category]} concluída para a Viatura ${selectedViatura}!\n\n`;
    
    if (pendentes.length > 0) {
        mensagem += `⚠️ Ainda estão pendentes:\n- ${pendentes.join('\n- ')}`;
    } else {
        mensagem += `🎉 Todas as etapas (Ferramentas, EPIs e Viatura) foram concluídas para este veículo!`;
    }
    
    alert(mensagem);
    console.log(`Status Viatura ${selectedViatura}:`, status);
}

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
    updateMenuStatus();
});