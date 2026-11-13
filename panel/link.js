import { isPanelDoc } from "./doc.js";
import { agreeKey, codeKey, codeTopic, confirmNumber, isPairCode, isPairToken, linkKey, newKeyPair, newPairCode, newPairToken, normalizeCode, pairQrText, randomId, seal, tokenKey, unseal } from "./seal.js";
import { panelLanguage, panelLanguageAt, panelText } from "./text.js";
import { isDeletedList, isSharedProfileList } from "./profiles.js";

export const topics = Object.freeze({
    pairGame: (code) => `aifit-panel/v1/pair/${code}/game`,
    pairApp: (code) => `aifit-panel/v1/pair/${code}/app`,
    linkGame: (channel) => `aifit-panel/v1/link/${channel}/game`,
    linkApp: (channel) => `aifit-panel/v1/link/${channel}/app`,
    live: (id) => `aifit-panel/v1/live/${id}`
});
export const liveGone = "gone";
export const gameNotices = Object.freeze(["changed", "closed", "unpaired"]);
/** What a tablet asks the game to draw again after the tablet changed it: the profile list, a profile's settings, the language. */
export const redrawKinds = Object.freeze(["profiles", "settings", "language"]);
export const isRedrawList = (value) => Array.isArray(value) && value.length >= 1 && value.length <= redrawKinds.length && value.every((item) => redrawKinds.includes(item)) && new Set(value).size === value.length;
export const linkSettings = Object.freeze({ pairMs: 5 * 60000, answerMs: 15000, docMs: 15000, resendMs: 2500, seen: 200, noticeMs: 800, noticeRepeatMs: 3000, leftMs: 30 * 86400000, leftMax: 20 });

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const cleanText = (value, fallback, max = 40) => typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : fallback;
const isKey = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{40,60}$/.test(value);
const isChannel = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);
const iso = (ms) => new Date(ms).toISOString();
const isCell = (value) => (typeof value === "string" && value.length <= 400) || (typeof value === "number" && Number.isFinite(value));
const isShort = (value, max) => typeof value === "string" && value.length >= 1 && value.length <= max;
const errorText = (error) => error instanceof Error ? error.message : String(error);

const cleanTime = (value) => typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : null;
const cleanLanguage = (value) => typeof value === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(value) ? value : null;

export const isPanelChange = (value) => isRecord(value) && (value.revision === undefined || value.revision === null || isShort(value.revision, 80))
    && (isShort(value.action, 40) ? value.action.trim() !== "" && value.form === undefined && value.values === undefined
        : isShort(value.form, 60) && isRecord(value.values) && Object.keys(value.values).length >= 1 && Object.keys(value.values).length <= 80 && Object.entries(value.values).every(([key, item]) => key.length <= 60 && isCell(item)));

export const isPairing = (value) => isRecord(value) && isChannel(value.channel) && isKey(value.key) && typeof value.device === "string" && typeof value.name === "string" && typeof value.pairedAt === "string";
export const isLeftPairing = (value) => isRecord(value) && isChannel(value.channel) && isKey(value.key) && typeof value.device === "string" && typeof value.leftAt === "string" && !Number.isNaN(Date.parse(value.leftAt));
export const isAppPairing = (value) => isRecord(value) && isChannel(value.channel) && isKey(value.key) && isRecord(value.game) && typeof value.game.id === "string" && typeof value.game.name === "string" && typeof value.pairedAt === "string";

export class GameLink
{
    constructor({ relay, game, pairings = [], left = [], live = randomId(18), screen = false, save = () => undefined, docFor, changeFor = null, lan = () => null, onChange = () => undefined, onPaired = () => undefined, onBye = () => undefined, onRedraw = () => undefined, now = Date.now, settings = linkSettings })
    {
        this.relay = relay;
        this.game = game;
        this.live = live;
        this.screen = screen === true;
        this.devices = pairings.filter(isPairing).map((item) => ({ ...item }));
        this.left = left.filter(isLeftPairing).map(({ channel, key, device, name, leftAt }) => ({ channel, key, device, name: typeof name === "string" ? name : "", leftAt }));
        this.save = save;
        this.docFor = docFor;
        this.changeFor = changeFor;
        this.lan = lan;
        this.onChange = onChange;
        this.onPaired = onPaired;
        this.onBye = onBye;
        this.onRedraw = onRedraw;
        this.now = now;
        this.settings = settings;
        this.keys = new Map();
        this.channels = new Map();
        this.seen = [];
        this.answers = new Map();
        this.paths = new Map();
        this.pairing = null;
        this.notice = null;
        this.repeats = new Set();
    }

