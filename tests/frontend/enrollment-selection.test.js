import { describe, expect, it } from 'vitest';
import { checkboxState, registeredIdsFrom } from '../../client/src/features/enrollment/catalog-selection.js';

describe('registeredIdsFrom', () => {
  it('locks normal registered rows but leaves withdrawn rows toggleable', () => {
    const registeredIds = registeredIdsFrom([
      { idToHoc: 'WITHDRAWN', withdrawn: true },
      { idToHoc: 'REGISTERED', withdrawn: false },
      { idToHoc: '', withdrawn: false }
    ]);

    expect(registeredIds).toEqual(new Set(['REGISTERED']));
    expect(checkboxState({ idToHoc: 'WITHDRAWN', selectedIds: new Set(), registeredIds }))
      .toEqual({ checked: false, disabled: false, registered: false });
    expect(checkboxState({ idToHoc: 'REGISTERED', selectedIds: new Set(), registeredIds }))
      .toEqual({ checked: true, disabled: true, registered: true });
  });
});

describe('checkboxState', () => {
  it('checks and locks a registered class', () => {
    expect(checkboxState({
      idToHoc: 'A-MAIN', selectedIds: new Set(), registeredIds: new Set(['A-MAIN'])
    })).toEqual({ checked: true, disabled: true, registered: true });
  });

  it('keeps a normal class toggleable by selection', () => {
    expect(checkboxState({
      idToHoc: 'A-MAIN', selectedIds: new Set(['A-MAIN']), registeredIds: new Set()
    })).toEqual({ checked: true, disabled: false, registered: false });
  });

  it('leaves an unselected, unregistered class unchecked and toggleable', () => {
    expect(checkboxState({
      idToHoc: 'B-MAIN', selectedIds: new Set(), registeredIds: new Set()
    })).toEqual({ checked: false, disabled: false, registered: false });
  });
});
