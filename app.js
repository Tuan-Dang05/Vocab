// State & storage
const STORAGE_KEYS = {
    words: 'fv_words_v1',
    tg: 'fv_tg_cfg_v1'
};
// const API_BASE = 'https://2.anonm.my.eu.org';
const API_BASE = 'http://localhost:3000';
const TTS_KEY = 'fv_tts_voice_v1';
const AUTH_COOKIE = 'fv_auth_token';
const AUTH_EMAIL_KEY = 'fv_auth_email';

function setCookie(name, value, days) {
    const d = new Date(); d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/`;
}
function getCookie(name) {
    const n = name + '=';
    const ca = document.cookie.split(';');
    for (let c of ca) {
        while (c.charAt(0) === ' ') c = c.substring(1);
        if (c.indexOf(n) === 0) return decodeURIComponent(c.substring(n.length, c.length));
    }
    return '';
}
function deleteCookie(name) { document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`; }
function hasAuthToken() { return !!getCookie(AUTH_COOKIE); }

/** @typedef {{
 *  id:string; word:string; meaning?:string; example?:string; phonetics?:string; pos?:string;
 *  definition?:string; audio?:string; status?:'new'|'learning'|'known'; createdAt:number
 * }} Vocab
 */

/** @type {Vocab[]} */
let vocabList = [];
let filteredList = [];
let currentIndex = 0;
let isFlipped = false;
const analysisCache = {}; // word -> analysis info

function loadStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.words);
        vocabList = raw ? JSON.parse(raw) : [];
    } catch { vocabList = [] }
}
function saveStorage() {
    localStorage.setItem(STORAGE_KEYS.words, JSON.stringify(vocabList));
    updateFooterCount();
}

function getAuthHeaders() { const t = getCookie(AUTH_COOKIE); return t ? { Authorization: `Bearer ${t}` } : {}; }

async function apiFetchWords() {
    try {
        const r = await fetch(`${API_BASE}/api/words`, { headers: { ...getAuthHeaders() } });
        if (!r.ok) throw 0;
        return await r.json();
    } catch { return null; }
}
async function apiCreateWord(doc) {
    try {
        const r = await fetch(`${API_BASE}/api/words`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(doc) });
        if (!r.ok) throw 0;
        return await r.json();
    } catch { return null; }
}
async function apiPatchWord(id, update) {
    try {
        const r = await fetch(`${API_BASE}/api/words/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(update) });
        if (!r.ok) throw 0;
        return await r.json();
    } catch { return null; }
}
async function apiDeleteWord(id) { try { const r = await fetch(`${API_BASE}/api/words/${id}`, { method: 'DELETE', headers: { ...getAuthHeaders() } }); if (!r.ok) throw 0; return await r.json(); } catch { return null; } }

// Auth APIs
async function apiRegister(email, password) {
    const r = await fetch(`${API_BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), credentials: 'include' });
    return r.json();
}
async function apiLogin(email, password) {
    const r = await fetch(`${API_BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), credentials: 'include' });
    return r.json();
}
async function apiLogout() {
    try { await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' }); } catch { }
}

// Telegram config APIs (server)
async function apiTgSaveConfig(cfg) {
    if (!hasAuthToken()) return null;
    const r = await fetch(`${API_BASE}/api/telegram/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(cfg)
    });
    return r.ok ? r.json() : null;
}
async function apiTgLoadConfig() {
    if (!hasAuthToken()) return null;
    const r = await fetch(`${API_BASE}/api/telegram/config`, { headers: { ...getAuthHeaders() } });
    return r.ok ? r.json() : null;
}
async function apiTgStatus() {
    if (!hasAuthToken()) return { connected: false, chatId: '' };
    const r = await fetch(`${API_BASE}/api/telegram/status`, { headers: { ...getAuthHeaders() } });
    if (!r.ok) return { connected: false, chatId: '' };
    return r.json();
}
async function apiTgTestSend(text) {
    if (!hasAuthToken()) return null;
    const r = await fetch(`${API_BASE}/api/telegram/test-send`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ text }) });
    return r.ok ? r.json() : null;
}

function updateFooterCount() {
    const el = document.getElementById('total-count');
    el.textContent = `${vocabList.length} từ`;
}

