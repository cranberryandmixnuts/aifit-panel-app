import { MultiRelay } from "./hub.js";

export const defaultRelays = Object.freeze(["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt"]);
export const relaySettings = Object.freeze({ keepAliveSec: 30, connectMs: 8000, retryMs: Object.freeze([1000, 3000, 10000, 30000]), queue: 50, wakeMs: 4000 });

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const concat = (...parts) =>
{
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts)
    {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
};

const remainingLength = (length) =>
{
    const bytes = [];
    do
    {
        let byte = length % 128;
        length = Math.floor(length / 128);
        if (length > 0) byte |= 128;
        bytes.push(byte);
    }
    while (length > 0);
    return Uint8Array.from(bytes);
};

const field = (text) =>
{
    const bytes = encoder.encode(text);
    return concat(Uint8Array.of(bytes.length >> 8, bytes.length & 255), bytes);
};

const packet = (type, body) => concat(Uint8Array.of(type), remainingLength(body.length), body);

export const mqttConnect = (clientId, keepAliveSec, will = null) => packet(0x10, concat(field("MQTT"), Uint8Array.of(4, will === null ? 0x02 : 0x06, keepAliveSec >> 8, keepAliveSec & 255), field(clientId), ...will === null ? [] : [field(will.topic), field(will.text)]));
export const mqttSubscribe = (id, topic) => packet(0x82, concat(Uint8Array.of(id >> 8, id & 255), field(topic), Uint8Array.of(0)));
export const mqttUnsubscribe = (id, topic) => packet(0xa2, concat(Uint8Array.of(id >> 8, id & 255), field(topic)));
export const mqttPublish = (topic, payload) => packet(0x30, concat(field(topic), encoder.encode(payload)));
export const mqttPing = () => Uint8Array.of(0xc0, 0);
export const mqttDisconnect = () => Uint8Array.of(0xe0, 0);

export const readPackets = (buffer) =>
{
    const packets = [];
    let offset = 0;
    while (offset < buffer.length)
    {
        let multiplier = 1;
        let length = 0;
        let index = offset + 1;
        let byte = 0;
        do
        {
            if (index >= buffer.length) return { packets, rest: buffer.slice(offset) };
            byte = buffer[index++];
            length += (byte & 127) * multiplier;
            multiplier *= 128;
            if (multiplier > 128 ** 4) throw new Error("bad remaining length");
        }
        while (byte & 128);
        if (index + length > buffer.length) return { packets, rest: buffer.slice(offset) };
        packets.push({ type: buffer[offset] >> 4, flags: buffer[offset] & 15, body: buffer.slice(index, index + length) });
        offset = index + length;
    }
    return { packets, rest: new Uint8Array(0) };
};

export const readPublish = (item) =>
{
    const length = (item.body[0] << 8) | item.body[1];
    const qos = (item.flags >> 1) & 3;
    const start = 2 + length + (qos > 0 ? 2 : 0);
    return { topic: decoder.decode(item.body.slice(2, 2 + length)), payload: decoder.decode(item.body.slice(start)), qos, id: qos > 0 ? (item.body[2 + length] << 8) | item.body[3 + length] : null };
};

export const publicRelay = ({ urls = defaultRelays, WebSocketImpl = globalThis.WebSocket, settings = relaySettings, will = null, onStatus = () => undefined } = {}) =>
{
    const relays = urls.map((url) => new MqttRelay({ urls: [url], WebSocketImpl, settings, will, onStatus: () => onStatus(relays.some((relay) => relay.online) ? "online" : relays.some((relay) => relay.status === "connecting") ? "connecting" : "offline") }));
    const multi = new MultiRelay(relays);
    multi.start = () => relays.forEach((relay) => relay.start());
    multi.status = () => relays.some((relay) => relay.online) ? "online" : relays.some((relay) => relay.status === "connecting") ? "connecting" : "offline";
    return multi;
};

