import { isDocProfile } from "./profiles.js";

export const panelFormat = "aifit-panel";
export const panelVersion = 1;
export const blockTypes = Object.freeze(["stats", "line", "bars", "table", "text", "chips", "form", "actions"]);

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value, max = 2000) => typeof value === "string" && value.length <= max;
const isCell = (value) => isText(value, 400) || (typeof value === "number" && Number.isFinite(value));
const optionalText = (value, max) => value === undefined || isText(value, max);
const listOf = (value, check, max = 500) => Array.isArray(value) && value.length <= max && value.every(check);

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isOption = (option) => isRecord(option) && isCell(option.value) && isText(option.label, 80);
const isRange = (range) => isRecord(range) && isNumber(range.min) && isNumber(range.max) && isNumber(range.step) && range.step > 0 && range.min <= range.max && optionalText(range.unit, 20);
const isField = (field) => isRecord(field) && isText(field.key, 60) && isText(field.label, 80) && optionalText(field.help, 600) && isCell(field.value) && optionalText(field.shown, 120)
    && (field.options === undefined || listOf(field.options, isOption, 60)) && (field.range === undefined || isRange(field.range)) && (field.readonly === undefined || typeof field.readonly === "boolean");

const blockChecks = {
    stats: (block) => listOf(block.items, (item) => isRecord(item) && isText(item.label, 80) && isCell(item.value) && optionalText(item.unit, 20), 24),
    line: (block) => optionalText(block.unit, 20) && (block.max === undefined || (typeof block.max === "number" && block.max > 0))
        && listOf(block.points, (point) => isRecord(point) && isText(point.x, 40) && typeof point.y === "number" && Number.isFinite(point.y), 400),
    bars: (block) => optionalText(block.unit, 20) && listOf(block.items, (item) => isRecord(item) && isText(item.label, 80) && typeof item.value === "number" && Number.isFinite(item.value)
        && (item.max === undefined || (typeof item.max === "number" && item.max > 0)) && optionalText(item.text, 80), 60),
    table: (block) => listOf(block.columns, (column) => isText(column, 80), 20) && listOf(block.rows, (row) => listOf(row, isCell, 20), 500),
    text: (block) => isText(block.text, 4000),
    chips: (block) => listOf(block.items, (item) => isRecord(item) && isText(item.label, 80) && (item.tone === undefined || ["good", "warn", "plain"].includes(item.tone)), 60),
    form: (block) => optionalText(block.id, 60) && optionalText(block.revision, 80) && optionalText(block.submit, 40) && optionalText(block.note, 300)
        && listOf(block.groups, (group) => isRecord(group) && isText(group.title, 80) && listOf(group.fields, isField, 80), 20),
    actions: (block) => optionalText(block.text, 400)
        && listOf(block.items, (item) => isRecord(item) && isText(item.id, 40) && item.id.trim() !== "" && isText(item.label, 40) && (item.tone === undefined || ["primary", "plain", "warn"].includes(item.tone)), 8)
};

export const isPanelBlock = (block) => isRecord(block) && isText(block.type, 40) && optionalText(block.title, 120) && (!Object.hasOwn(blockChecks, block.type) || blockChecks[block.type](block));

export const isPanelDoc = (value) => isRecord(value) && value.format === panelFormat && Number.isInteger(value.version) && value.version >= 1
    && isRecord(value.game) && isText(value.game.id, 60) && isText(value.game.name, 80) && optionalText(value.game.device, 80) && optionalText(value.game.build, 80) && isText(value.madeAt, 40)
    && listOf(value.pages, (page) => isRecord(page) && isText(page.id, 120) && isText(page.title, 80) && optionalText(page.group, 80) && optionalText(page.scope, 120) && listOf(page.blocks, isPanelBlock, 40), 400)
    && (value.profiles === undefined || (listOf(value.profiles, isDocProfile, 200) && new Set(value.profiles.map((item) => item.id)).size === value.profiles.length))
    && (value.language === undefined || (isRecord(value.language) && isText(value.language.id, 12) && isText(value.language.at, 40) && !Number.isNaN(Date.parse(value.language.at))));

export const pageGroups = (doc) =>
{
    const groups = [];
    for (const page of doc.pages)
    {
        const name = page.group ?? "";
        let group = groups.find((item) => item.name === name);
        if (group === undefined) groups.push(group = { name, pages: [] });
        group.pages.push(page);
    }
    return groups;
};

export const maxRangeChoices = 200;

export const fieldChoices = (field) =>
{
    if (field.readonly === true) return [];
    if (field.options !== undefined) return field.options.map((option) => ({ value: option.value, label: option.label }));
    if (field.range === undefined) return [];
    const { min, max, step, unit = "" } = field.range;
    const count = Math.floor((max - min) / step + 1e-9) + 1;
    if (count > maxRangeChoices) return [];
    return Array.from({ length: count }, (_, index) =>
    {
        const value = Math.round((min + index * step) * 1e6) / 1e6;
        return { value, label: `${value}${unit}` };
    });
};

export const isEditableForm = (block) => block.type === "form" && typeof block.id === "string" && block.groups.some((group) => group.fields.some((field) => fieldChoices(field).length > 0));
