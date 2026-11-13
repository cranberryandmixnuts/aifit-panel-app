import { linkKey, randomId, seal, sealBytes, unseal, unsealBytes } from "./seal.js";

export const screenSettings = Object.freeze({ fps: 8, width: 1280, minWidth: 320, maxWidth: 1920, viewMs: 5000, events: 40, seen: 400 });
export const screenPaths = Object.freeze({ frame: "/panel/screen/frame", input: "/panel/screen/input" });

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isSize = (value) => Number.isInteger(value) && value > 0 && value <= 10000;

export const isScreenEvent = (value) => isRecord(value) && (value.type === "down" || value.type === "move" || value.type === "up")
    && Number.isFinite(value.x) && Number.isFinite(value.y) && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1;

export const screenWidth = (value, settings = screenSettings) => Number.isFinite(value) ? Math.min(settings.maxWidth, Math.max(settings.minWidth, Math.round(value / 16) * 16)) : settings.width;

export const packFrame = ({ seq, width, height, session, jpeg }) =>
{
    const head = encoder.encode(JSON.stringify({ seq, width, height, session }));
    const out = new Uint8Array(4 + head.length + jpeg.length);
    new DataView(out.buffer).setUint32(0, head.length);
    out.set(head, 4);
    out.set(jpeg, 4 + head.length);
    return out;
};

export const unpackFrame = (bytes) =>
{
    if (bytes.length < 4) throw new Error("bad frame");
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (size > bytes.length - 4) throw new Error("bad frame");
    const head = JSON.parse(decoder.decode(bytes.subarray(4, 4 + size)));
    if (!isRecord(head) || !Number.isInteger(head.seq) || !isSize(head.width) || !isSize(head.height) || typeof head.session !== "string") throw new Error("bad frame");
    return { seq: head.seq, width: head.width, height: head.height, session: head.session, jpeg: bytes.subarray(4 + size) };
};

export class ScreenHost
{
    constructor({ frame, input, device, settings = screenSettings, onViewers = () => undefined, now = Date.now })
    {
        this.capture = frame;
        this.apply = input;
        this.device = device;
        this.settings = { ...screenSettings, ...settings };
        this.onViewers = onViewers;
        this.now = now;
        this.session = randomId(12);
        this.keys = new Map();
        this.seen = [];
        this.viewing = new Map();
        this.last = null;
        this.busy = null;
        this.seq = 0;
        this.timer = null;
        this.closed = false;
    }

    viewers()
    {
        return [...this.viewing.values()].map(({ device, name }) => ({ device, name }));
    }

    async handle(path, text)
    {
        let request;
        try
        {
            request = JSON.parse(text);
        }
        catch
        {
            return { status: 400, json: { ok: false } };
        }
        const found = isRecord(request) && typeof request.channel === "string" && typeof request.text === "string" ? this.device(request.channel) : null;
        if (found === null || this.closed) return { status: 403, json: { ok: false } };
        const key = await this.keyOf(found);
        const message = await unseal(key, request.text).catch(() => null);
        if (!isRecord(message) || typeof message.id !== "string") return { status: 403, json: { ok: false } };
        if (path === screenPaths.frame && message.type === "frame") return this.frame(found, key, message);
        if (path === screenPaths.input && message.type === "input") return this.input(found, message);
        return { status: 400, json: { ok: false } };
    }

    async frame(found, key, message)
    {
        this.view(found);
        const width = screenWidth(message.width, this.settings);
        const after = Number.isInteger(message.after) ? message.after : 0;
        let shot = this.last;
        if (shot === null || shot.seq <= after || shot.wanted !== width)
        {
            const wait = shot === null ? 0 : shot.at + 1000 / this.settings.fps - this.now();
            if (wait > 0) await sleep(wait);
            shot = this.last !== null && this.last.seq > after && this.last.wanted === width ? this.last : await this.shoot(width);
        }
        if (shot === null) return { status: 204 };
        return { status: 200, binary: await sealBytes(key, packFrame({ seq: shot.seq, width: shot.width, height: shot.height, session: this.session, jpeg: shot.jpeg })) };
    }

