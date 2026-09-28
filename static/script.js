// ============ CONSTANTS ============
const LS_CHATS  = "mirox_chats_v1";
const LS_MODEL  = "mirox_model";
const LS_THEME  = "mirox_theme";

const $ = s => document.querySelector(s);

const state = {
    user: null,
    models: [],
    model: "luna",
    chats: [],
    chatId: null,
    streaming: false,
};

// ============ UTIL ============
function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
}
function uid() {
    return "c_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ============ STORAGE ============
function loadChats() {
    try { state.chats = JSON.parse(localStorage.getItem(LS_CHATS)) || []; }
    catch { state.chats = []; }
}
function saveChats() {
    try { localStorage.setItem(LS_CHATS, JSON.stringify(state.chats.slice(0, 80))); } catch {}
}
function currentChat() {
    return state.chats.find(c => c.id === state.chatId) || null;
}

// ============ THEME ============
function applyTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    $("#themeBtn").innerHTML = mode === "dark"
    ? '<i class="ri-sun-line"></i>'
    : '<i class="ri-moon-line"></i>';
    localStorage.setItem(LS_THEME, mode);
}

// ============ MODALS ============
function openModal(id)  { $("#" + id).classList.add("open"); }
function closeModal(id) { $("#" + id).classList.remove("open"); }

document.addEventListener("click", e => {
    const closeBtn = e.target.closest("[data-close]");
    if (closeBtn) closeBtn.closest(".overlay").classList.remove("open");
    if (e.target.classList.contains("overlay")) e.target.classList.remove("open");
});

// ============ SIDEBAR ============
function openSidebar()  { $("#sidebar").classList.add("open"); $("#scrim").classList.add("open"); }
function closeSidebar() { $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("open"); }

// ============ API ============
async function api(path, opts = {}) {
    return fetch(path, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        ...opts,
    });
}

// ============ MODELS ============
async function loadModels() {
    try {
        const r = await api("/api/config");
        const d = await r.json();
        state.models = d.models || [];
        if (!d.hf_ready) {
            addSystem("Server HF key is missing. Set HF_API_KEY in Vercel env variables.");
        }
    } catch {
        state.models = [{ id: "luna", label: "Luna" }];
    }
    renderModelMenu();
    updateModelLabel();
}
function renderModelMenu() {
    const menu = $("#modelMenu");
    menu.innerHTML = state.models.map(m => `
    <button data-model="${m.id}" class="${m.id === state.model ? "active" : ""}">
    <span>${escapeHtml(m.label)}</span>
    <small>Fast, general purpose</small>
    </button>
    `).join("");
    menu.querySelectorAll("[data-model]").forEach(b => {
        b.addEventListener("click", () => {
            state.model = b.dataset.model;
            localStorage.setItem(LS_MODEL, state.model);
            updateModelLabel();
            renderModelMenu();
            menu.classList.remove("open");
        });
    });
}
function updateModelLabel() {
    const m = state.models.find(x => x.id === state.model);
    $("#modelLabel").textContent = m ? m.label : "Luna";
}

// ============ AUTH ============
async function loadMe() {
    try {
        const r = await api("/api/me");
        const d = await r.json();
        state.user = d.user;
    } catch { state.user = null; }
    updateUserUI();
}
function updateUserUI() {
    const name = state.user ? state.user.name : "Sign in";
    const tier = state.user ? (state.user.tier || "free") : "—";
    $("#userName").textContent = name;
    $("#userTier").textContent = state.user
    ? (tier.charAt(0).toUpperCase() + tier.slice(1) + " plan")
    : "—";
    $("#userAvatar").textContent = state.user
    ? (state.user.name || "?").trim().charAt(0).toUpperCase()
    : "?";
}

// ============ RENDER CHAT ============
function renderHistory() {
    const box = $("#history");
    box.innerHTML = "";
    const chats = state.chats.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!chats.length) {
        box.innerHTML = '<div class="hist-empty">No chats yet</div>';
        return;
    }
    chats.forEach(c => {
        const el = document.createElement("div");
        el.className = "hist-item" + (c.id === state.chatId ? " active" : "");
        el.innerHTML = `
        <i class="ri-chat-3-line"></i>
        <span>${escapeHtml(c.title || "New chat")}</span>
        <button class="hist-del" title="Delete"><i class="ri-close-line"></i></button>
        `;
        el.addEventListener("click", e => {
            if (e.target.closest(".hist-del")) return;
            state.chatId = c.id;
            renderCurrentChat();
            renderHistory();
            closeSidebar();
        });
        el.querySelector(".hist-del").addEventListener("click", e => {
            e.stopPropagation();
            state.chats = state.chats.filter(x => x.id !== c.id);
            if (state.chatId === c.id) { state.chatId = null; renderCurrentChat(); }
            saveChats();
            renderHistory();
        });
        box.appendChild(el);
    });
}

