import { auth, onAuthStateChanged } from "./firebase.js";
import {
    limparHistoricoConfig,
    logoutAdmin,
    renderAdminHistory
} from "./admin.js?v=5";
import { carregarConfiguracoes } from "./settings.js";

function voltarPainelAdmin() {
    sessionStorage.setItem("abrirPainelAdmin", "1");
    window.location.href = "index.html";
}

async function atualizarHistoricoConfig() {
    const container = document.getElementById("admin-config-history-list");
    if (container) container.innerHTML = '<p class="admin-history-empty">Atualizando histórico...</p>';
    await carregarConfiguracoes();
    renderAdminHistory();
}

function bindHistoricoFunctions() {
    Object.assign(window, {
        atualizarHistoricoConfig,
        limparHistoricoConfig,
        logoutAdmin,
        renderAdminHistory,
        voltarPainelAdmin
    });
}

function setVisible(selector, visible, display = "block") {
    const element = document.querySelector(selector);
    if (element) element.style.display = visible ? display : "none";
}

document.addEventListener("DOMContentLoaded", () => {
    bindHistoricoFunctions();

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = "index.html";
            return;
        }

        setVisible("header", Boolean(user), "flex");
        setVisible("main", Boolean(user));

        await atualizarHistoricoConfig();
    });

    window.addEventListener("focus", () => {
        if (auth.currentUser) atualizarHistoricoConfig();
    });
});
