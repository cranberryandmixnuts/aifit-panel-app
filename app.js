import { AppLink, DirectRelay, HttpRelay, MultiRelay, ScreenView, linkSettings, cleanSharedName, escapeHtml, formChanges, isAppPairing, isPairCode, isPanelLanguage, isSharedId, indicators, makeSharedId, mergeIndicators, mergeRegistry, normalizeCode, panelLanguage, publicRelay, randomId, registryForGame, removeFromRegistry, renderBlock, renderPage } from "./panel/index.js";
import { readPairQr } from "./panel/index.js";
import { readQr } from "./panel/qr-read.js";
import { adoptGameLanguage, appLocale, appText, languagePicker, startLanguage, translatePage } from "./text.js";

startLanguage();
translatePage();

const $ = (id) => document.getElementById(id);
const keys = { device: "aifit-panel-device", name: "aifit-panel-name", pairings: "aifit-panel-pairings", docs: "aifit-panel-docs", children: "aifit-panel-children", deleted: "aifit-panel-deleted", byes: "aifit-panel-byes" };

const read = (key, fallback) =>
{
    try
    {
        const value = localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
    }
    catch
    {
        return fallback;
    }
};

const write = (key, value) =>
{
    try
    {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    }
    catch
    {
        return false;
    }
};

const device = (() =>
{
    const stored = read(keys.device, null);
    if (typeof stored === "string" && stored.length >= 8) return stored;
    const made = randomId(12);
    write(keys.device, made);
    return made;
})();

const isChild = (value) => value !== null && typeof value === "object" && isSharedId(value.id) && cleanSharedName(value.name) === value.name && typeof value.createdAt === "string" && typeof value.updatedAt === "string"
    && value.games !== null && typeof value.games === "object" && Object.values(value.games).every((scope) => scope === null || typeof scope === "string")
    && (value.settings === undefined || (value.settings !== null && typeof value.settings === "object")) && (value.seen === undefined || (value.seen !== null && typeof value.seen === "object"))
    && (value.indicators === undefined || (value.indicators !== null && typeof value.indicators === "object"));

let pairings = (Array.isArray(read(keys.pairings, [])) ? read(keys.pairings, []) : []).filter(isAppPairing);
let children = (Array.isArray(read(keys.children, [])) ? read(keys.children, []) : []).filter(isChild);
let deleted = (Array.isArray(read(keys.deleted, [])) ? read(keys.deleted, []) : []).filter(isSharedId);
let byes = (Array.isArray(read(keys.byes, [])) ? read(keys.byes, []) : []).filter((item) => isAppPairing(item) && typeof item.byeAt === "string" && !Number.isNaN(Date.parse(item.byeAt)));
const docs = read(keys.docs, {});
const relay = publicRelay({ onStatus: (state) => relayStatus(state) });
const lanRelays = new Map();
const installed = location.hostname === "app.aifit.local";
const webPage = location.protocol === "https:" && !installed;
const tabs = new Map();
let busy = false;
let removeArmed = null;
let carried = null;

const savePairings = () =>
{
    write(keys.pairings, pairings);
    watchGames();
};
const saveChildren = () => write(keys.children, children) && write(keys.deleted, deleted);
const time = (iso) => new Date(iso).toLocaleString(appLocale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const cacheKey = (channel, scope) => `${channel}:${scope ?? ""}`;
const sameGame = (a, b) => a.id === b.id && (a.device !== undefined && b.device !== undefined ? a.device === b.device : a.name === b.name);
const tabletName = () => read(keys.name, appText("태블릿"));

const lanBase = (text) =>
{
    const trimmed = text.trim().replace(/\/+$/, "");
    if (trimmed === "") return null;
    const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
    try
    {
        const url = new URL(withScheme);
        return `http://${url.hostname}:${url.port === "" ? "47811" : url.port}`;
    }
    catch
    {
        return null;
    }
};

const lanBases = (pairing) => webPage || !pairing?.lan ? [] : [...new Set(pairing.lan.addresses.map((address) => `http://${address}:${pairing.lan.port}`))];

const lanRelay = (base) =>
{
    if (!lanRelays.has(base)) lanRelays.set(base, new HttpRelay(base, { onStatus: (now, before) => lanStatus(base, now, before) }));
    return lanRelays.get(base);
};

const directMs = { timeout: 2500, every: 10000 };
const direct = { found: new Map(), at: 0, run: 0 };

const directBase = (pairing) =>
{
    const base = direct.found.get(pairing.channel);
    return base !== undefined && lanRelays.get(base)?.status === "up" ? base : null;
};

const relayFor = (pairing, extra = null) =>
{
    const all = new MultiRelay([relay, ...[...new Set([...lanBases(pairing), ...webPage || extra === null ? [] : [extra]])].map(lanRelay)]);
    const base = pairing === null ? null : directBase(pairing);
    return base === null ? all : new DirectRelay(lanRelay(base), all, () => directLost(pairing));
};

const status = (text, tone = "plain") =>
{
    const line = $("status");
    line.hidden = text === "";
    line.textContent = text;
    line.dataset.tone = tone;
};

const show = (screen, title, subtitle = "") =>
{
    for (const id of ["home", "pair", "child", "game", "watch"]) $(id).hidden = id !== screen;
    document.body.classList.toggle("watching", screen === "watch");
    if (screen !== "pair") stopScan();
    $("title").textContent = title;
    $("subtitle").textContent = subtitle;
    $("subtitle").hidden = subtitle === "";
    $("back").hidden = screen === "home";
    $("refresh").hidden = screen === "pair";
};

const route = () =>
{
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] === "pair") return { screen: "pair" };
    if (parts[0] === "child" && parts[1] !== undefined) return { screen: "child", id: parts[1] };
    if (parts[0] === "game" && parts[1] !== undefined) return { screen: "game", channel: parts[1], scope: parts[2] ?? null };
    if (parts[0] === "watch" && parts[1] !== undefined) return { screen: "watch", channel: parts[1] };
    return { screen: "home" };
};

const go = (hash) =>
{
    if (location.hash === hash) render();
    else location.hash = hash;
};

const gameHash = (channel, scope = null) => `#/game/${encodeURIComponent(channel)}${scope === null ? "" : `/${encodeURIComponent(scope)}`}`;
const childHash = (id) => `#/child/${encodeURIComponent(id)}`;
const homeDoc = (channel) => docs[cacheKey(channel, null)]?.doc ?? null;
const openPages = (doc) => doc.pages.filter((page) => page.scope === undefined);
const childOf = (id) => children.find((item) => item.id === id);
const gamesOf = (child) => pairings.filter((pairing) => typeof child.games[pairing.channel] === "string").length;

const element = (tag, className = "", text = "") =>
{
    const node = document.createElement(tag);
    if (className !== "") node.className = className;
    if (text !== "") node.textContent = text;
    return node;
};

const playingFreshMs = 60000;

const playingNow = () => pairings.flatMap((pairing) =>
{
    const cached = docs[cacheKey(pairing.channel, null)];
    if (cached === undefined || live.gone.has(pairing.channel) || Date.now() - Date.parse(cached.at) > playingFreshMs) return [];
    const block = openPages(cached.doc)[0]?.blocks.find((item) => item.type === "actions" && item.items.length > 0);
    return block === undefined ? [] : [{ pairing, block }];
});

const playingKey = (now) => JSON.stringify(now.map(({ pairing, block }) => [pairing.channel, block]));
let playingShown = "";

const drawPlaying = () =>
{
    const now = playingNow();
    playingShown = playingKey(now);
    $("playing").hidden = now.length === 0;
    $("playing-list").replaceChildren(...now.map(({ pairing, block }) =>
    {
        const card = element("li", "playing-card");
        const { title: _title, ...plain } = block;
        card.innerHTML = `<strong>${escapeHtml(pairing.game.name)}</strong><div class="pv-page">${renderBlock(plain)}</div>`;
        for (const button of card.querySelectorAll("button.pv-action")) button.disabled = busy;
        wireActions(pairing, null, card);
        if (pairing.screen === true)
        {
            const can = directBase(pairing) !== null;
            const row = element("div", "watch-row");
            const watch = element("button", "tool watch-card", appText("화면 보기"));
            watch.disabled = !can;
            watch.addEventListener("click", () => openWatch(pairing));
            row.append(watch);
            if (!can) row.append(element("small", "watch-why", watchWhy()));
            card.append(row);
        }
        return card;
    }));
};

