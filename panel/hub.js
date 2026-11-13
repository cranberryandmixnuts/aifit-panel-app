export const hubSettings = Object.freeze({ keepMs: 60000, maxQueue: 500, waitMs: 15000, maxBody: 2 * 1024 * 1024, retryMs: 3000, lateMs: 6000 });
export const lanPort = 47811;

const topicPattern = /^aifit-panel\/v1\/(pair|link)\/[A-Za-z0-9_-]{8,64}\/(game|app)$/;
export const isPanelTopic = (topic) => typeof topic === "string" && topicPattern.test(topic);

const fanOut = (handlers, topic, text) =>
{
    for (const handler of [...handlers.get(topic) ?? []]) handler(text, topic);
};

const addHandler = (handlers, topic, handler) =>
{
    let set = handlers.get(topic);
    if (set === undefined) handlers.set(topic, set = new Set());
    set.add(handler);
    return () =>
    {
        set.delete(handler);
        if (set.size === 0 && handlers.get(topic) === set) handlers.delete(topic);
    };
};

export class LocalHub
{
    constructor({ settings = hubSettings, now = Date.now } = {})
    {
        this.settings = settings;
        this.now = now;
        this.handlers = new Map();
        this.queue = [];
        this.seq = 0;
        this.waiters = new Set();
    }

    subscribe(topic, handler)
    {
        return addHandler(this.handlers, topic, handler);
    }

    publish(topic, text)
    {
        fanOut(this.handlers, topic, text);
        this.queue.push({ seq: ++this.seq, topic, text, at: this.now() });
        const oldest = this.now() - this.settings.keepMs;
        while (this.queue.length > 0 && (this.queue.length > this.settings.maxQueue || this.queue[0].at < oldest)) this.queue.shift();
        for (const waiter of [...this.waiters]) waiter.check();
        return Promise.resolve();
    }

    receive(topic, text)
    {
        fanOut(this.handlers, topic, text);
    }

    poll(topics, after, waitMs = this.settings.waitMs)
    {
        if (after > this.seq) after = 0;
        const ready = () => this.queue.filter((item) => item.seq > after && topics.includes(item.topic)).map(({ seq, topic, text }) => ({ seq, topic, text }));
        const now = ready();
        if (now.length > 0 || waitMs <= 0) return Promise.resolve({ seq: this.seq, messages: now });
        return new Promise((resolve) =>
        {
            const waiter = {
                check: () =>
                {
                    const found = ready();
                    if (found.length === 0) return;
                    finish(found);
                }
            };
            const finish = (messages) =>
            {
                clearTimeout(timer);
                this.waiters.delete(waiter);
                resolve({ seq: this.seq, messages });
            };
            const timer = setTimeout(() => finish([]), Math.min(waitMs, this.settings.waitMs));
            this.waiters.add(waiter);
        });
    }

    close()
    {
        for (const waiter of [...this.waiters]) waiter.check();
        this.handlers.clear();
    }
}

const reply = (status, value) => ({ status, body: JSON.stringify(value) });

export const lanRoute = async (hub, method, path, text, game) =>
{
    if (method === "GET" && path === "/panel/ping") return reply(200, { ok: true, game });
    if (method !== "POST" || (path !== "/panel/publish" && path !== "/panel/poll")) return reply(404, { ok: false });
    let request;
    try
    {
        request = JSON.parse(text);
    }
    catch
    {
        return reply(400, { ok: false });
    }
    if (path === "/panel/publish")
    {
        if (!isPanelTopic(request?.topic) || typeof request.text !== "string") return reply(400, { ok: false });
        hub.receive(request.topic, request.text);
        return reply(200, { ok: true });
    }
    const topics = Array.isArray(request?.topics) ? request.topics.filter(isPanelTopic).slice(0, 20) : [];
    const after = Number.isInteger(request?.after) && request.after >= 0 ? request.after : 0;
    const waitMs = Number.isFinite(request?.waitMs) ? Math.max(0, request.waitMs) : hub.settings.waitMs;
    return reply(200, await hub.poll(topics, after, waitMs));
};

export class HttpRelay
{
    constructor(base, { fetchImpl = (...args) => globalThis.fetch(...args), settings = hubSettings, onStatus = () => undefined } = {})
    {
        this.base = base.replace(/\/+$/, "");
        this.fetchImpl = fetchImpl;
        this.settings = settings;
        this.onStatus = onStatus;
        this.status = "idle";
        this.nap = null;
        this.handlers = new Map();
        this.after = 0;
        this.running = false;
        this.closed = false;
        this.abort = null;
    }

