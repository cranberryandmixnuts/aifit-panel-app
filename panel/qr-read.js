import { qrDataCells, qrFormatBits, qrFormatCells, qrMasks, qrSizeOf, qrVersions } from "./qr.js";

const region = 8;
const minRange = 24;
const exp = new Uint8Array(512);
const log = new Uint8Array(256);
for (let power = 0, value = 1; power < 255; power++)
{
    exp[power] = value;
    exp[power + 255] = value;
    log[value] = power;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
}
const multiply = (a, b) => a === 0 || b === 0 ? 0 : exp[log[a] + log[b]];
const inverse = (a) => exp[255 - log[a]];
const evaluate = (polynomial, x) =>
{
    let value = 0;
    for (let index = polynomial.length - 1; index >= 0; index--) value = multiply(value, x) ^ polynomial[index];
    return value;
};

const syndromesOf = (block, count) => Array.from({ length: count }, (_, index) =>
{
    let value = 0;
    for (const byte of block) value = multiply(value, exp[index]) ^ byte;
    return value;
});

export const qrCorrect = (block, count) =>
{
    const syndromes = syndromesOf(block, count);
    if (syndromes.every((value) => value === 0)) return true;
    let locator = [1];
    let previous = [1];
    let length = 0;
    let shift = 1;
    let last = 1;
    for (let index = 0; index < count; index++)
    {
        let discrepancy = syndromes[index];
        for (let term = 1; term <= length; term++) discrepancy ^= multiply(locator[term] ?? 0, syndromes[index - term]);
        if (discrepancy === 0)
        {
            ++shift;
            continue;
        }
        const scale = multiply(discrepancy, inverse(last));
        const next = locator.slice();
        while (next.length < previous.length + shift) next.push(0);
        previous.forEach((coefficient, term) => next[term + shift] ^= multiply(scale, coefficient));
        if (2 * length <= index)
        {
            previous = locator;
            last = discrepancy;
            length = index + 1 - length;
            shift = 1;
        }
        else ++shift;
        locator = next;
    }
    if (length * 2 > count) return false;
    const places = [];
    for (let place = 0; place < block.length; place++) if (evaluate(locator, exp[(255 - place) % 255]) === 0) places.push(place);
    if (places.length !== length) return false;
    const omega = Array.from({ length: count }, (_, index) =>
    {
        let value = 0;
        for (let term = 0; term <= index && term < locator.length; term++) value ^= multiply(syndromes[index - term], locator[term]);
        return value;
    });
    const derivative = locator.map((coefficient, term) => term % 2 === 1 ? coefficient : 0).slice(1);
    for (const place of places)
    {
        const point = exp[(255 - place) % 255];
        const slope = evaluate(derivative, point);
        if (slope === 0) return false;
        block[block.length - 1 - place] ^= multiply(multiply(exp[place % 255], evaluate(omega, point)), inverse(slope));
    }
    return syndromesOf(block, count).every((value) => value === 0);
};

const parse = (data) =>
{
    let position = 0;
    const left = () => data.length * 8 - position;
    const read = (length) =>
    {
        let value = 0;
        for (let index = 0; index < length; index++, position++) value = value << 1 | ((data[position >>> 3] >>> (7 - (position & 7))) & 1);
        return value;
    };
    const letters = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
    let text = "";
    while (left() >= 4)
    {
        const mode = read(4);
        if (mode === 0) break;
        if (mode === 4)
        {
            if (left() < 8) return null;
            const count = read(8);
            if (left() < count * 8) return null;
            text += new TextDecoder().decode(Uint8Array.from({ length: count }, () => read(8)));
        }
        else if (mode === 1)
        {
            if (left() < 10) return null;
            let count = read(10);
            for (; count >= 3; count -= 3)
            {
                if (left() < 10) return null;
                text += String(read(10)).padStart(3, "0");
            }
            if (count > 0)
            {
                if (left() < count * 3 + 1) return null;
                text += String(read(count * 3 + 1)).padStart(count, "0");
            }
        }
        else if (mode === 2)
        {
            if (left() < 9) return null;
            let count = read(9);
            for (; count >= 2; count -= 2)
            {
                if (left() < 11) return null;
                const pair = read(11);
                text += letters[Math.floor(pair / 45) % 45] + letters[pair % 45];
            }
            if (count === 1)
            {
                if (left() < 6) return null;
                text += letters[read(6) % 45];
            }
        }
        else return null;
    }
    return text;
};