// UI helpers
function $(id) { return document.getElementById(id) }
function setActiveTab(tab) {
    document.querySelectorAll('.tab').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    $(`tab-${tab}`).classList.add('active');
    document.querySelector(`.tab-button[data-tab="${tab}"]`).classList.add('active');
}

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

function applyFilters() {
    const deck = /** @type {HTMLSelectElement} */($('deck-filter')).value;
    const q = /** @type {HTMLInputElement} */($('search')).value.toLowerCase().trim();
    filteredList = vocabList.filter(v => {
        if (deck !== 'all' && (v.status || 'new') !== deck) return false;
        if (!q) return true;
        return (v.word || '').toLowerCase().includes(q) || (v.meaning || '').toLowerCase().includes(q) || (v.definition || '').toLowerCase().includes(q);
    });
    if (currentIndex >= filteredList.length) currentIndex = 0;
    renderFlashcard();
}

function renderFlashcard() {
    const card = $('flashcard');
    const inner = $('flashcard-inner');
    isFlipped = false; card.classList.remove('flipped');
    const progress = $('progress');
    if (filteredList.length === 0) {
        $('word').textContent = 'Chưa có từ';
        $('phonetics').textContent = '';
        $('pos').textContent = '';
        $('definition').textContent = 'Hãy thêm từ ở tab "Thêm từ"';
        $('example').textContent = '';
        progress.textContent = '0 / 0';
        $('inline-analysis').textContent = '—';
        return;
    }
    const v = filteredList[currentIndex];
    $('word').textContent = v.word;
    $('phonetics').textContent = v.phonetics || '';
    $('pos').textContent = v.pos || '';
    $('definition').textContent = v.meaning || v.definition || '—';
    $('example').textContent = v.example || '—';
    progress.textContent = `${currentIndex + 1} / ${filteredList.length}`;

    const audioBtn = $('play-audio');
    audioBtn.classList.remove('playing');
    audioBtn.onclick = () => {
        const stopTTS = () => {
            try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) { }
        }
        const playAudioUrl = (url) => {
            const a = new Audio(url);
            audioBtn.classList.add('playing');
            a.play().finally(() => audioBtn.classList.remove('playing')).catch(() => audioBtn.classList.remove('playing'));
        }
        if (v.audio) {
            stopTTS();
            playAudioUrl(v.audio);
        } else if ('speechSynthesis' in window) {
            const utter = new SpeechSynthesisUtterance(v.word);
            const selectedVoiceURI = localStorage.getItem(TTS_KEY);
            const voices = window.speechSynthesis.getVoices();
            const voice = voices.find(vc => vc.voiceURI === selectedVoiceURI) || voices.find(vc => /^en(-|_)/i.test(vc.lang)) || voices[0];
            if (voice) { utter.voice = voice; utter.lang = voice.lang; }
            audioBtn.classList.add('playing');
            utter.onend = () => audioBtn.classList.remove('playing');
            utter.onerror = () => audioBtn.classList.remove('playing');
            window.speechSynthesis.speak(utter);
        }
    };

    // Update toggle label
    const mk = $('mark-known');
    if (mk) { mk.textContent = (v.status === 'known') ? 'Chưa biết' : 'Đã biết'; }
    renderInlineAnalysis(v);
}

function nextCard() { if (filteredList.length) { currentIndex = (currentIndex + 1) % filteredList.length; renderFlashcard(); } }
function prevCard() { if (filteredList.length) { currentIndex = (currentIndex - 1 + filteredList.length) % filteredList.length; renderFlashcard(); } }
function flipCard() { isFlipped = !isFlipped; const c = $('flashcard'); c.classList.toggle('flipped', isFlipped); }
function shuffleCards() { filteredList.sort(() => Math.random() - .5); currentIndex = 0; renderFlashcard(); }
function markKnown() {
    if (!filteredList.length) return;
    const v = filteredList[currentIndex];
    const idx = vocabList.findIndex(x => x.id === v.id);
    if (idx >= 0) {
        const nextStatus = (vocabList[idx].status === 'known') ? 'learning' : 'known';
        vocabList[idx].status = nextStatus;
        saveStorage();
        // sync server
        if (hasAuthToken() && vocabList[idx]._id) { apiPatchWord(vocabList[idx]._id, { status: nextStatus }); }
        applyFilters();
    }
}

