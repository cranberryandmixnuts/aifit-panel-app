const encoder = new TextEncoder();
const decoder = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

export const pairCodeDigits = 8;
export const confirmDigits = 4;

export const toBase64Url = (bytes) =>
{
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const fromBase64Url = (text) =>
{
    if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error("bad base64url");
    const plain = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    return Uint8Array.from(plain, (character) => character.charCodeAt(0));
};

export const randomBytes = (count) => globalThis.crypto.getRandomValues(new Uint8Array(count));
export const randomId = (count = 16) => toBase64Url(randomBytes(count));
export const newPairCode = () => Array.from(randomBytes(pairCodeDigits), (byte) => String(byte % 10)).join("");
export const normalizeCode = (text) => String(text).replace(/\D/g, "");
export const isPairCode = (text) => normalizeCode(text).length === pairCodeDigits;
export const showCode = (code) => `${code.slice(0, 4)} ${code.slice(4)}`;
export const pairTokenBytes = 9;
export const pairQrMark = "AFP1";
export const newPairToken = () => randomId(pairTokenBytes);
export const isPairToken = (text) => typeof text === "string" && text.length === pairTokenBytes / 3 * 4 && /^[A-Za-z0-9_-]+$/.test(text);
export const pairQrText = (code, token) => `${pairQrMark}-${normalizeCode(code)}-${token}`;
export const readPairQr = (text) =>
{
    const parts = typeof text === "string" ? text.trim().split("-") : [];
    const [mark, code] = parts;
    const token = parts.slice(2).join("-");
    return mark === pairQrMark && /^\d+$/.test(code ?? "") && code.length === pairCodeDigits && isPairToken(token) ? { code, token } : null;
};

const sha256 = async (text) => new Uint8Array(await subtle().digest("SHA-256", encoder.encode(text)));

export const codeTopic = async (code) => toBase64Url((await sha256(`aifit-panel/pair-topic/${normalizeCode(code)}`)).slice(0, 18));

export const codeKey = async (code) =>
{
    const base = await subtle().importKey("raw", encoder.encode(normalizeCode(code)), "PBKDF2", false, ["deriveKey"]);
    return subtle().deriveKey({ name: "PBKDF2", salt: encoder.encode("aifit-panel/pair-key/v1"), iterations: 150000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
};

export const tokenKey = async (code, token) =>
{
    const base = await subtle().importKey("raw", encoder.encode(`${normalizeCode(code)}|${token}`), "HKDF", false, ["deriveKey"]);
    return subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt: encoder.encode("aifit-panel/pair-qr-key/v1"), info: encoder.encode("pair") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
};

export const newKeyPair = async () =>
{
    const pair = await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    return { privateKey: pair.privateKey, publicKey: toBase64Url(new Uint8Array(await subtle().exportKey("raw", pair.publicKey))) };
};

export const agreeKey = async (privateKey, peerPublic, gamePublic, appPublic) =>
{
    const peer = await subtle().importKey("raw", fromBase64Url(peerPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
    const secret = await subtle().deriveBits({ name: "ECDH", public: peer }, privateKey, 256);
    const material = await subtle().importKey("raw", secret, "HKDF", false, ["deriveBits"]);
    const bits = await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: await sha256(`${gamePublic}|${appPublic}`), info: encoder.encode("aifit-panel/link-key/v1") }, material, 256);
    return toBase64Url(new Uint8Array(bits));
};

export const linkKey = (raw) => subtle().importKey("raw", fromBase64Url(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);

export const confirmNumber = async (gamePublic, appPublic) =>
{
    const hash = await sha256(`aifit-panel/confirm/${gamePublic}|${appPublic}`);
    return String(((hash[0] << 16) | (hash[1] << 8) | hash[2]) % 10 ** confirmDigits).padStart(confirmDigits, "0");
};

export const seal = async (key, value, iv = randomBytes(12)) =>
{
    const data = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(value))));
    return JSON.stringify({ v: 1, iv: toBase64Url(iv), data: toBase64Url(data) });
};

export const sealBytes = async (key, bytes, iv = randomBytes(12)) =>
{
    const data = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, bytes));
    const out = new Uint8Array(iv.length + data.length);
    out.set(iv);
    out.set(data, iv.length);
    return out;
};

export const unsealBytes = async (key, bytes) =>
{
    if (bytes.length < 28) throw new Error("bad envelope");
    return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)));
};

export const unseal = async (key, text) =>
{
    const envelope = JSON.parse(text);
    if (envelope === null || typeof envelope !== "object" || envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.data !== "string") throw new Error("bad envelope");
    const plain = await subtle().decrypt({ name: "AES-GCM", iv: fromBase64Url(envelope.iv) }, key, fromBase64Url(envelope.data));
    return JSON.parse(decoder.decode(plain));
};