const bitCount = (value) =>
{
    let count = 0;
    for (; value !== 0; value &= value - 1) ++count;
    return count;
};

export const qrDecodeModules = (modules) =>
{
    const size = modules.length;
    const number = (size - 21) / 4;
    const version = qrVersions[number];
    if (version === undefined || modules.some((row) => row.length !== size)) return null;
    let mask = -1;
    let nearest = 4;
    for (const cells of qrFormatCells(size))
    {
        const value = cells.reduce((bits, [x, y], index) => modules[y][x] ? bits | 1 << index : bits, 0);
        for (let candidate = 0; candidate < qrMasks.length; candidate++)
        {
            const distance = bitCount(qrFormatBits(candidate) ^ value);
            if (distance < nearest)
            {
                nearest = distance;
                mask = candidate;
            }
        }
    }
    if (mask < 0) return null;
    const bytes = new Uint8Array(version.total);
    qrDataCells(size).slice(0, version.total * 8).forEach(([x, y], bit) =>
    {
        if (modules[y][x] !== qrMasks[mask](x, y)) bytes[bit >>> 3] |= 0x80 >>> (bit & 7);
    });
    const length = (version.total - version.ec * version.blocks) / version.blocks;
    const data = new Uint8Array(length * version.blocks);
    for (let index = 0; index < version.blocks; index++)
    {
        const block = new Uint8Array(length + version.ec);
        for (let at = 0; at < length; at++) block[at] = bytes[at * version.blocks + index];
        for (let at = 0; at < version.ec; at++) block[length + at] = bytes[length * version.blocks + at * version.blocks + index];
        if (!qrCorrect(block, version.ec)) return null;
        data.set(block.subarray(0, length), index * length);
    }
    return parse(data);
};

export const qrLuminance = (data, width, height) =>
{
    const light = new Uint8Array(width * height);
    for (let index = 0; index < light.length; index++) light[index] = (data[index * 4] * 77 + data[index * 4 + 1] * 150 + data[index * 4 + 2] * 29) >> 8;
    return light;
};

export const qrBinarize = (light, width, height) =>
{
    const columns = Math.ceil(width / region);
    const rows = Math.ceil(height / region);
    const points = new Float32Array(columns * rows);
    for (let row = 0; row < rows; row++)
    {
        const top = Math.min(row * region, height - region);
        for (let column = 0; column < columns; column++)
        {
            const left = Math.min(column * region, width - region);
            let sum = 0;
            let min = 255;
            let max = 0;
            for (let y = 0; y < region; y++)
                for (let x = 0; x < region; x++)
                {
                    const value = light[(top + y) * width + left + x];
                    sum += value;
                    if (value < min) min = value;
                    if (value > max) max = value;
                }
            let average = sum / (region * region);
            if (max - min <= minRange)
            {
                average = min / 2;
                if (row > 0 && column > 0)
                {
                    const near = (points[(row - 1) * columns + column] + 2 * points[row * columns + column - 1] + points[(row - 1) * columns + column - 1]) / 4;
                    if (min < near) average = near;
                }
            }
            points[row * columns + column] = average;
        }
    }
    const dark = new Uint8Array(width * height);
    for (let row = 0; row < rows; row++)
    {
        const top = Math.min(row * region, height - region);
        const middle = Math.min(Math.max(row, 2), rows - 3);
        for (let column = 0; column < columns; column++)
        {
            const left = Math.min(column * region, width - region);
            const centre = Math.min(Math.max(column, 2), columns - 3);
            let sum = 0;
            for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) sum += points[(middle + y) * columns + centre + x];
            const threshold = sum / 25;
            for (let y = 0; y < region; y++) for (let x = 0; x < region; x++) dark[(top + y) * width + left + x] = light[(top + y) * width + left + x] <= threshold ? 1 : 0;
        }
    }
    return dark;
};