function renderCurrentChat() {
    const chat = $("#chat");
    chat.innerHTML = "";
    const convo = currentChat();
    if (!convo || !convo.messages.length) {
        chat.innerHTML = `
        <div class="welcome" id="welcome">
        <div class="welcome-mark">M</div>
        <h1>How can I help?</h1>
        <p>Ask anything. Mirox will respond instantly.</p>
        </div>`;
        $("#title").textContent = "New chat";
        $("#subtitle").textContent = "";
        return;
    }
    $("#title").textContent = convo.title || "Chat";
    $("#subtitle").textContent = "";
    convo.messages.forEach(m => addMessage(m.role, m.content));
    chat.scrollTop = chat.scrollHeight;
}

function addMessage(role, content, opts = {}) {
    const chat = $("#chat");
    const welcome = chat.querySelector(".welcome");
    if (welcome) welcome.remove();

    const wrap = document.createElement("div");
    wrap.className = "msg " + role;

    const isUser = role === "user";
    const avatarHtml = isUser
    ? '<div class="avatar"><i class="ri-user-3-line"></i></div>'
    : '<div class="avatar">M</div>';

    wrap.innerHTML = `
    ${avatarHtml}
    <div class="bubble"></div>
    `;
    const bubble = wrap.querySelector(".bubble");

    if (opts.thinking) {
        bubble.innerHTML = '<div class="thinking"><span></span><span></span><span></span></div>';
        wrap.dataset.thinking = "1";
    } else if (opts.html) {
        bubble.innerHTML = content;
    } else {
        bubble.textContent = content || "";
    }

    chat.appendChild(wrap);
    chat.scrollTop = chat.scrollHeight;
    return wrap;
}

function addSystem(text) {
    const chat = $("#chat");
    const welcome = chat.querySelector(".welcome");
    if (welcome) welcome.remove();
    const wrap = document.createElement("div");
    wrap.className = "msg error";
    wrap.innerHTML = `
    <div class="avatar"><i class="ri-error-warning-line"></i></div>
    <div class="bubble">${escapeHtml(text)}</div>
    `;
    chat.appendChild(wrap);
    chat.scrollTop = chat.scrollHeight;
}

function scrollBottom(force) {
    const chat = $("#chat");
    const near = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 220;
    if (force || near) chat.scrollTop = chat.scrollHeight;
}

// ============ NEW CHAT ============
function newChat() {
    state.chatId = null;
    renderCurrentChat();
    renderHistory();
    closeSidebar();
    setTimeout(() => $("#input").focus(), 50);
}

// ============ SEND / STREAM ============
async function sendMessage(text) {
    if (state.streaming) return;
    text = (text || "").trim();
    if (!text) return;

    if (!state.user) {
        openModal("loginModal");
        return;
    }

    let convo = currentChat();
    if (!convo) {
        convo = {
            id: uid(),
            title: text.slice(0, 48) || "New chat",
            messages: [],
            updatedAt: Date.now(),
        };
        state.chats.unshift(convo);
        state.chatId = convo.id;
        $("#title").textContent = convo.title;
        renderHistory();
    }

    convo.messages.push({ role: "user", content: text });
    convo.updatedAt = Date.now();
    saveChats();
    addMessage("user", text);
    scrollBottom(true);

    const aiWrap = addMessage("ai", "", { thinking: true });
    const bubble = aiWrap.querySelector(".bubble");
    state.streaming = true;
    $("#sendBtn").disabled = true;

    try {
        const history = convo.messages
        .slice(0, -1)
        .map(m => ({ role: m.role, content: m.content }));

        const response = await api("/api/chat", {
            method: "POST",
            body: JSON.stringify({ message: text, history, model: state.model }),
        });

        if (!response.ok || !response.body) {
            let msg = "Request failed";
            try { const e = await response.json(); msg = e.error || msg; } catch {}
            throw new Error(msg);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";
        let first = true;

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let idx;
            while ((idx = buffer.indexOf("\n\n")) !== -1) {
                const chunk = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);

                for (const line of chunk.split("\n")) {
                    if (!line.startsWith("data:")) continue;
                    const payload = line.slice(5).trim();
                    if (!payload) continue;

                    let evt;
                    try { evt = JSON.parse(payload); } catch { continue; }

                    if (evt.d) {
                        if (first) { bubble.innerHTML = ""; first = false; }
                        full += evt.d;
                        bubble.innerHTML = escapeHtml(full) + '<span class="cursor"></span>';
                        scrollBottom(false);
                    } else if (evt.done) {
                        bubble.textContent = full || "(empty reply)";
                        $("#subtitle").textContent =
                        (evt.model || "") + (evt.ms ? ` · ${evt.ms}ms` : "");
                    } else if (evt.error) {
                        throw new Error(evt.error);
                    }
                }
            }
        }

        if (!full) bubble.textContent = "(empty reply)";

        convo.messages.push({ role: "assistant", content: full });
        convo.updatedAt = Date.now();
        saveChats();
    } catch (err) {
        bubble.textContent = err.message || "Something went wrong.";
        aiWrap.classList.add("error");
    } finally {
        state.streaming = false;
        $("#sendBtn").disabled = !$("#input").value.trim();
        scrollBottom(false);
    }
}

