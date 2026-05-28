import { auth, onAuthStateChanged } from "./firebase.js";
import {
    limparHistoricoConfig,
    logoutAdmin,
    renderAdminHistory
} from "./admin.js";
import { carregarConfiguracoes } from "./settings.js";

function voltarPainelAdmin() {
    sessionStorage.setItem("abrirPainelAdmin", "1");
    window.location.href = "index.html";
}

function bindHistoricoFunctions() {
    Object.assign(window, {
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

        await carregarConfiguracoes();
        renderAdminHistory();
    });
});
