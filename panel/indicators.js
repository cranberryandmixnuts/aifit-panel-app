const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isTime = (value) => typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
const unit = (value) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
const dayMs = 86_400_000;

export const indicatorLimits = Object.freeze({ perDoc: 20, samples: 100000, weightSamples: 400, halfLifeDays: 45, enoughSamples: 20, easiest: 0.4 });

export const indicators = Object.freeze([
    {
        id: "attention", code: "b1400", title: "Sustaining attention",
        name: { ko: "주의 지속", en: "Sustaining attention" },
        about: { ko: "해야 할 일이 이어지는 동안 주의를 놓지 않고 계속 반응하는 기능이에요.", en: "Keeping attention on a task for as long as it goes on." },
        high: { ko: "과제가 길어져도 반응이 끊기거나 줄지 않고 끝까지 이어져요.", en: "Responses stay steady to the end even when the task is long." },
        low: { ko: "시간이 지나면 반응 없이 지나가는 일이 늘거나 과제에서 벗어나요.", en: "As time passes more chances go by without a response, or the child leaves the task." }
    },
    {
        id: "memory", code: "b1440", title: "Short-term memory",
        name: { ko: "단기 기억", en: "Short-term memory" },
        about: { ko: "방금 보거나 들은 것을 잠깐 기억해 두었다가 그대로 꺼내 쓰는 기능이에요.", en: "Holding what was just seen or heard for a short while and using it as it was." },
        high: { ko: "기억할 것이 많아져도 빠뜨리지 않고 떠올려요.", en: "Recalls everything even when there is more to remember." },
        low: { ko: "기억할 것이 조금만 늘어도 일부를 빠뜨리거나 다시 보여 줘야 해요.", en: "Leaves parts out or needs to be shown again when there is a little more to remember." }
    },
    {
        id: "sequencing", code: "b176", title: "Mental function of sequencing complex movements",
        name: { ko: "운동 순서화", en: "Sequencing of movements" },
        about: { ko: "여러 동작을 정해진 차례대로 이어서 하는 기능이에요.", en: "Carrying out several movements one after another in the set order." },
        high: { ko: "동작이 바뀌는 곳에서도 차례를 지켜 알맞은 동작으로 넘어가요.", en: "Keeps the order and moves on to the right movement where the movement changes." },
        low: { ko: "차례가 뒤바뀌거나, 동작이 바뀌는 곳에서 앞 동작을 되풀이하거나 다른 동작을 해요.", en: "Swaps the order, or repeats the last movement or does another one where the movement changes." }
    },
    {
        id: "coordination", code: "b7602", title: "Coordination of voluntary movements",
        name: { ko: "운동 협응", en: "Coordination of movements" },
        about: { ko: "몸의 여러 부분을 함께 맞춰 움직이고, 움직임을 필요한 만큼 유지하는 기능이에요.", en: "Moving several parts of the body together and holding a movement for as long as needed." },
        high: { ko: "서로 다른 몸 부분을 같이 써야 하는 동작과 자세를 유지하는 동작을 안정되게 해요.", en: "Does movements that use different body parts together, and holds positions, steadily." },
        low: { ko: "몸 부분을 같이 써야 하면 한쪽만 하거나, 자세를 유지하지 못하고 일찍 풀려요.", en: "Does only one part when parts must be used together, or lets a position go early." }
    },
    {
        id: "timing", code: "b1470", title: "Psychomotor control",
        name: { ko: "정신운동 조절", en: "Psychomotor control" },
        about: { ko: "정해진 때에 맞춰 알맞은 빠르기로 움직임을 시작하고 조절하는 기능이에요.", en: "Starting and adjusting a movement at the right moment and speed." },
        high: { ko: "신호나 정해진 때에 가깝게, 고르게 반응해요.", en: "Responds close to the cue or set moment, and evenly." },
        low: { ko: "반응이 정해진 때보다 많이 늦거나 이르고, 그 차이가 들쭉날쭉해요.", en: "Responds well after or before the set moment, and unevenly." }
    },
    {
        id: "impulse", code: "b1304", title: "Impulse control",
        name: { ko: "충동 조절", en: "Impulse control" },
        about: { ko: "하고 싶은 움직임을 참았다가 해야 할 때에 하는 기능이에요.", en: "Holding back a movement until it is the time to make it." },
        high: { ko: "기다려야 할 때 기다리고, 해야 할 때가 아니면 움직이지 않아요.", en: "Waits when waiting is needed and does not move when it is not the time." },
        low: { ko: "신호보다 먼저 움직이거나, 하지 않아도 될 때 움직이거나, 유지해야 할 것을 먼저 그만둬요.", en: "Moves before the cue, moves when no movement is asked for, or stops early what should be kept up." }
    }
]);

export const indicatorIds = Object.freeze(indicators.map((item) => item.id));

export const indicatorValue = (success, demand) => Math.round(100 * unit(success) * (indicatorLimits.easiest + (1 - indicatorLimits.easiest) * unit(demand)));

export const summarizeObservations = (observations) =>
{
    let weight = 0;
    let total = 0;
    let samples = 0;
    for (const item of observations)
    {
        const count = Number.isFinite(item.samples) && item.samples > 0 ? item.samples : 0;
        const share = count * (Number.isFinite(item.weight) && item.weight >= 0 ? item.weight : 1);
        if (share <= 0) continue;
        weight += share;
        total += share * indicatorValue(item.success, item.demand);
        samples += count;
    }
    return weight === 0 ? null : { value: Math.round(total / weight), samples: Math.min(indicatorLimits.samples, Math.round(samples)) };
};

const isItem = (value) => isRecord(value) && Object.keys(value).length === 3 && indicatorIds.includes(value.id)
    && Number.isFinite(value.value) && value.value >= 0 && value.value <= 100
    && Number.isInteger(value.samples) && value.samples >= 1 && value.samples <= indicatorLimits.samples;

export const isIndicatorReport = (value) => isRecord(value) && Object.keys(value).length === 2 && isTime(value.at)
    && Array.isArray(value.items) && value.items.length >= 1 && value.items.length <= indicatorIds.length && value.items.every(isItem)
    && new Set(value.items.map((item) => item.id)).size === value.items.length;

const newer = (first, second) => second === undefined || second === null || Date.parse(first) > Date.parse(second);

export const docIndicators = (profiles, known) =>
{
    let left = indicatorLimits.perDoc;
    return profiles.map(({ indicators: report, ...item }) =>
    {
        if (report === undefined || report === null || !isIndicatorReport(report) || left === 0 || !newer(report.at, known.get(item.id))) return item;
        --left;
        return { ...item, indicators: report };
    });
};

export const mergeIndicators = (reports, now = new Date()) => indicators.map((definition) =>
{
    const games = [];
    for (const [game, report] of Object.entries(reports ?? {}))
    {
        if (!isIndicatorReport(report)) continue;
        const item = report.items.find((entry) => entry.id === definition.id);
        if (item !== undefined) games.push({ game, value: item.value, samples: item.samples, at: report.at });
    }
    let weight = 0;
    let total = 0;
    let samples = 0;
    for (const item of games)
    {
        const ageDays = Math.max(0, (now.getTime() - Date.parse(item.at)) / dayMs);
        const share = Math.min(item.samples, indicatorLimits.weightSamples) * 0.5 ** (ageDays / indicatorLimits.halfLifeDays);
        weight += share;
        total += share * item.value;
        samples += item.samples;
    }
    return { id: definition.id, value: weight === 0 ? null : Math.round(total / weight), samples, enough: samples >= indicatorLimits.enoughSamples, games };
});
