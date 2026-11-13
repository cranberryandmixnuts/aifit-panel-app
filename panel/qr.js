export const qrVersions = Object.freeze([
    { total: 26, ec: 10, blocks: 1 },
    { total: 44, ec: 16, blocks: 1 },
    { total: 70, ec: 26, blocks: 1 },
    { total: 100, ec: 18, blocks: 2 },
    { total: 134, ec: 24, blocks: 2 },
    { total: 172, ec: 16, blocks: 4 }
]);

export const qrMasks = Object.freeze([
    (x, y) => (x + y) % 2 === 0,
    (_x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0
]);

const dataBytes = (version) => version.total - version.ec * version.blocks;

export const qrMaxBytes = Math.floor((dataBytes(qrVersions[qrVersions.length - 1]) * 8 - 12) / 8);
export const qrSizeOf = (number) => 21 + number * 4;

export const qrMultiply = (x, y) =>
{
    let product = 0;
    for (let bit = 7; bit >= 0; bit--)
    {
        product = (product << 1) ^ ((product >>> 7) * 0x11d);
        product ^= ((y >>> bit) & 1) * x;
    }
    return product;
};

export const qrErrorCodewords = (data, degree) =>
{
    const divisor = Array.from({ length: degree }, (_, index) => index === degree - 1 ? 1 : 0);
    let root = 1;
    for (let step = 0; step < degree; step++)
    {
        for (let index = 0; index < divisor.length; index++)
        {
            divisor[index] = qrMultiply(divisor[index], root);
            if (index + 1 < divisor.length) divisor[index] ^= divisor[index + 1];
        }
        root = qrMultiply(root, 2);
    }
    const remainder = divisor.map(() => 0);
    for (const byte of data)
    {
        const factor = byte ^ remainder.shift();
        remainder.push(0);
        divisor.forEach((coefficient, index) => remainder[index] ^= qrMultiply(coefficient, factor));
    }
    return remainder;
};

export const qrFormatBits = (mask) =>
{
    let remainder = mask;
    for (let step = 0; step < 10; step++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    return (mask << 10 | remainder) ^ 0x5412;
};

export const qrFormatCells = (size) =>
[
    [...Array.from({ length: 6 }, (_, index) => [8, index]), [8, 7], [8, 8], [7, 8], ...Array.from({ length: 6 }, (_, index) => [5 - index, 8])],
    [...Array.from({ length: 8 }, (_, index) => [size - 1 - index, 8]), ...Array.from({ length: 7 }, (_, index) => [8, size - 7 + index])]
];

export const qrReserved = (size) =>
{
    const aligned = size > 21;
    return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_unused, x) =>
        (x < 9 && y < 9) || (x >= size - 8 && y < 9) || (x < 9 && y >= size - 8) || x === 6 || y === 6 || (aligned && Math.abs(x - (size - 7)) <= 2 && Math.abs(y - (size - 7)) <= 2)));
};

export const qrDataCells = (size) =>
{
    const reserved = qrReserved(size);
    const cells = [];
    for (let right = size - 1; right >= 1; right -= 2)
    {
        if (right === 6) right = 5;
        const upward = ((right + 1) & 2) === 0;
        for (let step = 0; step < size; step++)
            for (let column = 0; column < 2; column++)
            {
                const x = right - column;
                const y = upward ? size - 1 - step : step;
                if (!reserved[y][x]) cells.push([x, y]);
            }
    }
    return cells;
};