function deleteCurrentWord() {
    if (!filteredList.length) return;
    const v = filteredList[currentIndex];
    // remove from main list
    const idx = vocabList.findIndex(x => x.id === v.id);
    if (idx >= 0) {
        const removed = vocabList.splice(idx, 1)[0];
        saveStorage();
        // sync server
        if (hasAuthToken() && removed && removed._id) { apiDeleteWord(removed._id); }
        // update filtered and index
        applyFilters();
    }
}

// Add form
async function analyzeWord(word) {
    // Use Free Dictionary API
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Không tìm thấy từ hoặc lỗi mạng');
    const data = await res.json();
    // Parse minimal info
    const entry = data[0];
    const phonetics = (entry.phonetic || (entry.phonetics?.find(p => p.text)?.text) || '')
    const audio = (entry.phonetics?.find(p => p.audio)?.audio) || '';
    let pos = '';
    let definition = '';
    let example = '';
    if (entry.meanings && entry.meanings.length) {
        pos = entry.meanings[0].partOfSpeech || '';
        const defObj = entry.meanings[0].definitions?.[0];
        definition = defObj?.definition || '';
        example = defObj?.example || '';
    }
    return { phonetics, audio, pos, definition, example };
}

async function translateEnToVi(text) {
    try {
        const r = await fetch(`${API_BASE}/api/translate?q=${encodeURIComponent(text)}`);
        if (!r.ok) throw 0;
        const d = await r.json();
        return d.text || '';
    } catch { return ''; }
}
async function fetchExample(word) {
    try {
        const r = await fetch(`${API_BASE}/api/example?word=${encodeURIComponent(word)}`);
        if (!r.ok) throw 0;
        const d = await r.json();
        return d.example || '';
    } catch { return ''; }
}

function renderInlineAnalysis(v) {
    const box = $('inline-analysis');
    const buildText = (info) => `Từ: ${v.word}\nPhiên âm: ${info.phonetics || v.phonetics || ''}\nTừ loại: ${info.pos || v.pos || ''}\nNghĩa: ${v.meaning || info.definition || v.definition || ''}\nVí dụ: ${v.example || info.example || ''}`;

    if ((v.phonetics || v.definition || v.example)) {
        box.textContent = buildText({});
    } else {
        box.textContent = 'Đang phân tích...';
    }

    const key = v.word.toLowerCase();
    if (analysisCache[key]) {
        box.textContent = buildText(analysisCache[key]);
        return;
    }

    analyzeWord(v.word).then(info => {
        analysisCache[key] = info;
        const idx = vocabList.findIndex(x => x.id === v.id);
        if (idx >= 0) {
            const merged = {
                ...vocabList[idx],
                phonetics: vocabList[idx].phonetics || info.phonetics,
                audio: vocabList[idx].audio || info.audio,
                pos: vocabList[idx].pos || info.pos,
                definition: vocabList[idx].definition || info.definition,
                example: vocabList[idx].example || info.example
            };
            vocabList[idx] = merged;
            saveStorage();
            const current = filteredList[currentIndex];
            if (current && current.id === merged.id) {
                $('phonetics').textContent = merged.phonetics || '';
                $('pos').textContent = merged.pos || '';
                if (!$('definition').textContent || $('definition').textContent === '—') $('definition').textContent = merged.meaning || merged.definition || '—';
                if (!$('example').textContent || $('example').textContent === '—') $('example').textContent = merged.example || '—';
                box.textContent = buildText(info);
            }
        } else {
            box.textContent = buildText(info);
        }
    }).catch(() => {
        if (box.textContent === 'Đang phân tích...') box.textContent = 'Không thể phân tích từ này lúc này.';
    });
}

function renderPreview(v) {
    const cont = $('preview-content');
    cont.innerHTML = `<b>${v.word}</b> ${v.phonetics ? `<span style="color:#94a3b8">${v.phonetics}</span>` : ''}<br>
  <i>${v.pos || ''}</i><br>
  ${v.meaning || v.definition || ''}<br>
  <span style="color:#93c5fd">${v.example || ''}</span>`;
    $('preview-card').hidden = false;
}