const gameState = (pairing) => live.gone.has(pairing.channel) ? "off" : live.seen.has(pairing.channel) ? "on" : "checking";
const gameStateText = (state) => appText(state === "on" ? "켜져 있어요" : state === "off" ? "꺼져 있어요" : "켜져 있는지 확인 중이에요");
const gamePath = (pairing) => gameState(pairing) !== "on" ? "" : appText(directBase(pairing) !== null ? "같은 공유기로 직접 연결돼 있어요" : "인터넷 중계로 연결돼 있어요");
const watchWhy = () => appText(webPage ? "웹 주소에서는 게임 화면을 볼 수 없어요. 같은 공유기에서 설치형 앱으로 열면 볼 수 있어요." : "게임 화면은 태블릿과 게임 PC가 같은 공유기(와이파이)에 있을 때만 볼 수 있어요.");

const drawGameStates = () =>
{
    for (const mark of document.querySelectorAll("#games .game-state"))
    {
        const pairing = pairings.find((item) => item.channel === mark.dataset.channel);
        if (pairing === undefined) continue;
        const state = gameState(pairing);
        if (mark.dataset.state === state) continue;
        mark.dataset.state = state;
        mark.textContent = gameStateText(state);
    }
    for (const mark of document.querySelectorAll("#games .game-path"))
    {
        const pairing = pairings.find((item) => item.channel === mark.dataset.channel);
        if (pairing !== undefined && mark.textContent !== gamePath(pairing)) mark.textContent = gamePath(pairing);
    }
};

const syncPlaying = () =>
{
    if (route().screen !== "home") return;
    if (playingKey(playingNow()) !== playingShown) drawPlaying();
    drawGameStates();
};

const renderHome = () =>
{
    show("home", appText("AI FIT 연동"));
    drawPlaying();
    const list = $("children");
    const sorted = [...children].sort((a, b) => a.name.localeCompare(b.name, appLocale()));
    list.replaceChildren(...sorted.map((child) =>
    {
        const item = element("li");
        const button = element("button", "child-card");
        const linked = gamesOf(child);
        button.append(element("strong", "", child.name), element("small", "", linked === 0 ? appText("아직 게임에 없어요") : appText("게임 {count}개에 있어요", { count: linked })));
        button.addEventListener("click", () => go(childHash(child.id)));
        item.append(button);
        return item;
    }));
    if (children.length === 0) list.append(element("li", "empty", appText("아직 프로필이 없어요. '프로필 만들기'로 만들면 연동한 게임마다 같은 프로필이 생겨요.")));
    const games = $("games");
    games.replaceChildren(...pairings.map((pairing) =>
    {
        const item = element("li");
        const button = element("button", "game-card");
        const seen = docs[cacheKey(pairing.channel, null)]?.at;
        const state = gameState(pairing);
        button.innerHTML = `<strong>${escapeHtml(pairing.game.name)}</strong><em class="game-state" data-channel="${escapeHtml(pairing.channel)}" data-state="${state}">${escapeHtml(gameStateText(state))}</em><small class="game-path" data-channel="${escapeHtml(pairing.channel)}">${escapeHtml(gamePath(pairing))}</small>${pairing.game.device === undefined ? "" : `<span>${escapeHtml(pairing.game.device)}</span>`}`
            + `<small>${escapeHtml(appText("연동 {time}", { time: time(pairing.pairedAt) }))}</small>${seen === undefined ? "" : `<small>${escapeHtml(appText("마지막으로 받음 {time}", { time: time(seen) }))}</small>`}`;
        button.addEventListener("click", () => go(gameHash(pairing.channel)));
        item.append(button);
        return item;
    }));
    if (pairings.length === 0) games.append(element("li", "empty", appText("아직 연동한 게임이 없어요. '게임 연동하기'로 시작해요.")));
};

const renderPair = () =>
{
    show("pair", appText("게임 연동"));
    $("name").value = read(keys.name, "");
    $("confirm").hidden = true;
    $("scan-go").hidden = !canScan();
    $("scan-note").hidden = canScan();
    $("lan-more").hidden = webPage;
    $("web-note").hidden = !webPage;
};

const drawSide = (pairing, scope) =>
{
    const home = homeDoc(pairing.channel);
    const entries = home === null ? [] : home.pages.filter((page) => page.scope !== undefined);
    const filter = $("find").value.trim();
    $("side-title").textContent = home === null ? appText("목록") : openPages(home)[0]?.title ?? appText("목록");
    $("find").hidden = entries.length <= 8;
    const items = [{ label: appText("전체"), scope: null }, ...entries.filter((page) => filter === "" || page.title.includes(filter)).map((page) => ({ label: page.title, scope: page.scope }))];
    $("scopes").replaceChildren(...items.map((item) =>
    {
        const button = element("button", "scope", item.label);
        button.setAttribute("aria-current", String(item.scope === scope));
        button.addEventListener("click", () => go(gameHash(pairing.channel, item.scope)));
        return button;
    }));
};

const tabBar = (nav, pages, key, onPick) =>
{
    const tab = Math.min(tabs.get(key) ?? 0, Math.max(0, pages.length - 1));
    nav.hidden = pages.length <= 1;
    nav.replaceChildren(...pages.map((item, index) =>
    {
        const button = element("button", "", item.title);
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(index === tab));
        button.addEventListener("click", () =>
        {
            tabs.set(key, index);
            onPick();
        });
        return button;
    }));
    return tab;
};

const drawContent = (pairing, scope) =>
{
    const cached = docs[cacheKey(pairing.channel, scope)];
    const head = $("content-head");
    const page = $("page");
    if (cached === undefined)
    {
        head.hidden = true;
        page.innerHTML = "";
        return;
    }
    const pages = openPages(cached.doc);
    const name = scope === null ? appText("전체") : homeDoc(pairing.channel)?.pages.find((item) => item.scope === scope)?.title ?? pages[0]?.group ?? "";
    const key = cacheKey(pairing.channel, scope);
    head.hidden = false;
    $("content-title").textContent = name;
    const tab = tabBar($("tabs"), pages, key, () => drawContent(pairing, scope));
    page.innerHTML = pages.length === 0 ? `<p class="pv-empty">${escapeHtml(appText("보여 줄 내용이 없어요."))}</p>` : renderPage(pages[tab], { edit: true });
    for (const form of page.querySelectorAll("form.pv-edit")) wireForm(pairing, scope, form);
    wireActions(pairing, scope, page);
};

const formState = (form) =>
{
    let count = 0;
    for (const select of form.querySelectorAll("select.pv-input"))
    {
        const changed = select.selectedIndex !== Number(select.dataset.start);
        select.closest(".pv-field").dataset.changed = String(changed);
        if (changed) count += 1;
    }
    form.querySelector(".pv-changed").textContent = count === 0 ? "" : appText("바뀐 값 {count}개", { count });
    form.querySelector(".pv-apply").disabled = count === 0 || busy;
    form.querySelector(".pv-reset").disabled = count === 0 || busy;
};

const wireForm = (pairing, scope, form) =>
{
    form.addEventListener("change", () => formState(form));
    form.querySelector(".pv-reset").addEventListener("click", () =>
    {
        for (const select of form.querySelectorAll("select.pv-input")) select.selectedIndex = Number(select.dataset.start);
        formState(form);
        liveResume();
    });
    form.addEventListener("submit", (event) =>
    {
        event.preventDefault();
        void applyForm(pairing, scope, form);
    });
    formState(form);
};

