// Picks the column/row split that gives the biggest 16:9 tiles for `count`
// tiles inside a `width` x `height` box. Pure so it can be unit-tested.
export const computeGrid = (count, width, height, gap = 8, aspect = 16 / 9) => {
  if (!count || width <= 0 || height <= 0) return { cols: 1, rows: 1, tileW: 0, tileH: 0 };
  let best = { cols: 1, rows: count, tileW: 0, tileH: 0 };
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    const maxW = (width - gap * (cols - 1)) / cols;
    const maxH = (height - gap * (rows - 1)) / rows;
    if (maxW <= 0 || maxH <= 0) continue;
    let tileW = maxW;
    let tileH = tileW / aspect;
    if (tileH > maxH) {
      tileH = maxH;
      tileW = tileH * aspect;
    }
    if (tileW * tileH > best.tileW * best.tileH) best = { cols, rows, tileW, tileH };
  }
  return {
    ...best,
    tileW: Math.floor(best.tileW),
    tileH: Math.floor(best.tileH),
  };
};

// How many tiles fit on one page before tiles would become unusably small.
export const maxTilesPerPage = (width, height) => {
  if (width < 520) return height > width ? 6 : 4;
  if (width < 900) return 9;
  return 16;
};

export const paginate = (items, page, perPage) => {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const safePage = Math.min(Math.max(0, page), pages - 1);
  return { pages, page: safePage, items: items.slice(safePage * perPage, (safePage + 1) * perPage) };
};

// Keeps anyone who is currently speaking on the first page.
export const promoteSpeakers = (items, speakingIds, perPage) => {
  if (items.length <= perPage || !speakingIds.size) return items;
  const result = [...items];
  const hidden = result.slice(perPage).filter((item) => speakingIds.has(item.id));
  hidden.forEach((speaker) => {
    const from = result.findIndex((item) => item.id === speaker.id);
    for (let slot = perPage - 1; slot >= 0; slot -= 1) {
      if (!speakingIds.has(result[slot].id) && !result[slot].isLocal && !result[slot].isHost) {
        [result[slot], result[from]] = [result[from], result[slot]];
        break;
      }
    }
  });
  return result;
};