function safeValue(id) { const el = /** @type {HTMLInputElement|HTMLTextAreaElement|null} */($(id)); return el && typeof el.value === 'string' ? el.value.trim() : ''; }
function safeChecked(id) { const el = /** @type {HTMLInputElement|null} */($(id)); return !!(el && el.checked); }
function getFormValues() {
    return {
        word: safeValue('add-word'),
        // 'add-meaning' may be absent in the DOM (optional field)
        meaning: safeValue('add-meaning'),
        example: safeValue('add-example'),
        autoAnalyze: safeChecked('auto-analyze')
    };
}

async function handleAnalyzeNow() {
    const { word } = getFormValues();
    const fb = $('add-feedback');
    if (!word) { fb.textContent = 'Vui lòng nhập từ.'; return; }
    fb.textContent = 'Đang phân tích...';
    try {
        const info = await analyzeWord(word);
        renderPreview({ word, ...info });
        fb.textContent = 'Phân tích xong.';
    } catch (e) { fb.textContent = 'Lỗi phân tích: ' + (e?.message || e); }
}

async function handleAddSubmit(ev) {
    ev.preventDefault();
    const form = getFormValues();
    const fb = $('add-feedback');
    if (!form.word) { fb.textContent = 'Vui lòng nhập từ.'; return; }
    let info = { phonetics: '', audio: '', pos: '', definition: '', example: '' };
    if (form.autoAnalyze) {
        fb.textContent = 'Đang phân tích...';
        try { info = await analyzeWord(form.word); } catch (e) { fb.textContent = 'Không phân tích được, vẫn lưu thủ công.'; }
    }
    // Tự dịch nghĩa sang tiếng Việt nếu trống
    if (!form.meaning) {
        const vi = await translateEnToVi(info.definition || form.word);
        if (vi) form.meaning = vi;
    }
    // Tự lấy ví dụ nếu trống
    if (!form.example) {
        const ex = info.example || await fetchExample(form.word);
        if (ex) form.example = ex;
    }
    const vocab = {
        id: uuid(),
        word: form.word,
        meaning: form.meaning || info.definition,
        example: form.example || info.example,
        phonetics: info.phonetics,
        pos: info.pos,
        definition: info.definition,
        audio: info.audio,
        status: 'new',
        createdAt: Date.now()
    };
    vocabList.unshift(vocab);
    saveStorage();
    // Đồng bộ lên server (không chặn UI)
    apiCreateWord(vocab).then(serverDoc => {
        if (serverDoc && serverDoc._id) {
            const idx = vocabList.findIndex(x => x.id === vocab.id);
            if (idx >= 0) { vocabList[idx]._id = serverDoc._id; saveStorage(); }
        }
    });
    applyFilters();
    ($('add-form')).reset();
    $('preview-card').hidden = true;
    fb.textContent = 'Đã lưu từ mới!';
}

// Analyze tab
async function handleAnalyzeTab() {
    const w = /** @type {HTMLInputElement} */($('analyze-word')).value.trim();
    const r = $('analyze-result');
    if (!w) { r.textContent = 'Nhập từ cần phân tích.'; return; }
    r.textContent = 'Đang phân tích...';
    try {
        const info = await analyzeWord(w);
        r.textContent = `Từ: ${w}\nPhiên âm: ${info.phonetics}\nTừ loại: ${info.pos}\nNghĩa: ${info.definition}\nVí dụ: ${info.example}`;
    } catch (e) { r.textContent = 'Lỗi: ' + (e?.message || e); }
}

// Telegram config and sender (client-side; may be blocked by CORS)
function loadTgCfg() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.tg) || '{}'); } catch { return {}; }
}
function saveTgCfg(cfg) { localStorage.setItem(STORAGE_KEYS.tg, JSON.stringify(cfg)); }