const keep = (pairing, scope, doc, lan, boot = null, shows = null) =>
{
    if (!pairings.includes(pairing)) return;
    if (lan !== null && JSON.stringify(lan) !== JSON.stringify(pairing.lan)) pairing.lan = lan;
    if (boot !== null) pairing.live = boot;
    if (shows !== null) pairing.screen = shows;
    pairing.game = { id: pairing.game.id, name: doc.game.name, ...doc.game.device === undefined ? {} : { device: doc.game.device } };
    savePairings();
    docs[cacheKey(pairing.channel, scope)] = { doc, at: new Date().toISOString() };
    write(keys.docs, docs);
    live.gone.delete(pairing.channel);
    live.seen.add(pairing.channel);
    if (scope === null && Array.isArray(doc.profiles))
    {
        children = mergeRegistry(children, pairing.channel, doc.profiles, { deleted, game: pairing.game.id });
        saveChildren();
    }
    if (doc.language !== undefined) adoptGameLanguage(doc.language);
};

const refreshView = () =>
{
    const where = route();
    if (where.screen === "game")
    {
        const pairing = pairings.find((item) => item.channel === where.channel);
        if (pairing !== undefined) drawGame(pairing, where.scope);
    }
    else if (where.screen === "child") drawChild(where.id);
    else if (where.screen === "home") renderHome();
};

const link = () => new AppLink({ device, name: tabletName() });

const wireActions = (pairing, scope, root) =>
{
    for (const button of root.querySelectorAll("button.pv-action")) button.addEventListener("click", () => void applyAction(pairing, scope, button.dataset.action));
};

const applyAction = async (pairing, scope, action) =>
{
    if (busy) return;
    busy = true;
    $("refresh").disabled = true;
    status(appText("게임에 보내는 중이에요…"));
    try
    {
        const { doc, lan, live: boot, screen: shows, notice } = await link().change(relayFor(pairing), pairing, { scope, action });
        keep(pairing, scope, doc, lan, boot, shows);
        busy = false;
        refreshView();
        status(notice ?? appText("보냈어요."));
    }
    catch (error)
    {
        busy = false;
        if (unlinked(pairing, error)) return;
        if (error.doc !== undefined)
        {
            keep(pairing, scope, error.doc, error.lan ?? null, error.live ?? null, error.screen ?? null);
            refreshView();
        }
        status(error.message, "error");
    }
    finally
    {
        busy = false;
        $("refresh").disabled = false;
        liveResume();
    }
};

const applyForm = async (pairing, scope, form) =>
{
    const change = formChanges(form);
    if (busy || Object.keys(change.values).length === 0) return;
    busy = true;
    $("refresh").disabled = true;
    formState(form);
    status(appText("게임에 보내는 중이에요…"));
    try
    {
        const { doc, lan, live: boot, screen: shows, notice } = await link().change(relayFor(pairing), pairing, { scope, ...change });
        keep(pairing, scope, doc, lan, boot, shows);
        busy = false;
        refreshView();
        status(notice ?? appText("적용했어요."));
    }
    catch (error)
    {
        busy = false;
        if (unlinked(pairing, error)) return;
        if (error.doc !== undefined)
        {
            keep(pairing, scope, error.doc, error.lan ?? null, error.live ?? null, error.screen ?? null);
            refreshView();
        }
        else formState(form);
        status(error.doc === undefined ? appText("{message} 바꾼 값은 아직 이 화면에만 있어요.", { message: error.message }) : appText("{message} 아래는 방금 새로 받은 값이에요.", { message: error.message }), "error");
    }
    finally
    {
        busy = false;
        $("refresh").disabled = false;
        liveResume();
    }
};

const subtitleOf = (pairing, scope) =>
{
    const at = docs[cacheKey(pairing.channel, scope)]?.at;
    return [pairing.game.device, gameStateText(gameState(pairing)), gamePath(pairing), at === undefined ? null : appText("{time}에 받음", { time: time(at) })].filter((item) => item !== undefined && item !== null && item !== "").join(" · ");
};

const drawWatchOpen = (pairing) =>
{
    const can = directBase(pairing) !== null;
    $("watch-box").hidden = pairing.screen !== true || live.gone.has(pairing.channel);
    $("watch-open").disabled = !can;
    $("watch-why").hidden = can;
    $("watch-why").textContent = can ? "" : watchWhy();
};

const drawGame = (pairing, scope) =>
{
    show("game", pairing.game.name, subtitleOf(pairing, scope));
    drawWatchOpen(pairing);
    $("forget-narrow").hidden = scope !== null;
    drawSide(pairing, scope);
    drawContent(pairing, scope);
};

const fetchDoc = async (pairing, scope, redraw = null) =>
{
    const { doc, lan, live: boot, screen: shows } = await link().fetchDoc(relayFor(pairing), pairing, scope, { ...scope === null ? { profiles: registryForGame(children, pairing.channel, pairing.game.id), deleted } : {}, ...redraw === null ? {} : { redraw } });
    keep(pairing, scope, doc, lan, boot, shows);
    refreshView();
};

const load = async (pairing, scope, withHome) =>
{
    if (busy) return;
    busy = true;
    $("refresh").disabled = true;
    status(appText("게임에서 받는 중이에요…"));
    try
    {
        await fetchDoc(pairing, scope);
        if (scope !== null && (withHome || homeDoc(pairing.channel) === null)) await fetchDoc(pairing, null).catch(() => undefined);
        status("");
    }
    catch (error)
    {
        busy = false;
        if (unlinked(pairing, error)) return;
        live.gone.add(pairing.channel);
        const cached = docs[cacheKey(pairing.channel, scope)];
        status(cached === undefined ? error.message : appText("{message} 아래는 {time}에 받은 기록이에요.", { message: error.message, time: time(cached.at) }), "error");
    }
    finally
    {
        busy = false;
        $("refresh").disabled = false;
    }
};

const syncAll = async (working, redraw = null) =>
{
    if (busy) return;
    busy = true;
    $("refresh").disabled = true;
    status(working);
    const failed = [];
    const lost = [];
    for (const pairing of pairings)
    {
        try
        {
            await fetchDoc(pairing, null, redraw);
        }
        catch (error)
        {
            if (error?.unpaired === true) lost.push(pairing);
            else
            {
                live.gone.add(pairing.channel);
                failed.push(`${pairing.game.name}: ${error.message}`);
            }
        }
    }
    busy = false;
    $("refresh").disabled = false;
    refreshView();
    status(failed.length === 0 ? "" : appText("답하지 않은 게임이 있어요 — {list}", { list: failed.join(" / ") }), failed.length === 0 ? "plain" : "error");
    for (const pairing of lost) unlinked(pairing, { unpaired: true });
};

const renderGame = (channel, scope) =>
{
    const pairing = pairings.find((item) => item.channel === channel);
    if (pairing === undefined)
    {
        go("#/");
        return;
    }
    drawGame(pairing, scope);
    void load(pairing, scope, false);
};

const childGameSection = (child, pairing) =>
{
    const section = element("section", "child-game");
    const head = element("header", "child-game-head");
    head.append(element("h3", "", pairing.game.name));
    const scope = child.games[pairing.channel];
    if (typeof scope !== "string")
    {
        const note = element("p", "child-note", appText("이 게임에는 아직 없어요. 게임이 켜져 있을 때 새로 받으면 이 프로필이 만들어져요."));
        const make = element("button", "primary", appText("이 게임에 만들기"));
        make.disabled = busy;
        make.addEventListener("click", () => void makeInGame(child.id, pairing));
        section.append(head, note, make);
        return section;
    }
    const cached = docs[cacheKey(pairing.channel, scope)];
    const info = element("small", "", cached === undefined ? appText("아직 받지 않았어요") : appText("{time}에 받음", { time: time(cached.at) }));
    const refresh = element("button", "tool", appText("새로 받기"));
    refresh.disabled = busy;
    refresh.addEventListener("click", () => void load(pairing, scope, false));
    head.append(info, refresh);
    section.append(head);
    if (cached === undefined)
    {
        section.append(element("p", "pv-empty", appText("받는 중이에요…")));
        return section;
    }
    const pages = openPages(cached.doc);
    const key = cacheKey(pairing.channel, scope);
    const nav = element("nav", "tabs");
    nav.setAttribute("role", "tablist");
    const body = element("div", "pv-page");
    const tab = tabBar(nav, pages, key, () => drawChild(child.id));
    body.innerHTML = pages.length === 0 ? `<p class="pv-empty">${escapeHtml(appText("보여 줄 내용이 없어요."))}</p>` : renderPage(pages[tab], { edit: true });
    for (const form of body.querySelectorAll("form.pv-edit")) wireForm(pairing, scope, form);
    wireActions(pairing, scope, body);
    section.append(nav, body);
    return section;
};