    start()
    {
        for (const device of this.devices) this.listen(device);
        this.prune();
        for (const entry of this.left) this.listenLeft(entry);
        if (this.devices.length > 0) void this.tell(this.devices, "changed");
    }

    state()
    {
        const pairing = this.pairing;
        return {
            pairing: pairing === null ? null : { code: pairing.code, qr: pairing.qr, expiresAt: pairing.expiresAt, request: pairing.request?.number ? { name: pairing.request.name, number: pairing.request.number } : null },
            devices: this.devices.map(({ device, name, pairedAt, lastSeenAt }) => ({ device, name, pairedAt, lastSeenAt: lastSeenAt ?? null }))
        };
    }

    async startPairing()
    {
        this.cancelPairing();
        const code = newPairCode();
        const token = newPairToken();
        const topic = await codeTopic(code);
        const pairing = { code, qr: pairQrText(code, token), topic, key: await codeKey(code), scanKey: await tokenKey(code, token), expiresAt: this.now() + this.settings.pairMs, request: null, stop: () => undefined, timer: null };
        pairing.stop = this.relay.subscribe(topics.pairGame(topic), (text) => void this.hello(pairing, text));
        pairing.timer = setTimeout(() => this.pairing === pairing && this.cancelPairing(), this.settings.pairMs);
        this.pairing = pairing;
        this.onChange();
        return { code, qr: pairing.qr, expiresAt: pairing.expiresAt };
    }

    cancelPairing()
    {
        const pairing = this.pairing;
        if (pairing === null) return;
        pairing.stop();
        clearTimeout(pairing.timer);
        this.pairing = null;
        this.onChange();
    }

    async approve(ok)
    {
        const pairing = this.pairing;
        if (pairing === null || pairing.request === null || pairing.request.number === null || pairing.request.decided) return false;
        const request = pairing.request;
        request.decided = true;
        if (ok)
        {
            const device = { device: request.device, name: request.name, channel: randomId(18), key: request.shared, pairedAt: iso(this.now()), lastSeenAt: null };
            for (const old of this.devices.filter((item) => item.device === device.device)) this.forget(old);
            this.devices.push(device);
            this.persist();
            this.listen(device);
            const topic = topics.pairApp(pairing.topic);
            const done = await seal(await linkKey(request.shared), { type: "done", id: randomId(), channel: device.channel, game: this.game, lan: this.lan(), live: this.live, ...this.screen ? { screen: true } : {} });
            await this.relay.publish(topic, done);
            for (const delay of [1500, 4000]) setTimeout(() => void this.relay.publish(topic, done).catch(() => undefined), delay);
        }
        else await this.relay.publish(topics.pairApp(pairing.topic), await seal(pairing.key, { type: "denied", id: randomId() }));
        this.cancelPairing();
        return true;
    }

    unpair(deviceId)
    {
        const found = this.devices.filter((item) => item.device === deviceId);
        if (found.length === 0) return false;
        void this.tell(found, "unpaired");
        for (const device of found) this.forget(device);
        this.persist();
        this.onChange();
        return true;
    }

    persist()
    {
        this.save(this.devices.map((item) => ({ ...item })), this.left.map((item) => ({ ...item })));
    }

    close()
    {
        this.cancelPairing();
        clearTimeout(this.notice);
        this.notice = null;
        for (const timer of this.repeats) clearTimeout(timer);
        this.repeats.clear();
        for (const stop of this.channels.values()) stop();
        this.channels.clear();
    }

    notify()
    {
        if (this.notice !== null || this.devices.length === 0) return;
        this.notice = setTimeout(() => void this.sendNotice(), this.settings.noticeMs ?? linkSettings.noticeMs);
    }

    async sendNotice()
    {
        this.notice = null;
        await this.tell(this.devices, "changed");
    }

    farewell()
    {
        clearTimeout(this.notice);
        this.notice = null;
        return this.tell(this.devices, "closed", false);
    }

