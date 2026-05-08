import { damageTypeNames, getVehicleMapConfig, vehicleViewNames } from "./config.js";
import { state } from "./state.js";

export function updateTabletInfo(viaturaId = state.selectedViatura) {
    const label = document.getElementById("tablet-current-label");
    if (label) label.innerText = `Tablet ${viaturaId.toString().padStart(2, "0")}`;
}

export function updateVehicleMapImage(viaturaId = state.selectedViatura) {
    const image = document.getElementById("vehicle-map-image");
    const config = getVehicleMapConfig(viaturaId);

    if (image) {
        if (!image.src.endsWith(config.src)) image.src = config.src;
        image.alt = config.alt;
    }
}

export function setDamageType(type) {
    state.selectedDamageType = type;
    document.querySelectorAll(".vehicle-damage-type").forEach(button => {
        button.classList.toggle("active", button.dataset.type === type);
    });
}

export function marcarAvaria(event, view) {
    const panel = event.currentTarget;
    const rect = panel.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const detectedView = view === "veiculo" ? detectarRegiaoVeiculo(x, y) : view;

    state.vehicleDamages[state.selectedViatura].push({
        view: detectedView,
        mapView: view,
        type: state.selectedDamageType,
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2))
    });

    renderDamageMarkers();
    renderDamageList();
}

export function renderDamageMarkers() {
    document.querySelectorAll(".damage-marker:not(.tablet-damage-marker)").forEach(marker => marker.remove());

    const map = document.getElementById("vehicle-map");
    if (!map) return;

    state.vehicleDamages[state.selectedViatura].forEach((damage, index) => {
        const viewPanel = map.querySelector(`[data-view="${damage.mapView || damage.view}"]`);
        if (!viewPanel) return;

        const marker = document.createElement("span");
        marker.className = `damage-marker ${damage.type}`;
        marker.style.left = `${damage.x}%`;
        marker.style.top = `${damage.y}%`;
        marker.title = `${damageTypeNames[damage.type]} - ${vehicleViewNames[damage.view]}`;
        marker.textContent = getDamageMarkerLabel(damage.type);
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

export function renderDamageList() {
    const list = document.getElementById("damage-list");
    if (!list) return;

    const damages = state.vehicleDamages[state.selectedViatura];
    if (damages.length === 0) {
        list.innerHTML = '<li class="empty">Nenhuma avaria marcada.</li>';
        return;
    }

    list.innerHTML = damages.map((damage, index) => `
        <li>
            <span><strong>${getDamageMarkerLabel(damage.type)} - ${damageTypeNames[damage.type]}</strong> - ${vehicleViewNames[damage.view]}</span>
            <button type="button" onclick="removerAvaria(${index})">Remover</button>
        </li>
    `).join("");
}

export function removerAvaria(index) {
    state.vehicleDamages[state.selectedViatura].splice(index, 1);
    renderDamageMarkers();
    renderDamageList();
}

export function limparAvariasViatura() {
    if (state.vehicleDamages[state.selectedViatura].length === 0) return;
    if (!confirm(`Deseja limpar todas as marcações da Viatura ${state.selectedViatura}?`)) return;
    state.vehicleDamages[state.selectedViatura] = [];
    renderDamageMarkers();
    renderDamageList();
}

export function setTabletDamageType(type) {
    state.selectedTabletDamageType = type;
    document.querySelectorAll(".tablet-damage-type").forEach(button => {
        button.classList.toggle("active", button.dataset.type === type);
    });
}

export function marcarAvariaTablet(event) {
    const panel = event.currentTarget;
    const rect = panel.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;

    state.tabletDamages[state.selectedViatura].push({
        view: detectarRegiaoTablet(x, y),
        type: state.selectedTabletDamageType,
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2))
    });

    renderTabletDamageMarkers();
    renderTabletDamageList();
}

function detectarRegiaoTablet(x) {
    if (x < 43) return "Frente";
    if (x < 82) return "Traseira";
    return "Lateral/caneta";
}

export function renderTabletDamageMarkers() {
    document.querySelectorAll(".tablet-damage-marker").forEach(marker => marker.remove());

    const map = document.getElementById("tablet-map");
    const viewPanel = map?.querySelector('[data-view="tablet"]');
    if (!viewPanel) return;

    state.tabletDamages[state.selectedViatura].forEach((damage, index) => {
        const marker = document.createElement("span");
        marker.className = `damage-marker tablet-damage-marker ${damage.type}`;
        marker.style.left = `${damage.x}%`;
        marker.style.top = `${damage.y}%`;
        marker.title = `${damageTypeNames[damage.type]} - ${damage.view}`;
        marker.textContent = getDamageMarkerLabel(damage.type);
        marker.onclick = (event) => {
            event.stopPropagation();
            removerAvariaTablet(index);
        };
        viewPanel.appendChild(marker);
    });
}

export function renderTabletDamageList() {
    const list = document.getElementById("tablet-damage-list");
    if (!list) return;

    const damages = state.tabletDamages[state.selectedViatura];
    if (damages.length === 0) {
        list.innerHTML = '<li class="empty">Nenhuma avaria marcada.</li>';
        return;
    }

    list.innerHTML = damages.map((damage, index) => `
        <li>
            <span><strong>${getDamageMarkerLabel(damage.type)} - ${damageTypeNames[damage.type]}</strong> - ${damage.view}</span>
            <button type="button" onclick="removerAvariaTablet(${index})">Remover</button>
        </li>
    `).join("");
}

export function removerAvariaTablet(index) {
    state.tabletDamages[state.selectedViatura].splice(index, 1);
    renderTabletDamageMarkers();
    renderTabletDamageList();
}

export function limparAvariasTablet() {
    if (state.tabletDamages[state.selectedViatura].length === 0) return;
    if (!confirm(`Deseja limpar todas as marcações do Tablet ${state.selectedViatura.padStart(2, "0")}?`)) return;
    state.tabletDamages[state.selectedViatura] = [];
    renderTabletDamageMarkers();
    renderTabletDamageList();
}

export function getDamageColor(type) {
    const colors = {
        amassado: "#7950f2",
        arranhao: "#f59f00",
        avariado: "#495057",
        faltante: "#1971c2",
        sem_caneta: "#1971c2",
        trincado: "#1971c2",
        quebrado: "#d6336c"
    };
    return colors[type] || "#495057";
}

export function getDamageMarkerLabel(type) {
    const labels = {
        amassado: "A",
        arranhao: "R",
        avariado: "X",
        faltante: "F",
        trincado: "F",
        sem_caneta: "F",
        quebrado: "Q"
    };
    return labels[type] || "?";
}