const missingIn = (id) => pairings.filter((pairing) => !live.gone.has(pairing.channel) && typeof childOf(id)?.games[pairing.channel] !== "string");

const makeInGame = async (id, pairing) =>
{
    const child = childOf(id);
    if (busy || child === undefined) return;
    busy = true;
    $("refresh").disabled = true;
    status(appText("'{name}'을(를) '{game}'에 만드는 중이에요…", { name: child.name, game: pairing.game.name }));
    try
    {
        await fetchDoc(pairing, null, ["profiles"]);
        const scope = childOf(id)?.games[pairing.channel];
        if (typeof scope === "string") await fetchDoc(pairing, scope).catch(() => undefined);
        busy = false;
        status(typeof scope === "string" ? appText("'{name}'을(를) '{game}'에 만들었어요.", { name: child.name, game: pairing.game.name })
            : appText("'{game}'이(가) '{name}'을(를) 만들지 않았어요. 게임의 프로필이 가득 찼거나 게임이 옛 연동 모듈일 수 있어요.", { name: child.name, game: pairing.game.name }), typeof scope === "string" ? "plain" : "error");
    }
    catch (error)
    {
        busy = false;
        if (unlinked(pairing, error)) return;
        live.gone.add(pairing.channel);
        status(error.message, "error");
    }
    finally
    {
        busy = false;
        $("refresh").disabled = false;
        refreshView();
    }
};

const drawIndicators = (child) =>
{
    const host = $("child-indicators");
    const language = panelLanguage() === "en" ? "en" : "ko";
    const merged = mergeIndicators(child.indicators ?? {});
    const gameName = (id) => pairings.find((pairing) => pairing.game.id === id)?.game.name ?? id;
    const rows = indicators.map((definition) =>
    {
        const result = merged.find((item) => item.id === definition.id);
        const row = element("details", "indicator");
        row.dataset.indicator = definition.id;
        row.dataset.state = result.value === null ? "none" : result.enough ? "enough" : "few";
        const summary = element("summary");
        const name = element("span", "indicator-name", definition.name[language]);
        name.append(element("small", "", `ICF ${definition.code}`));
        const bar = element("span", "indicator-bar");
        const fill = element("i");
        fill.style.width = `${result.value ?? 0}%`;
        bar.append(fill);
        summary.append(name, bar, element("b", "", result.value === null ? appText("자료 없음") : String(result.value)),
            ...result.value !== null && !result.enough ? [element("em", "", appText("자료 부족"))] : []);
        const games = element("ul", "indicator-games");
        games.append(...result.games.map((item) => element("li", "", appText("{game} · {value} · 관찰 {samples}회 · {time}", { game: gameName(item.game), value: item.value, samples: item.samples, time: time(item.at) }))));
        row.append(summary, element("p", "", definition.about[language]),
            element("p", "", appText("높을 때: {text}", { text: definition.high[language] })), element("p", "", appText("낮을 때: {text}", { text: definition.low[language] })),
            ...result.games.length === 0 ? [element("p", "child-note", appText("이 지표를 보낸 게임이 아직 없어요."))] : [games]);
        return row;
    });
    const head = element("div", "indicator-head");
    const info = element("button", "info-button", "i");
    info.type = "button";
    info.setAttribute("aria-label", appText("기능 지표는 어디서 왔나요"));
    info.addEventListener("click", openIndicatorInfo);
    head.append(element("h3", "", appText("기능 지표")), info);
    host.replaceChildren(head, ...rows);
    host.hidden = false;
};

const closeIndicatorInfo = () => document.getElementById("indicator-info")?.remove();

function openIndicatorInfo()
{
    closeIndicatorInfo();
    const language = panelLanguage() === "en" ? "en" : "ko";
    const overlay = element("div", "info-overlay");
    overlay.id = "indicator-info";
    const panel = element("div", "info-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "indicator-info-title");
    const title = element("h2", "", appText("기능 지표는 어디서 왔나요"));
    title.id = "indicator-info-title";
    const part = (heading, lines) => [element("h3", "", appText(heading)), ...lines.map((line) => element("p", "", appText(line)))];
    const table = element("table", "info-table");
    table.innerHTML = `<thead><tr><th>${escapeHtml(appText("이 앱의 이름"))}</th><th>${escapeHtml(appText("ICF 코드"))}</th><th>${escapeHtml(appText("ICF 항목 이름"))}</th></tr></thead>`
        + `<tbody>${indicators.map((item) => `<tr><td>${escapeHtml(item.name[language])}</td><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.title)}</td></tr>`).join("")}</tbody>`;
    const close = element("button", "primary", appText("닫기"));
    close.type = "button";
    close.id = "indicator-info-close";
    close.addEventListener("click", closeIndicatorInfo);
    const body = element("div", "info-body");
    const foot = element("div", "info-foot");
    foot.append(close);
    body.append(
        ...part("출처", ["여섯 지표는 세계보건기구(WHO)의 국제기능장애건강분류(ICF)에 있는 항목이에요.",
            "ICF는 2001년 5월 22일 제54차 세계보건총회에서 국제 표준으로 승인됐어요(결의 WHA54.21).",
            "우리나라는 통계청이 ICF를 바탕으로 한국표준건강분류(KCF)를 고시해 2018년부터 쓰고 있어요."]),
        ...part("ICF에 원래 있는 것", ["ICF는 사람의 기능을 신체 기능(b), 신체 구조(s), 활동과 참여(d), 환경 요인(e)으로 나눠 이름과 뜻을 정해 둔 분류예요.",
            "그중 신체 기능은 정신 기능, 감각 기능과 통증, 음성과 말하기 기능, 심혈관·호흡 등의 기능, 소화·대사·내분비 기능, 비뇨생식 기능, 신경근골격과 운동 관련 기능, 피부 기능의 여덟 장으로 되어 있어요."]),
        ...part("그중에서 고른 여섯 항목", ["움직임 놀이에서 아이의 수행으로 관찰할 수 있는 항목을 골랐어요. 정신 기능 장(b1)에서 다섯, 신경근골격과 운동 관련 기능 장(b7)에서 하나예요."]),
        table,
        element("p", "", appText("감각, 말하기, 심폐 기능처럼 이 게임들이 관찰할 수 없는 항목은 넣지 않았어요.")),
        ...part("값이 나오는 방법", ["ICF는 기능의 이름과 뜻을 정한 분류예요. 0~100 값은 그 뜻에 맞춰 게임들이 놀이 중 수행을 관찰해 계산해요.",
            "게임은 그 기능이 필요한 순간마다 해낸 정도와 그때의 어려운 정도를 함께 봐요. 가장 쉬운 조건에서 다 해내면 40, 가장 어려운 조건에서 다 해내면 100이에요.",
            "여러 게임의 값은 관찰이 많고 최근인 게임에 더 무게를 두어 합쳐요. 지표 줄을 누르면 게임별 값과 관찰 횟수가 보여요."]),
        element("p", "info-source", appText("자료: WHO, International Classification of Functioning, Disability and Health (2001) · 통계청, 한국표준건강분류(KCF)")));
    panel.append(title, body, foot);
    overlay.append(panel);
    overlay.addEventListener("click", (event) =>
    {
        if (event.target === overlay) closeIndicatorInfo();
    });
    document.body.append(overlay);
    close.focus({ preventScroll: true });
    body.scrollTop = 0;
}

window.addEventListener("keydown", (event) =>
{
    if (event.key === "Escape") closeIndicatorInfo();
});
window.addEventListener("hashchange", closeIndicatorInfo);