    async tell(devices, type, again = true)
    {
        const message = { type, id: randomId(), at: iso(this.now()) };
        await Promise.all(devices.map(async (device) =>
        {
            const topic = topics.linkApp(device.channel);
            const sealed = await seal(await this.keyOf(device), message);
            await this.relay.publish(topic, sealed).catch(() => undefined);
            if (!again) return;
            const repeat = setTimeout(() =>
            {
                this.repeats.delete(repeat);
                void this.relay.publish(topic, sealed).catch(() => undefined);
            }, this.settings.noticeRepeatMs ?? linkSettings.noticeRepeatMs);
            this.repeats.add(repeat);
        }));
    }

    forget(device)
    {
        this.devices = this.devices.filter((item) => item !== device);
        const stop = this.channels.get(device.channel);
        const entry = { channel: device.channel, key: device.key, device: device.device, name: device.name, leftAt: iso(this.now()) };
        this.left = [...this.left.filter((item) => item.channel !== entry.channel), entry];
        this.listenLeft(entry);
        stop?.();
        this.prune();
    }

    prune()
    {
        const oldest = this.now() - (this.settings.leftMs ?? linkSettings.leftMs);
        const kept = this.left.filter((item) => Date.parse(item.leftAt) >= oldest).slice(-(this.settings.leftMax ?? linkSettings.leftMax));
        for (const item of this.left.filter((entry) => !kept.includes(entry)))
        {
            this.channels.get(item.channel)?.();
            this.channels.delete(item.channel);
            this.keys.delete(item.channel);
        }
        this.left = kept;
    }

    listen(device)
    {
        this.channels.set(device.channel, this.relay.subscribe(topics.linkGame(device.channel), (text, _topic, via) => void this.request(device, text, via)));
    }

    listenLeft(entry)
    {
        this.channels.set(entry.channel, this.relay.subscribe(topics.linkGame(entry.channel), (text, _topic, via) => void this.leftRequest(entry, text, via)));
    }

    async leftRequest(entry, text, via = this.relay)
    {
        if (!this.left.includes(entry)) return;
        const key = await this.keyOf(entry);
        const message = await unseal(key, text).catch(() => null);
        if (!isRecord(message) || typeof message.id !== "string" || !["get", "set", "bye"].includes(message.type)) return;
        if (!this.fresh(message.id))
        {
            await this.repeat(message.id, via);
            return;
        }
        this.wait(message.id, via);
        await this.answer(message.id, topics.linkApp(entry.channel), await seal(key, { type: "unpaired", id: randomId(), reply: message.id }), via);
    }

    keyOf(device)
    {
        if (!this.keys.has(device.channel)) this.keys.set(device.channel, linkKey(device.key));
        return this.keys.get(device.channel);
    }

    fresh(id)
    {
        if (typeof id !== "string" || this.seen.includes(id)) return false;
        this.seen.push(id);
        if (this.seen.length > this.settings.seen) this.seen.shift();
        return true;
    }

    wait(id, via)
    {
        this.paths.set(id, new Set([via]));
        if (this.paths.size > this.settings.seen) this.paths.delete(this.paths.keys().next().value);
    }

    async answer(id, topic, text, via = this.relay)
    {
        this.answers.set(id, { topic, text });
        if (this.answers.size > this.settings.seen) this.answers.delete(this.answers.keys().next().value);
        const paths = this.paths.get(id) ?? new Set([via]);
        this.paths.delete(id);
        const sent = await Promise.allSettled([...paths].map((path) => path.publish(topic, text)));
        if (sent.every((item) => item.status === "rejected")) throw sent[0].reason;
    }

    async repeat(id, via = this.relay)
    {
        const waiting = this.paths.get(id);
        if (waiting !== undefined)
        {
            waiting.add(via);
            return;
        }
        const answer = this.answers.get(id);
        if (answer !== undefined) await via.publish(answer.topic, answer.text);
    }

