/**
 * Pure helpers cho trang /enrollment — không import React/DOM.
 * Normalize chấp nhận cả camelCase (client state) lẫn snake_case (dữ liệu thô).
 */

function normalize(raw) {
  const value = raw ?? {};
  const str = (a, b) => String((a ?? b ?? '')).trim();
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const soTc = num(value.soTc ?? value.so_tc ?? value.so_tin_chi);
  return {
    maMon: str(value.maMon, value.ma_mon) || str(value.ma_mon, value.maMon),
    tenMon: str(value.tenMon, value.ten_mon) || str(value.ten_mon, value.tenMon),
    soTc: Number.isFinite(soTc) ? soTc : null,
    idToHoc: str(value.idToHoc, value.id_to_hoc) || str(value.id_to_hoc, value.idToHoc),
    nhomTo: str(value.nhomTo, value.nhom_to) || str(value.nhom_to, value.nhomTo) || null,
    lop: str(value.lop, value.lop) || null,
    loai: value.loai === 'du_phong' ? 'du_phong' : 'chinh',
    thuTu: Number(value.thuTu ?? value.thu_tu) || 0
  };
}

const minThuTu = (group) => Math.min(
  group.chinh?.thuTu ?? Number.POSITIVE_INFINITY,
  ...group.duPhong.map((item) => item.thuTu ?? Number.POSITIVE_INFINITY)
);

export function groupBySubject(items) {
  const map = new Map();
  for (const raw of items ?? []) {
    const item = normalize(raw);
    if (!item.maMon) continue;
    let group = map.get(item.maMon);
    if (!group) {
      group = { maMon: item.maMon, tenMon: item.tenMon, soTc: item.soTc, chinh: null, duPhong: [] };
      map.set(item.maMon, group);
    }
    if (item.loai === 'chinh') {
      if (!group.chinh || item.thuTu < group.chinh.thuTu) group.chinh = item;
    } else {
      group.duPhong.push(item);
    }
  }
  const groups = [...map.values()].map((group) => ({
    ...group,
    duPhong: [...group.duPhong].sort((a, b) => a.thuTu - b.thuTu)
  }));
  groups.sort((a, b) => minThuTu(a) - minThuTu(b));
  return groups;
}

export function moveItem(items, itemId, direction) {
  const list = (items ?? []).map(normalize);
  const index = list.findIndex((item) => item.idToHoc === itemId);
  if (index === -1) return list;
  const target = index + (direction < 0 ? -1 : 1);
  if (target < 0 || target >= list.length) return list.map((item, i) => ({ ...item, thuTu: i + 1 }));
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((item, i) => ({ ...item, thuTu: i + 1 }));
}

export function toSavePayload(items) {
  return (items ?? []).map(normalize).map((item, index) => ({
    maMon: item.maMon,
    tenMon: item.tenMon,
    soTc: item.soTc,
    idToHoc: item.idToHoc,
    nhomTo: item.nhomTo,
    lop: item.lop,
    loai: item.loai,
    thuTu: index + 1
  }));
}

export function canSetAsChinh(items, item) {
  const target = normalize(item);
  if (target.loai === 'chinh') return true;
  return !(items ?? [])
    .map(normalize)
    .some((entry) => entry.maMon === target.maMon && entry.loai === 'chinh');
}
