export function isRegisteredId(registeredIds, idToHoc) {
  return Boolean(idToHoc) && registeredIds instanceof Set && registeredIds.has(idToHoc);
}

export function checkboxState({ idToHoc, selectedIds, registeredIds }) {
  const registered = isRegisteredId(registeredIds, idToHoc);
  const selected = selectedIds instanceof Set && selectedIds.has(idToHoc);
  return { checked: registered || selected, disabled: registered, registered };
}