    async hello(pairing, text)
    {
        const typed = await unseal(pairing.key, text).catch(() => null);
        const message = typed ?? await unseal(pairing.scanKey, text).catch(() => null);
        const scanned = typed === null;
        const key = scanned ? pairing.scanKey : pairing.key;
        if (this.pairing !== pairing || !isRecord(message) || message.type !== "hello" || typeof message.appPublic !== "string" || typeof message.id !== "string") return;
        if (!this.fresh(message.id))
        {
            await this.repeat(message.id);
            return;
        }
        if (pairing.request !== null)
        {
            if (pairing.request.appPublic !== message.appPublic) await this.answer(message.id, topics.pairApp(pairing.topic), await seal(key, { type: "busy", id: randomId(), reply: message.id }));
            return;
        }
        const request = { device: cleanText(message.device, randomId(8), 64), name: cleanText(message.name, "태블릿"), appPublic: message.appPublic, shared: null, number: null, decided: false };
        pairing.request = request;
        const keys = await newKeyPair();
        request.shared = await agreeKey(keys.privateKey, message.appPublic, keys.publicKey, message.appPublic);
        request.number = await confirmNumber(keys.publicKey, message.appPublic);
        await this.answer(message.id, topics.pairApp(pairing.topic), await seal(key, { type: "ack", id: randomId(), reply: message.id, gamePublic: keys.publicKey, game: this.game }));
        if (!scanned) this.onChange();
        else if (await this.approve(true)) this.onPaired({ name: request.name, scanned: true });
    }

    async request(device, text, via = this.relay)
    {
        const key = await this.keyOf(device);
        let message;
        try
        {
            message = await unseal(key, text);
        }
        catch
        {
            return;
        }
        if (isRecord(message) && message.type === "bye" && typeof message.id === "string")
        {
            if (!this.devices.includes(device) || !this.fresh(message.id)) return;
            this.forget(device);
            this.persist();
            this.onChange();
            this.onBye({ device: device.device, name: device.name });
            await this.answer(message.id, topics.linkApp(device.channel), await seal(key, { type: "unpaired", id: randomId(), reply: message.id }), via);
            return;
        }
        if (!isRecord(message) || (message.type !== "get" && !(message.type === "set" && isPanelChange(message))) || typeof message.id !== "string" || !this.devices.includes(device)) return;
        if (!this.fresh(message.id))
        {
            await this.repeat(message.id, via);
            return;
        }
        this.wait(message.id, via);
        device.lastSeenAt = iso(this.now());
        this.persist();
        this.onChange();
        const scope = cleanText(message.scope, null, 120);
        const language = cleanLanguage(message.language);
        const from = { device: device.device, name: device.name, language, languageAt: cleanTime(message.languageAt), profiles: scope === null && isSharedProfileList(message.profiles) ? message.profiles : null, deleted: scope === null && isDeletedList(message.deleted) ? message.deleted : null };
        const answer = message.type === "set" ? await this.change(device, scope, message, from) : await this.docAnswer(device, scope, {}, from);
        const redraw = [...new Set([...isRedrawList(message.redraw) ? message.redraw : [], ...message.type === "set" && answer.type === "doc" && (message.action ?? null) === null ? ["settings"] : []])];
        if (redraw.length > 0 && answer.type === "doc") this.redrawn(device, redraw);
        await this.answer(message.id, topics.linkApp(device.channel), await seal(key, { ...answer, id: randomId(), reply: message.id, lan: this.lan(), live: this.live, ...this.screen ? { screen: true } : {} }), via);
    }

    redrawn(device, what)
    {
        try
        {
            this.onRedraw(device, what);
        }
        catch
        {
            return;
        }
    }

    async docAnswer(device, scope, extra, from = null)
    {
        try
        {
            return { type: "doc", doc: await this.docFor(device, scope, from?.language ?? null, from), ...extra };
        }
        catch (error)
        {
            return { type: "error", message: errorText(error) };
        }
    }

    async change(device, scope, message, from = null)
    {
        let result;
        try
        {
            if (this.changeFor === null) throw new Error("이 게임은 아직 태블릿에서 바꾸기를 받지 않아요.");
            result = await this.changeFor(device, scope, { form: message.form ?? null, revision: message.revision ?? null, values: message.values ?? {}, action: message.action ?? null }, from?.language ?? null, from);
        }
        catch (error)
        {
            const fresh = await this.docAnswer(device, scope, {}, from);
            return { type: "error", message: errorText(error), ...fresh.type === "doc" ? { doc: fresh.doc } : {} };
        }
        this.notify();
        return this.docAnswer(device, scope, { notice: cleanText(result?.notice, "적용했어요.", 200) }, from);
    }
}