const drawChild = (id) =>
{
    const child = childOf(id);
    if (child === undefined)
    {
        go("#/");
        return;
    }
    const linked = gamesOf(child);
    show("child", child.name, linked === 0 ? appText("아직 게임에 없어요") : appText("게임 {count}개에 있어요", { count: linked }));
    $("child-remove").textContent = removeArmed === id ? appText("한 번 더 누르면 지워요") : appText("프로필 지우기");
    const opened = new Set([...document.querySelectorAll("#child-indicators details[open]")].map((row) => row.dataset.indicator));
    drawIndicators(child);
    for (const row of document.querySelectorAll("#child-indicators details")) row.open = opened.has(row.dataset.indicator);
    $("child-games").replaceChildren(...pairings.map((pairing) => childGameSection(child, pairing)));
    $("child-none").hidden = pairings.length !== 0;
};

const renderChild = (id) =>
{
    const child = childOf(id);
    if (child === undefined)
    {
        go("#/");
        return;
    }
    $("rename-form").hidden = true;
    drawChild(id);
    const missing = pairings.filter((pairing) => typeof child.games[pairing.channel] === "string" && docs[cacheKey(pairing.channel, child.games[pairing.channel])] === undefined);
    if (missing.length > 0) void loadChild(child);
};

const loadChild = async (child) =>
{
    if (busy) return;
    busy = true;
    $("refresh").disabled = true;
    status(appText("게임에서 받는 중이에요…"));
    const failed = [];
    const lost = [];
    for (const pairing of pairings)
    {
        const scope = child.games[pairing.channel];
        if (typeof scope !== "string") continue;
        try
        {
            await fetchDoc(pairing, scope);
        }
        catch (error)
        {
            if (error?.unpaired === true) lost.push(pairing);
            else
            {
                live.gone.add(pairing.channel);
                failed.push(`${pairing.game.name}: ${error.message}`);
            }
        }
    }
    busy = false;
    $("refresh").disabled = false;
    refreshView();
    status(failed.length === 0 ? "" : appText("답하지 않은 게임이 있어요 — {list}", { list: failed.join(" / ") }), failed.length === 0 ? "plain" : "error");
    for (const pairing of lost) unlinked(pairing, { unpaired: true });
};

const render = () =>
{
    status(carried?.text ?? "", carried?.tone ?? "plain");
    carried = null;
    removeArmed = null;
    const where = route();
    if (where.screen !== "watch") stopWatch();
    if (where.screen === "watch") renderWatch(where.channel);
    else if (where.screen === "pair") renderPair();
    else if (where.screen === "game") renderGame(where.channel, where.scope);
    else if (where.screen === "child") renderChild(where.id);
    else
    {
        $("child-form").hidden = true;
        renderHome();
        liveCheck();
    }
    window.scrollTo(0, 0);
};

const createChild = async () =>
{
    const name = cleanSharedName($("child-name").value);
    if (name === null)
    {
        status(appText("프로필 이름을 1~20자로 적어 주세요."), "error");
        return;
    }
    if (children.some((child) => child.name === name))
    {
        status(appText("같은 이름의 프로필이 이미 있어요."), "error");
        return;
    }
    const now = new Date().toISOString();
    const child = { id: makeSharedId(), name, createdAt: now, updatedAt: now, games: {}, settings: {}, seen: {} };
    children = [...children, child];
    saveChildren();
    $("child-name").value = "";
    go(childHash(child.id));
    if (pairings.length === 0) return;
    await syncAll(appText("'{name}'을(를) 게임에 만드는 중이에요…", { name }), ["profiles"]);
    const missing = missingIn(child.id);
    if (missing.length > 0) status(appText("'{name}'을(를) 만들지 못한 게임이 있어요 — {list}. 게임 칸의 '이 게임에 만들기'로 다시 해 보세요.", { name, list: missing.map((pairing) => pairing.game.name).join(", ") }), "error");
};

const renameChild = async () =>
{
    const where = route();
    const child = where.screen === "child" ? childOf(where.id) : undefined;
    const name = cleanSharedName($("rename-name").value);
    if (child === undefined) return;
    if (name === null)
    {
        status(appText("프로필 이름을 1~20자로 적어 주세요."), "error");
        return;
    }
    if (children.some((item) => item.id !== child.id && item.name === name))
    {
        status(appText("같은 이름의 프로필이 이미 있어요."), "error");
        return;
    }
    child.name = name;
    child.updatedAt = new Date().toISOString();
    saveChildren();
    $("rename-form").hidden = true;
    drawChild(child.id);
    if (pairings.length > 0) await syncAll(appText("바뀐 이름을 게임에 전하는 중이에요…"), ["profiles"]);
};

const removeChild = async () =>
{
    const where = route();
    const child = where.screen === "child" ? childOf(where.id) : undefined;
    if (child === undefined) return;
    if (removeArmed !== child.id)
    {
        removeArmed = child.id;
        drawChild(child.id);
        status(appText("연동한 모든 게임에서 이 프로필과 그 기록이 지워져요. 지우려면 한 번 더 눌러요."));
        setTimeout(() =>
        {
            if (removeArmed !== child.id) return;
            removeArmed = null;
            if (route().screen === "child") drawChild(child.id);
        }, 4000);
        return;
    }
    ({ registry: children, deleted } = removeFromRegistry(children, deleted, child.id));
    saveChildren();
    removeArmed = null;
    go("#/");
    if (pairings.length > 0) await syncAll(appText("'{name}'을(를) 게임에서 지우는 중이에요…", { name: child.name }), ["profiles"]);
};

let scanning = null;
const canScan = () => typeof navigator.mediaDevices?.getUserMedia === "function";

const stopScan = () =>
{
    if (scanning === null) return;
    clearTimeout(scanning.timer);
    for (const track of scanning.stream.getTracks()) track.stop();
    scanning = null;
    $("scan-video").srcObject = null;
    $("scan").hidden = true;
    $("scan-go").hidden = !canScan();
};

const startScan = async () =>
{
    if (scanning !== null || !canScan()) return;
    status("");
    $("scan-go").disabled = true;
    let stream;
    try
    {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    }
    catch
    {
        status(appText("카메라를 켜지 못했어요. 카메라 사용을 허락하거나 아래에 번호를 넣어 주세요."), "error");
        return;
    }
    finally
    {
        $("scan-go").disabled = false;
    }
    const video = $("scan-video");
    const state = { stream, timer: 0 };
    scanning = state;
    video.srcObject = stream;
    $("scan").hidden = false;
    $("scan-go").hidden = true;
    await video.play().catch(() => undefined);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let detector = null;
    try
    {
        detector = typeof globalThis.BarcodeDetector === "function" ? new globalThis.BarcodeDetector({ formats: ["qr_code"] }) : null;
    }
    catch
    {
        detector = null;
    }
    const look = async () =>
    {
        if (scanning !== state) return;
        let text = null;
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0)
        {
            const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            if (detector !== null) text = (await detector.detect(canvas).catch(() => []))[0]?.rawValue ?? null;
            if (text === null) text = readQr(context.getImageData(0, 0, canvas.width, canvas.height));
        }
        if (scanning !== state) return;
        const found = text === null ? null : readPairQr(text);
        if (found !== null)
        {
            stopScan();
            void pair(found);
            return;
        }
        if (text !== null) status(appText("연동 QR이 아니에요. 게임 설정의 태블릿 연동에 나오는 QR을 비춰 주세요."), "error");
        state.timer = setTimeout(() => void look(), 150);
    };
    void look();
};

