import { blockTypes, fieldChoices, isEditableForm } from "./doc.js";
import { panelText } from "./text.js";

export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

const title = (block) => block.title === undefined ? "" : `<h3>${escapeHtml(block.title)}</h3>`;
const number = (value) => typeof value === "number" ? String(Math.round(value * 10) / 10) : escapeHtml(value);
const empty = () => `<p class="pv-empty">${panelText("아직 기록이 없어요.")}</p>`;

const stats = (block) => `<div class="pv-stats">${block.items.map((item) => `<div class="pv-stat"><span>${escapeHtml(item.label)}</span><b>${number(item.value)}${item.unit === undefined ? "" : `<small>${escapeHtml(item.unit)}</small>`}</b></div>`).join("")}</div>`;

const line = (block) =>
{
    if (block.points.length === 0) return empty();
    const unit = escapeHtml(block.unit ?? "");
    const top = block.max ?? Math.max(1, ...block.points.map((point) => point.y));
    const x = (index) => block.points.length === 1 ? 50 : index * 100 / (block.points.length - 1);
    const y = (value) => 100 - Math.max(0, Math.min(1, value / top)) * 100;
    const at = (point, index) => `${x(index).toFixed(2)} ${y(point.y).toFixed(2)}`;
    const first = block.points[0];
    const last = block.points[block.points.length - 1];
    const best = Math.max(...block.points.map((point) => point.y));
    const bold = (value) => `<b>${number(value)}${unit}</b>`;
    const note = block.points.length === 1 ? panelText("기록 1개 {value}", { value: bold(first.y) })
        : panelText("처음 {first} · 마지막 {last} · 가장 높음 {best}", { first: bold(first.y), last: bold(last.y), best: bold(best) });
    return `<div class="pv-chart">`
        + `<div class="pv-axis-y" aria-hidden="true"><span style="top:0%">${number(top)}${unit}</span><span style="top:50%">${number(top / 2)}${unit}</span><span style="top:100%">0${unit}</span></div>`
        + `<svg class="pv-plot" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(block.title ?? panelText("추이"))}">`
        + `<path class="pv-grid" d="M0 0H100M0 50H100M0 100H100"/>`
        + `<polyline points="${block.points.map((point, index) => at(point, index).replace(" ", ",")).join(" ")}"/>`
        + block.points.map((point, index) => `<path class="pv-dot" d="M${at(point, index)}h0"><title>${escapeHtml(point.x)} · ${number(point.y)}${unit}</title></path>`).join("")
        + `</svg>`
        + `<div class="pv-axis-x" aria-hidden="true"><span>${escapeHtml(first.x)}</span>${block.points.length > 1 ? `<span>${escapeHtml(last.x)}</span>` : ""}</div>`
        + `</div><p class="pv-chart-note">${note}</p>`;
};

const bars = (block) => block.items.length === 0 ? empty()
    : `<div class="pv-bars">${block.items.map((item) =>
    {
        const share = Math.max(0, Math.min(1, item.value / (item.max ?? 100)));
        return `<div class="pv-bar"><span>${escapeHtml(item.label)}</span><i><b style="width:${(share * 100).toFixed(1)}%"></b></i><em>${escapeHtml(item.text ?? `${number(item.value)}${block.unit ?? ""}`)}</em></div>`;
    }).join("")}</div>`;

