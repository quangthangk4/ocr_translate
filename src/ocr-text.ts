// English dialogue: preserve numbers, contractions and basic sentence punctuation.
// Exclude noisy symbols such as =, |, _, :, ;, @ and decorative marks in OCR itself.
export const OCR_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?\'"-()\n';

/** Character offsets of sentence-initial letters in the normalized ASCII text. */
export function sentenceInitials(text: string): number[] {
  const positions: number[] = [];
  let start = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/[a-z]/i.test(c)) { if (start) positions.push(i); start = false; }
    else if (/\d/.test(c)) start = false;
    else if (/[.!?]/.test(c) && !(c === '.' && /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? ''))) start = true;
  }
  return positions;
}

/** One plain, selectable string for display, storage and clipboard. */
export function plainOcrText(text: string): string {
  const clean = text
    .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/[^a-zA-Z0-9\s.,!?'"()\-]+/g, ' ')
    .replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1')
    .replace(/([.,!?])(?=[a-zA-Z])/g, '$1 ')
    .trim().toLowerCase();
  const characters = [...clean];
  for (const index of sentenceInitials(clean)) characters[index] = characters[index].toUpperCase();
  // English's pronoun I and contractions (I'm, I've, I'd) remain capitalized.
  return characters.join('').replace(/\bi\b/g, 'I');
}