const codewords = (bytes, version) =>
{
    const capacity = dataBytes(version) * 8;
    const bits = [];
    const push = (value, length) =>
    {
        for (let bit = length - 1; bit >= 0; bit--) bits.push((value >>> bit) & 1);
    };
    push(0b0100, 4);
    push(bytes.length, 8);
    for (const byte of bytes) push(byte, 8);
    push(0, Math.min(4, capacity - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
    const data = Array.from({ length: capacity / 8 }, (_, index) => bits.slice(index * 8, index * 8 + 8).reduce((byte, bit) => byte << 1 | bit, 0));
    const size = data.length / version.blocks;
    const blocks = Array.from({ length: version.blocks }, (_, index) => data.slice(index * size, (index + 1) * size));
    const errors = blocks.map((block) => qrErrorCodewords(block, version.ec));
    const result = [];
    for (let index = 0; index < size; index++) for (const block of blocks) result.push(block[index]);
    for (let index = 0; index < version.ec; index++) for (const block of errors) result.push(block[index]);
    return result;
};

const penalty = (modules) =>
{
    const size = modules.length;
    let score = 0;
    const lines = (at) =>
    {
        for (let line = 0; line < size; line++)
        {
            let run = 1;
            for (let index = 1; index <= size; index++)
            {
                if (index < size && at(line, index) === at(line, index - 1)) ++run;
                else
                {
                    if (run >= 5) score += run - 2;
                    run = 1;
                }
            }
            for (let index = 0; index + 11 <= size; index++)
            {
                const window = Array.from({ length: 11 }, (_, offset) => at(line, index + offset) ? "1" : "0").join("");
                if (window === "10111010000" || window === "00001011101") score += 40;
            }
        }
    };
    lines((line, index) => modules[line][index]);
    lines((line, index) => modules[index][line]);
    let dark = 0;
    for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++)
        {
            if (modules[y][x]) ++dark;
            if (x + 1 < size && y + 1 < size && modules[y][x] === modules[y][x + 1] && modules[y][x] === modules[y + 1][x] && modules[y][x] === modules[y + 1][x + 1]) score += 3;
        }
    return score + (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10;
};

export const qrModules = (text) =>
{
    const bytes = new TextEncoder().encode(text);
    const number = qrVersions.findIndex((version) => 12 + bytes.length * 8 <= dataBytes(version) * 8);
    if (number < 0) throw new RangeError(`QR text too long: ${bytes.length} bytes, at most ${qrMaxBytes}`);
    const size = qrSizeOf(number);
    const modules = Array.from({ length: size }, () => Array(size).fill(false));
    for (let index = 0; index < size; index++)
    {
        modules[index][6] = index % 2 === 0;
        modules[6][index] = index % 2 === 0;
    }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
        for (let dy = -4; dy <= 4; dy++)
            for (let dx = -4; dx <= 4; dx++)
            {
                const distance = Math.max(Math.abs(dx), Math.abs(dy));
                if (cx + dx >= 0 && cx + dx < size && cy + dy >= 0 && cy + dy < size) modules[cy + dy][cx + dx] = distance !== 2 && distance !== 4;
            }
    if (number > 0)
        for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) modules[size - 7 + dy][size - 7 + dx] = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
    const format = (mask) =>
    {
        const bits = qrFormatBits(mask);
        for (const cells of qrFormatCells(size)) cells.forEach(([x, y], index) => modules[y][x] = ((bits >>> index) & 1) === 1);
        modules[size - 8][8] = true;
    };
    const cells = qrDataCells(size);
    const data = codewords(bytes, qrVersions[number]);
    cells.forEach(([x, y], bit) => modules[y][x] = bit < data.length * 8 && ((data[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1);
    const apply = (mask) =>
    {
        for (const [x, y] of cells) if (qrMasks[mask](x, y)) modules[y][x] = !modules[y][x];
    };
    let best = 0;
    let lowest = Number.POSITIVE_INFINITY;
    for (let mask = 0; mask < qrMasks.length; mask++)
    {
        apply(mask);
        format(mask);
        const score = penalty(modules);
        if (score < lowest)
        {
            best = mask;
            lowest = score;
        }
        apply(mask);
    }
    apply(best);
    format(best);
    return modules;
};

export const qrSvg = (text, { margin = 4, dark = "#000", light = "#fff" } = {}) =>
{
    const modules = qrModules(text);
    const size = modules.length + margin * 2;
    let path = "";
    modules.forEach((row, y) =>
    {
        for (let x = 0; x < row.length; x++)
        {
            if (!row[x]) continue;
            let end = x;
            while (end + 1 < row.length && row[end + 1]) ++end;
            path += `M${x + margin} ${y + margin}h${end - x + 1}v1h-${end - x + 1}z`;
            x = end;
        }
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
};