// ============ COMPOSER ============
function autosize() {
    const el = $("#input");
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
}

function wireComposer() {
    const input = $("#input");
    const form  = $("#composer");
    const send  = $("#sendBtn");

    input.addEventListener("input", () => {
        autosize();
        send.disabled = state.streaming || !input.value.trim();
    });

    input.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            form.dispatchEvent(new Event("submit"));
        }
    });

    form.addEventListener("submit", e => {
        e.preventDefault();
        const text = input.value;
        input.value = "";
        autosize();
        send.disabled = true;
        sendMessage(text);
    });
}

// ============ IMAGE ============
function wireImage() {
    $("#imageBtn").addEventListener("click", () => {
        if (!state.user) { openModal("loginModal"); return; }
        openModal("imageModal");
        $("#imageStatus").textContent = "";
        $("#imageResult").innerHTML = "";
        $("#imageResult").classList.remove("show");
        setTimeout(() => $("#imagePrompt").focus(), 100);
    });

    $("#imageGo").addEventListener("click", async () => {
        const prompt = $("#imagePrompt").value.trim();
        if (!prompt) return;
        const btn = $("#imageGo");
        btn.disabled = true;
        $("#imageStatus").textContent = "Generating… this can take 15–30 seconds.";
        $("#imageResult").classList.remove("show");
        $("#imageResult").innerHTML = "";
        try {
            const r = await api("/api/image", {
                method: "POST",
                body: JSON.stringify({ prompt }),
            });
            const d = await r.json();
            if (!d.ok) throw new Error(d.error || "Failed");
            $("#imageResult").innerHTML = `<img src="${d.url}" alt="generated image">`;
            $("#imageResult").classList.add("show");
            $("#imageStatus").textContent = "";
        } catch (e) {
            $("#imageStatus").textContent = e.message;
        } finally {
            btn.disabled = false;
        }
    });
}

// ============ LOGIN ============
function wireLogin() {
    $("#loginForm").addEventListener("submit", async e => {
        e.preventDefault();
        const name  = $("#loginName").value.trim();
        const email = $("#loginEmail").value.trim();
        const status = $("#loginStatus");
        const btn = $("#loginBtn");
        if (!name || !email) return;
        btn.disabled = true;
        status.textContent = "Signing in…";
        try {
            const r = await api("/api/auth/login", {
                method: "POST",
                body: JSON.stringify({ name, email }),
            });
            const d = await r.json();
            if (!d.ok) throw new Error(d.error || "Failed");
            state.user = d.user;
            updateUserUI();
            closeModal("loginModal");
            status.textContent = "";
            $("#input").focus();
        } catch (err) {
            status.textContent = err.message;
        } finally {
            btn.disabled = false;
        }
    });

    $("#userName").parentElement.parentElement.addEventListener("click", e => {
        if (!state.user) return;
        if (e.target.closest("#themeBtn")) return;
        if (confirm("Sign out?")) {
            api("/api/auth/logout", { method: "POST" }).then(() => {
                state.user = null;
                updateUserUI();
                newChat();
            });
        }
    });
}

// ============ WIRE TOP LEVEL ============
function wireTopLevel() {
    $("#newChatBtn").addEventListener("click", newChat);
    $("#openSidebar").addEventListener("click", openSidebar);
    $("#closeSidebar").addEventListener("click", closeSidebar);
    $("#scrim").addEventListener("click", closeSidebar);

    $("#themeBtn").addEventListener("click", e => {
        e.stopPropagation();
        const cur = document.documentElement.getAttribute("data-theme");
        applyTheme(cur === "dark" ? "light" : "dark");
    });

    $("#modelBtn").addEventListener("click", e => {
        e.stopPropagation();
        $("#modelMenu").classList.toggle("open");
    });
    document.addEventListener("click", e => {
        if (!e.target.closest("#modelPicker")) $("#modelMenu").classList.remove("open");
    });
}

// ============ BOOT ============
async function boot() {
    const savedTheme = localStorage.getItem(LS_THEME) || "light";
    applyTheme(savedTheme);

    loadChats();
    const savedModel = localStorage.getItem(LS_MODEL);
    if (savedModel) state.model = savedModel;

    wireTopLevel();
    wireComposer();
    wireImage();
    wireLogin();

    await loadModels();
    await loadMe();
    renderCurrentChat();
    renderHistory();
    autosize();

    if (!state.user) {
        setTimeout(() => openModal("loginModal"), 350);
    } else {
        setTimeout(() => $("#input").focus(), 100);
    }
}

boot();
