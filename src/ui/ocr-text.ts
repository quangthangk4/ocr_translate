import { plainOcrText, sentenceInitials } from '../ocr-text';

/** Light DOM text, assigned to a slot in the card so document.getSelection() works
 * for other translation extensions. Never insert recognized text as HTML. */
export function createOcrText(id: string, text: string) {
  const element = document.createElement('div');
  element.slot = `ocr-${id}`;
  element.dataset.comicLensOcr = id;
  element.lang = 'en';
  element.style.cssText = 'all:initial!important;display:block!important;position:static!important;visibility:inherit!important;pointer-events:auto!important;user-select:text!important;-webkit-user-select:text!important;font:normal 400 16px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif!important;color:var(--text,#172033)!important;white-space:normal!important;overflow-wrap:anywhere!important;text-transform:none!important;letter-spacing:normal!important;cursor:text!important;';
  const plain = plainOcrText(text);
  let previous = 0;
  for (const index of sentenceInitials(plain)) {
    element.append(document.createTextNode(plain.slice(previous, index)));
    const initial = document.createElement('strong');
    initial.style.cssText = 'all:unset!important;font:inherit!important;font-weight:700!important;color:inherit!important;user-select:text!important;-webkit-user-select:text!important;';
    initial.textContent = plain[index]; element.append(initial); previous = index + 1;
  }
  element.append(document.createTextNode(plain.slice(previous)));
  const slot = document.createElement('slot'); slot.name = element.slot;
  return { element, slot };
}