async function telegramSendMessage(token, chatId, text) {
    const res = await fetch(`${API_BASE}/api/telegram/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, chatId, text }) });
    if (!res.ok) { throw new Error('Gửi không thành công'); }
    return res.json();
}

function scheduleDailyReminder() {
    const cfg = loadTgCfg();
    if (!cfg.enabled || !cfg.token || !cfg.chatId) return;
    // Timer chạy trên tab đang mở: kiểm tra mỗi phút
    const check = async () => {
        const now = new Date();
        if (now.getHours() === Number(cfg.hour) && now.getMinutes() === Number(cfg.minute)) {
            const todayKey = `fv_reminded_${now.toDateString()}`;
            if (sessionStorage.getItem(todayKey)) return; // tránh gửi lặp trong cùng phiên
            const todayWord = vocabList[0]?.word || 'Học từ vựng nhé!';
            const msg = `Nhắc học từ vựng hôm nay: ${todayWord}`;
            try { await telegramSendMessage(cfg.token, cfg.chatId, msg); } catch (_) { /* ignore */ }
            sessionStorage.setItem(todayKey, '1');
        }
    };
    setInterval(check, 60 * 1000);
}

function initTelegramUI() {
    const cfg = loadTgCfg();
    $('tg-hour').value = cfg.hour ?? 8;
    $('tg-minute').value = cfg.minute ?? 0;
    $('tg-enabled').checked = !!cfg.enabled;
    const statusBadge = document.getElementById('tg-status-badge');
    const statusDesc = document.getElementById('tg-status-desc');
    const applyStatus = (connected, chatId) => {
        if (statusBadge) {
            statusBadge.classList.toggle('status-on', connected);
            statusBadge.classList.toggle('status-off', !connected);
            statusBadge.textContent = connected ? 'Đã kết nối' : 'Chưa kết nối';
        }
        if (statusDesc) {
            statusDesc.textContent = connected ? `Chat ID: ${chatId}` : 'Mở bot @tunz_vocab_bot, bấm Bắt đầu và nhập email để liên kết.';
        }
    };
    applyStatus(false, '');
    // nếu đã đăng nhập, tải cấu hình từ server và đồng bộ vào local
    (async () => {
        if (!hasAuthToken()) return;
        try {
            const res = await apiTgLoadConfig();
            const sc = res?.telegram || {};
            if (Object.keys(sc).length) {
                $('tg-hour').value = sc.hour ?? (cfg.hour ?? 8);
                $('tg-minute').value = sc.minute ?? (cfg.minute ?? 0);
                $('tg-enabled').checked = !!(sc.enabled ?? cfg.enabled);
                saveTgCfg({
                    chatId: String(sc.chatId || cfg.chatId || ''),
                    hour: Number($('tg-hour').value || 8),
                    minute: Number($('tg-minute').value || 0),
                    enabled: $('tg-enabled').checked
                });
            }
            const st = await apiTgStatus();
            applyStatus(!!st.connected, st.chatId || '');
        } catch { /* ignore */ }
    })();
}

// Events
function bindEvents() {
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', () => setActiveTab(btn.getAttribute('data-tab')));
    });
    $('next').onclick = nextCard;
    $('prev').onclick = prevCard;
    $('flip').onclick = flipCard;
    $('shuffle').onclick = shuffleCards;
    $('mark-known').onclick = markKnown;
    const delBtn = document.getElementById('delete-word');
    if (delBtn) { delBtn.addEventListener('click', deleteCurrentWord); }
    $('deck-filter').onchange = applyFilters;
    $('search').oninput = applyFilters;
    $('analyze-now').onclick = handleAnalyzeNow;
    $('add-form').addEventListener('submit', handleAddSubmit);
    $('btn-analyze').onclick = handleAnalyzeTab;
    $('tg-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const hourStr = $('tg-hour').value;
        const minuteStr = $('tg-minute').value;
        const cfg = {
            hour: hourStr === '' ? 8 : Number(hourStr),
            minute: minuteStr === '' ? 0 : Number(minuteStr),
            enabled: $('tg-enabled').checked
        };
        saveTgCfg(cfg);
        $('tg-feedback').textContent = 'Đã lưu cấu hình.';
        // đẩy lên server nếu đã đăng nhập
        (async () => {
            if (hasAuthToken()) {
                const lc = loadTgCfg();
                await apiTgSaveConfig({
                    hour: (lc.hour ?? 8),
                    minute: (lc.minute ?? 0),
                    enabled: lc.enabled
                });
            }
        })();
    });
    // Detect chat id automatically: fetch updates and store first chat
    const detectBtn = document.getElementById('tg-detect');
    if (detectBtn) {
        detectBtn.addEventListener('click', async () => {
            const token = $('tg-token').value.trim();
            if (!token) { $('tg-feedback').textContent = 'Nhập bot token trước.'; return; }
            $('tg-feedback').textContent = 'Đang phát hiện chat...';
            try {
                const r = await fetch(`${API_BASE}/api/telegram/detect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
                const d = await r.json();
                const chatId = d?.chatId;
                if (chatId) {
                    const cfg = loadTgCfg(); cfg.token = token; cfg.chatId = String(chatId); cfg.enabled = true; saveTgCfg(cfg);
                    $('tg-feedback').textContent = `Đã phát hiện chat: ${chatId}`;
                    // update status UI
                    const statusBadge = document.getElementById('tg-status-badge');
                    const statusDesc = document.getElementById('tg-status-desc');
                    if (statusBadge) { statusBadge.classList.remove('status-off'); statusBadge.classList.add('status-on'); statusBadge.textContent = 'Đã kết nối'; }
                    if (statusDesc) { statusDesc.textContent = `Chat ID: ${chatId}`; }
                    if (hasAuthToken()) { await apiTgSaveConfig({ token: cfg.token, chatId: cfg.chatId, hour: cfg.hour || 8, minute: cfg.minute || 0, enabled: cfg.enabled }); }
                } else {
                    $('tg-feedback').textContent = 'Chưa thấy chat. Hãy nhắn một tin cho bot rồi thử lại.';
                }
            } catch (e) { $('tg-feedback').textContent = 'Không thể phát hiện chat (server).'; }
        });
    }
    $('tg-test').onclick = async () => {
        if (!hasAuthToken()) { $('tg-feedback').textContent = 'Đăng nhập để gửi tin thử.'; return; }
        $('tg-feedback').textContent = 'Đang gửi...';
        try {
            const r = await apiTgTestSend('Chào mừng bạn đến với Flash Vocab');
            $('tg-feedback').textContent = r?.ok ? 'Đã gửi!' : 'Không gửi được (chưa liên kết?)';
        } catch (e) { $('tg-feedback').textContent = 'Lỗi gửi: ' + (e?.message || e); }
    };
    // TTS voice change
    const ttsSel = document.getElementById('tts-voice');
    if (ttsSel) {
        ttsSel.addEventListener('change', () => {
            const sel = /** @type {HTMLSelectElement} */(document.getElementById('tts-voice'));
            localStorage.setItem(TTS_KEY, sel.value);
        });
    }
    // Auth forms
    const regForm = document.getElementById('form-register');
    if (regForm) {
        regForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = /** @type {HTMLInputElement} */(document.getElementById('reg-email')).value.trim();
            const pass = /** @type {HTMLInputElement} */(document.getElementById('reg-pass')).value;
            const fb = document.getElementById('reg-feedback'); fb.classList.remove('error'); fb.textContent = 'Đang tạo...';
            const res = await apiRegister(email, pass);
            if (res?.token) { setCookie(AUTH_COOKIE, res.token, 30); localStorage.setItem(AUTH_EMAIL_KEY, email); document.getElementById('auth-status').textContent = `Đã đăng nhập: ${email}`; fb.textContent = 'Đăng ký thành công.'; refreshBanner(); refreshAuthUI(); await syncFromServer(); setActiveTab('flashcards'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
            else { fb.classList.add('error'); fb.textContent = res?.error || 'Lỗi đăng ký'; }
        });
    }
    const loginForm = document.getElementById('form-login');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = /** @type {HTMLInputElement} */(document.getElementById('login-email')).value.trim();
            const pass = /** @type {HTMLInputElement} */(document.getElementById('login-pass')).value;
            const fb = document.getElementById('login-feedback'); fb.classList.remove('error'); fb.textContent = 'Đang đăng nhập...';
            const res = await apiLogin(email, pass);
            if (res?.token) { setCookie(AUTH_COOKIE, res.token, 30); const em = res.user?.email || email; localStorage.setItem(AUTH_EMAIL_KEY, em); document.getElementById('auth-status').textContent = `Đã đăng nhập: ${em}`; fb.textContent = 'Đăng nhập thành công.'; refreshBanner(); refreshAuthUI(); await syncFromServer(); setActiveTab('flashcards'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
            else { fb.classList.add('error'); fb.textContent = res?.error || 'Sai tài khoản hoặc mật khẩu'; }
        });
    }
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) { logoutBtn.addEventListener('click', async () => { if (!hasAuthToken()) { setActiveTab('account'); window.scrollTo({ top: 0, behavior: 'smooth' }); return; } try { await apiLogout(); } catch { } deleteCookie(AUTH_COOKIE); localStorage.removeItem(AUTH_EMAIL_KEY); document.getElementById('auth-status').textContent = 'Chưa đăng nhập'; refreshBanner(); refreshAuthUI(); setActiveTab('flashcards'); window.scrollTo({ top: 0, behavior: 'smooth' }); }); }
}