const clientId = () => `aifit-${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

export class MqttRelay
{
    constructor({ urls = defaultRelays, WebSocketImpl = globalThis.WebSocket, settings = relaySettings, will = null, onStatus = () => undefined } = {})
    {
        this.urls = [...urls];
        this.will = will;
        this.WebSocketImpl = WebSocketImpl;
        this.settings = settings;
        this.onStatus = onStatus;
        this.handlers = new Map();
        this.pending = [];
        this.status = "idle";
        this.url = null;
        this.socket = null;
        this.buffer = new Uint8Array(0);
        this.closed = false;
        this.started = false;
        this.urlIndex = 0;
        this.attempt = 0;
        this.nextId = 1;
        this.pingTimer = null;
        this.connectTimer = null;
        this.retryTimer = null;
        this.wakeTimer = null;
        this.heardAt = 0;
    }

    get online()
    {
        return this.status === "online";
    }

    start()
    {
        if (this.started || this.closed) return;
        this.started = true;
        this.connect();
    }

    subscribe(topic, handler)
    {
        let set = this.handlers.get(topic);
        if (set === undefined)
        {
            set = new Set();
            this.handlers.set(topic, set);
            if (this.online) this.send(mqttSubscribe(this.packetId(), topic));
        }
        set.add(handler);
        this.start();
        return () =>
        {
            set.delete(handler);
            if (set.size > 0 || this.handlers.get(topic) !== set) return;
            this.handlers.delete(topic);
            if (this.online) this.send(mqttUnsubscribe(this.packetId(), topic));
        };
    }

    publish(topic, text)
    {
        const bytes = mqttPublish(topic, text);
        if (this.online) this.send(bytes);
        else
        {
            this.pending.push(bytes);
            if (this.pending.length > this.settings.queue) this.pending.shift();
        }
        this.start();
        return Promise.resolve();
    }

    wake()
    {
        if (this.closed || !this.started) return;
        if (this.status === "offline")
        {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
            this.attempt = 0;
            this.connect();
            return;
        }
        if (!this.online || this.wakeTimer !== null) return;
        const asked = Date.now();
        this.send(mqttPing());
        this.wakeTimer = setTimeout(() =>
        {
            this.wakeTimer = null;
            if (!this.online || this.heardAt >= asked) return;
            this.attempt = 0;
            this.drop();
        }, this.settings.wakeMs ?? relaySettings.wakeMs);
    }

    close()
    {
        this.closed = true;
        this.clearTimers();
        if (this.online) this.send(mqttDisconnect());
        this.socket?.close();
        this.socket = null;
        this.setStatus("closed");
    }

    packetId()
    {
        const id = this.nextId;
        this.nextId = this.nextId % 65535 + 1;
        return id;
    }

    setStatus(status)
    {
        if (this.status === status) return;
        this.status = status;
        this.onStatus(status, this.url);
    }

    send(bytes)
    {
        try
        {
            this.socket.send(bytes);
        }
        catch
        {
            this.drop();
        }
    }

    clearTimers()
    {
        for (const timer of ["pingTimer", "connectTimer", "retryTimer", "wakeTimer"])
        {
            if (this[timer] === null) continue;
            clearTimeout(this[timer]);
            clearInterval(this[timer]);
            this[timer] = null;
        }
    }

    connect()
    {
        if (this.closed) return;
        this.url = this.urls[this.urlIndex % this.urls.length];
        this.setStatus("connecting");
        this.buffer = new Uint8Array(0);
        let socket;
        try
        {
            socket = new this.WebSocketImpl(this.url, ["mqtt"]);
        }
        catch
        {
            this.drop();
            return;
        }
        this.socket = socket;
        socket.binaryType = "arraybuffer";
        socket.onopen = () => this.send(mqttConnect(clientId(), this.settings.keepAliveSec, this.will));
        socket.onmessage = (event) => this.receive(event.data);
        socket.onclose = () => this.socket === socket && this.drop();
        socket.onerror = () => this.socket === socket && this.drop();
        this.connectTimer = setTimeout(() => this.socket === socket && this.drop(), this.settings.connectMs);
    }

    drop()
    {
        const socket = this.socket;
        this.socket = null;
        this.clearTimers();
        if (socket !== null && socket.readyState < 2) socket.close();
        if (this.closed) return;
        this.setStatus("offline");
        ++this.urlIndex;
        const delays = this.settings.retryMs;
        this.retryTimer = setTimeout(() => this.connect(), delays[Math.min(this.attempt, delays.length - 1)]);
        ++this.attempt;
    }

    receive(data)
    {
        this.heardAt = Date.now();
        const bytes = typeof data === "string" ? encoder.encode(data) : new Uint8Array(data);
        const read = readPackets(concat(this.buffer, bytes));
        this.buffer = read.rest;
        for (const item of read.packets)
        {
            if (item.type === 2) this.connected(item.body[1]);
            else if (item.type === 3) this.deliver(readPublish(item));
        }
    }

    connected(code)
    {
        if (code !== 0)
        {
            this.drop();
            return;
        }
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
        this.attempt = 0;
        this.setStatus("online");
        for (const topic of this.handlers.keys()) this.send(mqttSubscribe(this.packetId(), topic));
        for (const bytes of this.pending.splice(0)) this.send(bytes);
        this.pingTimer = setInterval(() =>
        {
            if (!this.online) return;
            if (Date.now() - this.heardAt > this.settings.keepAliveSec * 1500) this.drop();
            else this.send(mqttPing());
        }, this.settings.keepAliveSec * 800);
    }

    deliver(message)
    {
        for (const handler of [...this.handlers.get(message.topic) ?? []]) handler(message.payload, message.topic);
    }
}