const failure = (message) => Object.assign(new Error(message), { panel: true });
const shownText = (value) =>
{
    const text = cleanText(value, null, 200);
    return text === null ? null : panelText(text);
};

export class AppLink
{
    constructor({ device, name, now = Date.now, settings = linkSettings })
    {
        this.device = device;
        this.name = name;
        this.now = now;
        this.settings = settings;
    }

    async pair(relay, code, onConfirm = () => undefined, token = null)
    {
        if (!isPairCode(code)) throw failure(panelText("게임 화면의 8자리 연동 번호를 넣어 주세요."));
        if (token !== null && !isPairToken(token)) throw failure(panelText("게임 화면의 연동 QR을 다시 찍어 주세요."));
        const plain = normalizeCode(code);
        const topic = await codeTopic(plain);
        const key = token === null ? await codeKey(plain) : await tokenKey(plain, token);
        const keys = await newKeyPair();
        const helloId = randomId();
        return new Promise((resolve, reject) =>
        {
            let shared = null;
            let game = null;
            let acked = false;
            let settled = false;
            let resend = null;
            const early = [];
            const finished = async (text) =>
            {
                const done = await unseal(await linkKey(shared), text).catch(() => null);
                if (!isRecord(done) || done.type !== "done" || !isChannel(done.channel)) return false;
                finish(null, { game, channel: done.channel, key: shared, lan: isRecord(done.lan) ? done.lan : null, live: isChannel(done.live) ? done.live : null, screen: done.screen === true, pairedAt: iso(this.now()) });
                return true;
            };
            const finish = (error, value) =>
            {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                clearInterval(resend);
                stop();
                if (error === null) resolve(value);
                else reject(error);
            };
            let timer = setTimeout(() => finish(failure(panelText("게임을 찾지 못했어요. 번호가 맞는지, 두 기기가 인터넷이나 같은 공유기에 연결돼 있는지 확인해 주세요."))), this.settings.answerMs);
            const stop = relay.subscribe(topics.pairApp(topic), async (text) =>
            {
                if (shared !== null && await finished(text)) return;
                const message = await unseal(key, text).catch(() => null);
                if (!isRecord(message))
                {
                    if (shared === null && early.length < 4) early.push(text);
                    return;
                }
                if (message.type === "denied" && shared !== null) finish(failure(panelText("게임에서 연동을 거절했어요.")));
                else if (message.type === "busy" && message.reply === helloId) finish(failure(panelText("게임이 다른 태블릿과 연동하는 중이에요. 잠시 뒤 다시 해 주세요.")));
                else if (message.type === "ack" && message.reply === helloId && !acked && typeof message.gamePublic === "string" && isRecord(message.game))
                {
                    acked = true;
                    clearInterval(resend);
                    shared = await agreeKey(keys.privateKey, message.gamePublic, message.gamePublic, keys.publicKey);
                    game = { id: cleanText(message.game.id, "game", 60), name: cleanText(message.game.name, "게임", 80), ...typeof message.game.device === "string" && message.game.device.trim() !== "" ? { device: cleanText(message.game.device, "", 80) } : {} };
                    clearTimeout(timer);
                    timer = token === null ? setTimeout(() => finish(failure(panelText("게임에서 연동을 누르지 않아 시간이 지났어요. 다시 해 주세요."))), this.settings.pairMs)
                        : setTimeout(() => finish(failure(panelText("게임이 답하지 않아요. 게임이 켜져 있는지, 인터넷이나 같은 공유기에 연결돼 있는지 확인해 주세요."))), this.settings.answerMs);
                    if (token === null) onConfirm(await confirmNumber(message.gamePublic, keys.publicKey), game);
                    for (const item of early.splice(0)) if (await finished(item)) return;
                }
            });
            void seal(key, { type: "hello", id: helloId, appPublic: keys.publicKey, device: this.device, name: this.name })
                .then((sealed) =>
                {
                    if (!settled && !acked) resend = setInterval(() => !acked && void relay.publish(topics.pairGame(topic), sealed).catch(() => undefined), this.settings.resendMs);
                    return relay.publish(topics.pairGame(topic), sealed);
                })
                .catch(() => finish(failure(panelText("인터넷에 연결되지 않았어요. 연결을 확인해 주세요."))));
        });
    }