function bootstrap() {
    loadStorage();
    updateFooterCount();
    bindEvents();
    initTelegramUI();
    refreshBanner();
    refreshAuthUI();
    // Populate TTS voice list
    const populateVoices = () => {
        const sel = /** @type {HTMLSelectElement} */(document.getElementById('tts-voice'));
        if (!sel) return;
        const current = localStorage.getItem(TTS_KEY);
        const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
        sel.innerHTML = '';
        voices
            .filter(v => /^en(-|_)/i.test(v.lang))
            .forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.voiceURI;
                opt.textContent = `${v.name} (${v.lang})`;
                sel.appendChild(opt);
            });
        if (current) { sel.value = current; }
    };
    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = populateVoices;
        populateVoices();
    }
    // Thử đồng bộ từ server nếu đã đăng nhập, nếu không dùng LocalStorage
    (async () => {
        if (hasAuthToken()) {
            const serverList = await apiFetchWords();
            if (Array.isArray(serverList)) {
                vocabList = serverList.map(doc => ({
                    id: doc.id || doc._id || (doc.word + "_" + doc.createdAt),
                    _id: doc._id,
                    word: doc.word,
                    meaning: doc.meaning,
                    example: doc.example,
                    phonetics: doc.phonetics,
                    pos: doc.pos,
                    definition: doc.definition,
                    audio: doc.audio,
                    status: doc.status || 'new',
                    createdAt: doc.createdAt || Date.now()
                }));
                saveStorage();
            }
        }
        filteredList = [...vocabList];
        applyFilters();
        renderFlashcard();
    })();
    scheduleDailyReminder();
}