const finderRatio = (counts) =>
{
    const total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
    if (total < 7 || counts.some((count) => count === 0)) return false;
    const size = total / 7;
    const slack = size / 2;
    return Math.abs(counts[0] - size) < slack && Math.abs(counts[1] - size) < slack && Math.abs(counts[2] - 3 * size) < 3 * slack && Math.abs(counts[3] - size) < slack && Math.abs(counts[4] - size) < slack;
};

const crossCheck = (image, fixed, start, vertical, most, total) =>
{
    const { dark, width, height } = image;
    const limit = vertical ? height : width;
    const at = (index) => vertical ? dark[index * width + fixed] === 1 : dark[fixed * width + index] === 1;
    const counts = [0, 0, 0, 0, 0];
    let index = start;
    for (; index >= 0 && at(index); index--) ++counts[2];
    if (index < 0) return null;
    for (; index >= 0 && !at(index) && counts[1] <= most; index--) ++counts[1];
    if (index < 0 || counts[1] > most) return null;
    for (; index >= 0 && at(index) && counts[0] <= most; index--) ++counts[0];
    if (counts[0] > most) return null;
    index = start + 1;
    for (; index < limit && at(index); index++) ++counts[2];
    if (index === limit) return null;
    for (; index < limit && !at(index) && counts[3] <= most; index++) ++counts[3];
    if (index === limit || counts[3] > most) return null;
    for (; index < limit && at(index) && counts[4] <= most; index++) ++counts[4];
    if (counts[4] > most) return null;
    const sum = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
    if (5 * Math.abs(sum - total) >= 2 * total || !finderRatio(counts)) return null;
    return { centre: index - counts[4] - counts[3] - counts[2] / 2, size: sum / 7 };
};