    fetchDoc(relay, pairing, scope = null, extra = {})
    {
        return this.ask(relay, pairing, { type: "get", ...scope === null ? {} : { scope }, ...this.languageFields(), ...scope === null && isSharedProfileList(extra.profiles) ? { profiles: extra.profiles } : {}, ...scope === null && isDeletedList(extra.deleted) && extra.deleted.length > 0 ? { deleted: extra.deleted } : {}, ...isRedrawList(extra.redraw) ? { redraw: extra.redraw } : {} });
    }

    watch(relay, pairing, onChanged)
    {
        const key = linkKey(pairing.key);
        const seen = [];
        const gone = isChannel(pairing.live) ? relay.subscribe(topics.live(pairing.live), (text) => text === liveGone && onChanged({ channel: pairing.channel, at: null, type: "gone" })) : () => undefined;
        const notices = relay.subscribe(topics.linkApp(pairing.channel), async (text) =>
        {
            let message;
            try
            {
                message = await unseal(await key, text);
            }
            catch
            {
                return;
            }
            if (!isRecord(message) || !gameNotices.includes(message.type) || typeof message.id !== "string" || seen.includes(message.id)) return;
            seen.push(message.id);
            if (seen.length > this.settings.seen) seen.shift();
            onChanged({ channel: pairing.channel, at: cleanTime(message.at), type: message.type });
        });
        return () =>
        {
            gone();
            notices();
        };
    }

    async bye(relay, pairing)
    {
        try
        {
            await this.ask(relay, pairing, { type: "bye" });
            return false;
        }
        catch (error)
        {
            return error?.unpaired === true;
        }
    }

    languageFields()
    {
        const at = panelLanguageAt();
        return { language: panelLanguage(), ...at === null ? {} : { languageAt: at } };
    }

    change(relay, pairing, { scope = null, form, revision = null, values, action })
    {
        const message = { type: "set", ...scope === null ? {} : { scope }, ...action === undefined ? { form, values } : { action }, ...revision === null ? {} : { revision }, ...this.languageFields() };
        if (!isPanelChange(message)) return Promise.reject(failure(panelText("바꿀 값을 다시 확인해 주세요.")));
        return this.ask(relay, pairing, message);
    }

    async ask(relay, pairing, body)
    {
        const key = await linkKey(pairing.key);
        const id = randomId();
        return new Promise((resolve, reject) =>
        {
            let settled = false;
            let resend = null;
            const finish = (error, value) =>
            {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                clearInterval(resend);
                stop();
                if (error === null) resolve(value);
                else reject(error);
            };
            const timer = setTimeout(() => finish(failure(panelText("게임이 답하지 않아요. 게임이 켜져 있는지, 인터넷이나 같은 공유기에 연결돼 있는지 확인해 주세요."))), this.settings.docMs);
            const stop = relay.subscribe(topics.linkApp(pairing.channel), async (text) =>
            {
                let message;
                try
                {
                    message = await unseal(key, text);
                }
                catch
                {
                    return;
                }
                if (!isRecord(message) || message.reply !== id) return;
                const lan = isRecord(message.lan) ? message.lan : null;
                const live = isChannel(message.live) ? message.live : null;
                const screen = message.screen === true;
                if (message.type === "unpaired") finish(Object.assign(failure(panelText("게임에서 이 태블릿의 연동을 해제했어요.")), { unpaired: true }));
                else if (message.type === "doc" && isPanelDoc(message.doc)) finish(null, { doc: message.doc, lan, live, screen, notice: shownText(message.notice) });
                else if (message.type === "doc") finish(failure(panelText("받은 기록을 읽지 못했어요. 앱과 게임을 새 버전으로 맞춰 주세요.")));
                else if (message.type === "error") finish(Object.assign(failure(panelText(cleanText(message.message, "게임에서 기록을 만들지 못했어요.", 200))), isPanelDoc(message.doc) ? { doc: message.doc, lan, live, screen } : {}));
            });
            void seal(key, { ...body, id, device: this.device })
                .then((sealed) =>
                {
                    if (!settled) resend = setInterval(() => void relay.publish(topics.linkGame(pairing.channel), sealed).catch(() => undefined), this.settings.resendMs);
                    return relay.publish(topics.linkGame(pairing.channel), sealed);
                })
                .catch(() => finish(failure(panelText("인터넷에 연결되지 않았어요. 연결을 확인해 주세요."))));
        });
    }
}