function refreshBanner() {
    const bannerText = document.getElementById('banner-text');
    const hasToken = hasAuthToken();
    if (bannerText) {
        bannerText.textContent = hasToken
            ? 'Chào mừng bạn đến với Flash Vocab'
            : 'Đăng ký tài khoản ngay để lưu vốn từ mỗi ngày';
    }
}

async function syncFromServer() {
    const serverList = await apiFetchWords();
    if (Array.isArray(serverList)) {
        vocabList = serverList.map(doc => ({
            id: doc.id || doc._id || (doc.word + "_" + doc.createdAt),
            _id: doc._id,
            word: doc.word,
            meaning: doc.meaning,
            example: doc.example,
            phonetics: doc.phonetics,
            pos: doc.pos,
            definition: doc.definition,
            audio: doc.audio,
            status: doc.status || 'new',
            createdAt: doc.createdAt || Date.now()
        }));
        saveStorage();
        filteredList = [...vocabList];
        applyFilters();
        renderFlashcard();
    }
}

function refreshAuthUI() {
    const statusEl = document.getElementById('auth-status');
    const logoutBtn = document.getElementById('btn-logout');
    const hasToken = hasAuthToken();
    const email = localStorage.getItem(AUTH_EMAIL_KEY) || '';
    if (statusEl) { statusEl.textContent = hasToken ? `Đã đăng nhập: ${email || 'Tài khoản'}` : 'Chưa đăng nhập'; }
    if (logoutBtn) {
        logoutBtn.textContent = hasToken ? 'Đăng xuất' : 'Đăng nhập';
        logoutBtn.classList.toggle('danger', !!hasToken);
    }
}

document.addEventListener('DOMContentLoaded', bootstrap);