    shoot(width)
    {
        if (this.busy !== null) return this.busy;
        this.busy = (async () =>
        {
            try
            {
                const at = this.now();
                const made = await this.capture(width);
                if (!isRecord(made) || !(made.jpeg instanceof Uint8Array) || made.jpeg.length === 0 || !isSize(made.width) || !isSize(made.height)) return null;
                this.last = { seq: ++this.seq, at, wanted: width, width: made.width, height: made.height, jpeg: made.jpeg };
                return this.last;
            }
            catch
            {
                return null;
            }
            finally
            {
                this.busy = null;
            }
        })();
        return this.busy;
    }

    input(found, message)
    {
        if (message.session !== this.session || !this.fresh(message.id)) return { status: 409, json: { ok: false } };
        if (message.stop === true)
        {
            this.leave(found.device);
            return { status: 200, json: { ok: true } };
        }
        const events = Array.isArray(message.events) ? message.events.filter(isScreenEvent).slice(0, this.settings.events).map(({ type, x, y }) => ({ type, x, y })) : [];
        if (events.length > 0) this.apply(events, { device: found.device, name: found.name });
        return { status: 200, json: { ok: true } };
    }

    view(found)
    {
        const fresh = !this.viewing.has(found.device);
        this.viewing.set(found.device, { device: found.device, name: found.name, at: this.now() });
        if (fresh) this.onViewers(this.viewers(), { action: "start", device: found.device, name: found.name });
        if (this.timer !== null) return;
        this.timer = setInterval(() =>
        {
            const oldest = this.now() - this.settings.viewMs;
            for (const item of [...this.viewing.values()]) if (item.at < oldest) this.leave(item.device);
        }, 1000);
        this.timer.unref?.();
    }

    leave(device)
    {
        const item = this.viewing.get(device);
        if (item === undefined) return;
        this.viewing.delete(device);
        this.onViewers(this.viewers(), { action: "stop", device: item.device, name: item.name });
        if (this.viewing.size > 0) return;
        clearInterval(this.timer);
        this.timer = null;
        this.last = null;
    }

    fresh(id)
    {
        if (this.seen.includes(id)) return false;
        this.seen.push(id);
        if (this.seen.length > this.settings.seen) this.seen.shift();
        return true;
    }

    keyOf(found)
    {
        if (!this.keys.has(found.channel)) this.keys.set(found.channel, linkKey(found.key));
        return this.keys.get(found.channel);
    }

    close()
    {
        this.closed = true;
        clearInterval(this.timer);
        this.timer = null;
        this.viewing.clear();
        this.last = null;
    }
}

export class ScreenView
{
    constructor({ base, pairing, fetchImpl = (...args) => globalThis.fetch(...args) })
    {
        this.base = base.replace(/\/+$/, "");
        this.pairing = pairing;
        this.fetchImpl = fetchImpl;
        this.key = linkKey(pairing.key);
        this.session = null;
    }

    async post(path, body, signal)
    {
        const text = await seal(await this.key, { ...body, id: randomId() });
        return this.fetchImpl(`${this.base}${path}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ channel: this.pairing.channel, text }), signal });
    }

    async frame(after = 0, width = screenSettings.width, signal = undefined)
    {
        const response = await this.post(screenPaths.frame, { type: "frame", after, width }, signal);
        if (response.status === 204) return null;
        if (!response.ok) throw Object.assign(new Error(`screen ${response.status}`), { status: response.status });
        const frame = unpackFrame(await unsealBytes(await this.key, new Uint8Array(await response.arrayBuffer())));
        this.session = frame.session;
        return frame;
    }

    async input(events)
    {
        if (this.session === null || events.length === 0) return false;
        const response = await this.post(screenPaths.input, { type: "input", session: this.session, events });
        return response.ok;
    }

    async stop()
    {
        if (this.session === null) return;
        await this.post(screenPaths.input, { type: "input", session: this.session, stop: true }).catch(() => undefined);
    }
}