const pair = async (scan = null) =>
{
    const code = scan === null ? normalizeCode($("code").value) : scan.code;
    if (!isPairCode(code))
    {
        status(appText("게임 화면의 8자리 연동 번호를 넣어 주세요."), "error");
        return;
    }
    const name = $("name").value.trim() || appText("태블릿");
    write(keys.name, name);
    const lanText = $("lan").value;
    const base = lanBase(lanText);
    if (lanText.trim() !== "" && base === null)
    {
        status(appText("게임 주소를 다시 확인해 주세요. 예: 192.168.0.12:47811"), "error");
        return;
    }
    $("pair-go").disabled = true;
    $("scan-go").disabled = true;
    $("confirm").hidden = true;
    status(scan === null ? appText("게임을 찾는 중이에요…") : appText("QR을 읽었어요. 게임과 연동하는 중이에요…"));
    try
    {
        const paired = await new AppLink({ device, name }).pair(relayFor(null, base), code, (number) =>
        {
            $("confirm-number").textContent = number;
            $("confirm").hidden = false;
            $("confirm").scrollIntoView({ block: "center", behavior: "smooth" });
            status(appText("게임에서 연동을 누르면 끝나요."));
        }, scan?.token ?? null);
        if (paired.lan === null && base !== null)
        {
            const url = new URL(base);
            paired.lan = { addresses: [url.hostname], port: Number(url.port) };
        }
        for (const old of pairings.filter((item) => item.channel !== paired.channel && sameGame(item.game, paired.game)))
        {
            for (const child of children)
            {
                if (Object.hasOwn(child.games, old.channel))
                {
                    child.games[paired.channel] = child.games[old.channel];
                    delete child.games[old.channel];
                }
                if (child.seen !== undefined && Object.hasOwn(child.seen, old.channel))
                {
                    child.seen[paired.channel] = child.seen[old.channel];
                    delete child.seen[old.channel];
                }
            }
            saveChildren();
        }
        pairings = [...pairings.filter((item) => item.channel !== paired.channel && !sameGame(item.game, paired.game)), paired];
        savePairings();
        $("code").value = "";
        go(gameHash(paired.channel));
    }
    catch (error)
    {
        status(error.message, "error");
    }
    finally
    {
        $("pair-go").disabled = false;
        $("scan-go").disabled = false;
        $("confirm").hidden = true;
    }
};

const removePairing = (pairing) =>
{
    pairings = pairings.filter((item) => item !== pairing);
    for (const child of children)
    {
        delete child.games[pairing.channel];
        if (child.seen !== undefined) delete child.seen[pairing.channel];
    }
    for (const key of Object.keys(docs)) if (key.startsWith(`${pairing.channel}:`)) delete docs[key];
    live.gone.delete(pairing.channel);
    live.failed.delete(pairing.channel);
    live.waiting.delete(pairing.channel);
    direct.found.delete(pairing.channel);
    savePairings();
    saveChildren();
    write(keys.docs, docs);
};

const forget = () =>
{
    const where = route();
    const pairing = pairings.find((item) => item.channel === where.channel);
    if (pairing === undefined || !confirm(appText("'{name}' 연동을 해제할까요? 게임에서도 이 태블릿이 빠지고, 이 태블릿의 프로필은 그 게임에 더 이상 보이지 않아요. 프로필은 이 태블릿에 그대로 있고, 다시 연동하면 게임에 다시 보여요.", { name: pairing.game.name }))) return;
    const leaving = { ...pairing, byeAt: new Date().toISOString() };
    byes = [...byes.filter((item) => item.channel !== leaving.channel), leaving];
    write(keys.byes, byes);
    void sendBye(leaving);
    removePairing(pairing);
    go("#/");
};

const byeMs = { first: 30000, most: 600000, keep: 30 * 86400000 };
const byeTries = new Map();

const sendBye = async (item) =>
{
    const tried = byeTries.get(item.channel);
    if (tried?.busy === true) return;
    byeTries.set(item.channel, { busy: true, tries: tried?.tries ?? 0, next: 0 });
    const done = await link().bye(relayFor(item), item);
    if (done || Date.now() - Date.parse(item.byeAt) > byeMs.keep)
    {
        byeTries.delete(item.channel);
        byes = byes.filter((other) => other.channel !== item.channel);
        write(keys.byes, byes);
        return;
    }
    const tries = (tried?.tries ?? 0) + 1;
    byeTries.set(item.channel, { busy: false, tries, next: Date.now() + Math.min(byeMs.first * 2 ** (tries - 1), byeMs.most) });
};

const sendByes = (now) =>
{
    for (const item of byes) if (now || Date.now() >= (byeTries.get(item.channel)?.next ?? 0)) void sendBye(item);
};

const unlinked = (pairing, error) =>
{
    if (error?.unpaired !== true) return false;
    gameSaid(pairing.channel, "unpaired");
    return true;
};

const gameSaid = (channel, type) =>
{
    const pairing = pairings.find((item) => item.channel === channel);
    if (pairing === undefined) return;
    if (type === "changed")
    {
        live.seen.add(channel);
        if (live.gone.delete(channel)) syncPlaying();
        liveChanged(channel);
        return;
    }
    if (type === "gone")
    {
        if (live.gone.has(channel)) return;
        live.gone.add(channel);
        syncPlaying();
        liveChanged(channel);
        return;
    }
    const where = route();
    if (type === "closed")
    {
        live.gone.add(channel);
        live.waiting.delete(channel);
        syncPlaying();
        if (where.screen === "game" && where.channel === channel) status(appText("'{name}' 게임이 꺼졌어요. 다시 켜면 저절로 새로 받아요.", { name: pairing.game.name }));
        return;
    }
    removePairing(pairing);
    const text = appText("'{name}'에서 이 태블릿의 연동을 해제했어요. 프로필은 이 태블릿에 그대로 있어요.", { name: pairing.game.name });
    if (where.screen === "home")
    {
        renderHome();
        status(text);
    }
    else
    {
        carried = { text, tone: "plain" };
        go("#/");
    }
};

const liveMs = { gather: 400, retry: 1000, backup: 30000, playing: 6000, quick: 8000, check: 3000, rest: 60000 };
const live = { waiting: new Set(), quick: new Set(), timer: null, running: false, failed: new Map(), noted: false, watches: new Map(), gone: new Set(), seen: new Set() };
const liveNote = "게임에서 값이 바뀌었어요. 고치던 값을 적용하거나 되돌리면 새 값을 받아요.";

function watchGames()
{
    const watchKey = (pairing) => JSON.stringify([pairing.lan ?? null, pairing.live ?? null]);
    for (const [channel, watch] of live.watches)
    {
        const pairing = pairings.find((item) => item.channel === channel);
        if (pairing !== undefined && watch.key === watchKey(pairing)) continue;
        watch.stop();
        live.watches.delete(channel);
    }
    let fresh = false;
    for (const pairing of pairings)
    {
        if (live.watches.has(pairing.channel)) continue;
        live.watches.set(pairing.channel, { key: watchKey(pairing), stop: link().watch(relayFor(pairing), pairing, (notice) => gameSaid(pairing.channel, notice.type ?? "changed")) });
        fresh = true;
    }
    if (fresh) checkDirect();
}

const shownScopes = (pairing) =>
{
    const where = route();
    if (where.screen === "home") return [null];
    if (where.screen === "game") return where.channel === pairing.channel ? [...new Set([where.scope, null])] : [];
    if (where.screen !== "child") return [];
    const scope = childOf(where.id)?.games[pairing.channel];
    return typeof scope === "string" ? [scope, null] : [null];
};

const editing = () => [...document.querySelectorAll("form.pv-edit")].some((form) => form.offsetParent !== null
    && [...form.querySelectorAll("select.pv-input")].some((select) => select === document.activeElement || select.selectedIndex !== Number(select.dataset.start)));

const livePump = (delay) =>
{
    clearTimeout(live.timer);
    live.timer = setTimeout(() => void liveRun(), delay);
};

const liveChanged = (channel) =>
{
    live.waiting.add(channel);
    livePump(liveMs.gather);
};

const liveResume = () =>
{
    if (live.waiting.size > 0) livePump(0);
};

