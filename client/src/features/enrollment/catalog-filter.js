/**
 * Pure catalog filtering that mirrors the official registration page
 * (`FilterByDKLoc` in the portal bundle). BDU returns the filter list per
 * account; each value means a different predicate and some need an extra
 * selection (subject/khoa/lop).
 */
export function filterCatalog(rows, { loaiLoc = 2, studentClass = '', subject = '', khoa = '', lop = '' } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  switch (Number(loaiLoc)) {
    case 0:
      if (!studentClass) return [];
      return list.filter((row) => row.lop === studentClass || (row.dsLop ?? []).includes(studentClass));
    case 1:
      return list.filter((row) => row.isRot === true);
    case 2:
      return list.filter((row) => row.isCtdt === true);
    case 3:
      if (!khoa) return [];
      return list.filter((row) => (row.dsKhoa ?? []).includes(khoa));
    case 4:
      if (!lop) return [];
      return list.filter((row) => (row.dsLop ?? []).includes(lop));
    case 6:
      return list.filter((row) => row.isChctdt === true);
    case 10:
      if (!subject) return [];
      return list.filter((row) => row.maMon === subject);
    default:
      return list;
  }
}