const table = (block) =>
{
    if (block.rows.length === 0) return empty();
    const numeric = block.columns.map((_, index) => block.rows.every((row) => typeof row[index] === "number"));
    const kind = (index) => numeric[index] ? " class=\"pv-num\"" : "";
    return `<div class="pv-table"><table><thead><tr>${block.columns.map((column, index) => `<th${kind(index)}>${escapeHtml(column)}</th>`).join("")}</tr></thead>`
        + `<tbody>${block.rows.map((row) => `<tr>${row.map((value, index) => `<td${kind(index)}>${number(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
};

const text = (block) => `<p class="pv-text">${escapeHtml(block.text).replace(/\n/g, "<br>")}</p>`;

const chips = (block) => `<div class="pv-chips">${block.items.map((item) => `<span class="pv-chip" data-tone="${escapeHtml(item.tone ?? "plain")}">${escapeHtml(item.label)}</span>`).join("")}</div>`;

const form = (block) => block.groups.map((group) => `<section class="pv-form"><h4>${escapeHtml(group.title)}</h4><dl>${group.fields.map((field) =>
    `<div><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.shown ?? String(field.value))}</dd>${field.help === undefined ? "" : `<p>${escapeHtml(field.help)}</p>`}</div>`).join("")}</dl></section>`).join("");

const editField = (field) =>
{
    const help = field.help === undefined ? "" : `<small>${escapeHtml(field.help)}</small>`;
    const choices = fieldChoices(field);
    if (choices.length === 0) return `<div class="pv-field" data-readonly="true"><span>${escapeHtml(field.label)}</span><b>${escapeHtml(field.shown ?? String(field.value))}</b>${help}</div>`;
    const all = choices.some((choice) => choice.value === field.value) ? choices : [{ value: field.value, label: field.shown ?? String(field.value) }, ...choices];
    const options = all.map((choice) => `<option${choice.value === field.value ? " selected" : ""}>${escapeHtml(choice.label)}</option>`).join("");
    return `<label class="pv-field"><span>${escapeHtml(field.label)}</span><select class="pv-input" data-key="${escapeHtml(field.key)}" data-start="${all.findIndex((choice) => choice.value === field.value)}" data-choices="${escapeHtml(JSON.stringify(all.map((choice) => choice.value)))}">${options}</select>${help}</label>`;
};

const editForm = (block) => `<form class="pv-edit" data-form="${escapeHtml(block.id)}" data-revision="${escapeHtml(block.revision ?? "")}">`
    + block.groups.map((group) => `<section class="pv-form"><h4>${escapeHtml(group.title)}</h4><div class="pv-fields">${group.fields.map(editField).join("")}</div></section>`).join("")
    + `<div class="pv-submit">${block.note === undefined ? "" : `<p class="pv-submit-note">${escapeHtml(block.note)}</p>`}<span class="pv-changed" aria-live="polite"></span>`
    + `<button type="button" class="pv-reset" disabled>${panelText("되돌리기")}</button><button type="submit" class="pv-apply" disabled>${escapeHtml(block.submit ?? panelText("적용"))}</button></div></form>`;

const actions = (block) => `<div class="pv-actions">${block.text === undefined ? "" : `<p class="pv-text">${escapeHtml(block.text).replace(/\n/g, "<br>")}</p>`}`
    + (block.items.length === 0 ? "" : `<div class="pv-action-row">${block.items.map((item) =>
        `<button type="button" class="pv-action" data-action="${escapeHtml(item.id)}" data-tone="${escapeHtml(item.tone ?? "primary")}">${escapeHtml(item.label)}</button>`).join("")}</div>`)
    + `</div>`;

const renderers = { stats, line, bars, table, text, chips, form, actions };

export const renderBlock = (block, options = {}) =>
{
    if (!blockTypes.includes(block.type)) return `<section class="pv-block" data-type="unknown">${title(block)}<p class="pv-empty">${panelText("이 앱에서 아직 못 보는 칸이에요. 앱을 새로 받아 주세요.")}</p></section>`;
    const body = options.edit === true && isEditableForm(block) ? editForm(block) : renderers[block.type](block);
    return `<section class="pv-block" data-type="${escapeHtml(block.type)}">${title(block)}${body}</section>`;
};

export const renderPage = (page, options = {}) => page.blocks.length === 0 ? `<p class="pv-empty">${panelText("보여 줄 내용이 없어요.")}</p>` : page.blocks.map((block) => renderBlock(block, options)).join("");

export const formChanges = (form) =>
{
    const values = {};
    for (const select of form.querySelectorAll("select.pv-input"))
    {
        const choices = JSON.parse(select.dataset.choices);
        if (select.selectedIndex !== Number(select.dataset.start)) values[select.dataset.key] = choices[select.selectedIndex];
    }
    return { form: form.dataset.form, revision: form.dataset.revision === "" ? null : form.dataset.revision, values };
};