    subscribe(topic, handler)
    {
        const fresh = !this.handlers.has(topic);
        const remove = addHandler(this.handlers, topic, handler);
        if (fresh) this.abort?.abort();
        if (!this.running) void this.loop();
        return remove;
    }

    async publish(topic, text)
    {
        const response = await this.fetchImpl(`${this.base}/panel/publish`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ topic, text }) });
        if (!response.ok) throw new Error(`publish ${response.status}`);
    }

    wake()
    {
        this.abort?.abort();
        this.nap?.();
    }

    close()
    {
        this.closed = true;
        this.abort?.abort();
        this.nap?.();
        this.handlers.clear();
    }

    mark(status)
    {
        if (this.status === status) return;
        const before = this.status;
        this.status = status;
        this.onStatus(status, before);
    }

    async loop()
    {
        this.running = true;
        while (!this.closed && this.handlers.size > 0)
        {
            const abort = new AbortController();
            this.abort = abort;
            const waitMs = this.status === "up" ? this.settings.waitMs : 0;
            let late = false;
            const timer = setTimeout(() =>
            {
                late = true;
                abort.abort();
            }, waitMs + (this.settings.lateMs ?? hubSettings.lateMs));
            try
            {
                const response = await this.fetchImpl(`${this.base}/panel/poll`, { method: "POST", headers: { "Content-Type": "text/plain" }, signal: abort.signal,
                    body: JSON.stringify({ topics: [...this.handlers.keys()], after: this.after, waitMs }) });
                if (!response.ok) throw new Error(`poll ${response.status}`);
                const data = await response.json();
                clearTimeout(timer);
                this.after = Number.isInteger(data.seq) ? data.seq : this.after;
                this.mark("up");
                for (const message of Array.isArray(data.messages) ? data.messages : []) fanOut(this.handlers, message.topic, message.text);
            }
            catch
            {
                clearTimeout(timer);
                if (abort.signal.aborted && !late) continue;
                this.mark("down");
                await new Promise((resolve) =>
                {
                    const timer = setTimeout(resolve, this.settings.retryMs);
                    this.nap = () =>
                    {
                        clearTimeout(timer);
                        resolve();
                    };
                });
                this.nap = null;
            }
        }
        this.running = false;
        this.abort = null;
    }
}

export class MultiRelay
{
    constructor(relays)
    {
        this.relays = relays;
    }

    subscribe(topic, handler)
    {
        const removes = this.relays.map((relay) => relay.subscribe(topic, (text, heard) => handler(text, heard, relay)));
        return () =>
        {
            for (const remove of removes) remove();
        };
    }

    wake()
    {
        for (const relay of this.relays) relay.wake?.();
    }

    async publish(topic, text)
    {
        const results = await Promise.allSettled(this.relays.map((relay) => relay.publish(topic, text)));
        if (results.every((result) => result.status === "rejected")) throw results[0].reason;
    }

    close()
    {
        for (const relay of this.relays) relay.close?.();
    }
}

export class DirectRelay
{
    constructor(direct, all, onFail = () => undefined)
    {
        this.direct = direct;
        this.all = all;
        this.onFail = onFail;
        this.sent = new Set();
    }

    subscribe(topic, handler)
    {
        return this.all.subscribe(topic, handler);
    }

    wake()
    {
        this.all.wake?.();
    }

    async publish(topic, text)
    {
        const again = this.sent.has(text);
        this.sent.add(text);
        if (again)
        {
            await this.all.publish(topic, text);
            return;
        }
        try
        {
            await this.direct.publish(topic, text);
        }
        catch
        {
            this.onFail();
            await this.all.publish(topic, text);
        }
    }

    close()
    {
        this.sent.clear();
    }
}

export class MemoryBus
{
    constructor()
    {
        this.handlers = new Map();
        this.sent = [];
    }

    relay()
    {
        return {
            subscribe: (topic, handler) => addHandler(this.handlers, topic, handler),
            publish: (topic, text) =>
            {
                this.sent.push({ topic, text });
                queueMicrotask(() => fanOut(this.handlers, topic, text));
                return Promise.resolve();
            },
            close: () => undefined
        };
    }
}
