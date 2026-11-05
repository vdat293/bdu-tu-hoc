import { describe, expect, it } from 'vitest';
import { checkboxState } from '../../client/src/features/enrollment/catalog-selection.js';

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