const liveRun = async () =>
{
    live.timer = null;
    if (live.waiting.size === 0 || document.hidden) return;
    if (busy || live.running)
    {
        livePump(liveMs.retry);
        return;
    }
    if (editing())
    {
        live.noted = true;
        status(appText(liveNote));
        return;
    }
    live.running = true;
    const channels = [...live.waiting];
    const quick = new Set(live.quick);
    live.waiting.clear();
    live.quick.clear();
    let fetched = false;
    for (const channel of channels)
    {
        const pairing = pairings.find((item) => item.channel === channel);
        if (pairing === undefined) continue;
        try
        {
            for (const scope of shownScopes(pairing))
            {
                const asker = quick.has(channel) ? new AppLink({ device, name: tabletName(), settings: { ...linkSettings, docMs: liveMs.quick } }) : link();
                const { doc, lan, live: boot, screen: shows } = await asker.fetchDoc(relayFor(pairing), pairing, scope, scope === null ? { profiles: registryForGame(children, pairing.channel, pairing.game.id), deleted } : {});
                keep(pairing, scope, doc, lan, boot, shows);
                fetched = true;
            }
            live.failed.delete(channel);
        }
        catch (error)
        {
            if (unlinked(pairing, error)) continue;
            live.failed.set(channel, Date.now());
            live.gone.add(channel);
        }
    }
    live.running = false;
    syncPlaying();
    if (!fetched || busy) return;
    if (editing())
    {
        for (const channel of channels) live.waiting.add(channel);
        live.noted = true;
        status(appText(liveNote));
        return;
    }
    if (live.noted)
    {
        live.noted = false;
        status("");
    }
    const top = window.scrollY;
    refreshView();
    window.scrollTo(0, top);
};

const liveCheck = () =>
{
    if (document.hidden) return;
    syncPlaying();
    sendByes(false);
    if (Date.now() - direct.at >= directMs.every) checkDirect();
    const now = Date.now();
    const playing = new Set(playingNow().map((item) => item.pairing.channel));
    for (const pairing of pairings)
    {
        if (now - (live.failed.get(pairing.channel) ?? 0) < liveMs.rest) continue;
        const limit = playing.has(pairing.channel) ? liveMs.playing : liveMs.backup;
        const old = shownScopes(pairing).some((scope) =>
        {
            const at = docs[cacheKey(pairing.channel, scope)]?.at;
            return at === undefined || now - Date.parse(at) > limit;
        });
        if (!old) continue;
        if (playing.has(pairing.channel)) live.quick.add(pairing.channel);
        liveChanged(pairing.channel);
    }
};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const watchHash = (channel) => `#/watch/${encodeURIComponent(channel)}`;
const watchBases = (pairing) =>
{
    const first = directBase(pairing);
    const bases = lanBases(pairing);
    return first === null ? bases : [first, ...bases.filter((base) => base !== first)];
};
let watching = null;
let watchTouchOn = true;
let watchReturn = "#/";

const openWatch = (pairing) =>
{
    watchReturn = location.hash === "" ? "#/" : location.hash;
    go(watchHash(pairing.channel));
};

const watchNote = (text, tone = "plain") =>
{
    $("watch-note").textContent = text;
    $("watch-note").dataset.tone = tone;
};

const drawTouch = () =>
{
    $("watch-touch").setAttribute("aria-pressed", String(watchTouchOn));
    $("watch-touch").querySelector("span").textContent = appText(watchTouchOn ? "누르기 켬" : "누르기 끔");
};

const renderWatch = (channel) =>
{
    const pairing = pairings.find((item) => item.channel === channel);
    if (pairing === undefined)
    {
        go("#/");
        return;
    }
    show("watch", pairing.game.name);
    $("watch-title").textContent = pairing.game.name;
    if (watchReturn.startsWith("#/watch/")) watchReturn = gameHash(channel);
    drawTouch();
    if (watching?.pairing === pairing) return;
    stopWatch();
    const state = { pairing, bases: watchBases(pairing), index: 0, view: null, seq: 0, abort: new AbortController(), pressed: false, move: null, moveTimer: null, sending: Promise.resolve(), rect: null, failures: 0, shown: [] };
    watching = state;
    if (state.bases.length === 0)
    {
        watchNote(appText("게임 화면 보기는 같은 공유기에서 설치형 앱이나 게임 PC의 '이 컴퓨터에서 앱 열기'로만 돼요."), "error");
        return;
    }
    watchNote(appText("게임 화면을 여는 중이에요…"));
    void watchLoop(state);
};

const stopWatch = () =>
{
    const state = watching;
    if (state === null) return;
    watching = null;
    state.abort.abort();
    clearTimeout(state.moveTimer);
    void state.view?.stop();
    const canvas = $("watch-canvas");
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    delete canvas.dataset.frame;
    delete canvas.dataset.rect;
};

const watchWidth = () => Math.min(1920, Math.max(640, Math.round($("watch-canvas").getBoundingClientRect().width * (window.devicePixelRatio || 1))));

const drawFrame = (state, picture) =>
{
    const canvas = $("watch-canvas");
    const ratio = window.devicePixelRatio || 1;
    const box = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(box.width * ratio));
    const height = Math.max(1, Math.round(box.height * ratio));
    if (canvas.width !== width || canvas.height !== height)
    {
        canvas.width = width;
        canvas.height = height;
    }
    const scale = Math.min(width / picture.width, height / picture.height);
    const shown = { width: picture.width * scale, height: picture.height * scale };
    const left = (width - shown.width) / 2;
    const top = (height - shown.height) / 2;
    const context = canvas.getContext("2d");
    context.fillStyle = "#0e1116";
    context.fillRect(0, 0, width, height);
    context.drawImage(picture, left, top, shown.width, shown.height);
    state.rect = { x: left / ratio, y: top / ratio, width: shown.width / ratio, height: shown.height / ratio };
    canvas.dataset.frame = String(state.seq);
    canvas.dataset.rect = [state.rect.x, state.rect.y, state.rect.width, state.rect.height].map((value) => value.toFixed(1)).join(",");
};

const watchLoop = async (state) =>
{
    while (watching === state)
    {
        if (document.hidden)
        {
            await pause(400);
            continue;
        }
        if (state.view === null) state.view = new ScreenView({ base: state.bases[state.index % state.bases.length], pairing: state.pairing });
        try
        {
            const frame = await state.view.frame(state.seq, watchWidth(), state.abort.signal);
            if (watching !== state) return;
            if (frame === null)
            {
                watchNote(appText("게임 화면을 아직 받을 수 없어요. 게임 창이 내려가 있으면 올려 주세요."), "error");
                await pause(1000);
                continue;
            }
            state.seq = frame.seq;
            state.failures = 0;
            const picture = await createImageBitmap(new Blob([frame.jpeg], { type: "image/jpeg" }));
            if (watching !== state)
            {
                picture.close();
                return;
            }
            drawFrame(state, picture);
            picture.close();
            const now = Date.now();
            state.shown = [...state.shown.filter((at) => now - at < 2000), now];
            const fps = Math.round(state.shown.length / 2);
            watchNote(appText(watchTouchOn ? "같은 공유기로 보는 중 · 초당 {fps}장 · 화면을 누르면 게임에서 눌려요" : "같은 공유기로 보는 중 · 초당 {fps}장 · 보기만 해요", { fps }));
        }
        catch (error)
        {
            if (watching !== state) return;
            state.failures += 1;
            state.view = null;
            state.index += 1;
            watchNote(error?.status === 403 ? appText("게임이 이 태블릿을 알아보지 못해요. 연동을 다시 확인해 주세요.") : appText("게임 화면을 받지 못했어요. 태블릿과 게임 PC가 같은 공유기에 있는지 확인해 주세요."), "error");
            await pause(Math.min(3000, 500 * state.failures));
        }
    }
};

const watchPoint = (event, clamp) =>
{
    const state = watching;
    if (state === null || state.rect === null) return null;
    const box = $("watch-canvas").getBoundingClientRect();
    const x = (event.clientX - box.left - state.rect.x) / state.rect.width;
    const y = (event.clientY - box.top - state.rect.y) / state.rect.height;
    if (clamp) return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
};

const watchSend = (state, events) =>
{
    const view = state.view;
    if (view === null) return;
    state.sending = state.sending.then(() => view.input(events)).catch(() => undefined);
};

const watchFlushMove = (state) =>
{
    clearTimeout(state.moveTimer);
    state.moveTimer = null;
    if (state.move === null) return;
    watchSend(state, [{ type: "move", ...state.move }]);
    state.move = null;
};