const findFinders = (image) =>
{
    const { dark, width, height } = image;
    const found = [];
    const add = (x, y, size) =>
    {
        for (const item of found)
        {
            if (Math.abs(item.x - x) > item.size || Math.abs(item.y - y) > item.size || Math.abs(item.size - size) > Math.max(1, item.size)) continue;
            const count = item.count + 1;
            item.x = (item.x * item.count + x) / count;
            item.y = (item.y * item.count + y) / count;
            item.size = (item.size * item.count + size) / count;
            item.count = count;
            return;
        }
        found.push({ x, y, size, count: 1 });
    };
    const step = Math.max(1, Math.floor(height / 240));
    for (let y = step - 1; y < height; y += step)
    {
        const counts = [0, 0, 0, 0, 0];
        let state = 0;
        const check = (end) =>
        {
            if (!finderRatio(counts)) return false;
            const total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
            const x = Math.floor(end - counts[4] - counts[3] - counts[2] / 2);
            const down = crossCheck(image, x, y, true, counts[2], total);
            if (down === null) return false;
            const across = crossCheck(image, Math.floor(down.centre), x, false, counts[2], total);
            if (across === null) return false;
            add(across.centre, down.centre, (across.size + down.size) / 2);
            return true;
        };
        const move = (matched) =>
        {
            if (matched)
            {
                counts.fill(0);
                state = 0;
                return;
            }
            counts[0] = counts[2];
            counts[1] = counts[3];
            counts[2] = counts[4];
            counts[3] = 1;
            counts[4] = 0;
            state = 3;
        };
        for (let x = 0; x < width; x++)
        {
            if (dark[y * width + x] === 1)
            {
                if ((state & 1) === 1) ++state;
                ++counts[state];
            }
            else if ((state & 1) === 1) ++counts[state];
            else if (state === 4) move(check(x));
            else ++counts[++state];
        }
        if (state === 4) check(width);
    }
    return found;
};

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const pickFinders = (found) =>
{
    let list = found.filter((item) => item.count >= 2);
    if (list.length < 3) list = found;
    if (list.length < 3) return null;
    list = [...list].sort((a, b) => b.count - a.count).slice(0, 12);
    let best = null;
    for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++)
            for (let k = j + 1; k < list.length; k++)
            {
                const corners = [list[i], list[j], list[k]];
                const sizes = corners.map((item) => item.size);
                const mean = (sizes[0] + sizes[1] + sizes[2]) / 3;
                const spread = Math.max(...sizes) - Math.min(...sizes);
                if (spread > mean * 0.5) continue;
                const sides = [[0, 1, 2], [1, 2, 0], [2, 0, 1]].map(([a, b, other]) => ({ length: distance(corners[a], corners[b]), other })).sort((a, b) => a.length - b.length);
                const legs = (sides[0].length + sides[1].length) / 2;
                if (legs / mean < 9 || legs / mean > 46) continue;
                const score = (sides[1].length - sides[0].length) / legs + Math.abs(sides[2].length - Math.SQRT2 * legs) / legs + spread / mean / 2;
                if (best !== null && score >= best.score) continue;
                const topLeft = corners[sides[2].other];
                let [topRight, bottomLeft] = corners.filter((item) => item !== topLeft);
                if ((topRight.x - topLeft.x) * (bottomLeft.y - topLeft.y) - (topRight.y - topLeft.y) * (bottomLeft.x - topLeft.x) < 0) [topRight, bottomLeft] = [bottomLeft, topRight];
                best = { score, topLeft, topRight, bottomLeft, size: mean };
            }
    return best !== null && best.score < 0.7 ? best : null;
};

const findAlignment = (image, nearX, nearY, size) =>
{
    const { dark, width, height } = image;
    const reach = Math.ceil(size * 5);
    const left = Math.max(0, Math.floor(nearX - reach));
    const right = Math.min(width - 1, Math.ceil(nearX + reach));
    const top = Math.max(0, Math.floor(nearY - reach));
    const bottom = Math.min(height - 1, Math.ceil(nearY + reach));
    const fits = (length) => length >= size * 0.5 && length <= size * 1.5;
    const run = (x, y, dx, dy, value) =>
    {
        let length = 0;
        for (; x >= 0 && x < width && y >= 0 && y < height && dark[y * width + x] === value && length <= size * 2; x += dx, y += dy) ++length;
        return length;
    };
    const found = [];
    for (let y = top; y <= bottom; y++)
        for (let x = left; x <= right; x++)
        {
            if (dark[y * width + x] !== 1 || (x > left && dark[y * width + x - 1] === 1)) continue;
            const across = run(x, y, 1, 0, 1);
            if (!fits(across) || !fits(run(x - 1, y, -1, 0, 0)) || !fits(run(x + across, y, 1, 0, 0))) continue;
            const middle = x + Math.floor(across / 2);
            const up = run(middle, y, 0, -1, 1);
            const down = run(middle, y + 1, 0, 1, 1);
            if (!fits(up + down) || !fits(run(middle, y - up, 0, -1, 0)) || !fits(run(middle, y + down + 1, 0, 1, 0))) continue;
            const point = { x: x + across / 2, y: y - up + 1 + (up + down) / 2, count: 1 };
            const same = found.find((item) => Math.abs(item.x - point.x) <= size && Math.abs(item.y - point.y) <= size);
            if (same === undefined) found.push(point);
            else
            {
                same.x = (same.x * same.count + point.x) / (same.count + 1);
                same.y = (same.y * same.count + point.y) / (same.count + 1);
                ++same.count;
            }
        }
    if (found.length === 0) return null;
    return found.sort((a, b) => b.count - a.count || Math.hypot(a.x - nearX, a.y - nearY) - Math.hypot(b.x - nearX, b.y - nearY))[0];
};

