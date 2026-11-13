import { isIndicatorReport } from "./indicators.js";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value, max) => typeof value === "string" && value.length >= 1 && value.length <= max;
const isTime = (value) => typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

export const sharedIdPrefix = "sp_";
export const sharedProfileLimits = Object.freeze({ list: 200, name: 20, deleted: 500, settingsChars: 8000, settingsPerDoc: 20 });

export const makeSharedId = () =>
{
    const bytes = new Uint8Array(12);
    globalThis.crypto.getRandomValues(bytes);
    return sharedIdPrefix + [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
};

export const isSharedId = (value) => typeof value === "string" && /^sp_[a-z0-9]{12}$/.test(value);
export const cleanSharedName = (value) =>
{
    if (typeof value !== "string") return null;
    const name = value.replace(/\s+/g, " ").trim();
    return name.length >= 1 && name.length <= sharedProfileLimits.name && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
};

export const isSharedSettings = (value) => isRecord(value) && Object.keys(value).length === 2 && isTime(value.at) && isRecord(value.data)
    && JSON.stringify(value.data).length <= sharedProfileLimits.settingsChars;
export const isSharedProfile = (value) => isRecord(value) && isSharedId(value.id) && isText(value.name, sharedProfileLimits.name) && cleanSharedName(value.name) === value.name
    && isTime(value.createdAt) && isTime(value.updatedAt) && (value.settingsAt === undefined || isTime(value.settingsAt)) && (value.settings === undefined || isSharedSettings(value.settings))
    && (value.indicatorsAt === undefined || isTime(value.indicatorsAt));
export const isSharedProfileList = (value) => Array.isArray(value) && value.length <= sharedProfileLimits.list && value.every(isSharedProfile)
    && new Set(value.map((item) => item.id)).size === value.length;
export const isDeletedList = (value) => Array.isArray(value) && value.length <= sharedProfileLimits.deleted && value.every(isSharedId);
export const isDocProfile = (value) => isSharedProfile(value) && isText(value.scope, 120);

const newer = (first, second) => second === undefined || second === null || Date.parse(first) > Date.parse(second);

export const planSharedSync = (local, incoming, deleted = []) =>
{
    const plan = { create: [], rename: [], link: [], remove: [], settings: [] };
    const gone = new Set(isDeletedList(deleted) ? deleted : []);
    for (const entry of local) if (entry.linked && gone.has(entry.sharedId)) plan.remove.push({ key: entry.key });
    if (!isSharedProfileList(incoming)) return plan;
    const listed = incoming.filter((item) => !gone.has(item.id));
    const taken = new Set(local.map((item) => item.sharedId));
    const settle = (entry, item) =>
    {
        if (item.settings !== undefined && newer(item.settings.at, entry?.settingsAt)) plan.settings.push({ key: entry.key, at: item.settings.at, data: item.settings.data });
    };
    for (const item of listed)
    {
        const known = local.find((entry) => entry.sharedId === item.id && !gone.has(entry.sharedId));
        if (known !== undefined)
        {
            if (!known.linked) plan.link.push({ key: known.key, id: item.id, updatedAt: newer(item.updatedAt, known.updatedAt) ? item.updatedAt : known.updatedAt });
            if (known.name !== item.name && (!known.linked || newer(item.updatedAt, known.updatedAt))) plan.rename.push({ key: known.key, name: item.name, updatedAt: item.updatedAt });
            settle(known, item);
            continue;
        }
        if (taken.has(item.id)) continue;
        taken.add(item.id);
        plan.create.push({ id: item.id, name: item.name, createdAt: item.createdAt, updatedAt: item.updatedAt, ...item.settings === undefined ? {} : { settings: item.settings } });
    }
    return plan;
};

export const docSettings = (profiles, known) =>
{
    let left = sharedProfileLimits.settingsPerDoc;
    return profiles.map((item) =>
    {
        if (item.settings === undefined || left === 0 || !newer(item.settings.at, known.get(item.id))) return { ...item, settings: undefined };
        --left;
        return item;
    }).map(({ settings, ...item }) => settings === undefined ? item : { ...item, settings });
};

export const mergeRegistry = (registry, channel, listed, options = {}) =>
{
    const gone = new Set(options.deleted ?? []);
    const game = options.game ?? null;
    const next = registry.map((item) => ({ ...item, games: { ...item.games }, settings: { ...item.settings }, seen: { ...item.seen }, indicators: { ...item.indicators } }));
    const seen = new Set();
    for (const item of listed)
    {
        if (gone.has(item.id)) continue;
        let entry = next.find((candidate) => candidate.id === item.id);
        if (entry === undefined)
        {
            entry = { id: item.id, name: item.name, createdAt: item.createdAt, updatedAt: item.updatedAt, games: {}, settings: {}, seen: {}, indicators: {} };
            next.push(entry);
        }
        else if (entry.name !== item.name && newer(item.updatedAt, entry.updatedAt))
        {
            entry.name = item.name;
            entry.updatedAt = item.updatedAt;
        }
        entry.games[channel] = item.scope;
        if (item.settingsAt !== undefined) entry.seen[channel] = item.settingsAt;
        if (game !== null && item.settings !== undefined && newer(item.settings.at, entry.settings[game]?.at)) entry.settings[game] = { at: item.settings.at, data: item.settings.data };
        if (game !== null && isIndicatorReport(item.indicators) && newer(item.indicators.at, entry.indicators[game]?.at)) entry.indicators[game] = { at: item.indicators.at, items: item.indicators.items.map((part) => ({ ...part })) };
        seen.add(entry.id);
    }
    for (const entry of next) if (!seen.has(entry.id) && typeof entry.games[channel] === "string") entry.games[channel] = null;
    return next;
};

export const registryForGame = (registry, channel, game = null) => registry.slice(0, sharedProfileLimits.list).map((item) =>
{
    const stored = game === null ? undefined : item.settings?.[game];
    const behind = stored !== undefined && newer(stored.at, item.seen?.[channel]);
    const reported = game === null ? undefined : item.indicators?.[game];
    return { id: item.id, name: item.name, createdAt: item.createdAt, updatedAt: item.updatedAt, ...stored === undefined ? {} : { settingsAt: stored.at }, ...behind ? { settings: { at: stored.at, data: stored.data } } : {},
        ...reported === undefined ? {} : { indicatorsAt: reported.at } };
});

export const ownerLimit = 20;
const cleanOwners = (list) => [...new Set(list.filter((item) => typeof item === "string" && item.length >= 1 && item.length <= 64))].slice(-ownerLimit);
export const isOwnerList = (value) => value === null || (Array.isArray(value) && value.length <= ownerLimit && value.every((item) => typeof item === "string" && item.length >= 1 && item.length <= 64));
export const linkedOwners = (owners, paired) => owners === null || owners === undefined ? cleanOwners([...paired]) : cleanOwners(owners);
export const ownersListed = (owners, paired, device) => cleanOwners([...linkedOwners(owners, paired), device]);
export const isLinkedShown = (owners, paired) => linkedOwners(owners, paired).some((item) => paired.includes(item));

export const removeFromRegistry = (registry, deleted, id) => ({ registry: registry.filter((item) => item.id !== id), deleted: [id, ...deleted.filter((item) => item !== id)].slice(0, sharedProfileLimits.deleted) });
