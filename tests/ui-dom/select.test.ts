// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { registerComponents } from '../../src/ui';
import { makeSelect, type StSelect } from '../../src/ui/components/StSelect';
import { modalStack } from '../../src/ui/modal';

registerComponents();
const key = (s: StSelect, k: string): void => { s.button.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); };
const OPTS = [{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Banana' }, { value: 'c', label: 'Cherry', disabled: true }, { value: 'd', label: 'Date' }];
const lis = (s: StSelect): HTMLElement[] => [...(s as unknown as { root: ShadowRoot }).root.querySelectorAll<HTMLElement>('li')];

describe('st-select', () => {
  it('constructs without attributes / children; has the select-like API', () => {
    const e = document.createElement('st-select');
    expect(e.attributes.length).toBe(0); expect(e.childNodes.length).toBe(0);
    document.body.append(e); e.remove();
    const s = makeSelect(OPTS, 'b', 'Fruit');
    expect(s.value).toBe('b'); expect(s.options).toHaveLength(4); expect(s.selectedIndex).toBe(1);
    expect(s.button.textContent).toContain('Banana'); expect(s.button.getAttribute('aria-label')).toBe('Fruit');
    s.value = 'd'; expect(s.value).toBe('d'); expect(s.button.textContent).toContain('Date');
    s.value = 'nope'; expect(s.value).toBe('d');
  });

  it('has listbox / option ARIA and opens / closes with the button', () => {
    const s = makeSelect(OPTS, 'a', 'Fruit'); document.body.append(s);
    const root = (s as unknown as { root: ShadowRoot }).root;
    expect(root.querySelector('ul')!.getAttribute('role')).toBe('listbox');
    expect(lis(s).map((l) => l.getAttribute('role'))).toEqual(['option', 'option', 'option', 'option']);
    expect(s.button.getAttribute('aria-haspopup')).toBe('listbox'); expect(s.button.getAttribute('aria-expanded')).toBe('false');
    s.button.click();
    expect(s.isOpen).toBe(true); expect(s.button.getAttribute('aria-expanded')).toBe('true');
    expect(lis(s)[0]!.getAttribute('aria-selected')).toBe('true');
    expect(lis(s)[2]!.getAttribute('aria-disabled')).toBe('true');
    s.button.click(); expect(s.isOpen).toBe(false);
    s.remove();
  });

  it('keyboard: arrows move (skipping disabled), Enter picks + fires change, Esc closes only the popup, Home/End, Tab closes', () => {
    const s = makeSelect(OPTS, 'a', 'Fruit'); document.body.append(s);
    const changes: string[] = []; s.addEventListener('change', () => changes.push(s.value));
    key(s, 'ArrowDown'); expect(s.isOpen).toBe(true);
    key(s, 'ArrowDown'); expect(lis(s)[1]!.classList.contains('act')).toBe(true);
    key(s, 'ArrowDown'); expect(lis(s)[3]!.classList.contains('act')).toBe(true); // Cherry (disabled) is skipped
    key(s, 'Home'); expect(lis(s)[0]!.classList.contains('act')).toBe(true);
    key(s, 'End'); expect(lis(s)[3]!.classList.contains('act')).toBe(true);
    key(s, 'ArrowUp'); expect(lis(s)[1]!.classList.contains('act')).toBe(true);
    key(s, 'Enter'); expect(s.isOpen).toBe(false); expect(s.value).toBe('b'); expect(changes).toEqual(['b']);
    key(s, 'Enter'); key(s, 'Escape'); expect(s.isOpen).toBe(false); expect(changes).toEqual(['b']); // Esc: no change
    key(s, ' '); expect(s.isOpen).toBe(true); key(s, 'Tab'); expect(s.isOpen).toBe(false);
    key(s, 'Enter'); key(s, 'Enter'); expect(changes).toEqual(['b']); // picking the current value fires nothing
    s.remove();
  });

  it('typeahead selects the next label starting with the typed text', () => {
    const s = makeSelect(OPTS, 'a', 'Fruit'); document.body.append(s);
    key(s, 'd'); expect(s.value).toBe('d'); // closed: typeahead picks directly
    key(s, 'Enter'); key(s, 'b'); expect(lis(s)[1]!.classList.contains('act')).toBe(true); key(s, 'Enter'); expect(s.value).toBe('b');
    s.remove();
  });

  it('mouse: click an option picks it; click outside closes; the open popup is on the modal stack (Esc closes it first)', () => {
    const s = makeSelect(OPTS, 'a', 'Fruit'); document.body.append(s);
    s.button.click(); expect(modalStack.has((s as unknown as { entry: never }).entry)).toBe(true);
    lis(s)[3]!.click(); expect(s.value).toBe('d'); expect(s.isOpen).toBe(false);
    expect(modalStack.size).toBe(0);
    s.button.click(); expect(s.isOpen).toBe(true);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true })); expect(s.isOpen).toBe(false);
    s.button.click(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect(s.isOpen).toBe(false);
    lis(s)[2]!.click(); expect(s.value).toBe('d'); // disabled option ignored
    s.remove();
  });

  it('disabled select never opens; setOptions keeps / falls back the value; removal while open cleans the stack', () => {
    const s = makeSelect(OPTS, 'a', 'Fruit'); document.body.append(s);
    s.disabled = true; s.button.click(); expect(s.isOpen).toBe(false); s.disabled = false;
    s.setOptions([{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }]); expect(s.value).toBe('x');
    s.setOptions([{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }], 'y'); expect(s.value).toBe('y');
    s.button.click(); expect(modalStack.size).toBe(1);
    s.remove(); expect(modalStack.size).toBe(0);
  });
});