const watchDown = (event) =>
{
    const state = watching;
    if (state === null || !watchTouchOn || state.pressed) return;
    const point = watchPoint(event, false);
    if (point === null) return;
    event.preventDefault();
    try
    {
        $("watch-canvas").setPointerCapture(event.pointerId);
    }
    catch
    {
    }
    state.pressed = true;
    watchSend(state, [{ type: "down", ...point }]);
};

const watchMove = (event) =>
{
    const state = watching;
    if (state === null || !state.pressed) return;
    event.preventDefault();
    state.move = watchPoint(event, true);
    if (state.moveTimer === null) state.moveTimer = setTimeout(() => watchFlushMove(state), 50);
};

const watchUp = (event) =>
{
    const state = watching;
    if (state === null || !state.pressed) return;
    event.preventDefault();
    state.pressed = false;
    watchFlushMove(state);
    watchSend(state, [{ type: "up", ...watchPoint(event, true) }]);
};

const catchUp = () =>
{
    for (const pairing of pairings) liveChanged(pairing.channel);
    sendByes(true);
};

let wokeAt = 0;
const wake = () =>
{
    if (document.hidden || Date.now() - wokeAt < 1500) return;
    wokeAt = Date.now();
    relay.wake();
    for (const lan of lanRelays.values()) lan.wake();
    catchUp();
    checkDirect();
};

let relayWas = "idle";
let relayOnce = false;
const relayStatus = (state) =>
{
    const back = state === "online" && relayWas !== "online" && relayOnce;
    if (state === "online") relayOnce = true;
    relayWas = state;
    if (back) catchUp();
};

const lanStatus = (base, now, before) =>
{
    checkDirect();
    drawDirect();
    if (now === "up" && before === "down") catchUp();
    if (now !== "down" || before !== "up") return;
    for (const pairing of pairings) if (pairing.lan?.addresses.some((address) => `http://${address}:${pairing.lan.port}` === base)) gameSaid(pairing.channel, "gone");
};

const pingGame = async (base) =>
{
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), directMs.timeout);
    try
    {
        const response = await fetch(`${base}/panel/ping`, { cache: "no-store", signal: abort.signal });
        const answer = response.ok ? await response.json() : null;
        return answer?.ok === true && answer.game !== null && typeof answer.game === "object" ? answer.game : null;
    }
    catch
    {
        return null;
    }
    finally
    {
        clearTimeout(timer);
    }
};

const isGameOf = (pairing, game) => game !== null && game.id === pairing.game.id
    && (pairing.game.device === undefined || typeof game.device !== "string" || game.device.trim().slice(0, 80) === pairing.game.device);

const findDirect = (pairing) => new Promise((resolve) =>
{
    const bases = lanBases(pairing);
    let left = bases.length;
    if (left === 0) resolve(null);
    for (const base of bases) void pingGame(base).then((game) =>
    {
        if (isGameOf(pairing, game)) resolve(base);
        else if (--left === 0) resolve(null);
    });
});

const drawDirect = () =>
{
    const where = route();
    if (where.screen === "home")
    {
        drawPlaying();
        drawGameStates();
        return;
    }
    const pairing = pairings.find((item) => item.channel === where.channel);
    if (pairing === undefined) return;
    if (where.screen === "game")
    {
        drawWatchOpen(pairing);
        const subtitle = subtitleOf(pairing, where.scope);
        $("subtitle").textContent = subtitle;
        $("subtitle").hidden = subtitle === "";
    }
    else if (where.screen === "watch" && watching !== null && watching.bases.length === 0)
    {
        stopWatch();
        renderWatch(where.channel);
    }
};

const setDirect = (pairing, base) =>
{
    if ((direct.found.get(pairing.channel) ?? null) === base) return;
    if (base === null) direct.found.delete(pairing.channel);
    else
    {
        direct.found.set(pairing.channel, base);
        lanRelay(base).wake();
    }
    drawDirect();
};

function checkDirect()
{
    const run = ++direct.run;
    direct.at = Date.now();
    for (const pairing of pairings) void findDirect(pairing).then((base) => pairings.includes(pairing) && (base !== null || run === direct.run) && setDirect(pairing, base));
}

const directLost = (pairing) =>
{
    setDirect(pairing, null);
    checkDirect();
};

$("pair-open").addEventListener("click", () => go("#/pair"));
$("pair-go").addEventListener("click", () => void pair());
$("scan-go").addEventListener("click", () => void startScan());
$("scan-stop").addEventListener("click", stopScan);
document.addEventListener("visibilitychange", () => document.hidden && stopScan());
$("code").addEventListener("input", () =>
{
    const digits = normalizeCode($("code").value).slice(0, 8);
    $("code").value = digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
});
$("child-open").addEventListener("click", () =>
{
    $("child-form").hidden = false;
    $("child-name").focus();
});
$("child-cancel").addEventListener("click", () => $("child-form").hidden = true);
$("child-form").addEventListener("submit", (event) =>
{
    event.preventDefault();
    void createChild();
});
$("child-rename").addEventListener("click", () =>
{
    const where = route();
    const child = where.screen === "child" ? childOf(where.id) : undefined;
    if (child === undefined) return;
    $("rename-name").value = child.name;
    $("rename-form").hidden = false;
    $("rename-name").focus();
});
$("rename-cancel").addEventListener("click", () => $("rename-form").hidden = true);
$("rename-form").addEventListener("submit", (event) =>
{
    event.preventDefault();
    void renameChild();
});
$("child-remove").addEventListener("click", removeChild);
$("back").addEventListener("click", () => go("#/"));
$("refresh").addEventListener("click", () =>
{
    const where = route();
    if (where.screen === "game")
    {
        const pairing = pairings.find((item) => item.channel === where.channel);
        if (pairing !== undefined) void load(pairing, where.scope, true);
    }
    else if (where.screen === "child")
    {
        const child = childOf(where.id);
        if (child !== undefined) void syncAll(appText("게임에서 받는 중이에요…")).then(() => loadChild(child));
    }
    else void syncAll(appText("게임에서 받는 중이에요…"));
});
$("find").addEventListener("input", () =>
{
    const where = route();
    const pairing = pairings.find((item) => item.channel === where.channel);
    if (pairing !== undefined) drawSide(pairing, where.scope);
});
$("forget").addEventListener("click", forget);
$("watch-open").addEventListener("click", () =>
{
    const pairing = pairings.find((item) => item.channel === route().channel);
    if (pairing !== undefined) openWatch(pairing);
});
$("watch-close").addEventListener("click", () => go(watchReturn));
$("watch-touch").addEventListener("click", () =>
{
    watchTouchOn = !watchTouchOn;
    drawTouch();
});
$("watch-canvas").addEventListener("pointerdown", watchDown);
$("watch-canvas").addEventListener("pointermove", watchMove);
$("watch-canvas").addEventListener("pointerup", watchUp);
$("watch-canvas").addEventListener("pointercancel", watchUp);
$("forget-narrow").addEventListener("click", forget);
window.addEventListener("hashchange", render);
if (globalThis.crypto?.subtle === undefined)
{
    status(appText("이 주소로는 연동 암호화를 쓸 수 없어요. 아이핏 PC에서는 게임 설정의 '이 컴퓨터에서 앱 열기'로, 다른 기기는 설치형 앱이나 https 주소로 열어 주세요."), "error");
    $("pair-open").disabled = true;
    $("child-open").disabled = true;
}
languagePicker($("language"), () => (pairings.length === 0 ? Promise.resolve() : syncAll(appText("바뀐 언어를 게임에 전하는 중이에요…"), ["language"])));
document.addEventListener("visibilitychange", () =>
{
    if (document.hidden) return;
    liveResume();
    liveCheck();
    wake();
});
for (const name of ["pageshow", "online", "focus", "aifit-wake"]) window.addEventListener(name, wake);
window.addEventListener("offline", checkDirect);
setInterval(liveCheck, liveMs.check);
watchGames();
fetch("version.json").then((response) => response.json()).then((info) => $("version").textContent = appText("앱 {version}", { version: info.version })).catch(() => undefined);
render();
wake();
