/**
 * Swap a label in a widget for a text input (Enter or leaving saves, Esc
 * cancels), then put the label back. Used where a widget replaces raw text
 * that the user can still edit (code block names, image captions).
 */
export function editInPlace(
  label: HTMLElement,
  options: { value: string; placeholder: string; className: string; onSave: (value: string) => void; onDone: () => void },
): void {
  const input = document.createElement('input');
  input.className = options.className;
  input.value = options.value;
  input.placeholder = options.placeholder;
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    if (save && input.value !== options.value) options.onSave(input.value);
    input.replaceWith(label);
    options.onDone();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  label.replaceWith(input);
  input.focus();
  input.select();
}