const fromSquare = ([p0, p1, p2, p3]) =>
{
    const dx3 = p0.x - p1.x + p2.x - p3.x;
    const dy3 = p0.y - p1.y + p2.y - p3.y;
    if (dx3 === 0 && dy3 === 0) return [p1.x - p0.x, p2.x - p1.x, p0.x, p1.y - p0.y, p2.y - p1.y, p0.y, 0, 0, 1];
    const dx1 = p1.x - p2.x;
    const dx2 = p3.x - p2.x;
    const dy1 = p1.y - p2.y;
    const dy2 = p3.y - p2.y;
    const bottom = dx1 * dy2 - dx2 * dy1;
    const g = (dx3 * dy2 - dx2 * dy3) / bottom;
    const h = (dx1 * dy3 - dx3 * dy1) / bottom;
    return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
};

const adjugate = ([a, b, c, d, e, f, g, h, i]) => [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];

const product = (m, n) => [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => m[row * 3] * n[column] + m[row * 3 + 1] * n[3 + column] + m[row * 3 + 2] * n[6 + column]));

export const qrTransform = (from, to) =>
{
    const matrix = product(fromSquare(to), adjugate(fromSquare(from)));
    return (x, y) =>
    {
        const bottom = matrix[6] * x + matrix[7] * y + matrix[8];
        return { x: (matrix[0] * x + matrix[1] * y + matrix[2]) / bottom, y: (matrix[3] * x + matrix[4] * y + matrix[5]) / bottom };
    };
};

const sample = (image, transform, size) =>
{
    const { dark, width, height } = image;
    const spots = [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]];
    return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_unused, x) =>
    {
        let votes = 0;
        for (const [dx, dy] of spots)
        {
            const point = transform(x + dx, y + dy);
            const px = Math.floor(point.x);
            const py = Math.floor(point.y);
            if (px >= 0 && px < width && py >= 0 && py < height && dark[py * width + px] === 1) ++votes;
        }
        return votes >= 3;
    }));
};

export const readQr = ({ data, width, height }) =>
{
    if (width < region * 5 || height < region * 5) return null;
    const image = { dark: qrBinarize(qrLuminance(data, width, height), width, height), width, height };
    const finders = pickFinders(findFinders(image));
    if (finders === null) return null;
    const { topLeft, topRight, bottomLeft } = finders;
    const angle = Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x);
    const unit = finders.size * Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
    const guess = (distance(topLeft, topRight) + distance(topLeft, bottomLeft)) / 2 / unit + 7;
    const corner = { x: topRight.x - topLeft.x + bottomLeft.x, y: topRight.y - topLeft.y + bottomLeft.y };
    const sizes = qrVersions.map((_, number) => qrSizeOf(number)).sort((a, b) => Math.abs(a - guess) - Math.abs(b - guess)).slice(0, 2);
    for (const size of sizes)
    {
        const tries = [];
        if (size > 21)
        {
            const share = 1 - 3 / (size - 7);
            const near = findAlignment(image, topLeft.x + share * (corner.x - topLeft.x), topLeft.y + share * (corner.y - topLeft.y), finders.size);
            if (near !== null) tries.push([near, size - 6.5]);
        }
        tries.push([corner, size - 3.5]);
        for (const [point, at] of tries)
        {
            const transform = qrTransform([{ x: 3.5, y: 3.5 }, { x: size - 3.5, y: 3.5 }, { x: at, y: at }, { x: 3.5, y: size - 3.5 }], [topLeft, topRight, point, bottomLeft]);
            const text = qrDecodeModules(sample(image, transform, size));
            if (text !== null) return text;
        }
    }
    return null;
};
